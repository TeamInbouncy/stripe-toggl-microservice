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

console.log('🔧 [CONFIG] Environment check:');
console.log('   - TOGGL_WORKSPACE_ID:', TOGGL_WORKSPACE_ID);
console.log('   - TODOIST_WORKSPACE_ID:', TODOIST_WORKSPACE_ID);
console.log('   - STRIPE_METER_EVENT_NAME:', STRIPE_METER_EVENT_NAME);
console.log('   - USAGE_JOB_SECRET exists:', !!USAGE_JOB_SECRET);

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
    console.log('\n🔄 [WEBHOOK] Stripe webhook received');
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log('✅ [WEBHOOK] Signature verified - Event type:', event.type);
    } catch (err) {
      console.error('❌ [WEBHOOK] Error verifying signature:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      console.log('🎯 [WEBHOOK] Processing event:', event.type);
      
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutSessionCompleted(event.data.object);
          break;
        case 'customer.subscription.created':
          await handleSubscriptionCreatedOrUpdated(event.data.object);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionCreatedOrUpdated(event.data.object);
          break;
        default:
          console.log('⏭️ [WEBHOOK] Ignoring event type:', event.type);
          break;
      }

      console.log('✅ [WEBHOOK] Event processed successfully');
      res.json({ received: true });
    } catch (err) {
      console.error('❌ [WEBHOOK] Error processing event:', err);
      console.error('🔴 [WEBHOOK] Error details:', err.message);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

// All other routes: normal JSON body
app.use(bodyParser.json());

// ---------- Checkout Session Handler ----------

async function handleCheckoutSessionCompleted(session) {
  console.log('\n🛒 [CHECKOUT] Handling checkout.session.completed');
  console.log('📋 [CHECKOUT] Session ID:', session.id);
  
  if (session.mode !== 'subscription') {
    console.log('⏭️ [CHECKOUT] Not a subscription session - skipping');
    return;
  }
  
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  
  if (!customerId || !subscriptionId) {
    console.log('❌ [CHECKOUT] Missing customer ID or subscription ID');
    return;
  }

  console.log('👤 [CHECKOUT] Customer ID:', customerId);
  console.log('📝 [CHECKOUT] Subscription ID:', subscriptionId);

  try {
    // Extract COMPANY NAME from custom fields
    let companyName = null;
    
    if (session.custom_fields && session.custom_fields.length > 0) {
      console.log('🔍 [CHECKOUT] Checking custom fields for COMPANY NAME...');
      
      const possibleFieldNames = ['company_name', 'company', 'business_name', 'business', 'organization', 'org_name'];
      
      for (const field of session.custom_fields) {
        const fieldKey = field.key ? String(field.key).toLowerCase() : '';
        const fieldLabel = field.label ? String(field.label).toLowerCase() : '';
        
        console.log(`   📝 [CHECKOUT] Field: ${field.key} = "${field.text?.value}"`);
        
        // Check if field matches any of our possible company name fields
        const isCompanyField = possibleFieldNames.some(name => 
          fieldKey.includes(name) || fieldLabel.includes(name)
        );
        
        if (isCompanyField && field.text && field.text.value) {
          companyName = field.text.value;
          console.log(`✅ [CHECKOUT] FOUND COMPANY NAME: "${companyName}"`);
          break;
        }
      }
    }

    // IMPORTANT: If no company name found, we can't proceed
    if (!companyName) {
      console.log('❌ [CHECKOUT] No company name found in custom fields - cannot proceed');
      return;
    }

    // Update customer metadata with COMPANY NAME
    console.log(`💾 [CHECKOUT] Updating customer metadata with COMPANY NAME: "${companyName}"`);
    await stripe.customers.update(customerId, {
      metadata: { company_name: companyName }
    });
    console.log(`✅ [CHECKOUT] Updated customer metadata with company name`);

    // NOW PROCESS THE SUBSCRIPTION WITH THE COMPANY NAME
    console.log('🔄 [CHECKOUT] Now processing subscription with company name...');
    await processSubscriptionWithCompanyName(subscriptionId, companyName);

  } catch (err) {
    console.error('❌ [CHECKOUT] Error:', err);
  }
}

// ---------- Process Subscription with Company Name ----------

async function processSubscriptionWithCompanyName(subscriptionId, companyName) {
  console.log('\n🎯 [SUBSCRIPTION-PROCESS] Processing subscription with company name');
  console.log('📝 [SUBSCRIPTION-PROCESS] Subscription ID:', subscriptionId);
  console.log('🏢 [SUBSCRIPTION-PROCESS] Company Name:', companyName);
  
  try {
    // Retrieve the subscription
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = subscription.customer;
    const priceItem = subscription.items?.data?.[0]?.price;

    if (!customerId || !priceItem) {
      console.warn('❌ [SUBSCRIPTION-PROCESS] Missing customer or price');
      return;
    }

    const priceId = priceItem.id;
    console.log('💰 [SUBSCRIPTION-PROCESS] Price ID:', priceId);

    // Fetch product data
    console.log('📡 [SUBSCRIPTION-PROCESS] Fetching product data...');
    const product = await stripe.products.retrieve(priceItem.product);
    console.log('📦 [SUBSCRIPTION-PROCESS] Product name:', product.name);

    // PLAN NAME EXTRACTION - from product name
    let planName = 'Plan';
    
    // Extract from product name format: "Website Support | Lite Plan"
    if (product.name) {
      const productParts = product.name.split('|');
      if (productParts[1]) {
        planName = productParts[1].trim();
        console.log(`✅ [SUBSCRIPTION-PROCESS] Extracted plan name: "${planName}"`);
      } else {
        planName = product.name.trim();
        console.log(`⚠️ [SUBSCRIPTION-PROCESS] Using full product name: "${planName}"`);
      }
    }

    // Clean plan label - REMOVE "(Unknown Plan)" 
    const planLabel = `Website Support | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();
    console.log(`🏷️ [SUBSCRIPTION-PROCESS] Final plan label: "${planLabel}"`);

    // TOGGL INTEGRATION - USING COMPANY NAME FOR CLIENT
    console.log('\n🔧 [TOGGL] Starting Toggl integration...');
    console.log(`🏢 [TOGGL] Creating Toggl client with COMPANY NAME: "${companyName}"`);
    
    const togglClientId = await findOrCreateTogglClient(companyName);
    console.log(`✅ [TOGGL] Client ID: ${togglClientId}`);

    console.log(`📋 [TOGGL] Creating Toggl project: "${planLabel}"`);
    const togglProjectId = await findOrCreateTogglProject(togglClientId, planLabel);
    console.log(`✅ [TOGGL] Project ID: ${togglProjectId}`);

    // TODOIST INTEGRATION
    console.log('\n🔧 [TODOIST] Starting Todoist integration...');
    const todoistProjectName = `${companyName} – ${planLabel}`;
    console.log(`📋 [TODOIST] Creating project: "${todoistProjectName}"`);
    
    const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);
    console.log(`✅ [TODOIST] Project ID: ${todoistProjectId}`);

    // SAVE TO DATABASE
    console.log('\n💾 [DATABASE] Saving mapping...');
    await upsertCustomerMapping({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_price_id: priceId,
      company_name: companyName,
      plan_label: planLabel,
      toggl_client_id: togglClientId,
      toggl_project_id: togglProjectId,
      todoist_project_id: todoistProjectId,
    });

    console.log(`✅ [SUBSCRIPTION-PROCESS] Completed for COMPANY: "${companyName}" with PLAN: "${planLabel}"`);

  } catch (err) {
    console.error('❌ [SUBSCRIPTION-PROCESS] Error:', err);
  }
}

// ---------- Subscription handler (for existing subscriptions) ----------

async function handleSubscriptionCreatedOrUpdated(subscription) {
  console.log('\n🎯 [SUBSCRIPTION] Handling subscription (existing)');
  console.log('📝 [SUBSCRIPTION] ID:', subscription.id);
  console.log('👤 [SUBSCRIPTION] Customer:', subscription.customer);
  
  const customerId = subscription.customer;
  const priceItem = subscription.items?.data?.[0]?.price;

  if (!customerId || !priceItem) {
    console.warn('❌ [SUBSCRIPTION] Missing customer or price');
    return;
  }

  const priceId = priceItem.id;
  console.log('💰 [SUBSCRIPTION] Price ID:', priceId);

  try {
    // Fetch customer + product data
    console.log('📡 [SUBSCRIPTION] Fetching customer and product data...');
    const [customer, product] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.products.retrieve(priceItem.product),
    ]);

    console.log('📋 [SUBSCRIPTION] Customer data:', {
      name: customer.name,
      email: customer.email,
      metadata: customer.metadata
    });

    console.log('📦 [SUBSCRIPTION] Product name:', product.name);

    // COMPANY NAME EXTRACTION - for existing subscriptions
    let companyName = null;
    
    // Priority 1: customer.metadata.company_name (from checkout custom field)
    if (customer.metadata && customer.metadata.company_name) {
      companyName = customer.metadata.company_name;
      console.log(`✅ [SUBSCRIPTION] Using COMPANY NAME from customer metadata: "${companyName}"`);
    }
    // Priority 2: subscription.metadata.company_name
    else if (subscription.metadata && subscription.metadata.company_name) {
      companyName = subscription.metadata.company_name;
      console.log(`✅ [SUBSCRIPTION] Using COMPANY NAME from subscription metadata: "${companyName}"`);
    }
    // If no company name found, we can't proceed
    else {
      console.log('❌ [SUBSCRIPTION] No company name found in metadata');
      console.log('⚠️ [SUBSCRIPTION] Cannot create Toggl client without company name');
      return;
    }

    console.log(`🏢 [SUBSCRIPTION] FINAL COMPANY NAME: "${companyName}"`);

    // PLAN NAME EXTRACTION - from product name
    let planName = 'Plan';
    
    // Extract from product name format: "Website Support | Lite Plan"
    if (product.name) {
      const productParts = product.name.split('|');
      if (productParts[1]) {
        planName = productParts[1].trim();
        console.log(`✅ [SUBSCRIPTION] Extracted plan name: "${planName}"`);
      } else {
        planName = product.name.trim();
        console.log(`⚠️ [SUBSCRIPTION] Using full product name: "${planName}"`);
      }
    }

    // Clean plan label - REMOVE "(Unknown Plan)" 
    const planLabel = `Website Support | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();
    console.log(`🏷️ [SUBSCRIPTION] Final plan label: "${planLabel}"`);

    // TOGGL INTEGRATION - USING COMPANY NAME FOR CLIENT
    console.log('\n🔧 [TOGGL] Starting Toggl integration...');
    console.log(`🏢 [TOGGL] Creating Toggl client with COMPANY NAME: "${companyName}"`);
    
    const togglClientId = await findOrCreateTogglClient(companyName);
    console.log(`✅ [TOGGL] Client ID: ${togglClientId}`);

    console.log(`📋 [TOGGL] Creating Toggl project: "${planLabel}"`);
    const togglProjectId = await findOrCreateTogglProject(togglClientId, planLabel);
    console.log(`✅ [TOGGL] Project ID: ${togglProjectId}`);

    // TODOIST INTEGRATION
    console.log('\n🔧 [TODOIST] Starting Todoist integration...');
    const todoistProjectName = `${companyName} – ${planLabel}`;
    console.log(`📋 [TODOIST] Creating project: "${todoistProjectName}"`);
    
    const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);
    console.log(`✅ [TODOIST] Project ID: ${todoistProjectId}`);

    // SAVE TO DATABASE
    console.log('\n💾 [DATABASE] Saving mapping...');
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

    console.log(`✅ [SUBSCRIPTION] Completed for COMPANY: "${companyName}" with PLAN: "${planLabel}"`);

  } catch (err) {
    console.error('❌ [SUBSCRIPTION] Error:', err);
  }
}

