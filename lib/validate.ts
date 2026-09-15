import { DateTime } from 'luxon';
import type { RepeatFrequency, ScheduleType, Weekday } from './types';

/** Pragmatic email check: one @, a dotted domain, no spaces. */
export function isEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 6 || v.length > 254) return false;
  return /^[^\s@,;]+@[^\s@.,;]+(\.[^\s@.,;]+)+$/.test(v);
}

export function isTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  return DateTime.local().setZone(value).isValid;
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && DateTime.fromFormat(value, 'yyyy-MM-dd').isValid;
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && DateTime.fromFormat(value, 'HH:mm').isValid;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > max) return null;
  return v;
}

export interface RecipientInput {
  name: string;
  email: string;
  department: string | null;
  notes: string | null;
}

export function validateRecipient(input: unknown): { ok: true; value: RecipientInput } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = str(body.name, 120);
  if (!name) return { ok: false, error: 'Enter the recipient’s name.' };
  if (!isEmail(body.email)) return { ok: false, error: 'Enter a valid email address.' };
  const department = typeof body.department === 'string' ? body.department.trim().slice(0, 120) || null : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null;
  return { ok: true, value: { name, email: (body.email as string).trim().toLowerCase(), department, notes } };
}

export interface ScheduleInput {
  recipientIds: number[];
  subject: string;
  body: string;
  scheduleType: ScheduleType;
  timezone: string;
  startDate: string;
  startTime: string;
  repeatFrequency: RepeatFrequency | null;
  repeatDays: Weekday[] | null;
  repeatIntervalDays: number | null;
  endDate: string | null;
}

const FREQUENCIES: RepeatFrequency[] = ['daily', 'weekly', 'monthly', 'custom'];

export function validateSchedule(
  input: unknown,
  now: Date = new Date()
): { ok: true; value: ScheduleInput } | { ok: false; error: string } {
  const b = (input ?? {}) as Record<string, unknown>;

  const ids = Array.isArray(b.recipientIds) ? b.recipientIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) return { ok: false, error: 'Choose at least one recipient.' };

  const subject = str(b.subject, 300);
  if (!subject) return { ok: false, error: 'Enter a subject.' };
  const body = str(b.body, 100_000);
  if (!body) return { ok: false, error: 'Write a message.' };

  const scheduleType = b.scheduleType as ScheduleType;
  if (!['now', 'once', 'repeat'].includes(scheduleType)) {
    return { ok: false, error: 'Choose when to send.' };
  }

  const timezone = isTimezone(b.timezone) ? (b.timezone as string) : null;
  if (!timezone) return { ok: false, error: 'Choose a valid time zone.' };

  // "Send now" needs no date input — stamp it from the current instant.
  if (scheduleType === 'now') {
    const local = DateTime.fromJSDate(now, { zone: timezone });
    return {
      ok: true,
      value: {
        recipientIds: ids,
        subject,
        body,
        scheduleType,
        timezone,
        startDate: local.toFormat('yyyy-MM-dd'),
        startTime: local.toFormat('HH:mm'),
        repeatFrequency: null,
        repeatDays: null,
        repeatIntervalDays: null,
        endDate: null,
      },
    };
  }

  if (!isDate(b.startDate)) return { ok: false, error: 'Choose a start date.' };
  if (!isTime(b.startTime)) return { ok: false, error: 'Choose a start time.' };
  const startDate = b.startDate as string;
  const startTime = b.startTime as string;

  let repeatFrequency: RepeatFrequency | null = null;
  let repeatDays: Weekday[] | null = null;
  let repeatIntervalDays: number | null = null;
  let endDate: string | null = null;

  if (scheduleType === 'once') {
    const at = DateTime.fromFormat(`${startDate} ${startTime}`, 'yyyy-MM-dd HH:mm', { zone: timezone });
    if (at.toMillis() <= now.getTime()) {
      return { ok: false, error: 'That date and time is in the past. Pick a future moment.' };
    }
  } else {
    repeatFrequency = FREQUENCIES.includes(b.repeatFrequency as RepeatFrequency)
      ? (b.repeatFrequency as RepeatFrequency)
      : null;
    if (!repeatFrequency) return { ok: false, error: 'Choose how often this repeats.' };

    if (repeatFrequency === 'weekly') {
      const days = Array.isArray(b.repeatDays)
        ? [...new Set(b.repeatDays.map(Number))].filter((d): d is Weekday => d >= 1 && d <= 7)
        : [];
      if (days.length === 0) return { ok: false, error: 'Pick at least one day of the week.' };
      repeatDays = days.sort((a, c) => a - c);
    }

    if (repeatFrequency === 'custom') {
      const n = Number(b.repeatIntervalDays);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return { ok: false, error: 'Enter a repeat interval between 1 and 365 days.' };
      }
      repeatIntervalDays = n;
    }

    if (b.endDate !== null && b.endDate !== undefined && b.endDate !== '') {
      if (!isDate(b.endDate)) return { ok: false, error: 'Enter a valid end date, or choose no end date.' };
      if ((b.endDate as string) < startDate) {
        return { ok: false, error: 'The end date cannot be before the start date.' };
      }
      endDate = b.endDate as string;
    }
  }

  return {
    ok: true,
    value: {
      recipientIds: ids,
      subject,
      body,
      scheduleType,
      timezone,
      startDate,
      startTime,
      repeatFrequency,
      repeatDays,
      repeatIntervalDays,
      endDate,
    },
  };
}
