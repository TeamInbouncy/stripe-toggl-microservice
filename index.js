// // require('dotenv').config();

// // const express = require('express');
// // const bodyParser = require('body-parser');
// // const axios = require('axios');
// // const Stripe = require('stripe');
// // const {
// //   initDb,
// //   upsertCustomerMapping,
// //   getAllMappings,
// //   updateLastSynced,
// // } = require('./db');

// // const app = express();
// // const port = process.env.PORT || 3000;

// // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
// //   apiVersion: '2024-06-20',
// // });

// // // ---------- Config / env ----------

// // const USAGE_JOB_SECRET = process.env.USAGE_JOB_SECRET;
// // const TOGGL_WORKSPACE_ID = process.env.TOGGL_WORKSPACE_ID;
// // const TODOIST_WORKSPACE_ID = process.env.TODOIST_WORKSPACE_ID;
// // const STRIPE_METER_EVENT_NAME =
// //   process.env.STRIPE_METER_EVENT_NAME || 'billable_hours';

// // // ---------- HTTP clients ----------

// // const togglApi = axios.create({
// //   baseURL: 'https://api.track.toggl.com/api/v9',
// //   auth: {
// //     username: process.env.TOGGL_API_TOKEN,
// //     password: 'api_token',
// //   },
// // });

// // const todoistApi = axios.create({
// //   baseURL: 'https://api.todoist.com/rest/v2',
// //   headers: {
// //     Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}`,
// //     'Content-Type': 'application/json',
// //   },
// // });

// // // ---------- Stripe Webhook (raw body) ----------

// // app.post(
// //   '/webhooks/stripe',
// //   bodyParser.raw({ type: 'application/json' }),
// //   async (req, res) => {
// //     const sig = req.headers['stripe-signature'];

// //     let event;
// //     try {
// //       event = stripe.webhooks.constructEvent(
// //         req.body,
// //         sig,
// //         process.env.STRIPE_WEBHOOK_SECRET
// //       );
// //     } catch (err) {
// //       console.error('❌ Error verifying Stripe webhook', err.message);
// //       return res.status(400).send(`Webhook Error: ${err.message}`);
// //     }

// //     try {
// //       switch (event.type) {
// //         case 'checkout.session.completed':
// //           await handleCheckoutSessionCompleted(event.data.object);
// //           break;
// //         case 'customer.subscription.created':
// //         case 'customer.subscription.updated':
// //           await handleSubscriptionCreatedOrUpdated(event.data.object);
// //           break;
// //         default:
// //           // ignore everything else
// //           break;
// //       }

// //       res.json({ received: true });
// //     } catch (err) {
// //       console.error('❌ Error handling Stripe webhook event', err);
// //       res.status(500).json({ error: 'Webhook handler failed' });
// //     }
// //   }
// // );

// // // All other routes: normal JSON body
// // app.use(bodyParser.json());

// // // ---------- Checkout Session Handler ----------

// // async function handleCheckoutSessionCompleted(session) {
// //   if (session.mode !== 'subscription') return;
  
// //   const customerId = session.customer;
// //   if (!customerId) return;

// //   try {
// //     // Extract company name from custom fields - try multiple possible field names
// //     let companyName = null;
// //     if (session.custom_fields && session.custom_fields.length > 0) {
// //       const possibleFieldNames = ['company_name', 'company', 'business_name', 'business', 'organization', 'org_name'];
      
// //       for (const field of session.custom_fields) {
// //         const fieldKey = field.key?.toLowerCase();
// //         const fieldLabel = field.label?.toLowerCase();
        
// //         // Check if field matches any of our possible names
// //         const isCompanyField = possibleFieldNames.some(name => 
// //           fieldKey?.includes(name) || fieldLabel?.includes(name)
// //         );
        
// //         if (isCompanyField && field.text && field.text.value) {
// //           companyName = field.text.value;
// //           console.log(`✅ Found company name from field "${field.key}": ${companyName}`);
// //           break;
// //         }
// //       }
      
// //       // If still not found, try to get the first custom text field
// //       if (!companyName) {
// //         const firstTextField = session.custom_fields.find(field => 
// //           field.text && field.text.value
// //         );
// //         if (firstTextField) {
// //           companyName = firstTextField.text.value;
// //           console.log(`⚠️ Using first custom field "${firstTextField.key}" as company name: ${companyName}`);
// //         }
// //       }
// //     }

// //     // Fallback to customer name if no company name found
// //     if (!companyName && session.customer_details && session.customer_details.name) {
// //       companyName = session.customer_details.name;
// //       console.log(`ℹ️ Using customer name as company name: ${companyName}`);
// //     }

// //     // If we found company name, update customer metadata
// //     if (companyName) {
// //       await stripe.customers.update(customerId, {
// //         metadata: { company_name: companyName }
// //       });
// //       console.log(`✅ Updated company name for customer ${customerId}: ${companyName}`);
// //     } else {
// //       console.log(`⚠️ No company name found in custom fields for customer ${customerId}`);
// //     }
// //   } catch (err) {
// //     console.error('❌ Error handling checkout.session.completed', err);
// //   }
// // }

// // // ---------- Subscription handler ----------

// // async function handleSubscriptionCreatedOrUpdated(subscription) {
// //   const customerId = subscription.customer;
// //   const priceItem = subscription.items?.data?.[0]?.price;

// //   if (!customerId || !priceItem) {
// //     console.warn('Subscription missing customer or price', subscription.id);
// //     return;
// //   }

// //   const priceId = priceItem.id;

// //   // Fetch customer + product so we can use company name and product name
// //   const [customer, product] = await Promise.all([
// //     stripe.customers.retrieve(customerId),
// //     stripe.products.retrieve(priceItem.product),
// //   ]);

// //   // Improved company name extraction with better priority
// //   const companyName =
// //     (customer.metadata && customer.metadata.company_name) ||
// //     (subscription.metadata && subscription.metadata.company_name) ||
// //     customer.name ||
// //     customer.email ||
// //     'Unknown Customer';

// //   // Extract product name and plan name from the full product name
// //   const fullProductName = product.name || 'Website Support | Plan';
  
// //   // Split the product name to get base product and plan
// //   const productParts = fullProductName.split('|');
// //   const productName = productParts[0]?.trim() || 'Website Support';
// //   const planName = productParts[1]?.trim() || 'Plan';

// //   // Clean plan label without "Unknown Plan"
// //   const planLabel = `${productName} | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();

// //   console.log(`📝 Product Analysis - Full: "${fullProductName}", Product: "${productName}", Plan: "${planName}"`);

// //   const togglClientId = await findOrCreateTogglClient(companyName);
// //   const togglProjectId = await findOrCreateTogglProject(
// //     togglClientId,
// //     planLabel
// //   );
  
// //   // Todoist project name should be "Company Name – Product Name"
// //   const todoistProjectName = `${companyName} – ${planLabel}`;
// //   const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);

// //   await upsertCustomerMapping({
// //     stripe_customer_id: customerId,
// //     stripe_subscription_id: subscription.id,
// //     stripe_price_id: priceId,
// //     company_name: companyName,
// //     plan_label: planLabel,
// //     toggl_client_id: togglClientId,
// //     toggl_project_id: togglProjectId,
// //     todoist_project_id: todoistProjectId,
// //   });

// //   console.log(
// //     `✅ Mapping upserted for subscription ${subscription.id} – ${companyName} (${planLabel})`
// //   );
// // }

// // // ---------- Toggl helpers ----------

// // async function findOrCreateTogglClient(clientName) {
// //   if (!TOGGL_WORKSPACE_ID) {
// //     throw new Error('TOGGL_WORKSPACE_ID is not set');
// //   }

