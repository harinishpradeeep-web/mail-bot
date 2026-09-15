# Gmail API setup

You need three values from Google: a **Client ID**, a **Client Secret**, and a **Redirect URI**.
Nothing in this repo contains real credentials — every place you must paste a value is marked
`YOU MUST FILL THIS IN` in `.env.example`.

Total time: about 10 minutes.

---

## Step 1 — Open the Google Cloud Console

Go to <https://console.cloud.google.com/> and sign in with **the Gmail account you want to send from**.

## Step 2 — Create a project

Project picker (top bar) → **New project**.

- Name: `Mail Scheduler` (anything works)
- Create, then make sure the project picker shows it as selected.

## Step 3 — Enable the Gmail API

**APIs & Services → Library** → search `Gmail API` → **Enable**.

Only the Gmail API is required. Do not enable anything else.

## Step 4 — Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**.

| Field | Value |
| --- | --- |
| User type | **External** (choose Internal only if you have Google Workspace and will send from that org) |
| App name | `Mail Scheduler` |
| User support email | your email |
| Developer contact email | your email |

On the **Scopes** step, click *Add or remove scopes* and add exactly:

```
https://www.googleapis.com/auth/gmail.send
```

This scope can send mail and nothing else — it grants no read access to your inbox.

On the **Test users** step, add every Gmail address that will sign in to the app
(at minimum, your own). While the app is in *Testing* mode only these accounts can connect.

> **Why the "unverified app" warning appears:** apps in Testing mode show a
> "Google hasn't verified this app" screen. Click *Advanced → Go to Mail Scheduler (unsafe)*.
> That is expected for a personal project. Verification is only needed to open the app to
> the public.
>
> **Refresh-token expiry:** in Testing mode Google expires refresh tokens after 7 days, so
> you will need to reconnect Gmail weekly. Publishing the app (consent screen → *Publish app*)
> removes that limit.

## Step 5 — Create an OAuth Client ID

**APIs & Services → Credentials → Create credentials → OAuth client ID**.

- **Application type: Web application** — this is the correct type; this app exchanges the
  authorisation code on the server, not in the browser.
- Name: `Mail Scheduler web`
- **Authorised redirect URIs** → *Add URI*:

```
http://localhost:3000/api/auth/google/callback
```

That path is the route this app actually implements — see
`app/api/auth/google/callback/route.ts`. It must match character for character: no trailing
slash, no `www`, correct port.

Leave *Authorised JavaScript origins* empty. It is not used.

## Step 6 — Copy the credentials into `.env`

Google shows the **Client ID** and **Client Secret** once you create the client (and again from
the credentials list).

```bash
cp .env.example .env
```

Then fill in:

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

Generate the three app secrets in the same file:

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('TOKEN_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"
```

Restart `npm run dev` after editing `.env` — Next.js reads it at startup.

**The Client Secret is server-only.** It is read in `lib/google.ts`, which runs inside API
routes. It is never imported by a component, never returned by an API response, and never
prefixed `NEXT_PUBLIC_`.

## Step 7 — Add the production redirect URI after deploying

When the app has a real URL, go back to **Credentials → your OAuth client → Authorised
redirect URIs** and *add* (don't replace) the production callback:

```
https://your-app.vercel.app/api/auth/google/callback
```

Then set these in your hosting provider's environment variables:

```env
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
GOOGLE_REDIRECT_URI=https://your-app.vercel.app/api/auth/google/callback
```

Keep the localhost URI registered too, so local development keeps working. Both can live on
the same OAuth client.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI` differs from the registered URI. Compare them character by character, including the port. |
| Settings page says *Google OAuth is not configured* | One of the three `GOOGLE_*` variables is empty, or the dev server wasn't restarted after editing `.env`. |
| `access_denied` | You pressed Cancel, or your address isn't in the consent screen's Test users list. |
| Sends fail with *The Gmail connection has expired* | Refresh token revoked or 7-day Testing expiry. Reconnect from Settings; publish the app to stop it recurring. |
| `invalid_grant` on connect | Reused or stale authorisation code. Start again from the Connect button. |
