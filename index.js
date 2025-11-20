// require('dotenv').config();

// const express = require('express');
// const bodyParser = require('body-parser');
// const axios = require('axios');
// const Stripe = require('stripe');
// const {
//   initDb,
//   upsertCustomerMapping,
//   getAllMappings,
//   updateLastSynced,
// } = require('./db');

// const app = express();
// const port = process.env.PORT || 3000;

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
//   apiVersion: '2024-06-20',
// });

// // ---------- Config / env ----------

// const USAGE_JOB_SECRET = process.env.USAGE_JOB_SECRET;
// const TOGGL_WORKSPACE_ID = process.env.TOGGL_WORKSPACE_ID;
// const TODOIST_WORKSPACE_ID = process.env.TODOIST_WORKSPACE_ID;
// const STRIPE_METER_EVENT_NAME =
//   process.env.STRIPE_METER_EVENT_NAME || 'billable_hours';

// // ---------- HTTP clients ----------

// const togglApi = axios.create({
//   baseURL: 'https://api.track.toggl.com/api/v9',
//   auth: {
//     username: process.env.TOGGL_API_TOKEN,
//     password: 'api_token',
//   },
// });

// const todoistApi = axios.create({
//   baseURL: 'https://api.todoist.com/rest/v2',
//   headers: {
//     Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}`,
//     'Content-Type': 'application/json',
//   },
// });

// // ---------- Stripe Webhook (raw body) ----------

// app.post(
//   '/webhooks/stripe',
//   bodyParser.raw({ type: 'application/json' }),
//   async (req, res) => {
//     const sig = req.headers['stripe-signature'];

//     let event;
//     try {
//       event = stripe.webhooks.constructEvent(
//         req.body,
//         sig,
//         process.env.STRIPE_WEBHOOK_SECRET
//       );
//     } catch (err) {
//       console.error('❌ Error verifying Stripe webhook', err.message);
//       return res.status(400).send(`Webhook Error: ${err.message}`);
//     }

//     try {
//       switch (event.type) {
//         case 'checkout.session.completed':
//           await handleCheckoutSessionCompleted(event.data.object);
//           break;
//         case 'customer.subscription.created':
//         case 'customer.subscription.updated':
//           await handleSubscriptionCreatedOrUpdated(event.data.object);
//           break;
//         default:
//           // ignore everything else
//           break;
//       }

//       res.json({ received: true });
//     } catch (err) {
//       console.error('❌ Error handling Stripe webhook event', err);
//       res.status(500).json({ error: 'Webhook handler failed' });
//     }
//   }
// );

// // All other routes: normal JSON body
// app.use(bodyParser.json());

// // ---------- Checkout Session Handler ----------

// async function handleCheckoutSessionCompleted(session) {
//   if (session.mode !== 'subscription') return;
  
//   const customerId = session.customer;
//   if (!customerId) return;

//   try {
//     // Extract company name from custom fields - try multiple possible field names
//     let companyName = null;
//     if (session.custom_fields && session.custom_fields.length > 0) {
//       const possibleFieldNames = ['company_name', 'company', 'business_name', 'business', 'organization', 'org_name'];
      
//       for (const field of session.custom_fields) {
//         const fieldKey = field.key?.toLowerCase();
//         const fieldLabel = field.label?.toLowerCase();
        
//         // Check if field matches any of our possible names
//         const isCompanyField = possibleFieldNames.some(name => 
//           fieldKey?.includes(name) || fieldLabel?.includes(name)
//         );
        
//         if (isCompanyField && field.text && field.text.value) {
//           companyName = field.text.value;
//           console.log(`✅ Found company name from field "${field.key}": ${companyName}`);
//           break;
//         }
//       }
      
//       // If still not found, try to get the first custom text field
//       if (!companyName) {
//         const firstTextField = session.custom_fields.find(field => 
//           field.text && field.text.value
//         );
//         if (firstTextField) {
//           companyName = firstTextField.text.value;
//           console.log(`⚠️ Using first custom field "${firstTextField.key}" as company name: ${companyName}`);
//         }
//       }
//     }