// //   try {
// //     const res = await togglApi.get(
// //       `/workspaces/${TOGGL_WORKSPACE_ID}/clients`
// //     );
// //     const existing = res.data.find((c) => c.name === clientName);
// //     if (existing) {
// //       return existing.id;
// //     }
// //   } catch (err) {
// //     console.error('Error fetching Toggl clients', err.response?.data || err);
// //   }

// //   const payload = { name: clientName };

// //   const createRes = await togglApi.post(
// //     `/workspaces/${TOGGL_WORKSPACE_ID}/clients`,
// //     payload
// //   );

// //   return createRes.data.id;
// // }

// // async function findOrCreateTogglProject(clientId, projectName) {
// //   if (!TOGGL_WORKSPACE_ID) {
// //     throw new Error('TOGGL_WORKSPACE_ID is not set');
// //   }

// //   try {
// //     const res = await togglApi.get(
// //       `/workspaces/${TOGGL_WORKSPACE_ID}/projects`
// //     );
// //     const existing = res.data.find((p) => p.name === projectName);
// //     if (existing) {
// //       return existing.id;
// //     }
// //   } catch (err) {
// //     console.error('Error fetching Toggl projects', err.response?.data || err);
// //   }

// //   const payload = {
// //     name: projectName,
// //     client_id: clientId,
// //     is_private: true,
// //     billable: true,
// //     active: true,
// //   };

// //   const createRes = await togglApi.post(
// //     `/workspaces/${TOGGL_WORKSPACE_ID}/projects`,
// //     payload
// //   );
// //   return createRes.data.id;
// // }

// // async function fetchTogglBillableSecondsForProject(projectId, since, until) {
// //   const params = {
// //     start_date: since.toISOString(),
// //     end_date: until.toISOString(),
// //   };

// //   try {
// //     const res = await togglApi.get('/me/time_entries', { params });

// //     const entries = res.data || [];
// //     let totalSeconds = 0;

// //     console.log(`   📊 Found ${entries.length} total time entries in Toggl`);

// //     entries.forEach((e) => {
// //       if (
// //         e.project_id === projectId &&
// //         e.billable &&
// //         typeof e.duration === 'number' &&
// //         e.duration > 0
// //       ) {
// //         totalSeconds += e.duration;
// //         console.log(`   ✅ Counting entry: ${e.description} - ${e.duration} seconds`);
// //       }
// //     });

// //     return totalSeconds;
// //   } catch (err) {
// //     console.error('Error fetching Toggl time entries', err.response?.data || err);
// //     return 0;
// //   }
// // }

// // // ---------- Todoist helpers ----------

// // async function findOrCreateTodoistProject(projectName) {
// //   try {
// //     const res = await todoistApi.get('/projects');
// //     const existing = res.data.find((p) => p.name === projectName);
// //     if (existing) {
// //       return existing.id;
// //     }
// //   } catch (err) {
// //     console.error('Error fetching Todoist projects', err.response?.data || err);
// //   }

// //   const payload = { name: projectName };

// //   // This is what makes it land in SPYCE, not "My Projects"
// //   if (TODOIST_WORKSPACE_ID) {
// //     payload.workspace_id = TODOIST_WORKSPACE_ID;
// //   }

// //   const createRes = await todoistApi.post('/projects', payload);
// //   return createRes.data.id;
// // }

// // // ---------- Usage sync job (Render Cron) ----------

// // app.post('/jobs/sync-usage', async (req, res) => {
// //   if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
// //     return res.status(401).json({ error: 'Unauthorized' });
// //   }

// //   try {
// //     const mappings = await getAllMappings();
// //     const now = new Date();
// //     let syncedCount = 0;

// //     console.log(`🕒 Starting sync job for ${mappings.length} mappings`);

// //     for (const mapping of mappings) {
// //       const since =
// //         mapping.last_synced_at ||
// //         new Date(now.getTime() - 24 * 60 * 60 * 1000);

// //       console.log(`🔍 Checking project ${mapping.toggl_project_id} for customer ${mapping.stripe_customer_id}`);
// //       console.log(`   Company: ${mapping.company_name}, Plan: ${mapping.plan_label}`);
// //       console.log(`   Time range: ${since.toISOString()} to ${now.toISOString()}`);

// //       const totalSeconds = await fetchTogglBillableSecondsForProject(
// //         mapping.toggl_project_id,
// //         new Date(since),
// //         now
// //       );

// //       const hours = totalSeconds / 3600;

// //       console.log(`   Found ${totalSeconds} seconds (${hours.toFixed(2)} hours) for project ${mapping.toggl_project_id}`);

// //       if (hours <= 0) {
// //         console.log(`   ⏭️  No hours to sync for project ${mapping.toggl_project_id}`);
// //         continue;
// //       }

// //       try {
// //         const form = new URLSearchParams();
// //         form.append('event_name', STRIPE_METER_EVENT_NAME);
// //         form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
// //         form.append('payload[value]', hours.toFixed(2));
// //         form.append('payload[project_id]', String(mapping.toggl_project_id));

// //         console.log(`   📤 Sending ${hours.toFixed(2)}h to Stripe for customer ${mapping.stripe_customer_id}`);

// //         await axios.post(
// //           'https://api.stripe.com/v1/billing/meter_events',
// //           form.toString(),
// //           {
// //             headers: {
// //               'Content-Type': 'application/x-www-form-urlencoded',
// //             },
// //             auth: {
// //               username: process.env.STRIPE_SECRET_KEY,
// //               password: '',
// //             },
// //           }
// //         );

// //         await updateLastSynced(mapping.stripe_subscription_id, now);

// //         console.log(
// //           `✅ Successfully sent ${hours.toFixed(2)}h for customer ${mapping.stripe_customer_id}`
// //         );
// //         syncedCount += 1;
// //       } catch (stripeErr) {
// //         console.error(`❌ Stripe API error for customer ${mapping.stripe_customer_id}:`, stripeErr.response?.data || stripeErr.message);
// //       }
// //     }

// //     console.log(`✅ Sync job completed. Synced ${syncedCount} customers`);
// //     res.json({ status: 'ok', synced: syncedCount });
// //   } catch (err) {
// //     console.error('❌ Error in sync-usage job', err);
// //     res.status(500).json({ error: 'sync-usage failed' });
// //   }
// // });

// // // ---------- Healthcheck & startup ----------

// // app.get('/', (req, res) => {
// //   res.send('Stripe → Toggl → Todoist microservice is running');
// // });

// // (async () => {
// //   try {
// //     await initDb();
// //     app.listen(port, () => {
// //       console.log(`🚀 Server listening on port ${port}`);
// //     });
// //   } catch (err) {
// //     console.error('❌ Failed to start service', err);
// //     process.exit(1);
// //   }
// // })();
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
//     console.log('\n🔄 STRIPE WEBHOOK RECEIVED ======================');
//     console.log('📨 Webhook event received');
//     console.log('🔐 Signature header present:', !!req.headers['stripe-signature']);

//     const sig = req.headers['stripe-signature'];

//     let event;
//     try {
//       event = stripe.webhooks.constructEvent(
//         req.body,
//         sig,
//         process.env.STRIPE_WEBHOOK_SECRET
//       );
//       console.log('✅ Webhook signature verified');
//       console.log('📋 Event type:', event.type);
//       console.log('🆔 Event ID:', event.id);
//     } catch (err) {
//       console.error('❌ Error verifying Stripe webhook', err.message);
//       return res.status(400).send(`Webhook Error: ${err.message}`);
//     }

