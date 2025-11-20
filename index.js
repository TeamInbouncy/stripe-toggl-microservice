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
        case 'checkout.session.completed':
          await handleCheckoutSessionCompleted(event.data.object);
          break;
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

// ---------- Checkout Session Handler ----------

async function handleCheckoutSessionCompleted(session) {
  if (session.mode !== 'subscription') return;
  
  const customerId = session.customer;
  if (!customerId) return;

  try {
    // Extract company name from custom fields - try multiple possible field names
    let companyName = null;
    if (session.custom_fields && session.custom_fields.length > 0) {
      const possibleFieldNames = ['company_name', 'company', 'business_name', 'business', 'organization', 'org_name'];
      
      for (const field of session.custom_fields) {
        const fieldKey = field.key?.toLowerCase();
        const fieldLabel = field.label?.toLowerCase();
        
        // Check if field matches any of our possible names
        const isCompanyField = possibleFieldNames.some(name => 
          fieldKey?.includes(name) || fieldLabel?.includes(name)
        );
        
        if (isCompanyField && field.text && field.text.value) {
          companyName = field.text.value;
          console.log(`✅ Found company name from field "${field.key}": ${companyName}`);
          break;
        }
      }
      
      // If still not found, try to get the first custom text field
      if (!companyName) {
        const firstTextField = session.custom_fields.find(field => 
          field.text && field.text.value
        );
        if (firstTextField) {
          companyName = firstTextField.text.value;
          console.log(`⚠️ Using first custom field "${firstTextField.key}" as company name: ${companyName}`);
        }
      }
    }

    // Fallback to customer name if no company name found
    if (!companyName && session.customer_details && session.customer_details.name) {
      companyName = session.customer_details.name;
      console.log(`ℹ️ Using customer name as company name: ${companyName}`);
    }

    // If we found company name, update customer metadata
    if (companyName) {
      await stripe.customers.update(customerId, {
        metadata: { company_name: companyName }
      });
      console.log(`✅ Updated company name for customer ${customerId}: ${companyName}`);
    } else {
      console.log(`⚠️ No company name found in custom fields for customer ${customerId}`);
    }
  } catch (err) {
    console.error('❌ Error handling checkout.session.completed', err);
  }
}

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

  // Improved company name extraction with better priority
  const companyName =
    (customer.metadata && customer.metadata.company_name) ||
    (subscription.metadata && subscription.metadata.company_name) ||
    customer.name ||
    customer.email ||
    'Unknown Customer';

  // Extract product name and plan name from the full product name
  const fullProductName = product.name || 'Website Support | Plan';
  
  // Split the product name to get base product and plan
  const productParts = fullProductName.split('|');
  const productName = productParts[0]?.trim() || 'Website Support';
  const planName = productParts[1]?.trim() || 'Plan';

  // Clean plan label without "Unknown Plan"
  const planLabel = `${productName} | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();

  console.log(`📝 Product Analysis - Full: "${fullProductName}", Product: "${productName}", Plan: "${planName}"`);

  const togglClientId = await findOrCreateTogglClient(companyName);
  const togglProjectId = await findOrCreateTogglProject(
    togglClientId,
    planLabel
  );
  
  // Todoist project name should be "Company Name – Product Name"
  const todoistProjectName = `${companyName} – ${planLabel}`;
  const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);

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

async function findOrCreateTogglProject(clientId, projectName) {
  if (!TOGGL_WORKSPACE_ID) {
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

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

  try {
    const res = await togglApi.get('/me/time_entries', { params });

    const entries = res.data || [];
    let totalSeconds = 0;

    console.log(`   📊 Found ${entries.length} total time entries in Toggl`);

    entries.forEach((e) => {
      if (
        e.project_id === projectId &&
        e.billable &&
        typeof e.duration === 'number' &&
        e.duration > 0
      ) {
        totalSeconds += e.duration;
        console.log(`   ✅ Counting entry: ${e.description} - ${e.duration} seconds`);
      }
    });

    return totalSeconds;
  } catch (err) {
    console.error('Error fetching Toggl time entries', err.response?.data || err);
    return 0;
  }
}

// ---------- Todoist helpers ----------

async function findOrCreateTodoistProject(projectName) {
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

    console.log(`🕒 Starting sync job for ${mappings.length} mappings`);

    for (const mapping of mappings) {
      const since =
        mapping.last_synced_at ||
        new Date(now.getTime() - 24 * 60 * 60 * 1000);

      console.log(`🔍 Checking project ${mapping.toggl_project_id} for customer ${mapping.stripe_customer_id}`);
      console.log(`   Company: ${mapping.company_name}, Plan: ${mapping.plan_label}`);
      console.log(`   Time range: ${since.toISOString()} to ${now.toISOString()}`);

      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        new Date(since),
        now
      );

      const hours = totalSeconds / 3600;

      console.log(`   Found ${totalSeconds} seconds (${hours.toFixed(2)} hours) for project ${mapping.toggl_project_id}`);

      if (hours <= 0) {
        console.log(`   ⏭️  No hours to sync for project ${mapping.toggl_project_id}`);
        continue;
      }

      try {
        const form = new URLSearchParams();
        form.append('event_name', STRIPE_METER_EVENT_NAME);
        form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
        form.append('payload[value]', hours.toFixed(2));
        form.append('payload[project_id]', String(mapping.toggl_project_id));

        console.log(`   📤 Sending ${hours.toFixed(2)}h to Stripe for customer ${mapping.stripe_customer_id}`);

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
          `✅ Successfully sent ${hours.toFixed(2)}h for customer ${mapping.stripe_customer_id}`
        );
        syncedCount += 1;
      } catch (stripeErr) {
        console.error(`❌ Stripe API error for customer ${mapping.stripe_customer_id}:`, stripeErr.response?.data || stripeErr.message);
      }
    }

    console.log(`✅ Sync job completed. Synced ${syncedCount} customers`);
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