// index.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const Stripe = require('stripe');
const {
  initDb,
  upsertCustomerMapping,
  getAllMappings,
  updateLastSynced,
} = require('./db');

const app = express();
const port = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// ---------- Config / env ----------

const USAGE_JOB_SECRET = process.env.USAGE_JOB_SECRET;
const TOGGL_WORKSPACE_ID = process.env.TOGGL_WORKSPACE_ID;
const TODOIST_WORKSPACE_ID = process.env.TODOIST_WORKSPACE_ID;
const STRIPE_METER_EVENT_NAME =
  process.env.STRIPE_METER_EVENT_NAME || 'billable_hours';

// ---------- HTTP clients ----------

const togglApi = axios.create({
  baseURL: 'https://api.track.toggl.com/api/v9',
  auth: {
    username: process.env.TOGGL_API_TOKEN,
    password: 'api_token',
  },
});

const todoistApi = axios.create({
  baseURL: 'https://api.todoist.com/rest/v2',
  headers: {
    Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// ---------- Stripe Webhook (raw body) ----------

app.post(
  '/webhooks/stripe',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('❌ Error verifying Stripe webhook', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionCreatedOrUpdated(event.data.object);
          break;
        default:
          // ignore everything else
          break;
      }

      res.json({ received: true });
    } catch (err) {
      console.error('❌ Error handling Stripe webhook event', err);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

// All other routes: normal JSON body
app.use(bodyParser.json());

// ---------- Subscription handler ----------

async function handleSubscriptionCreatedOrUpdated(subscription) {
  const customerId = subscription.customer;
  const priceItem = subscription.items?.data?.[0]?.price;

  if (!customerId || !priceItem) {
    console.warn('Subscription missing customer or price', subscription.id);
    return;
  }

  const priceId = priceItem.id;

  // Fetch customer + product so we can use company name and product name
  const [customer, product] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.products.retrieve(priceItem.product),
  ]);

  // Prefer company name from metadata, then fallback
  const companyName =
    (customer.metadata && customer.metadata.company_name) ||
    (subscription.metadata && subscription.metadata.company_name) ||
    customer.name ||
    customer.email ||
    'Unknown Customer';

  const productName = product.name || 'Website Support';
  const planName =
    priceItem.nickname ||
    (priceItem.metadata && priceItem.metadata.plan_name) ||
    'Unknown Plan';

  const planLabel = `${productName} (${planName})`;

  const togglClientId = await findOrCreateTogglClient(companyName);
  const togglProjectId = await findOrCreateTogglProject(
    togglClientId,
    companyName,
    productName,
    planName
  );
  const todoistProjectId = await findOrCreateTodoistProject(
    companyName,
    productName,
    planName
  );

  await upsertCustomerMapping({
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    company_name: companyName,
    plan_label: planLabel,
    toggl_client_id: togglClientId,
    toggl_project_id: togglProjectId,
    todoist_project_id: todoistProjectId,
  });

  console.log(
    `✅ Mapping upserted for subscription ${subscription.id} – ${companyName} (${planLabel})`
  );
}

// ---------- Toggl helpers ----------

async function findOrCreateTogglClient(clientName) {
  if (!TOGGL_WORKSPACE_ID) {
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

  try {
    const res = await togglApi.get(
      `/workspaces/${TOGGL_WORKSPACE_ID}/clients`
    );
    const existing = res.data.find((c) => c.name === clientName);
    if (existing) {
      return existing.id;
    }
  } catch (err) {
    console.error('Error fetching Toggl clients', err.response?.data || err);
  }

  const payload = { name: clientName };

  const createRes = await togglApi.post(
    `/workspaces/${TOGGL_WORKSPACE_ID}/clients`,
    payload
  );

  return createRes.data.id;
}

async function findOrCreateTogglProject(
  clientId,
  companyName,
  productName,
  planName
) {
  if (!TOGGL_WORKSPACE_ID) {
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

  const projectName = `${companyName} – ${productName} (${planName})`;

  try {
    const res = await togglApi.get(
      `/workspaces/${TOGGL_WORKSPACE_ID}/projects`
    );
    const existing = res.data.find((p) => p.name === projectName);
    if (existing) {
      return existing.id;
    }
  } catch (err) {
    console.error('Error fetching Toggl projects', err.response?.data || err);
  }

  const payload = {
    name: projectName,
    client_id: clientId,
    is_private: true,
    billable: true,
    active: true,
  };

  const createRes = await togglApi.post(
    `/workspaces/${TOGGL_WORKSPACE_ID}/projects`,
    payload
  );
  return createRes.data.id;
}

async function fetchTogglBillableSecondsForProject(projectId, since, until) {
  const params = {
    start_date: since.toISOString(),
    end_date: until.toISOString(),
  };

  const res = await togglApi.get('/me/time_entries', { params });

  const entries = res.data || [];
  let totalSeconds = 0;

  entries.forEach((e) => {
    if (
      e.project_id === projectId &&
      e.billable &&
      typeof e.duration === 'number' &&
      e.duration > 0
    ) {
      totalSeconds += e.duration;
    }
  });

  return totalSeconds;
}

// ---------- Todoist helpers ----------

async function findOrCreateTodoistProject(
  companyName,
  productName,
  planName
) {
  const projectName = `${companyName} – ${productName} (${planName})`;

  try {
    const res = await todoistApi.get('/projects');
    const existing = res.data.find((p) => p.name === projectName);
    if (existing) {
      return existing.id;
    }
  } catch (err) {
    console.error('Error fetching Todoist projects', err.response?.data || err);
  }

  const payload = { name: projectName };

  // This is what makes it land in SPYCE, not "My Projects"
  if (TODOIST_WORKSPACE_ID) {
    payload.workspace_id = TODOIST_WORKSPACE_ID;
  }

  const createRes = await todoistApi.post('/projects', payload);
  return createRes.data.id;
}

// ---------- Usage sync job (Render Cron) ----------

app.post('/jobs/sync-usage', async (req, res) => {
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const mappings = await getAllMappings();
    const now = new Date();
    let syncedCount = 0;

    for (const mapping of mappings) {
      const since =
        mapping.last_synced_at ||
        new Date(now.getTime() - 24 * 60 * 60 * 1000); // default: last 24h

      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        new Date(since),
        now
      );

      const hours = totalSeconds / 3600;

      if (hours <= 0) {
        continue;
      }

      const form = new URLSearchParams();
      form.append('event_name', STRIPE_METER_EVENT_NAME);
      form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
      form.append('payload[value]', hours.toFixed(2));
      form.append('payload[project_id]', String(mapping.toggl_project_id));

      await axios.post(
        'https://api.stripe.com/v1/billing/meter_events',
        form.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: process.env.STRIPE_SECRET_KEY,
            password: '',
          },
        }
      );

      await updateLastSynced(mapping.stripe_subscription_id, now);

      console.log(
        `✅ Sent ${hours.toFixed(
          2
        )}h for customer ${mapping.stripe_customer_id} (project ${
          mapping.toggl_project_id
        })`
      );
      syncedCount += 1;
    }

    res.json({ status: 'ok', synced: syncedCount });
  } catch (err) {
    console.error('❌ Error in sync-usage job', err);
    res.status(500).json({ error: 'sync-usage failed' });
  }
});

// ---------- Healthcheck & startup ----------

app.get('/', (req, res) => {
  res.send('Stripe → Toggl → Todoist microservice is running');
});

(async () => {
  try {
    await initDb();
    app.listen(port, () => {
      console.log(`🚀 Server listening on port ${port}`);
    });
  } catch (err) {
    console.error('❌ Failed to start service', err);
    process.exit(1);
  }
})();
