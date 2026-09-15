/**
 * Local scheduler loop for development.
 * Hits /api/cron/send-due once a minute so you don't need a real cron daemon.
 *
 *   npm run dev        (terminal 1)
 *   npm run cron:local (terminal 2)
 */
import 'dotenv/config';

const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error('CRON_SECRET is missing from .env — see .env.example');
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${base}/api/cron/send-due`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (res.status === 401) {
      console.error('401 Unauthorised — CRON_SECRET here does not match the one the app is running with.');
      console.error('Both read the same .env, so restart `npm run dev` after editing it.');
      return;
    }
    console.log(new Date().toISOString(), res.status, JSON.stringify(json));
  } catch (err) {
    console.error(
      `Could not reach ${base}. Is \`npm run dev\` running on that URL?`,
      err instanceof Error ? err.message : err
    );
  }
}

console.log(`Polling ${base}/api/cron/send-due every 60s. Ctrl+C to stop.`);
console.log('Leave this running — scheduled emails only send while something calls that endpoint.');
void tick();
setInterval(tick, 60_000);
