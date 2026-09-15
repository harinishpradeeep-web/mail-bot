'use client';

/** Browser-side helpers. Nothing secret is ever referenced here. */

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) || `Request failed (${res.status})`);
  return json as T;
}

export const WEEKDAYS: { value: 1 | 2 | 3 | 4 | 5 | 6 | 7; label: string; short: string }[] = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
];

/** A short list up front, plus whatever the browser reports. */
export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

export function timezoneOptions(): string[] {
  const tz = browserTimezone();
  return [...new Set([tz, ...COMMON_TIMEZONES])];
}

/** Renders a stored UTC instant in a given zone, e.g. "20 Sep 2026, 10:00 AM". */
export function formatInstant(iso: string | null, timezone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(d);
}

export function relativeToNow(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'now';
  if (Math.abs(mins) < 60) return mins > 0 ? `in ${mins} min` : `${-mins} min ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return hours > 0 ? `in ${hours} h` : `${-hours} h ago`;
  const days = Math.round(hours / 24);
  return days > 0 ? `in ${days} d` : `${-days} d ago`;
}
