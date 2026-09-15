import { describe, expect, it } from 'vitest';
import { describeSchedule, firstOccurrence, nextOccurrence } from '@/lib/recurrence';
import type { RecurrenceSpec } from '@/lib/types';

const base: RecurrenceSpec = {
  scheduleType: 'repeat',
  timezone: 'Asia/Kolkata',
  startDate: '2026-09-15',
  startTime: '08:00',
  repeatFrequency: 'daily',
  repeatDays: null,
  repeatIntervalDays: null,
  endDate: null,
};

describe('one-time schedules', () => {
  it('fires once at the chosen local time', () => {
    const spec: RecurrenceSpec = { ...base, scheduleType: 'once', repeatFrequency: null };
    const next = nextOccurrence(spec, new Date('2026-09-14T00:00:00Z'));
    // 08:00 IST = 02:30 UTC
    expect(next?.toISOString()).toBe('2026-09-15T02:30:00.000Z');
  });

  it('returns null once the moment has passed', () => {
    const spec: RecurrenceSpec = { ...base, scheduleType: 'once', repeatFrequency: null };
    expect(nextOccurrence(spec, new Date('2026-09-15T03:00:00Z'))).toBeNull();
  });
});

describe('daily recurrence', () => {
  it('rolls to the next day after firing', () => {
    const next = nextOccurrence(base, new Date('2026-09-15T02:30:00Z'));
    expect(next?.toISOString()).toBe('2026-09-16T02:30:00.000Z');
  });

  it('stops after the end date', () => {
    const spec = { ...base, endDate: '2026-09-16' };
    expect(nextOccurrence(spec, new Date('2026-09-16T02:30:00Z'))).toBeNull();
  });

  it('includes the end date itself', () => {
    const spec = { ...base, endDate: '2026-09-16' };
    expect(nextOccurrence(spec, new Date('2026-09-15T02:30:00Z'))?.toISOString()).toBe('2026-09-16T02:30:00.000Z');
  });
});

describe('weekly recurrence', () => {
  const weekly: RecurrenceSpec = {
    ...base,
    repeatFrequency: 'weekly',
    repeatDays: [1, 3, 5], // Mon, Wed, Fri
    startDate: '2026-09-14', // a Monday
    startTime: '18:00',
  };

  it('picks only the selected weekdays', () => {
    const first = firstOccurrence(weekly, new Date('2026-09-14T00:00:00Z'));
    expect(first?.toISOString()).toBe('2026-09-14T12:30:00.000Z'); // Mon 18:00 IST

    const second = nextOccurrence(weekly, first!);
    expect(second?.toISOString()).toBe('2026-09-16T12:30:00.000Z'); // Wed

    const third = nextOccurrence(weekly, second!);
    expect(third?.toISOString()).toBe('2026-09-18T12:30:00.000Z'); // Fri

    const fourth = nextOccurrence(weekly, third!);
    expect(fourth?.toISOString()).toBe('2026-09-21T12:30:00.000Z'); // next Mon
  });

  it('has no occurrences when no day is selected', () => {
    expect(nextOccurrence({ ...weekly, repeatDays: [] }, new Date('2026-09-14T00:00:00Z'))).toBeNull();
  });

  it('describes the pattern for the schedules table', () => {
    expect(describeSchedule(weekly)).toBe('Every Monday, Wednesday & Friday at 6:00 PM');
  });
});

describe('monthly and custom recurrence', () => {
  it('repeats on the same day each month', () => {
    const spec: RecurrenceSpec = { ...base, repeatFrequency: 'monthly', startDate: '2026-09-20' };
    const first = firstOccurrence(spec, new Date('2026-09-01T00:00:00Z'));
    expect(first?.toISOString()).toBe('2026-09-20T02:30:00.000Z');
    expect(nextOccurrence(spec, first!)?.toISOString()).toBe('2026-10-20T02:30:00.000Z');
  });

  it('clamps a 31st schedule to the last day of a short month', () => {
    const spec: RecurrenceSpec = { ...base, repeatFrequency: 'monthly', startDate: '2026-10-31' };
    const first = firstOccurrence(spec, new Date('2026-10-01T00:00:00Z'))!;
    expect(nextOccurrence(spec, first)?.toISOString()).toBe('2026-11-30T02:30:00.000Z');
  });

  it('honours a custom day interval', () => {
    const spec: RecurrenceSpec = { ...base, repeatFrequency: 'custom', repeatIntervalDays: 3 };
    const first = firstOccurrence(spec, new Date('2026-09-14T00:00:00Z'))!;
    expect(first.toISOString()).toBe('2026-09-15T02:30:00.000Z');
    expect(nextOccurrence(spec, first)?.toISOString()).toBe('2026-09-18T02:30:00.000Z');
  });
});

describe('timezone handling', () => {
  it('converts the same local time differently per zone', () => {
    const ist = nextOccurrence({ ...base, scheduleType: 'once', repeatFrequency: null }, new Date('2026-09-14T00:00:00Z'));
    const ny = nextOccurrence(
      { ...base, scheduleType: 'once', repeatFrequency: null, timezone: 'America/New_York' },
      new Date('2026-09-14T00:00:00Z')
    );
    expect(ist?.toISOString()).toBe('2026-09-15T02:30:00.000Z');
    expect(ny?.toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });

  it('keeps 08:00 local across a DST change', () => {
    const spec: RecurrenceSpec = { ...base, timezone: 'America/New_York', startDate: '2026-10-30' };
    // 08:00 EDT = 12:00 UTC; after the 1 Nov switch, 08:00 EST = 13:00 UTC
    const before = firstOccurrence(spec, new Date('2026-10-29T00:00:00Z'))!;
    expect(before.toISOString()).toBe('2026-10-30T12:00:00.000Z');
    const after = nextOccurrence(spec, new Date('2026-11-01T20:00:00Z'))!;
    expect(after.toISOString()).toBe('2026-11-02T13:00:00.000Z');
  });
});
