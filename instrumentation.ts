/**
 * Next.js runs register() once when the server process boots.
 *
 * Production sending is driven by cron hitting /api/cron/send-due — that is the
 * only mechanism that works on serverless, where no process survives between
 * requests. But `next dev` DOES keep one long-lived process, and forgetting to
 * start a second terminal is the easiest way to think scheduled email is broken
 * when it is only unscheduled. So in development, and only in development, this
 * calls that same endpoint on a timer.
 *
 * It deliberately goes over HTTP rather than importing lib/dispatch: importing
 * the database layer here drags better-sqlite3 into the bundler's graph and
 * breaks every route with "Can't resolve 'fs'". Going through the endpoint also
 * means development exercises exactly the path production uses.
 *
 * Set ENABLE_DEV_SCHEDULER=false to turn this off and drive the endpoint
 * yourself with `npm run cron:local`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'development') return;
  if (process.env.ENABLE_DEV_SCHEDULER === 'false') return;

  const globals = globalThis as typeof globalThis & { __devSchedulerStarted?: boolean };
  if (globals.__devSchedulerStarted) return; // hot reload re-runs register()
  globals.__devSchedulerStarted = true;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[SCHEDULER] CRON_SECRET is not set, so the development scheduler cannot run.');
    console.warn('[SCHEDULER] Scheduled emails will NOT send. Add CRON_SECRET to .env — see .env.example.');
    return;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const url = `${base}/api/cron/send-due`;

  console.log(`[SCHEDULER] Scheduler started (development loop, every 30s → ${url})`);
  console.log('[SCHEDULER] In production this loop does not run — cron calls that endpoint instead');

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap with ourselves
    running = true;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
      if (res.status === 401) {
        console.error('[SCHEDULER] Error: the scheduler endpoint rejected CRON_SECRET.');
      } else if (!res.ok) {
        console.error(`[SCHEDULER] Error: scheduler endpoint returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(
        `[SCHEDULER] Error: could not reach ${url}.`,
        'If the dev server is not on that URL, set NEXT_PUBLIC_APP_URL in .env.',
        err instanceof Error ? err.message : ''
      );
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 4000);
  setInterval(tick, 30_000);
}