//     // Fallback to customer name if no company name found
//     if (!companyName && session.customer_details && session.customer_details.name) {
//       companyName = session.customer_details.name;
//       console.log(`ℹ️ Using customer name as company name: ${companyName}`);
//     }

//     // If we found company name, update customer metadata
//     if (companyName) {
//       await stripe.customers.update(customerId, {
//         metadata: { company_name: companyName }
//       });
//       console.log(`✅ Updated company name for customer ${customerId}: ${companyName}`);
//     } else {
//       console.log(`⚠️ No company name found in custom fields for customer ${customerId}`);
//     }
//   } catch (err) {
//     console.error('❌ Error handling checkout.session.completed', err);
//   }
// }

// // ---------- Subscription handler ----------

// async function handleSubscriptionCreatedOrUpdated(subscription) {
//   const customerId = subscription.customer;
//   const priceItem = subscription.items?.data?.[0]?.price;

//   if (!customerId || !priceItem) {
//     console.warn('Subscription missing customer or price', subscription.id);
//     return;
//   }

//   const priceId = priceItem.id;

//   // Fetch customer + product so we can use company name and product name
//   const [customer, product] = await Promise.all([
//     stripe.customers.retrieve(customerId),
//     stripe.products.retrieve(priceItem.product),
//   ]);

//   // Improved company name extraction with better priority
//   const companyName =
//     (customer.metadata && customer.metadata.company_name) ||
//     (subscription.metadata && subscription.metadata.company_name) ||
//     customer.name ||
//     customer.email ||
//     'Unknown Customer';

//   // Extract product name and plan name from the full product name
//   const fullProductName = product.name || 'Website Support | Plan';
  
//   // Split the product name to get base product and plan
//   const productParts = fullProductName.split('|');
//   const productName = productParts[0]?.trim() || 'Website Support';
//   const planName = productParts[1]?.trim() || 'Plan';

//   // Clean plan label without "Unknown Plan"
//   const planLabel = `${productName} | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();

//   console.log(`📝 Product Analysis - Full: "${fullProductName}", Product: "${productName}", Plan: "${planName}"`);

//   const togglClientId = await findOrCreateTogglClient(companyName);
//   const togglProjectId = await findOrCreateTogglProject(
//     togglClientId,
//     planLabel
//   );
  
//   // Todoist project name should be "Company Name – Product Name"
//   const todoistProjectName = `${companyName} – ${planLabel}`;
//   const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);

//   await upsertCustomerMapping({
//     stripe_customer_id: customerId,
//     stripe_subscription_id: subscription.id,
//     stripe_price_id: priceId,
//     company_name: companyName,
//     plan_label: planLabel,
//     toggl_client_id: togglClientId,
//     toggl_project_id: togglProjectId,
//     todoist_project_id: todoistProjectId,
//   });

//   console.log(
//     `✅ Mapping upserted for subscription ${subscription.id} – ${companyName} (${planLabel})`
//   );
// }

// // ---------- Toggl helpers ----------

// async function findOrCreateTogglClient(clientName) {
//   if (!TOGGL_WORKSPACE_ID) {
//     throw new Error('TOGGL_WORKSPACE_ID is not set');
//   }

//   try {
//     const res = await togglApi.get(
//       `/workspaces/${TOGGL_WORKSPACE_ID}/clients`
//     );
//     const existing = res.data.find((c) => c.name === clientName);
//     if (existing) {
//       return existing.id;
//     }
//   } catch (err) {
//     console.error('Error fetching Toggl clients', err.response?.data || err);
//   }

//   const payload = { name: clientName };

//   const createRes = await togglApi.post(
//     `/workspaces/${TOGGL_WORKSPACE_ID}/clients`,
//     payload
//   );

//   return createRes.data.id;
// }

