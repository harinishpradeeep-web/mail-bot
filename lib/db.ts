import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './db/schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

let instance: AppDb | null = null;

export function db(): AppDb {
  if (instance) return instance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL environment variable. Please add DATABASE_URL to your .env file.');
  }

  const client = neon(connectionString);
  instance = drizzle(client, { schema });
  return instance;
}