// ---------- Toggl helpers ----------

async function findOrCreateTogglClient(companyName) {
  console.log(`\n🔍 [TOGGL-CLIENT] Finding/creating client: "${companyName}"`);
  
  if (!TOGGL_WORKSPACE_ID) {
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

  try {
    // Check if client already exists
    console.log('📡 [TOGGL-CLIENT] Fetching existing clients...');
    const res = await togglApi.get(`/workspaces/${TOGGL_WORKSPACE_ID}/clients`);
    
    console.log(`📊 [TOGGL-CLIENT] Found ${res.data?.length || 0} clients`);
    
    const existing = res.data.find((c) => c.name === companyName);
    if (existing) {
      console.log(`✅ [TOGGL-CLIENT] Found existing client: ${existing.id} - "${existing.name}"`);
      return existing.id;
    }

    // Create new client WITH COMPANY NAME
    console.log(`🚀 [TOGGL-CLIENT] Creating new client with COMPANY NAME: "${companyName}"`);
    const createRes = await togglApi.post(
      `/workspaces/${TOGGL_WORKSPACE_ID}/clients`,
      { name: companyName }
    );
    
    console.log(`✅ [TOGGL-CLIENT] Created new client: ${createRes.data.id}`);
    return createRes.data.id;

  } catch (err) {
    console.error('❌ [TOGGL-CLIENT] Error:');
    console.error('🔴 [TOGGL-CLIENT] Status:', err.response?.status);
    console.error('🔴 [TOGGL-CLIENT] Data:', err.response?.data);
    console.error('🔴 [TOGGL-CLIENT] Message:', err.message);
    throw err;
  }
}

async function findOrCreateTogglProject(clientId, projectName) {
  console.log(`\n🔍 [TOGGL-PROJECT] Finding/creating project: "${projectName}"`);
  
  if (!TOGGL_WORKSPACE_ID) {
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

  try {
    console.log('📡 [TOGGL-PROJECT] Fetching existing projects...');
    const res = await togglApi.get(`/workspaces/${TOGGL_WORKSPACE_ID}/projects`);
    
    console.log(`📊 [TOGGL-PROJECT] Found ${res.data?.length || 0} projects`);
    
    // Look for project with the exact name under this client
    const existing = res.data.find((p) => p.name === projectName && p.client_id === clientId);
    if (existing) {
      console.log(`✅ [TOGGL-PROJECT] Found existing project: ${existing.id} - "${existing.name}"`);
      return existing.id;
    }

    // Create new project with clean name (NO company name prefix)
    console.log(`🚀 [TOGGL-PROJECT] Creating new project: "${projectName}"`);
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
    
    console.log(`✅ [TOGGL-PROJECT] Created new project: ${createRes.data.id}`);
    return createRes.data.id;

  } catch (err) {
    console.error('❌ [TOGGL-PROJECT] Error:');
    console.error('🔴 [TOGGL-PROJECT] Status:', err.response?.status);
    console.error('🔴 [TOGGL-PROJECT] Data:', err.response?.data);
    console.error('🔴 [TOGGL-PROJECT] Message:', err.message);
    throw err;
  }
}

async function fetchTogglBillableSecondsForProject(projectId, since, until) {
  console.log('\n🔍 [TOGGL-TIME] Fetching time entries');
  console.log('📋 [TOGGL-TIME] Project ID:', projectId);
  console.log('⏰ [TOGGL-TIME] Since:', since.toISOString());
  console.log('⏰ [TOGGL-TIME] Until:', until.toISOString());

  const params = {
    start_date: since.toISOString(),
    end_date: until.toISOString(),
  };

  try {
    console.log('📡 [TOGGL-TIME] Making API request...');
    const res = await togglApi.get('/me/time_entries', { params });
    console.log('✅ [TOGGL-TIME] API request successful');

    const entries = res.data || [];
    let totalSeconds = 0;

    console.log(`📊 [TOGGL-TIME] Found ${entries.length} total time entries`);

    if (entries.length === 0) {
      console.log('⚠️ [TOGGL-TIME] No time entries found in the specified period');
      return 0;
    }

    let matchingEntries = 0;
    let billableEntries = 0;

    // Show all entries for debugging
    console.log('🔍 [TOGGL-TIME] Checking all entries:');
    entries.forEach((entry, index) => {
      const entryProjectId = entry.project_id?.toString();
      const targetProjectId = projectId.toString();
      const matches = entryProjectId === targetProjectId;
      
      console.log(`   ${index + 1}. Project: ${entryProjectId}, Match: ${matches}, Billable: ${entry.billable}, Duration: ${entry.duration}, Desc: "${entry.description}"`);
      
      if (matches) {
        matchingEntries++;
        if (entry.billable && typeof entry.duration === 'number' && entry.duration > 0) {
          totalSeconds += entry.duration;
          billableEntries++;
          console.log(`   ✅ COUNTED: ${entry.duration} seconds`);
        }
      }
    });

    console.log(`📈 [TOGGL-TIME] SUMMARY:`);
    console.log(`   - Total entries: ${entries.length}`);
    console.log(`   - Matching project: ${matchingEntries}`);
    console.log(`   - Billable entries: ${billableEntries}`);
    console.log(`   - Total seconds: ${totalSeconds}`);
    console.log(`   - Total hours: ${(totalSeconds / 3600).toFixed(2)}`);

    return totalSeconds;

  } catch (err) {
    console.error('❌ [TOGGL-TIME] Error fetching time entries:');
    console.error('🔴 [TOGGL-TIME] Status:', err.response?.status);
    console.error('🔴 [TOGGL-TIME] Data:', err.response?.data);
    console.error('🔴 [TOGGL-TIME] Message:', err.message);
    return 0;
  }
}

// ---------- Todoist helpers ----------

async function findOrCreateTodoistProject(projectName) {
  console.log(`\n🔍 [TODOIST] Finding/creating project: "${projectName}"`);
  
  try {
    console.log('📡 [TODOIST] Fetching existing projects...');
    const res = await todoistApi.get('/projects');
    
    console.log(`📊 [TODOIST] Found ${res.data?.length || 0} projects`);
    
    const existing = res.data.find((p) => p.name === projectName);
    if (existing) {
      console.log(`✅ [TODOIST] Found existing project: ${existing.id} - "${existing.name}"`);
      return existing.id;
    }

    console.log(`🚀 [TODOIST] Creating new project: "${projectName}"`);
    const payload = { name: projectName };

    if (TODOIST_WORKSPACE_ID) {
      payload.workspace_id = TODOIST_WORKSPACE_ID;
      console.log('🏢 [TODOIST] Using workspace ID:', TODOIST_WORKSPACE_ID);
    }

    const createRes = await todoistApi.post('/projects', payload);
    console.log(`✅ [TODOIST] Created new project: ${createRes.data.id}`);
    return createRes.data.id;

  } catch (err) {
    console.error('❌ [TODOIST] Error:');
    console.error('🔴 [TODOIST] Status:', err.response?.status);
    console.error('🔴 [TODOIST] Data:', err.response?.data);
    console.error('🔴 [TODOIST] Message:', err.message);
    throw err;
  }
}

// ---------- Usage sync job (Render Cron) ----------

app.post('/jobs/sync-usage', async (req, res) => {
  console.log('\n🎯 [SYNC] Sync job started');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [SYNC] Unauthorized - invalid secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('✅ [SYNC] Secret verified');

  try {
    const mappings = await getAllMappings();
    const now = new Date();
    let syncedCount = 0;

    console.log(`📊 [SYNC] Processing ${mappings.length} mappings`);

    if (mappings.length === 0) {
      console.log('⚠️ [SYNC] No mappings found in database');
      return res.json({ status: 'ok', synced: 0, message: 'No mappings found' });
    }

    for (const mapping of mappings) {
      console.log('\n🔍 [SYNC] Processing mapping:');
      console.log('   - Customer:', mapping.stripe_customer_id);
      console.log('   - Company:', mapping.company_name);
      console.log('   - Plan:', mapping.plan_label);
      console.log('   - Toggl Project ID:', mapping.toggl_project_id);
      console.log('   - Last Synced:', mapping.last_synced_at);

      const since = mapping.last_synced_at || new Date(now.getTime() - 24 * 60 * 60 * 1000);
      console.log(`⏰ [SYNC] Time range: ${since.toISOString()} to ${now.toISOString()}`);

      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        new Date(since),
        now
      );

      const hours = totalSeconds / 3600;
      console.log(`📈 [SYNC] Calculated hours: ${hours.toFixed(2)}`);

      if (hours <= 0) {
        console.log('⏭️ [SYNC] No hours to sync');
        continue;
      }

      try {
        console.log(`📤 [SYNC] Sending ${hours.toFixed(2)}h to Stripe...`);
        
        const form = new URLSearchParams();
        form.append('event_name', STRIPE_METER_EVENT_NAME);
        form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
        form.append('payload[value]', hours.toFixed(2));
        form.append('payload[project_id]', String(mapping.toggl_project_id));

        console.log('📦 [SYNC] Stripe payload:');
        console.log('   - Event:', STRIPE_METER_EVENT_NAME);
        console.log('   - Customer:', mapping.stripe_customer_id);
        console.log('   - Hours:', hours.toFixed(2));
        console.log('   - Project ID:', mapping.toggl_project_id);

        const stripeResponse = await axios.post(
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

        console.log('✅ [SYNC] Stripe API response:', stripeResponse.status);

        await updateLastSynced(mapping.stripe_subscription_id, now);

        console.log(`✅ [SYNC] Successfully synced ${hours.toFixed(2)}h for company: ${mapping.company_name}`);
        syncedCount += 1;

      } catch (stripeErr) {
        console.error('❌ [SYNC] Stripe API error:');
        console.error('🔴 [SYNC] Status:', stripeErr.response?.status);
        console.error('🔴 [SYNC] Data:', stripeErr.response?.data);
      }
    }

    console.log(`✅ [SYNC] Job completed: ${syncedCount} customers synced`);
    res.json({ status: 'ok', synced: syncedCount });

  } catch (err) {
    console.error('❌ [SYNC] Job failed:', err);
    res.status(500).json({ error: 'Sync job failed' });
  }
});

// ---------- Manual fix endpoint for existing subscriptions ----------

app.post('/fix-subscription', async (req, res) => {
  console.log('\n🔧 [MANUAL-FIX] Manual subscription fix requested');
  
  const { subscription_id, company_name } = req.body;
  
  if (!subscription_id || !company_name) {
    return res.status(400).json({ error: 'Missing subscription_id or company_name' });
  }

  try {
    console.log(`🔧 [MANUAL-FIX] Fixing subscription ${subscription_id} with company name: ${company_name}`);
    await processSubscriptionWithCompanyName(subscription_id, company_name);
    res.json({ success: true, message: 'Subscription processed successfully' });
  } catch (err) {
    console.error('❌ [MANUAL-FIX] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========== NEW MANUAL SYNC ENDPOINTS ==========

// ---------- Debug endpoint to test time sync ----------

app.post('/debug/test-sync', async (req, res) => {
  console.log('\n🐛 [DEBUG-TEST] Testing time sync manually');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [DEBUG-TEST] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { project_id, hours } = req.body;
  
  if (!project_id) {
    return res.status(400).json({ error: 'Missing project_id' });
  }

  try {
    console.log('🔧 [DEBUG-TEST] Manual sync test for project:', project_id);
    
    // Find the mapping for this project
    const mappings = await getAllMappings();
    const mapping = mappings.find(m => m.toggl_project_id == project_id);
    
    if (!mapping) {
      return res.status(404).json({ error: 'No mapping found for project ID' });
    }

    console.log('📋 [DEBUG-TEST] Found mapping:', {
      company: mapping.company_name,
      customer: mapping.stripe_customer_id,
      project_id: mapping.toggl_project_id
    });

    const now = new Date();
    const since = mapping.last_synced_at || new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    console.log(`⏰ [DEBUG-TEST] Sync range: ${since.toISOString()} to ${now.toISOString()}`);

    // If hours provided, use them directly (for testing)
    let totalSeconds;
    if (hours) {
      totalSeconds = hours * 3600;
      console.log(`🎯 [DEBUG-TEST] Using provided hours: ${hours} (${totalSeconds} seconds)`);
    } else {
      // Fetch actual time from Toggl
      totalSeconds = await fetchTogglBillableSecondsForProject(project_id, since, now);
    }

    const calculatedHours = totalSeconds / 3600;
    console.log(`📈 [DEBUG-TEST] Hours to sync: ${calculatedHours.toFixed(2)}`);

    if (calculatedHours <= 0) {
      console.log('⏭️ [DEBUG-TEST] No hours to sync');
      return res.json({ 
        success: true, 
        synced: false, 
        message: 'No hours to sync',
        hours: 0 
      });
    }

    // Send to Stripe
    console.log(`📤 [DEBUG-TEST] Sending ${calculatedHours.toFixed(2)}h to Stripe...`);
    
    const form = new URLSearchParams();
    form.append('event_name', STRIPE_METER_EVENT_NAME);
    form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
    form.append('payload[value]', calculatedHours.toFixed(2));
    form.append('payload[project_id]', String(project_id));

    const stripeResponse = await axios.post(
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

    console.log('✅ [DEBUG-TEST] Stripe API response:', stripeResponse.status);

    // Update last synced
    await updateLastSynced(mapping.stripe_subscription_id, now);

    console.log(`✅ [DEBUG-TEST] Successfully synced ${calculatedHours.toFixed(2)}h`);

    res.json({
      success: true,
      synced: true,
      hours: calculatedHours.toFixed(2),
      customer: mapping.stripe_customer_id,
      company: mapping.company_name,
      stripe_response: stripeResponse.data
    });

  } catch (err) {
    console.error('❌ [DEBUG-TEST] Error:', err);
    res.status(500).json({ 
      error: err.message,
      stripe_error: err.response?.data 
    });
  }
});

// ---------- Force sync endpoint (ignores last_synced) ----------

app.post('/force-sync', async (req, res) => {
  console.log('\n🔧 [FORCE-SYNC] Force sync requested');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [FORCE-SYNC] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { days = 7 } = req.body; // Default to 7 days back

  try {
    const mappings = await getAllMappings();
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    let syncedCount = 0;
    const results = [];

    console.log(`📊 [FORCE-SYNC] Processing ${mappings.length} mappings`);
    console.log(`⏰ [FORCE-SYNC] Time range: ${since.toISOString()} to ${now.toISOString()}`);

    for (const mapping of mappings) {
      console.log(`\n🔍 [FORCE-SYNC] Processing: ${mapping.company_name}`);
      
      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        since,
        now
      );

      const hours = totalSeconds / 3600;
      console.log(`📈 [FORCE-SYNC] Found ${hours.toFixed(2)} hours for ${mapping.company_name}`);

      if (hours <= 0) {
        console.log('⏭️ [FORCE-SYNC] No hours to sync');
        results.push({
          company: mapping.company_name,
          hours: 0,
          synced: false
        });
        continue;
      }

      try {
        console.log(`📤 [FORCE-SYNC] Sending ${hours.toFixed(2)}h to Stripe...`);
        
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

        // Update last synced to now
        await updateLastSynced(mapping.stripe_subscription_id, now);

        console.log(`✅ [FORCE-SYNC] Successfully synced ${hours.toFixed(2)}h`);
        syncedCount += 1;
        
        results.push({
          company: mapping.company_name,
          hours: hours.toFixed(2),
          synced: true
        });

      } catch (stripeErr) {
        console.error(`❌ [FORCE-SYNC] Stripe error for ${mapping.company_name}:`, stripeErr.response?.data);
        results.push({
          company: mapping.company_name,
          hours: hours.toFixed(2),
          synced: false,
          error: stripeErr.response?.data
        });
      }
    }

    console.log(`✅ [FORCE-SYNC] Completed: ${syncedCount} customers synced`);
    res.json({
      success: true,
      synced_count: syncedCount,
      time_range: {
        since: since.toISOString(),
        until: now.toISOString(),
        days: days
      },
      results: results
    });

  } catch (err) {
    console.error('❌ [FORCE-SYNC] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Get all mappings (for debugging) ----------

app.get('/mappings', async (req, res) => {
  console.log('\n📋 [MAPPINGS] Fetching all mappings');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [MAPPINGS] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const mappings = await getAllMappings();
    console.log(`📊 [MAPPINGS] Found ${mappings.length} mappings`);
    
    res.json({
      count: mappings.length,
      mappings: mappings
    });
  } catch (err) {
    console.error('❌ [MAPPINGS] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Healthcheck & startup ----------

app.get('/', (req, res) => {
  console.log('🏠 Health check request received');
  res.send('Stripe → Toggl → Todoist microservice is running');
});
(async () => {
  try {
    console.log('🚀 STARTING STRIPE → TOGGL → TODOIST MICROSERVICE ======================');
    console.log('🔧 Environment check:');
    console.log('   - TOGGL_API_TOKEN exists:', !!process.env.TOGGL_API_TOKEN);
    console.log('   - TOGGL_WORKSPACE_ID exists:', !!process.env.TOGGL_WORKSPACE_ID);
    console.log('   - STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
    console.log('   - DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('   - TODOIST_API_TOKEN exists:', !!process.env.TODOIST_API_TOKEN);
    console.log('   - TODOIST_WORKSPACE_ID exists:', !!process.env.TODOIST_WORKSPACE_ID);
    console.log('   - USAGE_JOB_SECRET exists:', !!process.env.USAGE_JOB_SECRET);
    
    await initDb();
    app.listen(port, () => {
      console.log(`✅ Server listening on port ${port}`);
      console.log(`🔧 Ready to receive webhooks and cron jobs`);
      console.log(`🌐 Service URL: https://stripe-toggl-microservice.onrender.com`);
      console.log('🚀 SERVICE STARTUP COMPLETE ======================\n');
    });
  } catch (err) {
    console.error('❌ Failed to start service', err);
    console.error('🔴 Error details:', err.message);
    process.exit(1);
  }
})();