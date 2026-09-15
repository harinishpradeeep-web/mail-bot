import {
  pgTable,
  serial,
  integer,
  text,
  primaryKey,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom bytea column type for binary attachments
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType() {
    return 'bytea';
  },
  toDriver(val: Buffer) {
    return val;
  },
  fromDriver(val: unknown) {
    if (Buffer.isBuffer(val)) return val;
    if (val instanceof Uint8Array) return Buffer.from(val);
    if (typeof val === 'string') {
      if (val.startsWith('\\x')) {
        return Buffer.from(val.slice(2), 'hex');
      }
      return Buffer.from(val, 'binary');
    }
    return Buffer.from(val as ArrayBuffer);
  },
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: text('token_expires_at'),
  gmailConnected: integer('gmail_connected').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const recipients = pgTable(
  'recipients',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    department: text('department'),
    notes: text('notes'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_recipients_user').on(table.userId),
    uniqueIndex('idx_recipients_user_email').on(table.userId, table.email),
  ]
);

export const scheduledEmails = pgTable(
  'scheduled_emails',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    scheduleType: text('schedule_type').notNull(),
    scheduledAt: text('scheduled_at'),
    timezone: text('timezone').notNull(),
    repeatFrequency: text('repeat_frequency'),
    repeatDays: text('repeat_days'),
    repeatIntervalDays: integer('repeat_interval_days'),
    startDate: text('start_date'),
    startTime: text('start_time'),
    endDate: text('end_date'),
    nextSendAt: text('next_send_at'),
    status: text('status').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_sched_user').on(table.userId),
    index('idx_sched_due').on(table.status, table.nextSendAt),
  ]
);

export const scheduledEmailRecipients = pgTable(
  'scheduled_email_recipients',
  {
    scheduledEmailId: integer('scheduled_email_id')
      .notNull()
      .references(() => scheduledEmails.id, { onDelete: 'cascade' }),
    recipientId: integer('recipient_id')
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.scheduledEmailId, table.recipientId] }),
  ]
);

export const schedulerState = pgTable('scheduler_state', {
  id: integer('id').primaryKey(),
  lastRunAt: text('last_run_at').notNull(),
  lastDue: integer('last_due').notNull().default(0),
  lastSent: integer('last_sent').notNull().default(0),
  lastFailed: integer('last_failed').notNull().default(0),
});

export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduledEmailId: integer('scheduled_email_id').references(() => scheduledEmails.id, {
      onDelete: 'cascade',
    }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    content: bytea('content').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_attachments_schedule').on(table.scheduledEmailId),
    index('idx_attachments_user').on(table.userId),
  ]
);

export const emailLogs = pgTable(
  'email_logs',
  {
    id: serial('id').primaryKey(),
    scheduledEmailId: integer('scheduled_email_id')
      .notNull()
      .references(() => scheduledEmails.id, { onDelete: 'cascade' }),
    recipientEmail: text('recipient_email').notNull(),
    occurrenceKey: text('occurrence_key').notNull(),
    sentAt: text('sent_at'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
  },
  (table) => [
    index('idx_logs_sched').on(table.scheduledEmailId),
    uniqueIndex('idx_logs_occurrence').on(
      table.scheduledEmailId,
      table.recipientEmail,
      table.occurrenceKey
    ),
  ]
);
