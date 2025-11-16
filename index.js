require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const Stripe = require("stripe");

const app = express();

// --- Config from .env ---
const {
  PORT = 3000,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_METER_EVENT_NAME,
  TOGGL_API_TOKEN,
  TOGGL_WORKSPACE_ID,
  TODOIST_API_TOKEN,
  USAGE_JOB_SECRET,
} = process.env;

const stripe = Stripe(STRIPE_SECRET_KEY);

// In-memory "DB" for now (replace with Postgres later)
const customerMappings = [];

// For Stripe webhooks we need raw body
app.post(
  "/webhooks/stripe",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    let event;

    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("⚠️  Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // We care about subscription-related events
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        await handleCheckoutSessionCompleted(session);
      } catch (err) {
        console.error("Error handling checkout.session.completed:", err);
        return res.status(500).send("Webhook handler error");
      }
    }

    res.json({ received: true });
  }
);

// Toggl + Todoist + mapping logic for new subscription
async function handleCheckoutSessionCompleted(session) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const priceId =
    session.metadata && session.metadata.price_id
      ? session.metadata.price_id
      : null;

  // Fetch full customer to get company / name
  const customer = await stripe.customers.retrieve(customerId);

  const companyName =
    customer.metadata?.company_name ||
    customer.name ||
    session.metadata?.company_name ||
    "Unknown Company";

  // You can derive plan from line_items on the subscription if needed
  // For now we'll just store priceId as "planName"
  const planName = priceId || "Unknown Plan";

  const baseProjectName = `${companyName} – Website Support (${planName})`;

  console.log("Creating Toggl client/project for:", baseProjectName);

  // 1) Create Toggl Client
  const togglClientId = await createTogglClient(companyName);

  // 2) Create Toggl Project
  const togglProjectId = await createTogglProject(
    baseProjectName,
    togglClientId
  );

  console.log("Creating Todoist project for:", baseProjectName);

  // 3) Create Todoist Project
  const todoistProjectId = await createTodoistProject(baseProjectName);

  // 4) Save mapping in memory
  const mapping = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    companyName,
    planName,
    togglClientId,
    togglProjectId,
    todoistProjectId,
    lastUsageSyncAt: null,
  };

  customerMappings.push(mapping);

  console.log("Mapping stored:", mapping);
}

// --- Toggl helpers ---

async function createTogglClient(name) {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${TOGGL_WORKSPACE_ID}/clients`;

  const res = await axios.post(
    url,
    { name },
    {
      auth: {
        username: TOGGL_API_TOKEN,
        password: "api_token",
      },
    }
  );

  return res.data.id;
}

async function createTogglProject(projectName, clientId) {
  const url = `https://api.track.toggl.com/api/v9/workspaces/${TOGGL_WORKSPACE_ID}/projects`;

  const res = await axios.post(
    url,
    {
      name: projectName,
      client_id: clientId,
      active: true,
      billable: true,
    },
    {
      auth: {
        username: TOGGL_API_TOKEN,
        password: "api_token",
      },
    }
  );

  return res.data.id;
}

// --- Todoist helper ---

async function createTodoistProject(projectName) {
  const url = "https://api.todoist.com/rest/v2/projects";

  const res = await axios.post(
    url,
    { name: projectName },
    {
      headers: {
        Authorization: `Bearer ${TODOIST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.id;
}

// --- Usage sync job endpoint ---
// Render cron or any scheduler can POST here with ?secret=...

app.post("/jobs/sync-usage", express.json(), async (req, res) => {
  const { secret } = req.query;
  if (!secret || secret !== USAGE_JOB_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // For now, just sync for all mappings using current month as window
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startIso = startOfMonth.toISOString();
    const endIso = now.toISOString();

    for (const mapping of customerMappings) {
      await syncUsageForMapping(mapping, startIso, endIso);
    }

    res.json({ status: "ok", synced: customerMappings.length });
  } catch (err) {
    console.error("Error in sync-usage job:", err);
    res.status(500).json({ error: "Job failed" });
  }
});

async function syncUsageForMapping(mapping, startIso, endIso) {
  console.log(
    `Syncing usage for ${mapping.companyName} (${mapping.stripeCustomerId})`
  );

  const timeEntries = await fetchTogglTimeEntries(
    mapping.togglProjectId,
    startIso,
    endIso
  );

  const totalSeconds = timeEntries.reduce((sum, e) => {
    if (e.billable && e.duration > 0) {
      return sum + e.duration;
    }
    return sum;
  }, 0);

  const hours = totalSeconds / 3600;
  const hoursRounded = Number(hours.toFixed(2));

  console.log(
    `Total billable seconds: ${totalSeconds}, hours: ${hoursRounded}`
  );

  if (hoursRounded <= 0) {
    console.log("No hours to report. Skipping Stripe meter event.");
    return;
  }

  // Send usage to Stripe meter
  await stripe.billing.meterEvents.create({
    event_name: STRIPE_METER_EVENT_NAME,
    payload: {
      stripe_customer_id: mapping.stripeCustomerId,
      value: hoursRounded,
      project_id: mapping.togglProjectId.toString(),
    },
  });

  console.log("Stripe meter event sent with value:", hoursRounded);
}

async function fetchTogglTimeEntries(projectId, startIso, endIso) {
  const url = `https://api.track.toggl.com/api/v9/me/time_entries?start_date=${encodeURIComponent(
    startIso
  )}&end_date=${encodeURIComponent(endIso)}`;

  const res = await axios.get(url, {
    auth: {
      username: TOGGL_API_TOKEN,
      password: "api_token",
    },
  });

  const allEntries = res.data;

  // Only entries from this project
  return allEntries.filter((e) => e.project_id === projectId);
}

// --- Healthcheck ---

app.get("/", (req, res) => {
  res.send("Stripe–Toggl–Todoist microservice is running.");
});

// --- Start server ---

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