//     try {
//       console.log('🔄 PROCESSING WEBHOOK EVENT ======================');
//       switch (event.type) {
//         case 'checkout.session.completed':
//           console.log('🎯 Handling checkout.session.completed');
//           await handleCheckoutSessionCompleted(event.data.object);
//           break;
//         case 'customer.subscription.created':
//           console.log('🎯 Handling customer.subscription.created');
//           await handleSubscriptionCreatedOrUpdated(event.data.object);
//           break;
//         case 'customer.subscription.updated':
//           console.log('🎯 Handling customer.subscription.updated');
//           await handleSubscriptionCreatedOrUpdated(event.data.object);
//           break;
//         default:
//           console.log('⏭️ Ignoring event type:', event.type);
//           break;
//       }

//       console.log('✅ Webhook event processed successfully');
//       res.json({ received: true });
//     } catch (err) {
//       console.error('❌ Error handling Stripe webhook event', err);
//       console.error('🔴 Error details:', err.message);
//       res.status(500).json({ error: 'Webhook handler failed' });
//     } finally {
//       console.log('🔄 WEBHOOK PROCESSING COMPLETE ======================\n');
//     }
//   }
// );

// // All other routes: normal JSON body
// app.use(bodyParser.json());

// // ---------- Checkout Session Handler ----------

// async function handleCheckoutSessionCompleted(session) {
//   console.log('\n🛒 CHECKOUT SESSION COMPLETED ======================');
//   console.log('📋 Session ID:', session.id);
//   console.log('🔧 Session mode:', session.mode);
  
//   if (session.mode !== 'subscription') {
//     console.log('⏭️ Not a subscription session - skipping');
//     return;
//   }
  
//   const customerId = session.customer;
//   if (!customerId) {
//     console.log('❌ No customer ID found in session');
//     return;
//   }

//   console.log('👤 Customer ID:', customerId);

//   try {
//     // Extract COMPANY NAME from custom fields
//     let companyName = null;
    
//     if (session.custom_fields && session.custom_fields.length > 0) {
//       console.log('🔍 Checking custom fields for COMPANY NAME...');
//       console.log('📋 Custom fields found:', session.custom_fields.length);
      
//       const possibleFieldNames = ['company_name', 'company', 'business_name', 'business', 'organization', 'org_name'];
      
//       for (const field of session.custom_fields) {
//         const fieldKey = field.key ? String(field.key).toLowerCase() : '';
//         const fieldLabel = field.label ? String(field.label).toLowerCase() : '';
        
//         console.log(`   🔎 Checking field: key="${field.key}", label="${field.label}", value="${field.text?.value}"`);
        
//         // Check if field matches any of our possible names
//         const isCompanyField = possibleFieldNames.some(name => 
//           fieldKey.includes(name) || fieldLabel.includes(name)
//         );
        
//         if (isCompanyField && field.text && field.text.value) {
//           companyName = field.text.value;
//           console.log(`✅ FOUND COMPANY NAME from field "${field.key}": ${companyName}`);
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
//           console.log(`⚠️ Using first custom field "${firstTextField.key}" as COMPANY NAME: ${companyName}`);
//         }
//       }
//     } else {
//       console.log('📋 No custom fields found in session');
//     }

//     // Fallback to customer name if no company name found
//     if (!companyName && session.customer_details && session.customer_details.name) {
//       companyName = session.customer_details.name;
//       console.log(`ℹ️ Using customer name as COMPANY NAME: ${companyName}`);
//     }

//     // Final fallback
//     if (!companyName) {
//       companyName = 'Unknown Company';
//       console.log(`⚠️ No company name found, using default: ${companyName}`);
//     }

//     console.log(`🏢 FINAL COMPANY NAME: ${companyName}`);

//     // If we found company name, update customer metadata
//     if (companyName && companyName !== 'Unknown Company') {
//       console.log('💾 Updating customer metadata with company name...');
//       await stripe.customers.update(customerId, {
//         metadata: { company_name: companyName }
//       });
//       console.log(`✅ Updated company name for customer ${customerId}: ${companyName}`);
//     } else {
//       console.log(`ℹ️ No company name to update for customer ${customerId}`);
//     }
//   } catch (err) {
//     console.error('❌ Error handling checkout.session.completed', err);
//     console.error('🔴 Error stack:', err.stack);
//   }
  
//   console.log('🛒 CHECKOUT SESSION COMPLETE ======================\n');
// }

// // ---------- Subscription handler ----------

// async function handleSubscriptionCreatedOrUpdated(subscription) {
//   console.log('\n🎯 SUBSCRIPTION HANDLING ======================');
//   console.log('📝 Subscription ID:', subscription.id);
//   console.log('👤 Customer ID:', subscription.customer);
  
//   const customerId = subscription.customer;
//   const priceItem = subscription.items?.data?.[0]?.price;

//   if (!customerId || !priceItem) {
//     console.warn('❌ Subscription missing customer or price', subscription.id);
//     return;
//   }

//   const priceId = priceItem.id;
//   console.log('💰 Price ID:', priceId);

//   // Fetch customer + product so we can use COMPANY NAME and product name
//   console.log('📡 Fetching customer and product data from Stripe...');
//   const [customer, product] = await Promise.all([
//     stripe.customers.retrieve(customerId),
//     stripe.products.retrieve(priceItem.product),
//   ]);

//   console.log('📋 Customer data retrieved:', {
//     id: customer.id,
//     name: customer.name,
//     email: customer.email,
//     metadata: customer.metadata
//   });

//   console.log('📦 Product data retrieved:', {
//     id: product.id,
//     name: product.name,
//     description: product.description
//   });

//   // COMPANY NAME extraction with priority for metadata
//   console.log('🔍 Extracting COMPANY NAME...');
//   const companyName =
//     (customer.metadata && customer.metadata.company_name) ||
//     (subscription.metadata && subscription.metadata.company_name) ||
//     customer.name ||
//     customer.email ||
//     'Unknown Customer';

//   console.log(`🏢 COMPANY NAME determined: ${companyName}`);

//   // Extract product name and plan name from the full product name
//   const fullProductName = product.name || 'Website Support | Plan';
//   console.log(`📦 Full product name: "${fullProductName}"`);
  
//   // Split the product name to get base product and plan
//   const productParts = fullProductName.split('|');
//   const productName = productParts[0]?.trim() || 'Website Support';
//   const planName = productParts[1]?.trim() || 'Plan';

//   console.log(`📊 Product Analysis:`);
//   console.log(`   - Product: "${productName}"`);
//   console.log(`   - Plan: "${planName}"`);

//   // Clean plan label without "Unknown Plan"
//   const planLabel = `${productName} | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();
//   console.log(`🏷️ Final plan label: "${planLabel}"`);

//   console.log('\n🔧 STEP 1: FINDING/CREATING TOGGL CLIENT WITH COMPANY NAME');
//   const togglClientId = await findOrCreateTogglClient(companyName); // Using COMPANY NAME for Toggl client
//   console.log('✅ Toggl Client ID:', togglClientId);

//   console.log('\n🔧 STEP 2: FINDING/CREATING TOGGL PROJECT');
//   const togglProjectId = await findOrCreateTogglProject(
//     togglClientId,
//     planLabel
//   );
//   console.log('✅ Toggl Project ID:', togglProjectId);
  
//   // Todoist project name should be "Company Name – Product Name"
//   const todoistProjectName = `${companyName} – ${planLabel}`;
//   console.log('\n🔧 STEP 3: FINDING/CREATING TODOIST PROJECT');
//   console.log('📋 Todoist project name:', todoistProjectName);
//   const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);
//   console.log('✅ Todoist Project ID:', todoistProjectId);

