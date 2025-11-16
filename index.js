// index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const Stripe = require("stripe");
const {
  initDb,
  upsertMapping,
  getActiveMappings,
  getAllMappings,
} = require("./db");

const app = express();

// ---- ENV CONFIG ----
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

if (!STRIPE_SECRET_KEY) console.warn("⚠ STRIPE_SECRET_KEY not set");
if (!STRIPE_WEBHOOK_SECRET) console.warn("⚠ STRIPE_WEBHOOK_SECRET not set");
if (!STRIPE_METER_EVENT_NAME) console.warn("⚠ STRIPE_METER_EVENT_NAME not set");
if (!TOGGL_API_TOKEN) console.warn("⚠ TOGGL_API_TOKEN not set");
if (!TOGGL_WORKSPACE_ID) console.warn("⚠ TOGGL_WORKSPACE_ID not set");
if (!TODOIST_API_TOKEN) console.warn("⚠ TODOIST_API_TOKEN not set");
if (!USAGE_JOB_SECRET) console.warn("⚠ USAGE_JOB_SECRET not set");

const stripe = Stripe(STRIPE_SECRET_KEY);

// ---------- STRIPE WEBHOOK (RAW BODY) ----------
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
      console.log("✅ Stripe webhook received:", event.type);
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await handleCheckoutSessionCompleted(session);
      }

      res.json({ received: true });
    } catch (err) {
      console.error("❌ Error handling Stripe webhook:", err);
      res.status(500).send("Webhook handler error");
    }
  }
);

// ---------- JSON BODY FOR EVERYTHING ELSE ----------
app.use(bodyParser.json());

// Healthcheck
app.get("/", (req, res) => {
  res.send("Stripe–Toggl–Todoist microservice is running.");
});

// Debug endpoint: list mappings (protect with a secret in real life)
app.get("/admin/mappings", async (req, res) => {
  const rows = await getAllMappings();
  res.json(rows);
});

// Cron job endpoint – called by Render cron
app.post("/jobs/sync-usage", async (req, res) => {
  const { secret } = req.query;
  if (!secret || secret !== USAGE_JOB_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    console.log("🔁 Running usage sync job...");

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startIso = startOfMonth.toISOString();
    const endIso = now.toISOString();

    const mappings = await getActiveMappings();
    console.log(`   → Found ${mappings.length} active mappings`);

    let processed = 0;
    for (const mapping of mappings) {
      await syncUsageForMapping(mapping, startIso, endIso);
      processed++;
    }

    res.json({ status: "ok", synced: processed });
  } catch (err) {
    console.error("❌ Error in sync-usage job:", err);
    res.status(500).json({ error: "Job failed" });
  }
});

// ---------- HANDLER: checkout.session.completed ----------

async function handleCheckoutSessionCompleted(session) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  console.log(
    `🧾 checkout.session.completed for customer ${customerId}, subscription ${subscriptionId}`
  );

  // 1) Fetch full customer data from Stripe
  const customer = await stripe.customers.retrieve(customerId);

  const companyName =
    customer.metadata?.company_name ||
    customer.name ||
    session.metadata?.company_name ||
    "Unknown Company";

  const planName =
    session.metadata?.plan_name ||
    (session.mode === "subscription" && session.display_items
      ? "Subscription"
      : "Unknown Plan");

  const projectName = `${companyName} – Website Support (${planName})`;

  console.log("🧱 Creating Toggl client/project for:", projectName);

  // 2) Create Toggl Client + Project
  const togglClientId = await createTogglClient(companyName);
  const togglProjectId = await createTogglProject(projectName, togglClientId);

  console.log("📁 Creating Todoist project for:", projectName);

  // 3) Create Todoist Project
  const todoistProjectId = await createTodoistProject(projectName);

  // 4) Save mapping in Postgres
  const mapping = await upsertMapping({
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    company_name: companyName,
    plan_name: planName,
    toggl_client_id: togglClientId,
    toggl_project_id: togglProjectId,
    todoist_project_id: todoistProjectId,
  });

  console.log("✅ Mapping stored in DB:", mapping);
}

// ---------- TOGGL HELPERS ----------

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

  console.log("   → Toggl client created with id:", res.data.id);
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

  console.log("   → Toggl project created with id:", res.data.id);
  return res.data.id;
}

// ---------- TODOIST HELPER ----------

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

  console.log("   → Todoist project created with id:", res.data.id);
  return res.data.id;
}

// ---------- USAGE SYNC LOGIC ----------

async function syncUsageForMapping(mapping, startIso, endIso) {
  console.log(
    `⏱ Syncing usage for ${mapping.company_name} (${mapping.stripe_customer_id})`
  );

  const timeEntries = await fetchTogglTimeEntries(
    mapping.toggl_project_id,
    startIso,
    endIso
  );

  const totalSeconds = timeEntries.reduce((sum, e) => {
    if (e.billable && e.duration > 0) return sum + e.duration;
    return sum;
  }, 0);

  const hours = totalSeconds / 3600;
  const hoursRounded = Number(hours.toFixed(2));

  console.log(
    `   → Total billable seconds: ${totalSeconds}, hours: ${hoursRounded}`
  );

  if (hoursRounded <= 0) {
    console.log("   → No hours to report. Skipping Stripe meter event.");
    return;
  }

  await stripe.billing.meterEvents.create({
    event_name: STRIPE_METER_EVENT_NAME,
    payload: {
      stripe_customer_id: mapping.stripe_customer_id,
      value: hoursRounded,
      project_id: mapping.toggl_project_id.toString(),
    },
  });

  console.log("   → Stripe meter event sent with value:", hoursRounded);
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
  return allEntries.filter((e) => e.project_id === projectId);
}

// ---------- START SERVER ----------
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to init DB:", err);
    process.exit(1);
  }
})();
