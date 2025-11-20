const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '⚠️ DATABASE_URL is not set. Postgres features will not work until this is configured.'
  );
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.PGSSLMODE === 'disable'
      ? false
      : {
          rejectUnauthorized: false,
        },
});

async function initDb() {
  if (!connectionString) return;

  console.log('🔧 [DB] Initializing database...');
  
  const createSql = `
    CREATE TABLE IF NOT EXISTS customer_mappings (
      id SERIAL PRIMARY KEY,
      stripe_customer_id TEXT NOT NULL,
      stripe_subscription_id TEXT NOT NULL,
      stripe_price_id TEXT,
      company_name TEXT NOT NULL,
      plan_label TEXT NOT NULL,
      toggl_client_id BIGINT NOT NULL,
      toggl_project_id BIGINT NOT NULL,
      todoist_project_id TEXT,
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Only unique constraint on subscription ID (remove project ID constraint)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_sub
      ON customer_mappings(stripe_subscription_id);

    -- Remove the project ID unique constraint to allow same project for different customers
    DROP INDEX IF EXISTS idx_customer_mappings_proj;
  `;

  try {
    await pool.query(createSql);
    console.log('✅ [DB] customer_mappings table ready');
  } catch (err) {
    console.error('❌ [DB] Error creating table:', err);
  }
}

async function upsertCustomerMapping(mapping) {
  if (!connectionString) {
    console.log('⚠️ [DB] No database connection - skipping mapping upsert');
    return;
  }

  console.log('💾 [DB] Saving mapping to database:', {
    stripe_customer_id: mapping.stripe_customer_id,
    stripe_subscription_id: mapping.stripe_subscription_id,
    company_name: mapping.company_name,
    plan_label: mapping.plan_label,
    toggl_project_id: mapping.toggl_project_id
  });

  const {
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    company_name,
    plan_label,
    toggl_client_id,
    toggl_project_id,
    todoist_project_id,
  } = mapping;

  const sql = `
    INSERT INTO customer_mappings (
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      company_name,
      plan_label,
      toggl_client_id,
      toggl_project_id,
      todoist_project_id,
      last_synced_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
    ON CONFLICT (stripe_subscription_id) 
    DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_price_id = EXCLUDED.stripe_price_id,
      company_name = EXCLUDED.company_name,
      plan_label = EXCLUDED.plan_label,
      toggl_client_id = EXCLUDED.toggl_client_id,
      toggl_project_id = EXCLUDED.toggl_project_id,
      todoist_project_id = EXCLUDED.todoist_project_id,
      updated_at = NOW()
  `;

  const params = [
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id || null,
    company_name,
    plan_label,
    toggl_client_id || null,
    toggl_project_id,
    todoist_project_id || null,
  ];

  try {
    await pool.query(sql, params);
    console.log('✅ [DB] Successfully saved mapping to database');
  } catch (err) {
    console.error('❌ [DB] Error saving mapping:', err);
    console.error('🔴 [DB] Error details:', err.message);
    throw err;
  }
}

async function getAllMappings() {
  if (!connectionString) {
    console.log('⚠️ [DB] No database connection - returning empty mappings');
    return [];
  }
  
  try {
    const res = await pool.query(
      'SELECT * FROM customer_mappings ORDER BY id ASC'
    );
    console.log(`📊 [DB] Retrieved ${res.rows.length} mappings from database`);
    return res.rows;
  } catch (err) {
    console.error('❌ [DB] Error getting mappings:', err);
    return [];
  }
}

async function updateLastSynced(subscriptionId, date) {
  if (!connectionString) return;

  try {
    await pool.query(
      `
      UPDATE customer_mappings
         SET last_synced_at = $2,
             updated_at = NOW()
       WHERE stripe_subscription_id = $1
    `,
      [subscriptionId, date.toISOString()]
    );
    console.log(`✅ [DB] Updated last_synced for subscription: ${subscriptionId}`);
  } catch (err) {
    console.error('❌ [DB] Error updating last_synced:', err);
  }
}

module.exports = {
  pool,
  initDb,
  upsertCustomerMapping,
  getAllMappings,
  updateLastSynced,
};