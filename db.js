// // const { Pool } = require('pg');

// // const connectionString = process.env.DATABASE_URL;

// // if (!connectionString) {
// //   console.warn(
// //     '⚠️ DATABASE_URL is not set. Postgres features will not work until this is configured.'
// //   );
// // }

// // const pool = new Pool({
// //   connectionString,
// //   ssl:
// //     process.env.PGSSLMODE === 'disable'
// //       ? false
// //       : {
// //           rejectUnauthorized: false,
// //         },
// // });

// // async function initDb() {
// //   if (!connectionString) return;

// //   const createSql = `
// //     CREATE TABLE IF NOT EXISTS customer_mappings (
// //       id SERIAL PRIMARY KEY,
// //       stripe_customer_id TEXT NOT NULL,
// //       stripe_subscription_id TEXT NOT NULL,
// //       stripe_price_id TEXT,
// //       company_name TEXT NOT NULL,
// //       plan_label TEXT NOT NULL,
// //       toggl_client_id BIGINT NOT NULL,
// //       toggl_project_id BIGINT NOT NULL,
// //       todoist_project_id TEXT,
// //       last_synced_at TIMESTAMPTZ,
// //       created_at TIMESTAMPTZ DEFAULT NOW(),
// //       updated_at TIMESTAMPTZ DEFAULT NOW()
// //     );

// //     CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_sub
// //       ON customer_mappings(stripe_subscription_id);

// //     CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_proj
// //       ON customer_mappings(toggl_project_id);
// //   `;

// //   await pool.query(createSql);
// //   console.log('✅ customer_mappings table ready');
// // }

// // async function upsertCustomerMapping(mapping) {
// //   if (!connectionString) return;

// //   const {
// //     stripe_customer_id,
// //     stripe_subscription_id,
// //     stripe_price_id,
// //     company_name,
// //     plan_label,
// //     toggl_client_id,
// //     toggl_project_id,
// //     todoist_project_id,
// //   } = mapping;

// //   const sql = `
// //     INSERT INTO customer_mappings (
// //       stripe_customer_id,
// //       stripe_subscription_id,
// //       stripe_price_id,
// //       company_name,
// //       plan_label,
// //       toggl_client_id,
// //       toggl_project_id,
// //       todoist_project_id,
// //       last_synced_at
// //     )
// //     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
// //     ON CONFLICT (stripe_subscription_id) DO UPDATE
// //       SET
// //         stripe_customer_id = EXCLUDED.stripe_customer_id,
// //         stripe_price_id    = EXCLUDED.stripe_price_id,
// //         company_name       = EXCLUDED.company_name,
// //         plan_label         = EXCLUDED.plan_label,
// //         toggl_client_id    = EXCLUDED.toggl_client_id,
// //         toggl_project_id   = EXCLUDED.toggl_project_id,
// //         todoist_project_id = EXCLUDED.todoist_project_id,
// //         updated_at         = NOW();
// //   `;

// //   const params = [
// //     stripe_customer_id,
// //     stripe_subscription_id,
// //     stripe_price_id,
// //     company_name,
// //     plan_label,
// //     toggl_client_id,
// //     toggl_project_id,
// //     todoist_project_id,
// //   ];

// //   await pool.query(sql, params);
// // }

// // async function getAllMappings() {
// //   if (!connectionString) return [];
// //   const res = await pool.query(
// //     'SELECT * FROM customer_mappings ORDER BY id ASC'
// //   );
// //   return res.rows;
// // }

// // async function updateLastSynced(subscriptionId, date) {
// //   if (!connectionString) return;

// //   await pool.query(
// //     `
// //     UPDATE customer_mappings
// //        SET last_synced_at = $2,
// //            updated_at     = NOW()
// //      WHERE stripe_subscription_id = $1
// //   `,
// //     [subscriptionId, date.toISOString()]
// //   );
// // }

// // module.exports = {
// //   pool,
// //   initDb,
// //   upsertCustomerMapping,
// //   getAllMappings,
// //   updateLastSynced,
// // };
// const { Pool } = require('pg');

// const connectionString = process.env.DATABASE_URL;

// if (!connectionString) {
//   console.warn(
//     '⚠️ DATABASE_URL is not set. Postgres features will not work until this is configured.'
//   );
// }

// const pool = new Pool({
//   connectionString,
//   ssl:
//     process.env.PGSSLMODE === 'disable'
//       ? false
//       : {
//           rejectUnauthorized: false,
//         },
// });

// async function initDb() {
//   if (!connectionString) return;

//   const createSql = `
//     CREATE TABLE IF NOT EXISTS customer_mappings (
//       id SERIAL PRIMARY KEY,
//       stripe_customer_id TEXT NOT NULL,
//       stripe_subscription_id TEXT NOT NULL,
//       stripe_price_id TEXT,
//       company_name TEXT NOT NULL,
//       plan_label TEXT NOT NULL,
//       toggl_client_id BIGINT NOT NULL,
//       toggl_project_id BIGINT NOT NULL,
//       todoist_project_id TEXT,
//       last_synced_at TIMESTAMPTZ,
//       created_at TIMESTAMPTZ DEFAULT NOW(),
//       updated_at TIMESTAMPTZ DEFAULT NOW()
//     );

