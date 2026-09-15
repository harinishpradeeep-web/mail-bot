import { DateTime } from 'luxon';
import type { RecurrenceSpec, Weekday } from './types';

/**
 * Recurrence maths. Pure functions, no I/O — this is what tests/recurrence.test.ts
 * exercises.
 *
 * All schedules are defined in the user's chosen IANA timezone (e.g. Asia/Kolkata)
 * and stored as UTC instants. That means "every day at 8:00 AM" stays 8:00 AM
 * local even across a DST change, which is what a person expects.
 */

const MAX_LOOKAHEAD_DAYS = 366 * 3;

function localAt(date: string, time: string, zone: string): DateTime {
  return DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', { zone });
}

/** Inclusive end-of-day for the end date, so the last occurrence isn't skipped. */
function endBoundary(spec: RecurrenceSpec): DateTime | null {
  if (!spec.endDate) return null;
  return DateTime.fromFormat(spec.endDate, 'yyyy-MM-dd', { zone: spec.timezone }).endOf('day');
}

/**
 * Returns the next firing instant strictly after `after`, or null when the
 * schedule has no more occurrences (past its end date, or a one-time send
 * that has already happened).
 */
export function nextOccurrence(spec: RecurrenceSpec, after: Date): Date | null {
  const afterDt = DateTime.fromJSDate(after, { zone: spec.timezone });
  const start = localAt(spec.startDate, spec.startTime, spec.timezone);
  if (!start.isValid) return null;

  const end = endBoundary(spec);
  if (end && end < afterDt) return null;

  const fits = (candidate: DateTime): boolean =>
    candidate > afterDt && candidate >= start && (!end || candidate <= end);

  // One-off sends: a single candidate, take it or leave it.
  if (spec.scheduleType !== 'repeat') {
    return fits(start) ? start.toUTC().toJSDate() : null;
  }

  const frequency = spec.repeatFrequency ?? 'daily';

  if (frequency === 'monthly') {
    // Anchor on the start date's day-of-month, clamped for short months
    // (a 31st schedule fires on the 30th in November, not in December).
    const anchorDay = start.day;
    let cursor = start.startOf('month');
    const afterMonth = afterDt.startOf('month');
    if (cursor < afterMonth) cursor = afterMonth;
    for (let i = 0; i < 48; i++) {
      const month = cursor.plus({ months: i });
      const day = Math.min(anchorDay, month.daysInMonth ?? 28);
      const candidate = localAt(
        month.set({ day }).toFormat('yyyy-MM-dd'),
        spec.startTime,
        spec.timezone
      );
      if (end && candidate > end) return null;
      if (fits(candidate)) return candidate.toUTC().toJSDate();
    }
    return null;
  }

  const weekdays: Weekday[] = (spec.repeatDays ?? []) as Weekday[];
  if (frequency === 'weekly' && weekdays.length === 0) return null;

  const interval = frequency === 'custom' ? Math.max(1, spec.repeatIntervalDays ?? 1) : 1;

  // Walk forward day by day from the later of (start date, today).
  let day = start.startOf('day');
  const afterDay = afterDt.startOf('day');
  if (day < afterDay) day = afterDay;

  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    const cursor = day.plus({ days: i });
    if (end && cursor.startOf('day') > end) return null;

    let matches: boolean;
    if (frequency === 'daily') {
      matches = true;
    } else if (frequency === 'weekly') {
      matches = weekdays.includes(cursor.weekday as Weekday);
    } else {
      const elapsed = Math.round(cursor.startOf('day').diff(start.startOf('day'), 'days').days);
      matches = elapsed >= 0 && elapsed % interval === 0;
    }
    if (!matches) continue;

    const candidate = localAt(cursor.toFormat('yyyy-MM-dd'), spec.startTime, spec.timezone);
    if (fits(candidate)) return candidate.toUTC().toJSDate();
  }
  return null;
}

/** First occurrence for a brand new schedule, measured from "now". */
export function firstOccurrence(spec: RecurrenceSpec, now: Date = new Date()): Date | null {
  // `after` is exclusive, so nudge back a second to allow a schedule created
  // for this exact minute to fire.
  return nextOccurrence(spec, new Date(now.getTime() - 1000));
}

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function listNames(days: Weekday[]): string {
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]);
  if (names.length === 1) return names[0];
  if (names.length === 7) return 'day';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function formatTime(time: string, zone: string): string {
  const dt = DateTime.fromFormat(time, 'HH:mm', { zone });
  return dt.isValid ? dt.toFormat('h:mm a') : time;
}

export function formatDate(date: string, zone: string): string {
  const dt = DateTime.fromFormat(date, 'yyyy-MM-dd', { zone });
  return dt.isValid ? dt.toFormat('d MMM yyyy') : date;
}

/** Short label for tables: "Every day at 8:00 AM". */
export function describeSchedule(spec: RecurrenceSpec): string {
  const time = formatTime(spec.startTime, spec.timezone);
  if (spec.scheduleType === 'now') return 'Sent immediately';
  if (spec.scheduleType === 'once') {
    return `Once on ${formatDate(spec.startDate, spec.timezone)} at ${time}`;
  }
  switch (spec.repeatFrequency) {
    case 'weekly': {
      const days = (spec.repeatDays ?? []) as Weekday[];
      if (days.length === 7) return `Every day at ${time}`;
      return `Every ${listNames(days)} at ${time}`;
    }
    case 'monthly': {
      const day = DateTime.fromFormat(spec.startDate, 'yyyy-MM-dd', { zone: spec.timezone }).day;
      return `Every month on day ${day} at ${time}`;
    }
    case 'custom': {
      const n = Math.max(1, spec.repeatIntervalDays ?? 1);
      return n === 1 ? `Every day at ${time}` : `Every ${n} days at ${time}`;
    }
    default:
      return `Every day at ${time}`;
  }
}

/** Full sentence for the compose preview and confirmation modal. */
export function describeScheduleLong(spec: RecurrenceSpec): string {
  const base = describeSchedule(spec);
  if (spec.scheduleType !== 'repeat') return base;
  const from = `from ${formatDate(spec.startDate, spec.timezone)}`;
  const until = spec.endDate ? ` until ${formatDate(spec.endDate, spec.timezone)}` : ' with no end date';
  return `This email will be sent ${base.replace(/^Every/, 'every')} ${from}${until}.`;
}