//   console.log('\n💾 STEP 4: SAVING MAPPING TO DATABASE');
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
//   console.log('🎯 SUBSCRIPTION HANDLING COMPLETE ======================\n');
// }

// // ---------- Toggl helpers ----------

// async function findOrCreateTogglClient(companyName) {
//   console.log('\n🔍 TOGGL CLIENT OPERATION ======================');
//   console.log('🏢 Input COMPANY NAME for Toggl client:', companyName);
  
//   if (!TOGGL_WORKSPACE_ID) {
//     console.error('❌ TOGGL_WORKSPACE_ID is not set');
//     throw new Error('TOGGL_WORKSPACE_ID is not set');
//   }

//   console.log('🔧 Toggl configuration:');
//   console.log('   - Workspace ID:', TOGGL_WORKSPACE_ID);
//   console.log('   - API Token exists:', !!process.env.TOGGL_API_TOKEN);
//   console.log('   - API Token length:', process.env.TOGGL_API_TOKEN?.length);

//   try {
//     console.log('📡 Fetching existing Toggl clients...');
//     const res = await togglApi.get(
//       `/workspaces/${TOGGL_WORKSPACE_ID}/clients`
//     );
    
//     console.log('✅ Toggl clients fetched successfully');
//     console.log('📊 Number of clients found:', res.data?.length || 0);
    
//     if (res.data && res.data.length > 0) {
//       console.log('📋 Existing client names:');
//       res.data.slice(0, 5).forEach(client => {
//         console.log(`   - ${client.name} (ID: ${client.id})`);
//       });
//     }
    
//     const existing = res.data.find((c) => c.name === companyName);
//     if (existing) {
//       console.log('✅ Found existing Toggl client with COMPANY NAME:', {
//         id: existing.id,
//         name: existing.name,
//         workspace_id: existing.wid
//       });
//       return existing.id;
//     } else {
//       console.log('❌ No existing client found with COMPANY NAME, creating new one');
//     }
//   } catch (err) {
//     console.error('❌ Error fetching Toggl clients');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//     throw err;
//   }

//   console.log('🚀 Creating new Toggl client with COMPANY NAME...');
//   const payload = { name: companyName };
//   console.log('📦 Client creation payload:', payload);

//   try {
//     const createRes = await togglApi.post(
//       `/workspaces/${TOGGL_WORKSPACE_ID}/clients`,
//       payload
//     );
    
//     console.log('✅ Toggl client created successfully with COMPANY NAME:', {
//       id: createRes.data.id,
//       name: createRes.data.name,
//       workspace_id: createRes.data.wid
//     });
    
//     return createRes.data.id;
//   } catch (err) {
//     console.error('❌ Error creating Toggl client');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//     throw err;
//   } finally {
//     console.log('🔍 TOGGL CLIENT OPERATION COMPLETE ======================\n');
//   }
// }

// async function findOrCreateTogglProject(clientId, projectName) {
//   console.log('\n🔍 TOGGL PROJECT OPERATION ======================');
//   console.log('📋 Input project name:', projectName);
//   console.log('👤 Client ID:', clientId);
  
//   if (!TOGGL_WORKSPACE_ID) {
//     console.error('❌ TOGGL_WORKSPACE_ID is not set');
//     throw new Error('TOGGL_WORKSPACE_ID is not set');
//   }

//   console.log('🏢 Toggl Workspace ID:', TOGGL_WORKSPACE_ID);

//   try {
//     console.log('📡 Fetching existing Toggl projects...');
//     const res = await togglApi.get(
//       `/workspaces/${TOGGL_WORKSPACE_ID}/projects`
//     );
    
//     console.log('✅ Toggl projects fetched successfully');
//     console.log('📊 Number of projects found:', res.data?.length || 0);
    
//     if (res.data && res.data.length > 0) {
//       console.log('📋 First few project names:');
//       res.data.slice(0, 3).forEach(project => {
//         console.log(`   - ${project.name} (Client ID: ${project.client_id})`);
//       });
//     }
    
//     const existing = res.data.find((p) => p.name === projectName);
//     if (existing) {
//       console.log('✅ Found existing Toggl project:', {
//         id: existing.id,
//         name: existing.name,
//         client_id: existing.client_id,
//         workspace_id: existing.wid
//       });
//       return existing.id;
//     } else {
//       console.log('❌ No existing project found, creating new one');
//     }
//   } catch (err) {
//     console.error('❌ Error fetching Toggl projects');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//     throw err;
//   }

//   console.log('🚀 Creating new Toggl project...');
//   const payload = {
//     name: projectName,
//     client_id: clientId,
//     is_private: true,
//     billable: true,
//     active: true,
//   };

//   console.log('📦 Project creation payload:', payload);

//   try {
//     const createRes = await togglApi.post(
//       `/workspaces/${TOGGL_WORKSPACE_ID}/projects`,
//       payload
//     );
    
//     console.log('✅ Toggl project created successfully:', {
//       id: createRes.data.id,
//       name: createRes.data.name,
//       client_id: createRes.data.client_id,
//       workspace_id: createRes.data.wid
//     });
    
//     return createRes.data.id;
//   } catch (err) {
//     console.error('❌ Error creating Toggl project');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//     throw err;
//   } finally {
//     console.log('🔍 TOGGL PROJECT OPERATION COMPLETE ======================\n');
//   }
// }

// async function fetchTogglBillableSecondsForProject(projectId, since, until) {
//   console.log('\n🔍 TOGGL TIME ENTRIES FETCH ======================');
//   console.log('📋 Input parameters:');
//   console.log('   - Project ID:', projectId);
//   console.log('   - Since:', since.toISOString());
//   console.log('   - Until:', until.toISOString());

//   const params = {
//     start_date: since.toISOString(),
//     end_date: until.toISOString(),
//   };

//   console.log('📡 API Request params:', params);

//   try {
//     console.log('🚀 Fetching Toggl time entries...');
//     const res = await togglApi.get('/me/time_entries', { params });

//     console.log('✅ Toggl time entries fetched successfully');
    
//     const entries = res.data || [];
//     let totalSeconds = 0;

//     console.log(`📊 Found ${entries.length} total time entries in Toggl`);

//     if (entries.length > 0) {
//       console.log('📋 Sample of time entries found:');
//       entries.slice(0, 3).forEach((e, i) => {
//         console.log(`   ${i + 1}. Project: ${e.project_id}, Billable: ${e.billable}, Duration: ${e.duration}, Desc: ${e.description}`);
//       });
//     }

//     let billableEntriesCount = 0;
//     entries.forEach((e) => {
//       if (
//         e.project_id === projectId &&
//         e.billable &&
//         typeof e.duration === 'number' &&
//         e.duration > 0
//       ) {
//         totalSeconds += e.duration;
//         billableEntriesCount++;
//         console.log(`   ✅ Counting entry: ${e.description} - ${e.duration} seconds`);
//       }
//     });

//     console.log(`📈 Summary for project ${projectId}:`);
//     console.log(`   - Billable entries: ${billableEntriesCount}`);
//     console.log(`   - Total seconds: ${totalSeconds}`);
//     console.log(`   - Total hours: ${(totalSeconds / 3600).toFixed(2)}`);
    
//     console.log('🔍 TOGGL TIME ENTRIES FETCH COMPLETE ======================\n');
    
//     return totalSeconds;
//   } catch (err) {
//     console.error('❌ Error fetching Toggl time entries');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//     console.log('🔍 TOGGL TIME ENTRIES FETCH FAILED ======================\n');
//     return 0;
//   }
// }

// // ---------- Todoist helpers ----------

