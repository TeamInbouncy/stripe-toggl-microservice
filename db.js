// db.js
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("⚠ DATABASE_URL is not set. Postgres will not work.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required on Render
});

// Create table if it doesn't exist
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_mappings (
      id SERIAL PRIMARY KEY,
      stripe_customer_id TEXT NOT NULL UNIQUE,
      stripe_subscription_id TEXT,
      company_name TEXT,
      plan_name TEXT,
      toggl_client_id BIGINT,
      toggl_project_id BIGINT,
      todoist_project_id TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("✅ customer_mappings table ready");
}

async function upsertMapping(mapping) {
  const {
    stripe_customer_id,
    stripe_subscription_id,
    company_name,
    plan_name,
    toggl_client_id,
    toggl_project_id,
    todoist_project_id,
  } = mapping;

  const result = await pool.query(
    `
    INSERT INTO customer_mappings (
      stripe_customer_id,
      stripe_subscription_id,
      company_name,
      plan_name,
      toggl_client_id,
      toggl_project_id,
      todoist_project_id,
      active,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
    ON CONFLICT (stripe_customer_id)
    DO UPDATE SET
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      company_name          = EXCLUDED.company_name,
      plan_name             = EXCLUDED.plan_name,
      toggl_client_id       = EXCLUDED.toggl_client_id,
      toggl_project_id      = EXCLUDED.toggl_project_id,
      todoist_project_id    = EXCLUDED.todoist_project_id,
      active                = TRUE,
      updated_at            = NOW()
    RETURNING *;
  `,
    [
      stripe_customer_id,
      stripe_subscription_id,
      company_name,
      plan_name,
      toggl_client_id,
      toggl_project_id,
      todoist_project_id,
    ]
  );

  return result.rows[0];
}

async function getActiveMappings() {
  const result = await pool.query(
    `SELECT * FROM customer_mappings WHERE active = TRUE`
  );
  return result.rows;
}

// Debug helper (optional)
async function getAllMappings() {
  const result = await pool.query(`SELECT * FROM customer_mappings`);
  return result.rows;
}

module.exports = {
  pool,
  initDb,
  upsertMapping,
  getActiveMappings,
  getAllMappings,
};
