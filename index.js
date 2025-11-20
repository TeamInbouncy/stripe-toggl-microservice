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
const STRIPE_METER_EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME || 'billable_hours';

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
    console.log('\n📄 [WEBHOOK] Stripe webhook received');
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
          console.log('⭐️ [WEBHOOK] Ignoring event type:', event.type);
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
    console.log('⭐️ [CHECKOUT] Not a subscription session - skipping');
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
        
        console.log(`   🔎 [CHECKOUT] Field: ${field.key} = "${field.text?.value}"`);
        
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
    const todoistProjectName = `${companyName} — ${planLabel}`;
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
    const todoistProjectName = `${companyName} — ${planLabel}`;
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

// ---------- FIXED: Toggl Time Entry Function ----------

async function fetchTogglBillableSecondsForProject(projectId, since, until) {
  console.log('\n🔍 [TOGGL-TIME] Fetching time entries');
  console.log('📋 [TOGGL-TIME] Project ID:', projectId);
  console.log('⏰ [TOGGL-TIME] Since:', since.toISOString());
  console.log('⏰ [TOGGL-TIME] Until:', until.toISOString());

  // Rate limiting protection - 1.5 second delay
  await new Promise(resolve => setTimeout(resolve, 1500));

  const params = {
    start_date: since.toISOString(),
    end_date: until.toISOString(),
    // NOTE: Toggl API v9 doesn't reliably support project_ids in params
    // We'll filter in memory instead
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

    // Convert projectId to number for comparison
    const targetProjectId = parseInt(projectId);
    
    let matchingEntries = 0;
    let billableEntries = 0;

    console.log('🔍 [TOGGL-TIME] Filtering entries for project:', targetProjectId);
    
    entries.forEach((entry, index) => {
      const entryProjectId = parseInt(entry.project_id);
      const matches = entryProjectId === targetProjectId;
      
      // Debug logging - show first 5 entries + all matches
      if (index < 5 || matches) {
        console.log(`   ${index + 1}. Project: ${entryProjectId}, Match: ${matches}, Billable: ${entry.billable}, Duration: ${entry.duration}s`);
      }
      
      if (matches) {
        matchingEntries++;
        
        // Only count if billable AND has positive duration
        if (entry.billable === true && typeof entry.duration === 'number' && entry.duration > 0) {
          totalSeconds += entry.duration;
          billableEntries++;
          console.log(`   ✅ COUNTED: ${entry.duration}s - "${entry.description || 'No description'}"`);
        }
      }
    });

    console.log(`📈 [TOGGL-TIME] SUMMARY:`);
    console.log(`   - Total entries retrieved: ${entries.length}`);
    console.log(`   - Matching project ${targetProjectId}: ${matchingEntries}`);
    console.log(`   - Billable entries counted: ${billableEntries}`);
    console.log(`   - Total seconds: ${totalSeconds}`);
    console.log(`   - Total hours: ${(totalSeconds / 3600).toFixed(2)}`);

    return totalSeconds;

  } catch (err) {
    // Handle rate limiting
    if (err.response?.status === 402) {
      console.error('❌ [TOGGL-TIME] RATE LIMIT HIT - Toggl API quota exceeded');
      console.error('⏰ [TOGGL-TIME] Waiting 60 seconds before retry...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      return 0;
    }
    
    if (err.response?.status === 429) {
      console.error('❌ [TOGGL-TIME] Too many requests - backing off 30 seconds');
      await new Promise(resolve => setTimeout(resolve, 30000));
      return 0;
    }
    
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

// ---------- FIXED: Usage sync job with CORRECT Stripe payload ----------

app.post('/jobs/sync-usage', async (req, res) => {
  console.log('\n🎯 [SYNC] Sync job started at:', new Date().toISOString());
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [SYNC] Unauthorized - invalid secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('✅ [SYNC] Secret verified');

  try {
    const mappings = await getAllMappings();
    const now = new Date();
    let syncedCount = 0;
    const results = [];

    console.log(`📊 [SYNC] Processing ${mappings.length} mappings`);

    if (mappings.length === 0) {
      console.log('⚠️ [SYNC] No mappings found in database');
      return res.json({ status: 'ok', synced: 0, message: 'No mappings found' });
    }

    for (const [index, mapping] of mappings.entries()) {
      console.log(`\n🔍 [SYNC] Processing ${index + 1}/${mappings.length}:`);
      console.log('   - Customer:', mapping.stripe_customer_id);
      console.log('   - Company:', mapping.company_name);
      console.log('   - Plan:', mapping.plan_label);
      console.log('   - Toggl Project ID:', mapping.toggl_project_id);
      console.log('   - Last Synced:', mapping.last_synced_at || 'Never');

      // Rate limiting: 2-second delay between customers (avoid Toggl rate limits)
      if (index > 0) {
        console.log('⏳ [SYNC] Adding 2-second delay to avoid rate limits...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Look back window: last sync OR 7 days
      const since = mapping.last_synced_at 
        ? new Date(mapping.last_synced_at)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      console.log(`⏰ [SYNC] Time range: ${since.toISOString()} to ${now.toISOString()}`);

      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        since,
        now
      );

      const hours = totalSeconds / 3600;
      console.log(`📈 [SYNC] Calculated hours: ${hours.toFixed(2)}`);

      if (hours <= 0) {
        console.log('⭐ [SYNC] No hours to sync');
        results.push({
          company: mapping.company_name,
          hours: 0,
          synced: false,
          message: 'No billable hours found'
        });
        continue;
      }

      try {
        console.log(`📤 [SYNC] Sending ${hours.toFixed(2)}h to Stripe...`);
        
        const form = new URLSearchParams();
        form.append('event_name', STRIPE_METER_EVENT_NAME);
        form.append('payload[stripe_customer_id]', mapping.stripe_customer_id); // FIXED
        form.append('payload[value]', hours.toFixed(2));
        form.append('timestamp', Math.floor(now.getTime() / 1000)); // ADDED

        // Idempotency key: subscription + timestamp
        const idempotencyKey = `sync-${mapping.stripe_subscription_id}-${Math.floor(now.getTime() / 1000)}`;

        console.log('📦 [SYNC] Stripe payload:');
        console.log('   - Event:', STRIPE_METER_EVENT_NAME);
        console.log('   - Customer ID:', mapping.stripe_customer_id);
        console.log('   - Hours:', hours.toFixed(2));
        console.log('   - Timestamp:', Math.floor(now.getTime() / 1000));
        console.log('   - Idempotency Key:', idempotencyKey);

        const stripeResponse = await axios.post(
          'https://api.stripe.com/v1/billing/meter_events',
          form.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Idempotency-Key': idempotencyKey, // ADDED
            },
            auth: {
              username: process.env.STRIPE_SECRET_KEY,
              password: '',
            },
          }
        );

        console.log('✅ [SYNC] Stripe API response:', stripeResponse.status);
        console.log('📄 [SYNC] Response data:', JSON.stringify(stripeResponse.data, null, 2));

        // Update last synced timestamp
        await updateLastSynced(mapping.stripe_subscription_id, now);

        console.log(`✅ [SYNC] Successfully synced ${hours.toFixed(2)}h for: ${mapping.company_name}`);
        syncedCount += 1;
        
        results.push({
          company: mapping.company_name,
          customer_id: mapping.stripe_customer_id,
          hours: hours.toFixed(2),
          synced: true
        });

      } catch (stripeErr) {
        console.error('❌ [SYNC] Stripe API error:');
        console.error('🔴 [SYNC] Status:', stripeErr.response?.status);
        console.error('🔴 [SYNC] Data:', JSON.stringify(stripeErr.response?.data, null, 2));
        
        results.push({
          company: mapping.company_name,
          hours: hours.toFixed(2),
          synced: false,
          error: stripeErr.response?.data?.error?.message || stripeErr.message
        });
      }
    }

    console.log(`\n✅ [SYNC] Job completed: ${syncedCount}/${mappings.length} customers synced`);
    
    res.json({ 
      status: 'ok', 
      synced: syncedCount,
      total: mappings.length,
      results: results
    });

  } catch (err) {
    console.error('❌ [SYNC] Job failed:', err);
    console.error('🔴 [SYNC] Stack trace:', err.stack);
    res.status(500).json({ error: 'Sync job failed', message: err.message });
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

// ========== DEBUGGING & MANUAL SYNC ENDPOINTS ==========

// ---------- Real-time sync for single customer ----------

app.post('/sync-customer', async (req, res) => {
  console.log('\n⚡ [REAL-TIME] Real-time sync requested');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [REAL-TIME] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { stripe_customer_id, hours } = req.body;
  
  if (!stripe_customer_id) {
    return res.status(400).json({ error: 'Missing stripe_customer_id' });
  }

  try {
    console.log('🔧 [REAL-TIME] Syncing customer:', stripe_customer_id);
    
    // Find the mapping for this customer
    const mappings = await getAllMappings();
    const mapping = mappings.find(m => m.stripe_customer_id === stripe_customer_id);
    
    if (!mapping) {
      return res.status(404).json({ error: 'No mapping found for customer ID' });
    }

    console.log('📋 [REAL-TIME] Found mapping:', {
      company: mapping.company_name,
      customer: mapping.stripe_customer_id,
      project_id: mapping.toggl_project_id
    });

    const now = new Date();
    const since = mapping.last_synced_at || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    console.log(`⏰ [REAL-TIME] Sync range: ${since.toISOString()} to ${now.toISOString()}`);

    // If hours provided, use them directly (for manual testing)
    let totalSeconds;
    if (hours) {
      totalSeconds = hours * 3600;
      console.log(`🎯 [REAL-TIME] Using provided hours: ${hours} (${totalSeconds} seconds)`);
    } else {
      // Fetch actual time from Toggl
      totalSeconds = await fetchTogglBillableSecondsForProject(mapping.toggl_project_id, since, now);
    }

    const calculatedHours = totalSeconds / 3600;
    console.log(`📈 [REAL-TIME] Hours to sync: ${calculatedHours.toFixed(2)}`);

    if (calculatedHours <= 0) {
      console.log('⭐ [REAL-TIME] No hours to sync');
      return res.json({ 
        success: true, 
        synced: false, 
        message: 'No hours to sync',
        hours: 0 
      });
    }

    // Send to Stripe
    console.log(`📤 [REAL-TIME] Sending ${calculatedHours.toFixed(2)}h to Stripe...`);
    
    const form = new URLSearchParams();
    form.append('event_name', STRIPE_METER_EVENT_NAME);
    form.append('payload[stripe_customer_id]', stripe_customer_id); // FIXED
    form.append('payload[value]', calculatedHours.toFixed(2));
    form.append('timestamp', Math.floor(now.getTime() / 1000)); // ADDED

    const idempotencyKey = `manual-${stripe_customer_id}-${Math.floor(now.getTime() / 1000)}`;

    const stripeResponse = await axios.post(
      'https://api.stripe.com/v1/billing/meter_events',
      form.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        auth: {
          username: process.env.STRIPE_SECRET_KEY,
          password: '',
        },
      }
    );

    console.log('✅ [REAL-TIME] Stripe API response:', stripeResponse.status);

    // Update last synced
    await updateLastSynced(mapping.stripe_subscription_id, now);

    console.log(`✅ [REAL-TIME] Successfully synced ${calculatedHours.toFixed(2)}h`);

    res.json({
      success: true,
      synced: true,
      hours: calculatedHours.toFixed(2),
      customer: mapping.stripe_customer_id,
      company: mapping.company_name,
      stripe_response: stripeResponse.data
    });

  } catch (err) {
    console.error('❌ [REAL-TIME] Error:', err);
    res.status(500).json({ 
      error: err.message,
      stripe_error: err.response?.data 
    });
  }
});

// ---------- Test meter event submission ----------

app.post('/test-meter-event', async (req, res) => {
  console.log('\n🧪 [TEST-METER] Testing meter event submission');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [TEST-METER] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { stripe_customer_id, hours = 1, event_name = STRIPE_METER_EVENT_NAME } = req.body;
  
  if (!stripe_customer_id) {
    return res.status(400).json({ error: 'Missing stripe_customer_id' });
  }

  try {
    console.log(`🧪 [TEST-METER] Sending test event: ${hours}h for customer ${stripe_customer_id}`);
    
    const form = new URLSearchParams();
    form.append('event_name', event_name);
    form.append('payload[stripe_customer_id]', stripe_customer_id); // FIXED
    form.append('payload[value]', hours.toString());
    form.append('timestamp', Math.floor(Date.now() / 1000)); // ADDED

    const idempotencyKey = `test-${stripe_customer_id}-${Date.now()}`;

    const response = await axios.post(
      'https://api.stripe.com/v1/billing/meter_events',
      form.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        auth: {
          username: process.env.STRIPE_SECRET_KEY,
          password: '',
        },
      }
    );

    console.log('✅ [TEST-METER] Success:', response.data);
    res.json({ success: true, data: response.data });

  } catch (err) {
    console.error('❌ [TEST-METER] Error:', err.response?.data);
    res.status(500).json({ error: err.response?.data });
  }
});

// ---------- Debug endpoint to check Toggl projects ----------

app.post('/debug/toggl-projects', async (req, res) => {
  console.log('\n🛠 [DEBUG-TOGGL] Checking Toggl projects');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [DEBUG-TOGGL] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const projects = await togglApi.get(`/workspaces/${TOGGL_WORKSPACE_ID}/projects`);
    
    console.log(`📊 [DEBUG-TOGGL] Found ${projects.data?.length || 0} projects`);
    
    // Show projects with their IDs and client names
    const projectList = projects.data.map(p => ({
      id: p.id,
      name: p.name,
      client_id: p.client_id,
      active: p.active,
      billable: p.billable
    }));
    
    res.json({
      total: projects.data.length,
      projects: projectList
    });
  } catch (err) {
    console.error('❌ [DEBUG-TOGGL] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Debug endpoint to check Toggl time entries ----------

app.post('/debug/toggl-time', async (req, res) => {
  console.log('\n🛠 [DEBUG-TOGGL-TIME] Checking Toggl time entries');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [DEBUG-TOGGL-TIME] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { project_id, days = 7 } = req.body;
  
  if (!project_id) {
    return res.status(400).json({ error: 'Missing project_id' });
  }

  try {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    console.log(`🔍 [DEBUG-TOGGL-TIME] Checking project ${project_id} from ${since.toISOString()} to ${now.toISOString()}`);
    
    const totalSeconds = await fetchTogglBillableSecondsForProject(project_id, since, now);
    const hours = totalSeconds / 3600;
    
    res.json({
      project_id: project_id,
      time_range: {
        since: since.toISOString(),
        until: now.toISOString(),
        days: days
      },
      total_seconds: totalSeconds,
      hours: hours.toFixed(2),
      found_entries: hours > 0
    });
  } catch (err) {
    console.error('❌ [DEBUG-TOGGL-TIME] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Force sync endpoint (ignores last_synced) ----------

app.post('/force-sync', async (req, res) => {
  console.log('\n🔧 [FORCE-SYNC] Force sync requested');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [FORCE-SYNC] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { days = 7 } = req.body;

  try {
    const mappings = await getAllMappings();
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    let syncedCount = 0;
    const results = [];

    console.log(`📊 [FORCE-SYNC] Processing ${mappings.length} mappings`);
    console.log(`⏰ [FORCE-SYNC] Time range: ${since.toISOString()} to ${now.toISOString()}`);

    for (const [index, mapping] of mappings.entries()) {
      console.log(`\n🔍 [FORCE-SYNC] Processing ${index + 1}/${mappings.length}: ${mapping.company_name}`);
      
      // Add delay between API calls
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        since,
        now
      );

      const hours = totalSeconds / 3600;
      console.log(`📈 [FORCE-SYNC] Found ${hours.toFixed(2)} hours for ${mapping.company_name}`);

      if (hours <= 0) {
        console.log('⭐ [FORCE-SYNC] No hours to sync');
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
        form.append('payload[stripe_customer_id]', mapping.stripe_customer_id); // FIXED
        form.append('payload[value]', hours.toFixed(2));
        form.append('timestamp', Math.floor(now.getTime() / 1000)); // ADDED

        const idempotencyKey = `force-${mapping.stripe_subscription_id}-${Math.floor(now.getTime() / 1000)}`;

        await axios.post(
          'https://api.stripe.com/v1/billing/meter_events',
          form.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Idempotency-Key': idempotencyKey,
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

// ---------- NEW: Debug sync status for all customers ----------

app.get('/debug/sync-status', async (req, res) => {
  console.log('\n🛠 [DEBUG-STATUS] Checking sync status for all customers');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ [DEBUG-STATUS] Unauthorized');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const mappings = await getAllMappings();
    
    const status = await Promise.all(mappings.map(async (m) => {
      try {
        const now = new Date();
        const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const seconds = await fetchTogglBillableSecondsForProject(m.toggl_project_id, since, now);
        
        return {
          company: m.company_name,
          stripe_customer_id: m.stripe_customer_id,
          toggl_project_id: m.toggl_project_id,
          last_synced: m.last_synced_at,
          hours_last_7_days: (seconds / 3600).toFixed(2),
          status: seconds > 0 ? 'Has billable time' : 'No billable time'
        };
      } catch (err) {
        return {
          company: m.company_name,
          error: err.message
        };
      }
    }));
    
    res.json({ mappings: status });
  } catch (err) {
    console.error('❌ [DEBUG-STATUS] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Healthcheck & startup ----------

app.get('/', (req, res) => {
  console.log('🏠 Health check request received');
  res.send('Stripe → Toggl → Todoist microservice is running ✅');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      stripe: !!process.env.STRIPE_SECRET_KEY,
      toggl: !!process.env.TOGGL_API_TOKEN,
      todoist: !!process.env.TODOIST_API_TOKEN,
      database: !!process.env.DATABASE_URL
    }
  });
});

// ---------- Start server ----------

(async () => {
  try {
    console.log('\n🚀 STARTING STRIPE → TOGGL → TODOIST MICROSERVICE ======================');
    console.log('🔧 Environment check:');
    console.log('   - TOGGL_API_TOKEN exists:', !!process.env.TOGGL_API_TOKEN);
    console.log('   - TOGGL_WORKSPACE_ID:', process.env.TOGGL_WORKSPACE_ID);
    console.log('   - STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
    console.log('   - STRIPE_WEBHOOK_SECRET exists:', !!process.env.STRIPE_WEBHOOK_SECRET);
    console.log('   - DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('   - TODOIST_API_TOKEN exists:', !!process.env.TODOIST_API_TOKEN);
    console.log('   - TODOIST_WORKSPACE_ID:', process.env.TODOIST_WORKSPACE_ID);
    console.log('   - USAGE_JOB_SECRET exists:', !!process.env.USAGE_JOB_SECRET);
    console.log('   - STRIPE_METER_EVENT_NAME:', STRIPE_METER_EVENT_NAME);
    
    await initDb();
    
    app.listen(port, () => {
      console.log(`\n✅ Server listening on port ${port}`);
      console.log(`🔧 Ready to receive webhooks and cron jobs`);
      console.log(`🌐 Service URL: https://stripe-toggl-microservice.onrender.com`);
      console.log('\n📋 Available endpoints:');
      console.log('   - POST /webhooks/stripe - Stripe webhook handler');
      console.log('   - POST /jobs/sync-usage?secret=XXX - Cron job for usage sync');
      console.log('   - POST /sync-customer?secret=XXX - Manual customer sync');
      console.log('   - POST /force-sync?secret=XXX - Force sync all customers');
      console.log('   - POST /test-meter-event?secret=XXX - Test Stripe meter event');
      console.log('   - GET /mappings?secret=XXX - View all customer mappings');
      console.log('   - GET /debug/sync-status?secret=XXX - Check sync status');
      console.log('   - POST /debug/toggl-projects?secret=XXX - List Toggl projects');
      console.log('   - POST /debug/toggl-time?secret=XXX - Check Toggl time entries');
      console.log('   - GET /health - Health check');
      console.log('\n🚀 SERVICE STARTUP COMPLETE ======================\n');
    });
  } catch (err) {
    console.error('❌ Failed to start service', err);
    console.error('🔴 Error details:', err.message);
    console.error('🔴 Stack trace:', err.stack);
    process.exit(1);
  }
})();