//     CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_sub
//       ON customer_mappings(stripe_subscription_id);

//     CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_proj
//       ON customer_mappings(toggl_project_id);
//   `;

//   await pool.query(createSql);
//   console.log('✅ customer_mappings table ready');
// }

// async function upsertCustomerMapping(mapping) {
//   if (!connectionString) return;

//   const {
//     stripe_customer_id,
//     stripe_subscription_id,
//     stripe_price_id,
//     company_name,
//     plan_label,
//     toggl_client_id,
//     toggl_project_id,
//     todoist_project_id,
//   } = mapping;

//   const sql = `
//     INSERT INTO customer_mappings (
//       stripe_customer_id,
//       stripe_subscription_id,
//       stripe_price_id,
//       company_name,
//       plan_label,
//       toggl_client_id,
//       toggl_project_id,
//       todoist_project_id,
//       last_synced_at
//     )
//     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
//     ON CONFLICT (stripe_subscription_id) DO UPDATE
//       SET
//         stripe_customer_id = EXCLUDED.stripe_customer_id,
//         stripe_price_id    = EXCLUDED.stripe_price_id,
//         company_name       = EXCLUDED.company_name,
//         plan_label         = EXCLUDED.plan_label,
//         toggl_client_id    = EXCLUDED.toggl_client_id,
//         toggl_project_id   = EXCLUDED.toggl_project_id,
//         todoist_project_id = EXCLUDED.todoist_project_id,
//         updated_at         = NOW();
//   `;

//   const params = [
//     stripe_customer_id,
//     stripe_subscription_id,
//     stripe_price_id,
//     company_name,
//     plan_label,
//     toggl_client_id,
//     toggl_project_id,
//     todoist_project_id,
//   ];

//   await pool.query(sql, params);
// }

// async function getAllMappings() {
//   if (!connectionString) return [];
//   const res = await pool.query(
//     'SELECT * FROM customer_mappings ORDER BY id ASC'
//   );
//   return res.rows;
// }

// async function updateLastSynced(subscriptionId, date) {
//   if (!connectionString) return;

//   await pool.query(
//     `
//     UPDATE customer_mappings
//        SET last_synced_at = $2,
//            updated_at     = NOW()
//      WHERE stripe_subscription_id = $1
//   `,
//     [subscriptionId, date.toISOString()]
//   );
// }

// module.exports = {
//   pool,
//   initDb,
//   upsertCustomerMapping,
//   getAllMappings,
//   updateLastSynced,
// };
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_sub
      ON customer_mappings(stripe_subscription_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_mappings_proj
      ON customer_mappings(toggl_project_id);
  `;

  try {
    await pool.query(createSql);
    console.log('✅ customer_mappings table ready');
    
    // Check if stripe_price_id column exists, if not add it
    const checkColumnSql = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='customer_mappings' AND column_name='stripe_price_id';
    `;
    
    const columnCheck = await pool.query(checkColumnSql);
    if (columnCheck.rows.length === 0) {
      console.log('🔧 Adding missing stripe_price_id column...');
      await pool.query('ALTER TABLE customer_mappings ADD COLUMN stripe_price_id TEXT;');
      console.log('✅ Added stripe_price_id column');
    }
    
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
}

async function upsertCustomerMapping(mapping) {
  if (!connectionString) {
    console.log('⚠️ No database connection - skipping mapping upsert');
    return;
  }

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

  console.log('💾 Saving to database:', {
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    company_name,
    plan_label,
    toggl_client_id,
    toggl_project_id,
    todoist_project_id
  });

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
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
    ON CONFLICT (stripe_subscription_id) DO UPDATE
      SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_price_id    = EXCLUDED.stripe_price_id,
        company_name       = EXCLUDED.company_name,
        plan_label         = EXCLUDED.plan_label,
        toggl_client_id    = EXCLUDED.toggl_client_id,
        toggl_project_id   = EXCLUDED.toggl_project_id,
        todoist_project_id = EXCLUDED.todoist_project_id,
        updated_at         = NOW();
  `;

  const params = [
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    company_name,
    plan_label,
    toggl_client_id,
    toggl_project_id,
    todoist_project_id,
  ];

  try {
    await pool.query(sql, params);
    console.log('✅ Successfully saved mapping to database');
  } catch (err) {
    console.error('❌ Database error saving mapping:', err);
    throw err;
  }
}

async function getAllMappings() {
  if (!connectionString) {
    console.log('⚠️ No database connection - returning empty mappings');
    return [];
  }
  
  try {
    const res = await pool.query(
      'SELECT * FROM customer_mappings ORDER BY id ASC'
    );
    console.log(`📊 Retrieved ${res.rows.length} mappings from database`);
    return res.rows;
  } catch (err) {
    console.error('❌ Database error getting mappings:', err);
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
             updated_at     = NOW()
       WHERE stripe_subscription_id = $1
    `,
      [subscriptionId, date.toISOString()]
    );
    console.log(`✅ Updated last_synced for subscription: ${subscriptionId}`);
  } catch (err) {
    console.error('❌ Database error updating last_synced:', err);
  }
}

module.exports = {
  pool,
  initDb,
  upsertCustomerMapping,
  getAllMappings,
  updateLastSynced,
};