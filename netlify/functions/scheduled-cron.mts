import { Config } from '@netlify/functions';
import { runDueSchedules } from '../../lib/dispatch';

export default async () => {
  const now = new Date().toISOString();
  console.log(`[NETLIFY CRON FUNCTION] ⏰ Scheduled tick triggered at ${now}`);

  try {
    const result = await runDueSchedules();
    console.log(
      `[NETLIFY CRON FUNCTION] ✅ Tick completed successfully: due=${result.due}, sent=${result.sent}, failed=${result.failed}, skippedDuplicates=${result.skippedDuplicates}, skippedLocked=${result.skippedLocked}`
    );
    if (result.errors.length > 0) {
      console.error(`[NETLIFY CRON FUNCTION] ⚠️ Errors encountered during tick:`, result.errors);
    }
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[NETLIFY CRON FUNCTION] ❌ Scheduled tick failed with error: ${errorMsg}`);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config: Config = {
  schedule: '* * * * *',
};
