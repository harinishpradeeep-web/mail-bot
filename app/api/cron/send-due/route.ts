import { NextResponse, type NextRequest } from 'next/server';
import { runDueSchedules } from '@/lib/dispatch';
import { safeEqual } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-side scheduler API endpoint.
 * Accepts authentication via:
 *   - Bearer token header: Authorization: Bearer <CRON_SECRET>
 *   - Query parameter: /api/cron/send-due?secret=<CRON_SECRET>
 *   - Custom header: x-cron-secret: <CRON_SECRET>
 */
async function handle(req: NextRequest) {
  const timestamp = new Date().toISOString();
  console.log(`[NETLIFY CRON API] 📩 Cron endpoint invoked at ${timestamp} (${req.method} ${req.url})`);

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[NETLIFY CRON API] ❌ ERROR: CRON_SECRET is not set in Netlify environment variables!');
    return NextResponse.json({ error: 'CRON_SECRET is not set in environment variables.' }, { status: 500 });
  }

  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret') || url.searchParams.get('token');
  const headerSecret = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('x-cron-secret');
  const provided = headerSecret || querySecret || '';

  if (!provided || !safeEqual(provided, secret)) {
    console.warn('[NETLIFY CRON API] ⚠️ Authorization failed: missing or invalid CRON_SECRET token.');
    return NextResponse.json({ error: 'Unauthorised. Missing or invalid CRON_SECRET.' }, { status: 401 });
  }

  console.log('[NETLIFY CRON API] ✅ Authorization successful. Checking for due schedules...');

  try {
    const result = await runDueSchedules();
    console.log(
      `[NETLIFY CRON API] 🚀 Tick complete: due=${result.due}, sent=${result.sent}, failed=${result.failed}, skippedDuplicates=${result.skippedDuplicates}, lockedSkipped=${result.skippedLocked}`
    );
    if (result.errors.length > 0) {
      console.error(`[NETLIFY CRON API] ⚠️ Send errors encountered:`, result.errors);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[NETLIFY CRON API] ❌ Scheduler run failed with error: ${message}`);
    return NextResponse.json({ error: 'Scheduler run failed.', details: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
