import { describe, expect, it } from 'vitest';
import { isEmail, validateRecipient, validateSchedule } from '@/lib/validate';

const now = new Date('2026-09-12T06:00:00Z');

describe('email validation', () => {
  it('accepts ordinary addresses', () => {
    expect(isEmail('professor@gmail.com')).toBe(true);
    expect(isEmail('first.last+tag@dept.university.ac.in')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['professor', 'professor@', '@gmail.com', 'a b@gmail.com', 'prof@gmail', '']) {
      expect(isEmail(bad)).toBe(false);
    }
  });

  it('refuses a recipient with an invalid email', () => {
    const result = validateRecipient({ name: 'Dr. Sharma', email: 'not-an-email' });
    expect(result.ok).toBe(false);
  });

  it('normalises a valid recipient', () => {
    const result = validateRecipient({ name: '  Dr. Sharma ', email: 'Professor@Gmail.com', department: 'Mech' });
    expect(result).toMatchObject({ ok: true, value: { name: 'Dr. Sharma', email: 'professor@gmail.com' } });
  });
});

describe('schedule validation', () => {
  const valid = {
    recipientIds: [1],
    subject: 'Daily project update',
    body: 'Good morning sir',
    timezone: 'Asia/Kolkata',
    startDate: '2026-09-20',
    startTime: '10:00',
  };

  it('accepts a future one-time send', () => {
    expect(validateSchedule({ ...valid, scheduleType: 'once' }, now).ok).toBe(true);
  });

  it('rejects a one-time send in the past', () => {
    const result = validateSchedule({ ...valid, scheduleType: 'once', startDate: '2026-09-01' }, now);
    expect(result.ok).toBe(false);
  });

  it('requires at least one recipient', () => {
    expect(validateSchedule({ ...valid, scheduleType: 'once', recipientIds: [] }, now).ok).toBe(false);
  });

  it('requires a subject and a message', () => {
    expect(validateSchedule({ ...valid, scheduleType: 'once', subject: '  ' }, now).ok).toBe(false);
    expect(validateSchedule({ ...valid, scheduleType: 'once', body: '' }, now).ok).toBe(false);
  });

  it('rejects an unknown timezone', () => {
    expect(validateSchedule({ ...valid, scheduleType: 'once', timezone: 'Mars/Olympus' }, now).ok).toBe(false);
  });

  it('requires weekdays for a weekly repeat', () => {
    const result = validateSchedule(
      { ...valid, scheduleType: 'repeat', repeatFrequency: 'weekly', repeatDays: [] },
      now
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = validateSchedule(
      { ...valid, scheduleType: 'repeat', repeatFrequency: 'daily', endDate: '2026-09-01' },
      now
    );
    expect(result.ok).toBe(false);
  });

  it('fills in date and time for an immediate send', () => {
    const result = validateSchedule(
      { recipientIds: [1], subject: 'Hi', body: 'Now', scheduleType: 'now', timezone: 'Asia/Kolkata' },
      now
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startDate).toBe('2026-09-12');
      expect(result.value.startTime).toBe('11:30'); // 06:00 UTC in IST
    }
  });
});