// async function findOrCreateTodoistProject(projectName) {
//   console.log('\n🔍 TODOIST PROJECT OPERATION ======================');
//   console.log('📋 Input project name:', projectName);
  
//   try {
//     console.log('📡 Fetching existing Todoist projects...');
//     const res = await todoistApi.get('/projects');
    
//     console.log('✅ Todoist projects fetched successfully');
//     console.log('📊 Number of projects found:', res.data?.length || 0);
    
//     const existing = res.data.find((p) => p.name === projectName);
//     if (existing) {
//       console.log('✅ Found existing Todoist project:', {
//         id: existing.id,
//         name: existing.name
//       });
//       return existing.id;
//     } else {
//       console.log('❌ No existing project found, creating new one');
//     }
//   } catch (err) {
//     console.error('❌ Error fetching Todoist projects');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//   }

//   console.log('🚀 Creating new Todoist project...');
//   const payload = { name: projectName };

//   // This is what makes it land in SPYCE, not "My Projects"
//   if (TODOIST_WORKSPACE_ID) {
//     payload.workspace_id = TODOIST_WORKSPACE_ID;
//     console.log('🏢 Using workspace ID:', TODOIST_WORKSPACE_ID);
//   }

//   console.log('📦 Project creation payload:', payload);

//   try {
//     const createRes = await todoistApi.post('/projects', payload);
//     console.log('✅ Todoist project created successfully:', {
//       id: createRes.data.id,
//       name: createRes.data.name
//     });
//     return createRes.data.id;
//   } catch (err) {
//     console.error('❌ Error creating Todoist project');
//     console.error('🔴 HTTP Status:', err.response?.status);
//     console.error('🔴 Error Data:', err.response?.data);
//     console.error('🔴 Error Message:', err.message);
//     throw err;
//   } finally {
//     console.log('🔍 TODOIST PROJECT OPERATION COMPLETE ======================\n');
//   }
// }

// // ---------- Usage sync job (Render Cron) ----------

// app.post('/jobs/sync-usage', async (req, res) => {
//   console.log('\n🎯 SYNC USAGE JOB STARTED ======================');
//   console.log('📅 Job timestamp:', new Date().toISOString());
//   console.log('🔐 Secret provided:', !!req.query.secret);
  
//   if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
//     console.error('❌ UNAUTHORIZED - Invalid or missing secret');
//     return res.status(401).json({ error: 'Unauthorized' });
//   }

//   console.log('✅ Secret verified - proceeding with sync job');

//   try {
//     const mappings = await getAllMappings();
//     const now = new Date();
//     let syncedCount = 0;

//     console.log(`📊 Found ${mappings.length} customer mappings in database`);

//     for (const mapping of mappings) {
//       console.log('\n🔍 PROCESSING CUSTOMER MAPPING ======================');
//       console.log('📋 Mapping details:', {
//         customer_id: mapping.stripe_customer_id,
//         company_name: mapping.company_name,
//         plan_label: mapping.plan_label,
//         toggl_project_id: mapping.toggl_project_id,
//         last_synced_at: mapping.last_synced_at
//       });

//       const since =
//         mapping.last_synced_at ||
//         new Date(now.getTime() - 24 * 60 * 60 * 1000);

//       console.log(`⏰ Time range: ${since.toISOString()} to ${now.toISOString()}`);

//       const totalSeconds = await fetchTogglBillableSecondsForProject(
//         mapping.toggl_project_id,
//         new Date(since),
//         now
//       );

//       const hours = totalSeconds / 3600;

//       console.log(`📈 Calculated hours: ${totalSeconds} seconds = ${hours.toFixed(2)} hours`);

//       if (hours <= 0) {
//         console.log(`⏭️ No hours to sync for project ${mapping.toggl_project_id}`);
//         console.log('🔍 CUSTOMER PROCESSING COMPLETE ======================\n');
//         continue;
//       }

//       try {
//         const form = new URLSearchParams();
//         form.append('event_name', STRIPE_METER_EVENT_NAME);
//         form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
//         form.append('payload[value]', hours.toFixed(2));
//         form.append('payload[project_id]', String(mapping.toggl_project_id));

//         console.log(`📤 Sending ${hours.toFixed(2)}h to Stripe for customer ${mapping.stripe_customer_id}`);
//         console.log('📦 Stripe payload details:');
//         console.log('   - Event name:', STRIPE_METER_EVENT_NAME);
//         console.log('   - Customer ID:', mapping.stripe_customer_id);
//         console.log('   - Value (hours):', hours.toFixed(2));
//         console.log('   - Project ID:', String(mapping.toggl_project_id));

//         console.log('🚀 Making Stripe API request...');
//         const stripeResponse = await axios.post(
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

//         console.log('✅ Stripe API response received');
//         console.log('📊 Stripe response status:', stripeResponse.status);

//         await updateLastSynced(mapping.stripe_subscription_id, now);

//         console.log(
//           `✅ Successfully sent ${hours.toFixed(2)}h for customer ${mapping.stripe_customer_id}`
//         );
//         syncedCount += 1;
//       } catch (stripeErr) {
//         console.error(`❌ Stripe API error for customer ${mapping.stripe_customer_id}`);
//         console.error('🔴 Error details:', stripeErr.response?.data || stripeErr.message);
//         if (stripeErr.response) {
//           console.error('🔴 HTTP Status:', stripeErr.response.status);
//           console.error('🔴 Response data:', stripeErr.response.data);
//         }
//       }
      
//       console.log('🔍 CUSTOMER PROCESSING COMPLETE ======================\n');
//     }

//     console.log(`✅ Sync job completed. Synced ${syncedCount} customers`);
//     console.log('🎯 SYNC USAGE JOB COMPLETED ======================\n');
//     res.json({ status: 'ok', synced: syncedCount });
//   } catch (err) {
//     console.error('❌ Error in sync-usage job', err);
//     console.error('🔴 Error stack:', err.stack);
//     res.status(500).json({ error: 'sync-usage failed' });
//   }
// });

// // ---------- Healthcheck & startup ----------

// app.get('/', (req, res) => {
//   console.log('🏠 Health check request received');
//   res.send('Stripe → Toggl → Todoist microservice is running');
// });

// (async () => {
//   try {
//     console.log('🚀 STARTING STRIPE → TOGGL → TODOIST MICROSERVICE ======================');
//     console.log('🔧 Environment check:');
//     console.log('   - TOGGL_API_TOKEN exists:', !!process.env.TOGGL_API_TOKEN);
//     console.log('   - TOGGL_WORKSPACE_ID exists:', !!process.env.TOGGL_WORKSPACE_ID);
//     console.log('   - STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
//     console.log('   - DATABASE_URL exists:', !!process.env.DATABASE_URL);
//     console.log('   - TODOIST_API_TOKEN exists:', !!process.env.TODOIST_API_TOKEN);
//     console.log('   - TODOIST_WORKSPACE_ID exists:', !!process.env.TODOIST_WORKSPACE_ID);
//     console.log('   - USAGE_JOB_SECRET exists:', !!process.env.USAGE_JOB_SECRET);
    
