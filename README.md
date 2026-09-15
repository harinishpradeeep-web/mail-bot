# Mail Scheduler

Schedule one-time and recurring emails from your own Gmail account. Sending happens on the
server, so an email goes out whether or not the site is open in a browser.

One Next.js project holds both halves: pages and components are the frontend, `app/api/**`
and `lib/**` are the backend. Gmail credentials and tokens exist only on the server side.

---

## Quick start

```bash
npm install
cp .env.example .env          # then fill it in — see GMAIL_SETUP.md
npm run db:init               # creates database/mail-scheduler.db
npm run dev                   # http://localhost:3000
```

`npm run dev` also starts the scheduler in development (it calls its own
`/api/cron/send-due` every 30 seconds), so a scheduled email sends without a second
terminal. Settings shows whether it is running.

To drive the endpoint yourself instead — which is what production does — set
`ENABLE_DEV_SCHEDULER=false` and run:

```bash
npm run cron:local
```

If your dev server is not on port 3000, set `NEXT_PUBLIC_APP_URL` to its URL so the loop can
reach itself.

Then: **Continue with Google** → **Recipients → Add recipient** → **Compose email**.

Want to try the flow without sending real mail? Set `MAIL_MODE=mock` in `.env`. Sends are
logged to the console and recorded in history as successful, but nothing leaves your machine.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs the test suite (49 tests, never sends real mail) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` / `npm start` | Production build and serve |

---

## Where to put your Google credentials

Everything you must supply yourself is in **one file: `.env`**, and each line is marked
`YOU MUST FILL THIS IN` in `.env.example`.

| Variable | Where it comes from |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → Credentials → OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Same screen as the client ID |
| `GOOGLE_REDIRECT_URI` | Must equal `<app url>/api/auth/google/callback` and be registered in the Console |
| `SESSION_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `TOKEN_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

Step-by-step Console walkthrough: **[GMAIL_SETUP.md](./GMAIL_SETUP.md)**.

No credentials are hard-coded anywhere. `.env` is git-ignored.

---

## Project layout

The spec asked for `/frontend`, `/backend`, `/database`, `/api`, `/components`, `/pages`,
`/services`, `/jobs`. Next.js App Router merges frontend and backend into one deployable, so
those roles map like this:

| Spec folder | Here | Contents |
| --- | --- | --- |
| `/frontend`, `/pages` | `app/page.tsx`, `app/recipients`, `app/compose`, `app/scheduled`, `app/history`, `app/settings` | Dashboard, Recipients, Compose, Scheduled, Sent history, Settings |
| `/components` | `components/` | `AppShell` (sidebar + nav), `Modal`, `Toast`, `Ui` (cards, badges, empty/error/loading states), `GoogleButton`, `SessionProvider` |
| `/api`, `/backend` | `app/api/` | `auth/google`, `auth/google/callback`, `auth/logout`, `me`, `recipients`, `schedules`, `logs`, `cron/send-due` |
| `/services` | `lib/` | `google.ts` (OAuth), `gmail.ts` (Gmail API), `recurrence.ts` (next-send maths), `validate.ts`, `crypto.ts`, `session.ts`, `db.ts` |
| `/jobs` | `app/api/cron/send-due/route.ts` + `lib/dispatch.ts` | The scheduler tick and the send engine |
| `/database` | `database/` + `lib/db.ts` | SQLite file plus the schema and migrations |
| — | `tests/`, `scripts/` | Test suite; DB init and local cron loop |

---

## How scheduling works

1. Compose posts to `POST /api/schedules`. The server validates it, computes `next_send_at`
   in UTC, and stores the pattern (`repeat_frequency`, `repeat_days`, `start_date`,
   `start_time`, `end_date`, `timezone`).
2. `GET /api/cron/send-due` runs every minute. It selects rows where `status` is `active` or
   `scheduled` and `next_send_at <= now`.
3. For each recipient it writes an `email_logs` row **before** sending, then calls the Gmail
   API and updates the row to `sent` or `failed`.
4. It recomputes `next_send_at` from the pattern. When nothing is left, the schedule becomes
   `completed` (or `failed` if the only attempt failed).

Times are stored as UTC but computed in the schedule's IANA timezone, so "every day at
8:00 AM" stays 8:00 AM local across a DST change. `lib/recurrence.ts` is pure — no I/O — and
is the file to read or test if you change the timing rules.

**Duplicate-send protection** has two layers.

First, a claim: the tick moves a row `active`/`scheduled` → `processing` with
`UPDATE … WHERE id = ? AND next_send_at = ? AND status IN ('active','scheduled')`. Only one
caller can win that update, so a second overlapping invocation skips the schedule entirely.
`advanceSchedule` then moves it to `active`, `scheduled`, `completed` or `failed`, so nothing
stays locked.

Second, a unique index on
`email_logs(scheduled_email_id, recipient_email, occurrence_key)`. Two overlapping scheduler
runs both try to claim the same occurrence; the second hits the constraint and skips instead
of sending twice. Running the cron endpoint more often than necessary is therefore harmless.

### Status meanings

| Status | Meaning |
| --- | --- |
| 🔵 Sending (`processing`) | Claimed by a scheduler run right now. A claim left behind by a crashed run is released after 10 minutes |
| 🟢 Active | Recurring schedule with more sends to come |
| 🟡 Scheduled | One-time email waiting for its moment |
| ⏸ Paused | Stopped by you; resuming skips whatever came due while paused |
| 🔴 Failed | Last attempt failed and nothing is queued — fix the cause, then Resume |
| ✅ Completed | Ran to its end date, or the one-time send went out |

---

## Running the scheduler

**This is the part that actually sends scheduled email.** The scheduler is a plain
authenticated HTTP endpoint — deliberately not an in-process timer, because a `setInterval`
inside a Next.js app dies with the serverless invocation and never fires on Vercel. Nothing
calls the endpoint on its own, so if no cron is configured, schedules are stored correctly
and simply never fire.

**Settings → Scheduler** shows the last tick and warns when nothing has run. In the server
log, every tick prints
`[SCHEDULER] Checking for due schedules` with the server time and the due count. If your
server log has no `[SCHEDULER]` lines and no `/api/cron/send-due` requests, the scheduler is
not wired up — that, not the schedule itself, is the problem.

Anything that can make a request on a timer will drive it. It needs the header `Authorization: Bearer $CRON_SECRET`.

**Local:** `npm run cron:local`

**Any server with cron:**

```cron
* * * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app/api/cron/send-due
```

**Vercel:** `vercel.json` already declares the cron job. Two caveats worth knowing before you
deploy there:

- Minute-level cron needs a **Pro** plan; on Hobby the minimum interval is once per day. If
  you're on Hobby, delete the `crons` block and point an external pinger
  (cron-job.org, GitHub Actions scheduled workflow, Uptime Robot) at the endpoint each minute.
- Serverless filesystems are ephemeral, so **SQLite will not persist on Vercel.** Swap the
  driver before deploying — `lib/db.ts` is the only file that touches the database. Turso
  (`@libsql/client`, closest to SQLite), Neon, or Vercel Postgres all work; keep the same
  table definitions and the unique index on `email_logs`.

Set `CRON_SECRET` as a project environment variable and Vercel Cron's own bearer token will
match it.

---

## Security

- **OAuth only.** The app never asks for or stores a Gmail password. Requested scope is
  `gmail.send`, which cannot read your inbox.
- **Secrets stay server-side.** Client ID, client secret and tokens are read only in
  `lib/google.ts` and `lib/gmail.ts` from API routes. No `NEXT_PUBLIC_` variable holds a
  secret. `GET /api/me` returns an email address and a boolean — never a token.
- **Refresh tokens are encrypted at rest** with AES-256-GCM (`lib/crypto.ts`) using
  `TOKEN_ENCRYPTION_KEY`.
- **Sessions** are HttpOnly, SameSite=Lax, HMAC-signed cookies; the OAuth flow carries a
  signed `state` value to block CSRF.
- **Authorization.** Every query is scoped `WHERE user_id = ?`, and schedules verify that the
  recipient IDs belong to the caller, so one user cannot read or modify another's data.
- **Validation** runs server-side in `lib/validate.ts` regardless of what the browser did —
  email format, timezone, date/time, weekday selection, interval bounds, end-date ordering.
- **Logging** records statuses and HTTP codes only. Tokens, secrets and authorisation codes
  are never logged.

---

## Testing

```bash
npm test
```

`MAIL_MODE`/`NODE_ENV=test` force the mock mailer and `global.fetch` is stubbed in the OAuth
tests, so the suite cannot send a real email or call Google.

Covered: attachment filename sanitisation and path-traversal attempts, size and type
validation, multipart MIME building, unchanged output when there are no attachments,
concurrent scheduler ticks (exactly one send), stale-claim release, Gmail error
classification (401/403/429/5xx), OAuth URL shape and offline access, code-exchange success and failure, expired-token
handling, encrypted-token round trip, tampered-cookie rejection, Gmail MIME building
(including a non-ASCII subject), recipient email validation, immediate send, one-time
schedule, daily / weekly / monthly / custom recurrence, multiple recipients, end-date
completion, pause and resume (including skipping missed occurrences), delete cascade, failed
Gmail request, duplicate-send prevention, and timezone handling across a DST change.

---

## Attachments

Files chosen in the composer upload straight away to `POST /api/attachments` and are stored as
BLOBs in the `attachments` table, so a scheduled email still has its files when it fires days
later. They are bound to a schedule on create (`attachmentIds`) and can be replaced on edit by
sending a new `attachmentIds` array; omitting the field leaves them untouched.

Limits: 10 MB per file, 15 MB total per email (~20 MB once base64-encoded, under Gmail's 25 MB
ceiling), 10 files per email. The browser's filename and MIME type are both distrusted — the
name is reduced to a bare basename and the type is derived from an extension allowlist, so
executables are refused. Attachment bytes are never served back over HTTP; only metadata
reaches the browser. Uploads never bound to a schedule are purged after 24 hours.

An email with no attachments produces a byte-identical message to before — plain text, no
multipart wrapper. With attachments it becomes `multipart/mixed`: the body as the first part,
one base64 part per file.

Note for Vercel: serverless request bodies cap at ~4.5 MB, so large uploads need a persistent
host or direct-to-storage uploads.

## Known limitations

- Messages are plain text. The composer preserves line breaks; it is not a rich-text editor.
- Recurring sends reuse the same subject and body each time — there are no template variables.
- Gmail's own sending limits apply (roughly 500 recipients/day on a personal account).