// async function findOrCreateTogglProject(clientId, projectName) {
//   if (!TOGGL_WORKSPACE_ID) {
//     throw new Error('TOGGL_WORKSPACE_ID is not set');
//   }

//   try {
//     const res = await togglApi.get(
//       `/workspaces/${TOGGL_WORKSPACE_ID}/projects`
//     );
//     const existing = res.data.find((p) => p.name === projectName);
//     if (existing) {
//       return existing.id;
//     }
//   } catch (err) {
//     console.error('Error fetching Toggl projects', err.response?.data || err);
//   }

//   const payload = {
//     name: projectName,
//     client_id: clientId,
//     is_private: true,
//     billable: true,
//     active: true,
//   };

//   const createRes = await togglApi.post(
//     `/workspaces/${TOGGL_WORKSPACE_ID}/projects`,
//     payload
//   );
//   return createRes.data.id;
// }

// async function fetchTogglBillableSecondsForProject(projectId, since, until) {
//   const params = {
//     start_date: since.toISOString(),
//     end_date: until.toISOString(),
//   };

//   try {
//     const res = await togglApi.get('/me/time_entries', { params });

//     const entries = res.data || [];
//     let totalSeconds = 0;

//     console.log(`   📊 Found ${entries.length} total time entries in Toggl`);

//     entries.forEach((e) => {
//       if (
//         e.project_id === projectId &&
//         e.billable &&
//         typeof e.duration === 'number' &&
//         e.duration > 0
//       ) {
//         totalSeconds += e.duration;
//         console.log(`   ✅ Counting entry: ${e.description} - ${e.duration} seconds`);
//       }
//     });

//     return totalSeconds;
//   } catch (err) {
//     console.error('Error fetching Toggl time entries', err.response?.data || err);
//     return 0;
//   }
// }

// // ---------- Todoist helpers ----------

// async function findOrCreateTodoistProject(projectName) {
//   try {
//     const res = await todoistApi.get('/projects');
//     const existing = res.data.find((p) => p.name === projectName);
//     if (existing) {
//       return existing.id;
//     }
//   } catch (err) {
//     console.error('Error fetching Todoist projects', err.response?.data || err);
//   }

//   const payload = { name: projectName };

//   // This is what makes it land in SPYCE, not "My Projects"
//   if (TODOIST_WORKSPACE_ID) {
//     payload.workspace_id = TODOIST_WORKSPACE_ID;
//   }

//   const createRes = await todoistApi.post('/projects', payload);
//   return createRes.data.id;
// }

// // ---------- Usage sync job (Render Cron) ----------

// app.post('/jobs/sync-usage', async (req, res) => {
//   if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
//     return res.status(401).json({ error: 'Unauthorized' });
//   }

//   try {
//     const mappings = await getAllMappings();
//     const now = new Date();
//     let syncedCount = 0;

//     console.log(`🕒 Starting sync job for ${mappings.length} mappings`);

//     for (const mapping of mappings) {
//       const since =
//         mapping.last_synced_at ||
//         new Date(now.getTime() - 24 * 60 * 60 * 1000);

//       console.log(`🔍 Checking project ${mapping.toggl_project_id} for customer ${mapping.stripe_customer_id}`);
//       console.log(`   Company: ${mapping.company_name}, Plan: ${mapping.plan_label}`);
//       console.log(`   Time range: ${since.toISOString()} to ${now.toISOString()}`);

//       const totalSeconds = await fetchTogglBillableSecondsForProject(
//         mapping.toggl_project_id,
//         new Date(since),
//         now
//       );

//       const hours = totalSeconds / 3600;

//       console.log(`   Found ${totalSeconds} seconds (${hours.toFixed(2)} hours) for project ${mapping.toggl_project_id}`);

//       if (hours <= 0) {
//         console.log(`   ⏭️  No hours to sync for project ${mapping.toggl_project_id}`);
//         continue;
//       }