//     await initDb();
//     app.listen(port, () => {
//       console.log(`✅ Server listening on port ${port}`);
//       console.log(`🔧 Ready to receive webhooks and cron jobs`);
//       console.log(`🌐 Service URL: https://stripe-toggl-microservice.onrender.com`);
//       console.log('🚀 SERVICE STARTUP COMPLETE ======================\n');
//     });
//   } catch (err) {
//     console.error('❌ Failed to start service', err);
//     console.error('🔴 Error details:', err.message);
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
    console.log('\n🔄 STRIPE WEBHOOK RECEIVED ======================');
    console.log('📨 Webhook event received');
    console.log('🔐 Signature header present:', !!req.headers['stripe-signature']);

    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log('✅ Webhook signature verified');
      console.log('📋 Event type:', event.type);
      console.log('🆔 Event ID:', event.id);
    } catch (err) {
      console.error('❌ Error verifying Stripe webhook', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      console.log('🔄 PROCESSING WEBHOOK EVENT ======================');
      switch (event.type) {
        case 'checkout.session.completed':
          console.log('🎯 Handling checkout.session.completed');
          await handleCheckoutSessionCompleted(event.data.object);
          break;
        case 'customer.subscription.created':
          console.log('🎯 Handling customer.subscription.created');
          await handleSubscriptionCreatedOrUpdated(event.data.object);
          break;
        case 'customer.subscription.updated':
          console.log('🎯 Handling customer.subscription.updated');
          await handleSubscriptionCreatedOrUpdated(event.data.object);
          break;
        default:
          console.log('⏭️ Ignoring event type:', event.type);
          break;
      }

      console.log('✅ Webhook event processed successfully');
      res.json({ received: true });
    } catch (err) {
      console.error('❌ Error handling Stripe webhook event', err);
      console.error('🔴 Error details:', err.message);
      res.status(500).json({ error: 'Webhook handler failed' });
    } finally {
      console.log('🔄 WEBHOOK PROCESSING COMPLETE ======================\n');
    }
  }
);

// All other routes: normal JSON body
app.use(bodyParser.json());

// ---------- Checkout Session Handler ----------

async function handleCheckoutSessionCompleted(session) {
  console.log('\n🛒 CHECKOUT SESSION COMPLETED ======================');
  console.log('📋 Session ID:', session.id);
  console.log('🔧 Session mode:', session.mode);
  
  if (session.mode !== 'subscription') {
    console.log('⏭️ Not a subscription session - skipping');
    return;
  }
  
  const customerId = session.customer;
  if (!customerId) {
    console.log('❌ No customer ID found in session');
    return;
  }

  console.log('👤 Customer ID:', customerId);

  try {
    // Extract COMPANY NAME from custom fields - FIXED VERSION
    let companyName = null;
    
    if (session.custom_fields && session.custom_fields.length > 0) {
      console.log('🔍 Checking custom fields for COMPANY NAME...');
      console.log('📋 Custom fields found:', session.custom_fields.length);
      
      const possibleFieldNames = ['company_name', 'company', 'business_name', 'business', 'organization', 'org_name'];
      
      for (const field of session.custom_fields) {
        const fieldKey = field.key ? String(field.key).toLowerCase() : '';
        const fieldLabel = field.label ? String(field.label).toLowerCase() : '';
        
        console.log(`   🔎 Checking field: key="${field.key}", label="${field.label}", value="${field.text?.value}"`);
        
        // Check if field matches any of our possible names
        const isCompanyField = possibleFieldNames.some(name => 
          fieldKey.includes(name) || fieldLabel.includes(name)
        );
        
        if (isCompanyField && field.text && field.text.value) {
          companyName = field.text.value;
          console.log(`✅ FOUND COMPANY NAME from field "${field.key}": ${companyName}`);
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
          console.log(`⚠️ Using first custom field "${firstTextField.key}" as COMPANY NAME: ${companyName}`);
        }
      }
    } else {
      console.log('📋 No custom fields found in session');
    }

    // If we found company name, update customer metadata
    if (companyName) {
      console.log('💾 Updating customer metadata with company name...');
      await stripe.customers.update(customerId, {
        metadata: { company_name: companyName }
      });
      console.log(`✅ Updated company name for customer ${customerId}: ${companyName}`);
    } else {
      console.log(`ℹ️ No company name found in custom fields for customer ${customerId}`);
    }
  } catch (err) {
    console.error('❌ Error handling checkout.session.completed', err);
    console.error('🔴 Error stack:', err.stack);
  }
  
  console.log('🛒 CHECKOUT SESSION COMPLETE ======================\n');
}

// ---------- Subscription handler ----------

async function handleSubscriptionCreatedOrUpdated(subscription) {
  console.log('\n🎯 SUBSCRIPTION HANDLING ======================');
  console.log('📝 Subscription ID:', subscription.id);
  console.log('👤 Customer ID:', subscription.customer);
  
  const customerId = subscription.customer;
  const priceItem = subscription.items?.data?.[0]?.price;

  if (!customerId || !priceItem) {
    console.warn('❌ Subscription missing customer or price', subscription.id);
    return;
  }

  const priceId = priceItem.id;
  console.log('💰 Price ID:', priceId);

  // Fetch customer + product so we can use COMPANY NAME and product name
  console.log('📡 Fetching customer and product data from Stripe...');
  const [customer, product, price] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.products.retrieve(priceItem.product),
    stripe.prices.retrieve(priceId), // Get price to check nickname
  ]);

  console.log('📋 Customer data retrieved:', {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    metadata: customer.metadata
  });

  console.log('📦 Product data retrieved:', {
    id: product.id,
    name: product.name,
    description: product.description
  });

  console.log('💰 Price data retrieved:', {
    id: price.id,
    nickname: price.nickname,
    product: price.product
  });

  // COMPANY NAME extraction with CORRECT PRIORITY (as per client requirements)
  console.log('🔍 Extracting COMPANY NAME with priority order...');
  let companyName = 'Unknown Customer';
  
  // Priority 1: customer.metadata.company_name
  if (customer.metadata && customer.metadata.company_name) {
    companyName = customer.metadata.company_name;
    console.log('✅ Using company name from customer.metadata.company_name');
  }
  // Priority 2: subscription.metadata.company_name
  else if (subscription.metadata && subscription.metadata.company_name) {
    companyName = subscription.metadata.company_name;
    console.log('✅ Using company name from subscription.metadata.company_name');
  }
  // Priority 3: customer.name
  else if (customer.name) {
    companyName = customer.name;
    console.log('⚠️ Using customer.name as company name (fallback)');
  }
  // Priority 4: customer.email
  else if (customer.email) {
    companyName = customer.email;
    console.log('⚠️ Using customer.email as company name (fallback)');
  }

  console.log(`🏢 FINAL COMPANY NAME: ${companyName}`);

  // Extract plan name from price nickname or product name - FIXED VERSION
  console.log('🔍 Extracting plan name...');
  let planName = 'Plan';
  
  // Priority 1: Use price nickname if available
  if (price.nickname) {
    planName = price.nickname;
    console.log(`✅ Using plan name from price nickname: ${planName}`);
  }
  // Priority 2: Extract from product name
  else if (product.name) {
    const productParts = product.name.split('|');
    if (productParts[1]) {
      planName = productParts[1].trim();
      console.log(`✅ Using plan name from product name: ${planName}`);
    } else {
      planName = product.name.trim();
      console.log(`⚠️ Using full product name as plan: ${planName}`);
    }
  }

  // Clean plan label - REMOVE "(Unknown Plan)" and any unwanted text
  const planLabel = `Website Support | ${planName}`.replace(/\(Unknown Plan\)/gi, '').trim();
  console.log(`🏷️ FINAL PLAN LABEL: "${planLabel}"`);

  console.log('\n🔧 STEP 1: FINDING/CREATING TOGGL CLIENT WITH COMPANY NAME');
  const togglClientId = await findOrCreateTogglClient(companyName);
  console.log('✅ Toggl Client ID:', togglClientId);

  console.log('\n🔧 STEP 2: FINDING/CREATING TOGGL PROJECT');
  const togglProjectId = await findOrCreateTogglProject(
    togglClientId,
    planLabel
  );
  console.log('✅ Toggl Project ID:', togglProjectId);
  
  // Todoist project name format: "Company Name – Product Name"
  const todoistProjectName = `${companyName} – ${planLabel}`;
  console.log('\n🔧 STEP 3: FINDING/CREATING TODOIST PROJECT');
  console.log('📋 Todoist project name:', todoistProjectName);
  const todoistProjectId = await findOrCreateTodoistProject(todoistProjectName);
  console.log('✅ Todoist Project ID:', todoistProjectId);

  console.log('\n💾 STEP 4: SAVING MAPPING TO DATABASE');
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
  console.log('🎯 SUBSCRIPTION HANDLING COMPLETE ======================\n');
}

