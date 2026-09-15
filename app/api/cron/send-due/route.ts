import { NextResponse, type NextRequest } from 'next/server';
import { runDueSchedules } from '@/lib/dispatch';
import { safeEqual } from '@/lib/crypto';

export const runtime = 'nodejs';
// Never cache the scheduler tick.
export const dynamic = 'force-dynamic';

/**
 * The server-side scheduler. Nothing here depends on a browser tab being open.
 *
 * Call it every minute:
 *   • Vercel        → vercel.json "crons" (Pro allows minute granularity;
 *                     on Hobby the minimum is daily, so use an external
 *                     pinger — see README "Running the scheduler")
 *   • Any VPS/cron  → * * * * * curl -H "Authorization: Bearer $CRON_SECRET" \
 *                       https://your-app/api/cron/send-due
 *   • Local dev     → npm run cron:local
 *
 * Auth: Bearer CRON_SECRET. Vercel Cron also sends its own bearer token, which
 * matches when you set CRON_SECRET as a project environment variable.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[SCHEDULER] Error: CRON_SECRET is not set, so the scheduler cannot run.');
    return NextResponse.json({ error: 'CRON_SECRET is not set. See .env.example.' }, { status: 500 });
  }

  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!provided || !safeEqual(provided, secret)) {
    console.warn('[SCHEDULER] Rejected a tick with a missing or wrong bearer token.');
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  console.log('[SCHEDULER] Scheduler started');

  try {
    const result = await runDueSchedules();
    // Errors are per-recipient messages; they contain no credentials.
    console.log(
      `[SCHEDULER] Tick complete: due=${result.due} sent=${result.sent} failed=${result.failed} duplicatesSkipped=${result.skippedDuplicates} lockedSkipped=${result.skippedLocked}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[SCHEDULER] Error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'Scheduler run failed.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
