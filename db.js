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

  console.log('🔧 INITIALIZING DATABASE ======================');
  
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
    
    // Check and add missing columns
    const requiredColumns = [
      'stripe_price_id',
      'company_name', 
      'plan_label',
      'toggl_client_id',
      'toggl_project_id',
      'todoist_project_id',
      'last_synced_at',
      'created_at',
      'updated_at'
    ];

    console.log('🔍 Checking for missing columns...');
    
    for (const column of requiredColumns) {
      const checkColumnSql = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='customer_mappings' AND column_name=$1;
      `;
      
      const columnCheck = await pool.query(checkColumnSql, [column]);
      if (columnCheck.rows.length === 0) {
        console.log(`🔧 Adding missing column: ${column}`);
        
        let alterSql;
        switch(column) {
          case 'toggl_client_id':
          case 'toggl_project_id':
            alterSql = `ALTER TABLE customer_mappings ADD COLUMN ${column} BIGINT`;
            break;
          case 'last_synced_at':
          case 'created_at':
          case 'updated_at':
            alterSql = `ALTER TABLE customer_mappings ADD COLUMN ${column} TIMESTAMPTZ`;
            if (column === 'created_at' || column === 'updated_at') {
              alterSql += ' DEFAULT NOW()';
            }
            break;
          default:
            alterSql = `ALTER TABLE customer_mappings ADD COLUMN ${column} TEXT`;
        }
        
        await pool.query(alterSql);
        console.log(`✅ Added column: ${column}`);
      } else {
        console.log(`✅ Column exists: ${column}`);
      }
    }
    
    console.log('✅ Database schema check complete');
    console.log('🔧 DATABASE INITIALIZATION COMPLETE ======================\n');
    
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
}

async function upsertCustomerMapping(mapping) {
  if (!connectionString) {
    console.log('⚠️ No database connection - skipping mapping upsert');
    return;
  }

  console.log('💾 DATABASE SAVE OPERATION ======================');
  
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

  console.log('📦 Data to save:', {
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
    const result = await pool.query(sql, params);
    console.log('✅ Successfully saved mapping to database');
    console.log('💾 DATABASE SAVE COMPLETE ======================\n');
    return result;
  } catch (err) {
    console.error('❌ Database error saving mapping:', err);
    console.error('💾 DATABASE SAVE FAILED ======================\n');
    throw err;
  }
}

async function getAllMappings() {
  if (!connectionString) {
    console.log('⚠️ No database connection - returning empty mappings');
    return [];
  }
  
  console.log('📊 FETCHING ALL MAPPINGS FROM DATABASE ======================');
  
  try {
    const res = await pool.query(
      'SELECT * FROM customer_mappings ORDER BY id ASC'
    );
    console.log(`✅ Retrieved ${res.rows.length} mappings from database`);
    
    if (res.rows.length > 0) {
      console.log('📋 Mappings found:');
      res.rows.forEach((mapping, index) => {
        console.log(`  ${index + 1}. ${mapping.company_name} - ${mapping.plan_label} (Toggl Project: ${mapping.toggl_project_id})`);
      });
    }
    
    console.log('📊 DATABASE FETCH COMPLETE ======================\n');
    return res.rows;
  } catch (err) {
    console.error('❌ Database error getting mappings:', err);
    console.log('📊 DATABASE FETCH FAILED ======================\n');
    return [];
  }
}

async function updateLastSynced(subscriptionId, date) {
  if (!connectionString) return;

  console.log('🕒 UPDATING LAST SYNCED TIME ======================');
  console.log('📝 Subscription ID:', subscriptionId);
  console.log('⏰ Sync time:', date.toISOString());

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
    console.log('✅ Updated last_synced for subscription');
    console.log('🕒 LAST SYNCED UPDATE COMPLETE ======================\n');
  } catch (err) {
    console.error('❌ Database error updating last_synced:', err);
    console.log('🕒 LAST SYNCED UPDATE FAILED ======================\n');
  }
}

module.exports = {
  pool,
  initDb,
  upsertCustomerMapping,
  getAllMappings,
  updateLastSynced,
};