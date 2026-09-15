/** Initializes the database. */
import 'dotenv/config';
import { db } from '../lib/db';

db();
console.log('Database initialized successfully using Drizzle ORM.');
