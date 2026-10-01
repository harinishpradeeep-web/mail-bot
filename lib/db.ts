import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __db_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __db_instance: AppDb | undefined;
}

export function db(): AppDb {
  if (globalThis.__db_instance) return globalThis.__db_instance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL environment variable. Please add DATABASE_URL to your .env file.');
  }

  if (!globalThis.__db_pool) {
    globalThis.__db_pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
    });
  }

  globalThis.__db_instance = drizzle(globalThis.__db_pool, { schema });
  return globalThis.__db_instance;
}