// ---------- Toggl helpers ----------

async function findOrCreateTogglClient(companyName) {
  console.log('\n🔍 TOGGL CLIENT OPERATION ======================');
  console.log('🏢 Input COMPANY NAME for Toggl client:', companyName);
  
  if (!TOGGL_WORKSPACE_ID) {
    console.error('❌ TOGGL_WORKSPACE_ID is not set');
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

  console.log('🔧 Toggl configuration:');
  console.log('   - Workspace ID:', TOGGL_WORKSPACE_ID);
  console.log('   - API Token exists:', !!process.env.TOGGL_API_TOKEN);
  console.log('   - API Token length:', process.env.TOGGL_API_TOKEN?.length);

  try {
    console.log('📡 Fetching existing Toggl clients...');
    const res = await togglApi.get(
      `/workspaces/${TOGGL_WORKSPACE_ID}/clients`
    );
    
    console.log('✅ Toggl clients fetched successfully');
    console.log('📊 Number of clients found:', res.data?.length || 0);
    
    if (res.data && res.data.length > 0) {
      console.log('📋 Existing client names:');
      res.data.slice(0, 5).forEach(client => {
        console.log(`   - ${client.name} (ID: ${client.id})`);
      });
    }
    
    const existing = res.data.find((c) => c.name === companyName);
    if (existing) {
      console.log('✅ Found existing Toggl client with COMPANY NAME:', {
        id: existing.id,
        name: existing.name,
        workspace_id: existing.wid
      });
      return existing.id;
    } else {
      console.log('❌ No existing client found with COMPANY NAME, creating new one');
    }
  } catch (err) {
    console.error('❌ Error fetching Toggl clients');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
    throw err;
  }

  console.log('🚀 Creating new Toggl client with COMPANY NAME...');
  const payload = { name: companyName };
  console.log('📦 Client creation payload:', payload);

  try {
    const createRes = await togglApi.post(
      `/workspaces/${TOGGL_WORKSPACE_ID}/clients`,
      payload
    );
    
    console.log('✅ Toggl client created successfully with COMPANY NAME:', {
      id: createRes.data.id,
      name: createRes.data.name,
      workspace_id: createRes.data.wid
    });
    
    return createRes.data.id;
  } catch (err) {
    console.error('❌ Error creating Toggl client');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
    throw err;
  } finally {
    console.log('🔍 TOGGL CLIENT OPERATION COMPLETE ======================\n');
  }
}

async function findOrCreateTogglProject(clientId, projectName) {
  console.log('\n🔍 TOGGL PROJECT OPERATION ======================');
  console.log('📋 Input project name:', projectName);
  console.log('👤 Client ID:', clientId);
  
  if (!TOGGL_WORKSPACE_ID) {
    console.error('❌ TOGGL_WORKSPACE_ID is not set');
    throw new Error('TOGGL_WORKSPACE_ID is not set');
  }

  console.log('🏢 Toggl Workspace ID:', TOGGL_WORKSPACE_ID);

  try {
    console.log('📡 Fetching existing Toggl projects...');
    const res = await togglApi.get(
      `/workspaces/${TOGGL_WORKSPACE_ID}/projects`
    );
    
    console.log('✅ Toggl projects fetched successfully');
    console.log('📊 Number of projects found:', res.data?.length || 0);
    
    if (res.data && res.data.length > 0) {
      console.log('📋 First few project names:');
      res.data.slice(0, 3).forEach(project => {
        console.log(`   - ${project.name} (Client ID: ${project.client_id})`);
      });
    }
    
    const existing = res.data.find((p) => p.name === projectName);
    if (existing) {
      console.log('✅ Found existing Toggl project:', {
        id: existing.id,
        name: existing.name,
        client_id: existing.client_id,
        workspace_id: existing.wid
      });
      return existing.id;
    } else {
      console.log('❌ No existing project found, creating new one');
    }
  } catch (err) {
    console.error('❌ Error fetching Toggl projects');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
    throw err;
  }

  console.log('🚀 Creating new Toggl project...');
  const payload = {
    name: projectName,
    client_id: clientId,
    is_private: true,
    billable: true,
    active: true,
  };

  console.log('📦 Project creation payload:', payload);

  try {
    const createRes = await togglApi.post(
      `/workspaces/${TOGGL_WORKSPACE_ID}/projects`,
      payload
    );
    
    console.log('✅ Toggl project created successfully:', {
      id: createRes.data.id,
      name: createRes.data.name,
      client_id: createRes.data.client_id,
      workspace_id: createRes.data.wid
    });
    
    return createRes.data.id;
  } catch (err) {
    console.error('❌ Error creating Toggl project');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
    throw err;
  } finally {
    console.log('🔍 TOGGL PROJECT OPERATION COMPLETE ======================\n');
  }
}

async function fetchTogglBillableSecondsForProject(projectId, since, until) {
  console.log('\n🔍 TOGGL TIME ENTRIES FETCH ======================');
  console.log('📋 Input parameters:');
  console.log('   - Project ID:', projectId);
  console.log('   - Since:', since.toISOString());
  console.log('   - Until:', until.toISOString());

  const params = {
    start_date: since.toISOString(),
    end_date: until.toISOString(),
  };

  console.log('📡 API Request params:', params);

  try {
    console.log('🚀 Fetching Toggl time entries...');
    const res = await togglApi.get('/me/time_entries', { params });

    console.log('✅ Toggl time entries fetched successfully');
    
    const entries = res.data || [];
    let totalSeconds = 0;

    console.log(`📊 Found ${entries.length} total time entries in Toggl`);

    if (entries.length > 0) {
      console.log('📋 Sample of time entries found:');
      entries.slice(0, 5).forEach((e, i) => {
        console.log(`   ${i + 1}. Project: ${e.project_id}, Billable: ${e.billable}, Duration: ${e.duration}, Desc: "${e.description}"`);
      });
    }

    let billableEntriesCount = 0;
    let matchingEntriesCount = 0;
    
    entries.forEach((e) => {
      // First check if it matches our project ID
      if (e.project_id == projectId) { // Use == for loose comparison (number vs string)
        matchingEntriesCount++;
        console.log(`   🔍 Found matching entry for project ${projectId}: "${e.description}" - Duration: ${e.duration}s, Billable: ${e.billable}`);
        
        if (e.billable && typeof e.duration === 'number' && e.duration > 0) {
          totalSeconds += e.duration;
          billableEntriesCount++;
          console.log(`   ✅ Counting billable entry: "${e.description}" - ${e.duration} seconds`);
        } else if (e.billable && e.duration <= 0) {
          console.log(`   ⚠️  Billable entry has invalid duration: ${e.duration}s - "${e.description}"`);
        }
      }
    });

    console.log(`📈 SUMMARY FOR PROJECT ${projectId}:`);
    console.log(`   - Total entries found: ${entries.length}`);
    console.log(`   - Entries matching project: ${matchingEntriesCount}`);
    console.log(`   - Billable entries counted: ${billableEntriesCount}`);
    console.log(`   - Total seconds: ${totalSeconds}`);
    console.log(`   - Total hours: ${(totalSeconds / 3600).toFixed(2)}`);
    
    console.log('🔍 TOGGL TIME ENTRIES FETCH COMPLETE ======================\n');
    
    return totalSeconds;
  } catch (err) {
    console.error('❌ Error fetching Toggl time entries');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
    console.log('🔍 TOGGL TIME ENTRIES FETCH FAILED ======================\n');
    return 0;
  }
}

// ---------- Todoist helpers ----------

async function findOrCreateTodoistProject(projectName) {
  console.log('\n🔍 TODOIST PROJECT OPERATION ======================');
  console.log('📋 Input project name:', projectName);
  
  try {
    console.log('📡 Fetching existing Todoist projects...');
    const res = await todoistApi.get('/projects');
    
    console.log('✅ Todoist projects fetched successfully');
    console.log('📊 Number of projects found:', res.data?.length || 0);
    
    const existing = res.data.find((p) => p.name === projectName);
    if (existing) {
      console.log('✅ Found existing Todoist project:', {
        id: existing.id,
        name: existing.name
      });
      return existing.id;
    } else {
      console.log('❌ No existing project found, creating new one');
    }
  } catch (err) {
    console.error('❌ Error fetching Todoist projects');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
  }

  console.log('🚀 Creating new Todoist project...');
  const payload = { name: projectName };

  // This is what makes it land in SPYCE, not "My Projects"
  if (TODOIST_WORKSPACE_ID) {
    payload.workspace_id = TODOIST_WORKSPACE_ID;
    console.log('🏢 Using workspace ID:', TODOIST_WORKSPACE_ID);
  }

  console.log('📦 Project creation payload:', payload);

  try {
    const createRes = await todoistApi.post('/projects', payload);
    console.log('✅ Todoist project created successfully:', {
      id: createRes.data.id,
      name: createRes.data.name
    });
    return createRes.data.id;
  } catch (err) {
    console.error('❌ Error creating Todoist project');
    console.error('🔴 HTTP Status:', err.response?.status);
    console.error('🔴 Error Data:', err.response?.data);
    console.error('🔴 Error Message:', err.message);
    throw err;
  } finally {
    console.log('🔍 TODOIST PROJECT OPERATION COMPLETE ======================\n');
  }
}

// ---------- Usage sync job (Render Cron) ----------

app.post('/jobs/sync-usage', async (req, res) => {
  console.log('\n🎯 SYNC USAGE JOB STARTED ======================');
  console.log('📅 Job timestamp:', new Date().toISOString());
  console.log('🔐 Secret provided:', !!req.query.secret);
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ UNAUTHORIZED - Invalid or missing secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('✅ Secret verified - proceeding with sync job');

  try {
    const mappings = await getAllMappings();
    const now = new Date();
    let syncedCount = 0;

    console.log(`📊 Found ${mappings.length} customer mappings in database`);

    for (const mapping of mappings) {
      console.log('\n🔍 PROCESSING CUSTOMER MAPPING ======================');
      console.log('📋 Mapping details:', {
        customer_id: mapping.stripe_customer_id,
        company_name: mapping.company_name,
        plan_label: mapping.plan_label,
        toggl_project_id: mapping.toggl_project_id,
        last_synced_at: mapping.last_synced_at
      });

      const since =
        mapping.last_synced_at ||
        new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default to 24 hours ago

      console.log(`⏰ Time range: ${since.toISOString()} to ${now.toISOString()}`);

      const totalSeconds = await fetchTogglBillableSecondsForProject(
        mapping.toggl_project_id,
        new Date(since),
        now
      );

      const hours = totalSeconds / 3600;

      console.log(`📈 Calculated hours: ${totalSeconds} seconds = ${hours.toFixed(2)} hours`);

      if (hours <= 0) {
        console.log(`⏭️ No hours to sync for project ${mapping.toggl_project_id}`);
        console.log('🔍 CUSTOMER PROCESSING COMPLETE ======================\n');
        continue;
      }

      try {
        const form = new URLSearchParams();
        form.append('event_name', STRIPE_METER_EVENT_NAME);
        form.append('payload[stripe_customer_id]', mapping.stripe_customer_id);
        form.append('payload[value]', hours.toFixed(2));
        form.append('payload[project_id]', String(mapping.toggl_project_id));

        console.log(`📤 Sending ${hours.toFixed(2)}h to Stripe for customer ${mapping.stripe_customer_id}`);
        console.log('📦 Stripe payload details:');
        console.log('   - Event name:', STRIPE_METER_EVENT_NAME);
        console.log('   - Customer ID:', mapping.stripe_customer_id);
        console.log('   - Value (hours):', hours.toFixed(2));
        console.log('   - Project ID:', String(mapping.toggl_project_id));

        console.log('🚀 Making Stripe API request...');
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

        console.log('✅ Stripe API response received');
        console.log('📊 Stripe response status:', stripeResponse.status);
        console.log('📋 Stripe response data:', stripeResponse.data);

        await updateLastSynced(mapping.stripe_subscription_id, now);

        console.log(
          `✅ Successfully sent ${hours.toFixed(2)}h for customer ${mapping.stripe_customer_id}`
        );
        syncedCount += 1;
      } catch (stripeErr) {
        console.error(`❌ Stripe API error for customer ${mapping.stripe_customer_id}`);
        console.error('🔴 Error details:', stripeErr.response?.data || stripeErr.message);
        if (stripeErr.response) {
          console.error('🔴 HTTP Status:', stripeErr.response.status);
          console.error('🔴 Response data:', stripeErr.response.data);
        }
      }
      
      console.log('🔍 CUSTOMER PROCESSING COMPLETE ======================\n');
    }

    console.log(`✅ Sync job completed. Synced ${syncedCount} customers`);
    console.log('🎯 SYNC USAGE JOB COMPLETED ======================\n');
    res.json({ status: 'ok', synced: syncedCount });
  } catch (err) {
    console.error('❌ Error in sync-usage job', err);
    console.error('🔴 Error stack:', err.stack);
    res.status(500).json({ error: 'sync-usage failed' });
  }
});

// ---------- Debug endpoint for manual testing ----------

app.post('/debug/sync-customer', async (req, res) => {
  console.log('\n🐛 DEBUG SYNC CUSTOMER ENDPOINT ======================');
  
  if (!USAGE_JOB_SECRET || req.query.secret !== USAGE_JOB_SECRET) {
    console.error('❌ UNAUTHORIZED - Invalid or missing secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { customer_id, project_id } = req.body;
  
  if (!customer_id || !project_id) {
    return res.status(400).json({ error: 'Missing customer_id or project_id' });
  }

  try {
    console.log('🔍 Debug sync for:', { customer_id, project_id });
    
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago for testing
    
    console.log(`⏰ Time range: ${since.toISOString()} to ${now.toISOString()}`);

    const totalSeconds = await fetchTogglBillableSecondsForProject(
      project_id,
      since,
      now
    );

    const hours = totalSeconds / 3600;

    console.log(`📈 Calculated hours: ${totalSeconds} seconds = ${hours.toFixed(2)} hours`);

    res.json({
      success: true,
      customer_id,
      project_id,
      hours: hours.toFixed(2),
      seconds: totalSeconds,
      time_range: {
        since: since.toISOString(),
        until: now.toISOString()
      }
    });
  } catch (err) {
    console.error('❌ Debug sync error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    console.log('🐛 DEBUG SYNC COMPLETE ======================\n');
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