//       try {
//         const form = new URLSearchParams();
//         form.append('event_name', STRIPE_METER_EVENT_NAME);
//         form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
//         form.append('payload[value]', hours.toFixed(2));
//         form.append('payload[project_id]', String(mapping.toggl_project_id));

//         console.log(`   📤 Sending ${hours.toFixed(2)}h to Stripe for customer ${mapping.stripe_customer_id}`);

//         await axios.post(
//           'https://api.stripe.com/v1/billing/meter_events',
//           form.toString(),
//           {
//             headers: {
//               'Content-Type': 'application/x-www-form-urlencoded',
//             },
//             auth: {
//               username: process.env.STRIPE_SECRET_KEY,
//               password: '',
//             },
//           }
//         );

//         await updateLastSynced(mapping.stripe_subscription_id, now);

//         console.log(
//           `✅ Successfully sent ${hours.toFixed(2)}h for customer ${mapping.stripe_customer_id}`
//         );
//         syncedCount += 1;
//       } catch (stripeErr) {
//         console.error(`❌ Stripe API error for customer ${mapping.stripe_customer_id}:`, stripeErr.response?.data || stripeErr.message);
//       }
//     }

//     console.log(`✅ Sync job completed. Synced ${syncedCount} customers`);
//     res.json({ status: 'ok', synced: syncedCount });
//   } catch (err) {
//     console.error('❌ Error in sync-usage job', err);
//     res.status(500).json({ error: 'sync-usage failed' });
//   }
// });

// // ---------- Healthcheck & startup ----------

// app.get('/', (req, res) => {
//   res.send('Stripe → Toggl → Todoist microservice is running');
// });

// (async () => {
//   try {
//     await initDb();
//     app.listen(port, () => {
//       console.log(`🚀 Server listening on port ${port}`);
//     });
//   } catch (err) {
//     console.error('❌ Failed to start service', err);
//     process.exit(1);
//   }
// })();
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
  if (!customerId) {
    console.log('❌ [CHECKOUT] No customer ID found');
    return;
  }

  console.log('👤 [CHECKOUT] Customer ID:', customerId);

  try {
    // Extract COMPANY NAME from custom fields - FIXED: Use company name, not card holder name
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

    // IMPORTANT: DO NOT fallback to customer name (card holder name)
    // We only want company name from custom fields
    if (!companyName) {
      console.log('⚠️ [CHECKOUT] No company name found in custom fields');
      console.log('ℹ️ [CHECKOUT] Will use customer metadata if available later');
      return; // Don't update customer metadata if no company name found
    }

    // Update customer metadata with COMPANY NAME
    console.log(`💾 [CHECKOUT] Updating customer metadata with COMPANY NAME: "${companyName}"`);
    await stripe.customers.update(customerId, {
      metadata: { company_name: companyName }
    });
    console.log(`✅ [CHECKOUT] Updated customer metadata with company name`);

  } catch (err) {
    console.error('❌ [CHECKOUT] Error:', err);
  }
}

// ---------- Subscription handler ----------

async function handleSubscriptionCreatedOrUpdated(subscription) {
  console.log('\n🎯 [SUBSCRIPTION] Handling subscription');
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

    // COMPANY NAME EXTRACTION WITH STRICT PRIORITY - USE COMPANY NAME ONLY
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
    // DO NOT use customer.name (card holder name) as fallback
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
    // Check if project already exists
    console.log('📡 [TOGGL-PROJECT] Fetching existing projects...');
    const res = await togglApi.get(`/workspaces/${TOGGL_WORKSPACE_ID}/projects`);
    
    console.log(`📊 [TOGGL-PROJECT] Found ${res.data?.length || 0} projects`);
    
    const existing = res.data.find((p) => p.name === projectName);
    if (existing) {
      console.log(`✅ [TOGGL-PROJECT] Found existing project: ${existing.id} - "${existing.name}"`);
      return existing.id;
    }

    // Create new project
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