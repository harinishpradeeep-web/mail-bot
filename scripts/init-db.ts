/** Creates the SQLite file and applies the schema. Safe to re-run. */
import 'dotenv/config';
import { db } from '../lib/db';

db();
console.log(`Database ready at ${process.env.DATABASE_PATH || './database/mail-scheduler.db'}`);
