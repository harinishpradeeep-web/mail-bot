import { describe, expect, it, vi } from 'vitest';
import { advanceSchedule, runDueSchedules, sendOccurrence } from '@/lib/dispatch';
import { TokenExpiredError } from '@/lib/google';
import { nextOccurrence } from '@/lib/recurrence';
import { specOf } from '@/lib/dispatch';
import { recordingMailer, seed } from './helpers';

const DUE = '2026-09-15T02:30:00.000Z';
const AFTER_DUE = new Date('2026-09-15T02:30:30.000Z');

describe('sending due schedules', () => {
  it('sends a one-time email and marks it completed', async () => {
    const ctx = seed({ scheduleType: 'once', status: 'scheduled' });
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(sent[0].to).toContain('professor@gmail.com');
    expect(ctx.schedule().status).toBe('completed');
    expect(ctx.schedule().next_send_at).toBeNull();
  });

  it('sends to every recipient of a multi-recipient schedule', async () => {
    const ctx = seed({
      recipients: [
        { name: 'Dr. Sharma', email: 'sharma@gmail.com' },
        { name: 'Dr. Iyer', email: 'iyer@gmail.com' },
      ],
    });
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.sent).toBe(2);
    expect(sent.map((s) => s.to).join(' ')).toContain('iyer@gmail.com');
  });

  it('advances a daily recurrence to the next day and stays active', async () => {
    const ctx = seed({ repeatFrequency: 'daily' });
    const { mailer } = recordingMailer();

    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(ctx.schedule().status).toBe('active');
    expect(ctx.schedule().next_send_at).toBe('2026-09-16T02:30:00.000Z');
  });

  it('completes a recurrence after its final occurrence', async () => {
    const ctx = seed({ repeatFrequency: 'daily', endDate: '2026-09-15' });
    const { mailer } = recordingMailer();

    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(ctx.schedule().status).toBe('completed');
    expect(ctx.schedule().next_send_at).toBeNull();
  });

  it('walks a weekly recurrence Mon → Wed', async () => {
    const ctx = seed({
      repeatFrequency: 'weekly',
      repeatDays: [1, 3],
      startDate: '2026-09-14',
      startTime: '18:00',
      nextSendAt: '2026-09-14T12:30:00.000Z',
    });
    const { mailer } = recordingMailer();

    await runDueSchedules({ conn: ctx.conn, mailer, now: new Date('2026-09-14T12:31:00Z') });

    expect(ctx.schedule().next_send_at).toBe('2026-09-16T12:30:00.000Z');
  });

  it('ignores schedules that are not due yet', async () => {
    const ctx = seed();
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: new Date('2026-09-15T02:00:00Z') });

    expect(result.due).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('ignores paused schedules', async () => {
    const ctx = seed({ status: 'paused' });
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.due).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('duplicate protection', () => {
  it('does not send the same occurrence twice when two runs overlap', async () => {
    const ctx = seed();
    const { mailer, sent } = recordingMailer();
    const schedule = ctx.schedule();

    const first = await sendOccurrence(schedule, DUE, { conn: ctx.conn, mailer });
    const second = await sendOccurrence(schedule, DUE, { conn: ctx.conn, mailer });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(sent).toHaveLength(1);
    expect(ctx.logs()).toHaveLength(1);
  });

  it('treats a later occurrence of the same schedule as new', async () => {
    const ctx = seed();
    const { mailer, sent } = recordingMailer();
    const schedule = ctx.schedule();

    await sendOccurrence(schedule, DUE, { conn: ctx.conn, mailer });
    await sendOccurrence(schedule, '2026-09-16T02:30:00.000Z', { conn: ctx.conn, mailer });

    expect(sent).toHaveLength(2);
  });
});

describe('failure handling', () => {
  it('logs a failed Gmail API request without losing the schedule', async () => {
    const ctx = seed();
    const mailer = { send: vi.fn().mockRejectedValue(new Error('Gmail API send failed (HTTP 500)')) };

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.failed).toBe(1);
    const log = ctx.logs()[0];
    expect(log.status).toBe('failed');
    expect(String(log.error_message)).toContain('HTTP 500');
    // A daily schedule keeps its next occurrence even after one bad send.
    expect(ctx.schedule().next_send_at).toBe('2026-09-16T02:30:00.000Z');
  });

  it('marks a one-time send failed when the token has expired', async () => {
    const ctx = seed({ scheduleType: 'once', status: 'scheduled' });
    const mailer = { send: vi.fn().mockRejectedValue(new TokenExpiredError()) };

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.failed).toBe(1);
    expect(ctx.schedule().status).toBe('failed');
  });

  it('stops after an expired token instead of hammering every recipient', async () => {
    const ctx = seed({
      recipients: [
        { name: 'A', email: 'a@gmail.com' },
        { name: 'B', email: 'b@gmail.com' },
      ],
    });
    const mailer = { send: vi.fn().mockRejectedValue(new TokenExpiredError()) };

    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});

describe('pause and resume', () => {
  it('resuming skips occurrences missed while paused', () => {
    const ctx = seed({ status: 'paused' });
    const row = ctx.schedule();

    // Paused through 15–17 Sep; resumed on the 18th.
    const next = nextOccurrence(specOf(row), new Date('2026-09-18T06:00:00Z'));
    expect(next?.toISOString()).toBe('2026-09-19T02:30:00.000Z');
  });

  it('a schedule with nothing left closes out as completed', () => {
    const ctx = seed({ endDate: '2026-09-15' });
    const row = ctx.schedule();

    advanceSchedule(row, new Date(DUE), false, { conn: ctx.conn });
    expect(ctx.schedule().status).toBe('completed');
  });
});

describe('deleting a schedule', () => {
  it('removes its recipients links and logs', async () => {
    const ctx = seed();
    const { mailer } = recordingMailer();
    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    ctx.conn.prepare('DELETE FROM scheduled_emails WHERE id = ?').run(ctx.scheduleId);

    expect(ctx.logs()).toHaveLength(0);
    expect(
      ctx.conn.prepare('SELECT COUNT(*) AS n FROM scheduled_email_recipients WHERE scheduled_email_id = ?').get(ctx.scheduleId)
    ).toMatchObject({ n: 0 });
  });
});

describe('concurrent scheduler invocations', () => {
  it('only one of two simultaneous ticks sends the occurrence', async () => {
    const ctx = seed();
    const { mailer, sent } = recordingMailer();

    const [a, b] = await Promise.all([
      runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE }),
      runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE }),
    ]);

    expect(sent).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    // The loser either never sees the row (already flipped to processing) or
    // loses the claim update. Both outcomes are a skip, never a second send.
    expect(a.due + b.due).toBe(1);
    expect(a.skippedLocked + b.skippedLocked).toBeLessThanOrEqual(1);
    expect(ctx.schedule().status).toBe('active');
  });

  it('leaves no schedule stuck in processing after a tick', async () => {
    const ctx = seed();
    const { mailer } = recordingMailer();
    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });
    expect(ctx.schedule().status).not.toBe('processing');
  });

  it('skips a schedule another worker is already processing', async () => {
    const ctx = seed();
    // Claimed a moment ago on the scheduler's clock.
    ctx.conn.prepare("UPDATE scheduled_emails SET status = 'processing', updated_at = ? WHERE id = ?")
      .run(AFTER_DUE.toISOString(), ctx.scheduleId);
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.due).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('releases a claim left behind by a crashed run', async () => {
    const ctx = seed();
    const stale = new Date(AFTER_DUE.getTime() - 30 * 60 * 1000).toISOString();
    ctx.conn.prepare("UPDATE scheduled_emails SET status = 'processing', updated_at = ? WHERE id = ?")
      .run(stale, ctx.scheduleId);
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe('Gmail error diagnostics', () => {
  it('maps status codes to safe, actionable messages and never retries', async () => {
    const { describeGmailFailure } = await import('@/lib/gmail');

    expect(describeGmailFailure(401, '').message).toMatch(/Reconnect Gmail/);
    expect(describeGmailFailure(403, JSON.stringify({ error: { message: 'Daily limit exceeded' } })).message)
      .toMatch(/Daily limit exceeded/);
    expect(describeGmailFailure(429, '').message).toMatch(/rate limit/i);
    expect(describeGmailFailure(503, '').message).toMatch(/temporarily unavailable/i);
  });

  it('stops the send loop on a 401 rather than calling Gmail again', async () => {
    const { describeGmailFailure } = await import('@/lib/gmail');
    const ctx = seed({
      recipients: [
        { name: 'A', email: 'a@gmail.com' },
        { name: 'B', email: 'b@gmail.com' },
      ],
    });
    const mailer = { send: vi.fn().mockRejectedValue(describeGmailFailure(401, '')) };

    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});
