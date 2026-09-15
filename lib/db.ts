import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Single point of database access.
 *
 * Local dev uses SQLite. This is the ONLY file to change if you move to
 * Postgres / Turso / Neon for a serverless deploy — see README "Deploying".
 */

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'database', 'mail-scheduler.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migrate(instance);
  return instance;
}

/** Used by tests: an isolated in-memory database with the same schema. */
export function createTestDb(): Database.Database {
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  migrate(mem);
  return mem;
}

export function migrate(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id       TEXT NOT NULL UNIQUE,
      email           TEXT NOT NULL,
      name            TEXT NOT NULL DEFAULT '',
      access_token    TEXT,               -- encrypted at rest
      refresh_token   TEXT,               -- encrypted at rest
      token_expires_at TEXT,
      gmail_connected INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipients (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      department  TEXT,
      notes       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recipients_user ON recipients(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_user_email ON recipients(user_id, email);

    CREATE TABLE IF NOT EXISTS scheduled_emails (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject              TEXT NOT NULL,
      body                 TEXT NOT NULL,
      schedule_type        TEXT NOT NULL,          -- now | once | repeat
      scheduled_at         TEXT,                   -- UTC ISO, one-time sends
      timezone             TEXT NOT NULL,
      repeat_frequency     TEXT,                   -- daily | weekly | monthly | custom
      repeat_days          TEXT,                   -- JSON array of ISO weekdays
      repeat_interval_days INTEGER,                -- custom frequency
      start_date           TEXT,                   -- yyyy-MM-dd (local to timezone)
      start_time           TEXT,                   -- HH:mm (local to timezone)
      end_date             TEXT,                   -- yyyy-MM-dd, NULL = no end
      next_send_at         TEXT,                   -- UTC ISO, NULL when finished
      status               TEXT NOT NULL,          -- active|scheduled|paused|failed|completed
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sched_user ON scheduled_emails(user_id);
    -- The scheduler's hot path: "what is due right now?"
    CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_emails(status, next_send_at);

    -- A schedule can target several recipients (spec §4 "select one or multiple").
    CREATE TABLE IF NOT EXISTS scheduled_email_recipients (
      scheduled_email_id INTEGER NOT NULL REFERENCES scheduled_emails(id) ON DELETE CASCADE,
      recipient_id       INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      PRIMARY KEY (scheduled_email_id, recipient_id)
    );

    -- One row (id = 1) recording the last scheduler tick, so the app can show
    -- whether the scheduler is actually running.
    CREATE TABLE IF NOT EXISTS scheduler_state (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      last_run_at  TEXT NOT NULL,
      last_due     INTEGER NOT NULL DEFAULT 0,
      last_sent    INTEGER NOT NULL DEFAULT 0,
      last_failed  INTEGER NOT NULL DEFAULT 0
    );

    -- Attachment bytes live here so a scheduled email keeps its files until it
    -- fires. scheduled_email_id is NULL between upload and scheduling.
    CREATE TABLE IF NOT EXISTS attachments (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_email_id INTEGER REFERENCES scheduled_emails(id) ON DELETE CASCADE,
      filename           TEXT NOT NULL,   -- sanitised display name, never a path
      mime_type          TEXT NOT NULL,   -- derived from the extension, not the browser
      size_bytes         INTEGER NOT NULL,
      content            BLOB NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_schedule ON attachments(scheduled_email_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);

    CREATE TABLE IF NOT EXISTS email_logs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      scheduled_email_id INTEGER NOT NULL REFERENCES scheduled_emails(id) ON DELETE CASCADE,
      recipient_email    TEXT NOT NULL,
      occurrence_key     TEXT NOT NULL,   -- the UTC instant this send belongs to
      sent_at            TEXT,
      status             TEXT NOT NULL,   -- pending | sent | failed
      error_message      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_sched ON email_logs(scheduled_email_id);
    -- Duplicate-send guard: one row per (schedule, recipient, occurrence).
    -- Two overlapping scheduler runs cannot both claim the same occurrence.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_occurrence
      ON email_logs(scheduled_email_id, recipient_email, occurrence_key);
  `);
}
