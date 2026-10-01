/**
 * Migration Script: NeonDB to Supabase
 *
 * Supports both:
 *   1. Direct Postgres connection via DATABASE_URL
 *   2. Supabase HTTP REST Client via NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *
 * Usage:
 *   1. Set OLD_DATABASE_URL (NeonDB) in .env
 *   2. Set NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or DATABASE_URL) in .env
 *   3. Run `npm run db:migrate-data`
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

// Helper to normalize query results from neon HTTP client (array vs result object)
function extractRows(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

async function runMigration() {
  const sourceUrl = process.env.OLD_DATABASE_URL || process.env.NEON_DATABASE_URL;
  const targetDbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!sourceUrl) {
    console.error('❌ Error: Missing OLD_DATABASE_URL (or NEON_DATABASE_URL) in environment variables.');
    console.error('   Please add your NeonDB connection string to your .env file as OLD_DATABASE_URL=...');
    process.exit(1);
  }

  if (!targetDbUrl && (!supabaseUrl || !supabaseKey)) {
    console.error('❌ Error: Missing Supabase connection details in environment variables.');
    console.error('   Please set either DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env');
    process.exit(1);
  }

  console.log('🚀 Starting data migration from NeonDB to Supabase...');

  // 1. Source DB: Neon HTTP Driver
  console.log('🔌 Initializing Neon HTTP driver for source database...');
  const sourceSql = neon(sourceUrl);
  console.log('✅ Source driver ready (HTTP/HTTPS).');

  // Diagnostic check for NeonDB database & tables
  try {
    const dbRes = await sourceSql.query('SELECT current_database() as db, current_schema() as schema');
    const dbRows = extractRows(dbRes);
    console.log(`ℹ️  Connected to NeonDB database: '${dbRows[0]?.db || 'unknown'}', schema: '${dbRows[0]?.schema || 'public'}'`);

    const tableRes = await sourceSql.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tableRows = extractRows(tableRes);
    const tableNames = tableRows.map((r: any) => r.table_name);
    console.log(`ℹ️  Found ${tableNames.length} tables in public schema on NeonDB: ${tableNames.join(', ') || 'NONE'}`);
  } catch (err: any) {
    console.warn('⚠️ Diagnostic check failed on NeonDB:', err.message);
  }

  // 2. Target DB: Check whether to use Supabase JS REST Client or pg Client
  let useRestApi = false;
  let supabaseRest: ReturnType<typeof createClient> | null = null;
  let targetPgClient: Client | null = null;

  if (supabaseUrl && supabaseKey) {
    console.log(`🔌 Initializing Supabase REST client (${supabaseUrl})...`);
    supabaseRest = createClient(supabaseUrl, supabaseKey);
    useRestApi = true;
    console.log('✅ Target Supabase REST client ready.');
  }

  if (!useRestApi && targetDbUrl) {
    console.log('🔌 Connecting to target Supabase database via PostgreSQL driver...');
    targetPgClient = new Client({
      connectionString: targetDbUrl,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await targetPgClient.connect();
      console.log('✅ Connected to Supabase via Postgres driver.');
    } catch (pgErr: any) {
      console.warn('⚠️ Postgres driver connection failed:', pgErr.message);
      if (supabaseUrl && supabaseKey) {
        console.log('🔄 Falling back to Supabase REST client...');
        supabaseRest = createClient(supabaseUrl, supabaseKey);
        useRestApi = true;
      } else {
        throw pgErr;
      }
    }
  }

  try {
    // Table definitions in dependency order
    const tables = [
      {
        name: 'users',
        hasSerialKey: true,
        columns: ['id', 'google_id', 'email', 'name', 'access_token', 'refresh_token', 'token_expires_at', 'gmail_connected', 'created_at'],
        primaryKeys: ['id'],
      },
      {
        name: 'recipients',
        hasSerialKey: true,
        columns: ['id', 'user_id', 'name', 'email', 'department', 'notes', 'created_at'],
        primaryKeys: ['id'],
      },
      {
        name: 'scheduled_emails',
        hasSerialKey: true,
        columns: [
          'id',
          'user_id',
          'subject',
          'body',
          'schedule_type',
          'scheduled_at',
          'timezone',
          'repeat_frequency',
          'repeat_days',
          'repeat_interval_days',
          'start_date',
          'start_time',
          'end_date',
          'next_send_at',
          'status',
          'created_at',
          'updated_at',
        ],
        primaryKeys: ['id'],
      },
      {
        name: 'scheduled_email_recipients',
        hasSerialKey: false,
        columns: ['scheduled_email_id', 'recipient_id'],
        primaryKeys: ['scheduled_email_id', 'recipient_id'],
      },
      {
        name: 'scheduler_state',
        hasSerialKey: false,
        columns: ['id', 'last_run_at', 'last_due', 'last_sent', 'last_failed'],
        primaryKeys: ['id'],
      },
      {
        name: 'attachments',
        hasSerialKey: true,
        columns: ['id', 'user_id', 'scheduled_email_id', 'filename', 'mime_type', 'size_bytes', 'content', 'created_at'],
        primaryKeys: ['id'],
      },
      {
        name: 'email_logs',
        hasSerialKey: true,
        columns: ['id', 'scheduled_email_id', 'recipient_email', 'occurrence_key', 'sent_at', 'status', 'error_message'],
        primaryKeys: ['id'],
      },
    ];

    for (const table of tables) {
      console.log(`\n📦 Migrating table '${table.name}'...`);

      // Fetch rows from source via Neon HTTP client using quoted identifiers
      const selectQuery = `SELECT ${table.columns.map((c) => `"${c}"`).join(', ')} FROM "${table.name}"`;
      const queryResult = await sourceSql.query(selectQuery);
      const rows = extractRows(queryResult);

      if (!rows || rows.length === 0) {
        console.log(`   ℹ️  Table '${table.name}' is empty on NeonDB. Skipping.`);
        continue;
      }

      console.log(`   📥 Read ${rows.length} rows from NeonDB. Inserting into Supabase...`);

      const BATCH_SIZE = 50;

      if (useRestApi && supabaseRest) {
        // Use Supabase REST Client
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const chunk = rows.slice(i, i + BATCH_SIZE).map((row) => {
            const formattedRow: Record<string, any> = {};
            for (const col of table.columns) {
              let val = row[col];
              if (col === 'content' && typeof val === 'string' && val.startsWith('\\x')) {
                val = '\\x' + val.slice(2);
              }
              formattedRow[col] = val;
            }
            return formattedRow;
          });

          const { error } = await supabaseRest.from(table.name).upsert(chunk, {
            onConflict: table.primaryKeys.join(','),
            ignoreDuplicates: true,
          });

          if (error) {
            console.error(`   ❌ Error inserting batch into '${table.name}':`, error.message);
          } else {
            console.log(`   ... inserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} rows into '${table.name}'`);
          }
        }
      } else if (targetPgClient) {
        // Use PostgreSQL Direct Client
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const chunk = rows.slice(i, i + BATCH_SIZE);
          const valueTuples: string[] = [];
          const params: any[] = [];
          let paramIdx = 1;

          for (const row of chunk) {
            const tuplePlaceholders: string[] = [];
            for (const col of table.columns) {
              tuplePlaceholders.push(`$${paramIdx++}`);
              let val = row[col];
              if (col === 'content' && typeof val === 'string' && val.startsWith('\\x')) {
                val = Buffer.from(val.slice(2), 'hex');
              }
              params.push(val);
            }
            valueTuples.push(`(${tuplePlaceholders.join(', ')})`);
          }

          const colNames = table.columns.map((c) => `"${c}"`).join(', ');
          const conflictTarget = table.primaryKeys.map((c) => `"${c}"`).join(', ');
          const insertBatchQuery = `
            INSERT INTO "${table.name}" (${colNames})
            VALUES ${valueTuples.join(', ')}
            ON CONFLICT (${conflictTarget}) DO NOTHING
          `;

          await targetPgClient.query(insertBatchQuery, params);
          console.log(`   ... inserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} rows into '${table.name}'`);
        }

        // Reset auto-increment sequence if primary key is serial
        if (table.hasSerialKey) {
          try {
            const resetSeqQuery = `
              SELECT setval(
                COALESCE(pg_get_serial_sequence('${table.name}', 'id'), '${table.name}_id_seq'),
                COALESCE((SELECT MAX(id) FROM "${table.name}"), 1),
                true
              );
            `;
            await targetPgClient.query(resetSeqQuery);
            console.log(`   🔄 Reset primary key sequence for '${table.name}'.`);
          } catch (seqErr: any) {
            console.warn(`   ⚠️ Warning resetting sequence for '${table.name}':`, seqErr.message);
          }
        }
      }

      console.log(`   ✅ Successfully migrated table '${table.name}'.`);
    }

    console.log('\n🎉 Data migration from NeonDB to Supabase completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    if (targetPgClient) {
      await targetPgClient.end().catch(() => {});
    }
    console.log('🔌 Database connections closed.');
  }
}

runMigration();
