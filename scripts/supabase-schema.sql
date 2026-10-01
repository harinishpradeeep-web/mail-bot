-- ──────────────────────────────────────────────────────────────
-- Mail Scheduler — Supabase Database Creation Schema
-- Copy and run this script in the Supabase SQL Editor.
-- ──────────────────────────────────────────────────────────────

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    gmail_connected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Recipients Table
CREATE TABLE IF NOT EXISTS recipients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recipients_user ON recipients(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_user_email ON recipients(user_id, email);

-- 3. Scheduled Emails Table
CREATE TABLE IF NOT EXISTS scheduled_emails (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    schedule_type TEXT NOT NULL,
    scheduled_at TEXT,
    timezone TEXT NOT NULL,
    repeat_frequency TEXT,
    repeat_days TEXT,
    repeat_interval_days INTEGER,
    start_date TEXT,
    start_time TEXT,
    end_date TEXT,
    next_send_at TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sched_user ON scheduled_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_emails(status, next_send_at);

-- 4. Scheduled Email Recipients (Junction Table)
CREATE TABLE IF NOT EXISTS scheduled_email_recipients (
    scheduled_email_id INTEGER NOT NULL REFERENCES scheduled_emails(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
    PRIMARY KEY (scheduled_email_id, recipient_id)
);

-- 5. Scheduler State Table
CREATE TABLE IF NOT EXISTS scheduler_state (
    id INTEGER PRIMARY KEY,
    last_run_at TEXT NOT NULL,
    last_due INTEGER NOT NULL DEFAULT 0,
    last_sent INTEGER NOT NULL DEFAULT 0,
    last_failed INTEGER NOT NULL DEFAULT 0
);

-- 6. Attachments Table
CREATE TABLE IF NOT EXISTS attachments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_email_id INTEGER REFERENCES scheduled_emails(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content BYTEA NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachments_schedule ON attachments(scheduled_email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);

-- 7. Email Logs Table
CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    scheduled_email_id INTEGER NOT NULL REFERENCES scheduled_emails(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    sent_at TEXT,
    status TEXT NOT NULL,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_sched ON email_logs(scheduled_email_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_occurrence ON email_logs(scheduled_email_id, recipient_email, occurrence_key);
