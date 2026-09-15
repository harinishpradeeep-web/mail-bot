'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/Ui';
import { useSession } from '@/components/SessionProvider';
import { GoogleButton } from '@/components/GoogleButton';
import { AttachmentPicker, type UploadedAttachment } from '@/components/AttachmentPicker';
import { api, browserTimezone, formatInstant, timezoneOptions, WEEKDAYS } from '@/lib/client';
import { describeScheduleLong, firstOccurrence, formatDate, formatTime } from '@/lib/recurrence';
import { formatBytes } from '@/lib/attachment-limits';
import type { Recipient, RepeatFrequency, ScheduleType, Weekday } from '@/lib/types';

const SCHEDULE_CHOICES: { value: ScheduleType; label: string; hint: string }[] = [
  { value: 'now', label: 'Send now', hint: 'Goes out as soon as you confirm' },
  { value: 'once', label: 'Schedule once', hint: 'One email at a chosen date and time' },
  { value: 'repeat', label: 'Repeat', hint: 'Keeps sending on a pattern' },
];

const FREQUENCIES: { value: RepeatFrequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom', label: 'Custom' },
];

function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

export default function ComposePage() {
  const router = useRouter();
  const { notify } = useToast();
  const { me, refresh } = useSession();

  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once');
  const [timezone, setTimezone] = useState(browserTimezone());
  const [startDate, setStartDate] = useState(todayIn(browserTimezone()));
  const [startTime, setStartTime] = useState('08:00');
  const [frequency, setFrequency] = useState<RepeatFrequency>('daily');
  const [weekdays, setWeekdays] = useState<Weekday[]>([1]);
  const [intervalDays, setIntervalDays] = useState(2);
  const [noEndDate, setNoEndDate] = useState(true);
  const [endDate, setEndDate] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoadError(null);
    api<{ recipients: Recipient[] }>('/api/recipients')
      .then((d) => setRecipients(d.recipients))
      .catch((e: Error) => setLoadError(e.message));
  };

  useEffect(load, []);

  const chosen = useMemo(
    () => (recipients ?? []).filter((r) => selected.includes(r.id)),
    [recipients, selected]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients ?? [];
    return (recipients ?? []).filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q)
    );
  }, [recipients, search]);

  const spec = useMemo(
    () => ({
      scheduleType,
      timezone,
      startDate,
      startTime,
      repeatFrequency: scheduleType === 'repeat' ? frequency : null,
      repeatDays: scheduleType === 'repeat' && frequency === 'weekly' ? weekdays : null,
      repeatIntervalDays: scheduleType === 'repeat' && frequency === 'custom' ? intervalDays : null,
      endDate: scheduleType === 'repeat' && !noEndDate && endDate ? endDate : null,
    }),
    [scheduleType, timezone, startDate, startTime, frequency, weekdays, intervalDays, noEndDate, endDate]
  );

  const preview = useMemo(() => {
    if (scheduleType === 'now') return 'This email will be sent as soon as you confirm.';
    const next = firstOccurrence(spec);
    if (!next) return 'This pattern has no send dates. Check the start date, days and end date.';
    if (scheduleType === 'once') {
      return `This email will be sent once on ${formatDate(startDate, timezone)} at ${formatTime(startTime, timezone)} (${timezone}).`;
    }
    return `${describeScheduleLong(spec)} First send: ${formatInstant(next.toISOString(), timezone)}.`;
  }, [spec, scheduleType, startDate, startTime, timezone]);

  const toggleRecipient = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleWeekday = (day: Weekday) =>
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));

  const validateLocally = (): string | null => {
    if (selected.length === 0) return 'Choose at least one recipient.';
    if (!subject.trim()) return 'Enter a subject.';
    if (!body.trim()) return 'Write a message.';
    if (scheduleType !== 'now') {
      if (!startDate) return 'Choose a start date.';
      if (!startTime) return 'Choose a start time.';
    }
    if (scheduleType === 'repeat') {
      if (frequency === 'weekly' && weekdays.length === 0) return 'Pick at least one day of the week.';
      if (frequency === 'custom' && (intervalDays < 1 || intervalDays > 365)) {
        return 'Enter a repeat interval between 1 and 365 days.';
      }
      if (!noEndDate && !endDate) return 'Choose an end date, or switch on “No end date”.';
      if (!noEndDate && endDate < startDate) return 'The end date cannot be before the start date.';
    }
    if (scheduleType === 'once' && !firstOccurrence(spec)) {
      return 'That date and time is in the past. Pick a future moment.';
    }
    return null;
  };

  const review = () => {
    const problem = validateLocally();
    setFormError(problem);
    if (!problem) setConfirmOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        recipientIds: selected,
        subject: subject.trim(),
        body,
        scheduleType,
        timezone,
        startDate,
        startTime,
        repeatFrequency: spec.repeatFrequency,
        repeatDays: spec.repeatDays,
        repeatIntervalDays: spec.repeatIntervalDays,
        endDate: spec.endDate,
        attachmentIds: attachments.map((f) => f.id),
      };
      const res = await api<{ id: number; sent?: number; failed?: number }>('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setConfirmOpen(false);
      void refresh();
      if (scheduleType === 'now') {
        notify(`Sent to ${res.sent ?? 0} recipient${res.sent === 1 ? '' : 's'}`, 'success');
        router.push('/history');
      } else {
        notify('Schedule created', 'success');
        router.push('/scheduled');
      }
    } catch (e) {
      setFormError((e as Error).message);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (recipients === null) return <Loading label="Loading recipients…" />;

  if (recipients.length === 0) {
    return (
      <>
        <PageHeader title="Compose email" />
        <EmptyState
          title="Add a recipient first"
          body="You need at least one saved recipient before you can compose and schedule an email."
          action={
            <Link href="/recipients" className="btn-primary">
              Go to recipients
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Compose email" description="Pick who it goes to, write it, then choose when it sends." />

      {me?.user && !me.user.gmailConnected ? (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 border-amber-200 bg-amber-50 p-5">
          <p className="text-sm text-amber-900">Gmail is not connected, so this email cannot be sent yet.</p>
          <GoogleButton label="Connect with Google" />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <section className="card p-5">
            <h2 className="mb-4 text-base font-semibold text-ink">To</h2>
            <input
              className="field"
              placeholder="Search recipients by name, email or department"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {chosen.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {chosen.map((r) => (
                  <button key={r.id} className="chip bg-brand-50 text-brand-800" onClick={() => toggleRecipient(r.id)}>
                    {r.name}
                    <span aria-hidden>×</span>
                    <span className="sr-only">Remove {r.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="mt-3 max-h-64 divide-y divide-slate-150 overflow-y-auto rounded-xl border border-slate-200">
              {filtered.length === 0 ? (
                <li className="px-4 py-4 text-sm text-slate-500">No recipients match that search.</li>
              ) : null}
              {filtered.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-500"
                      checked={selected.includes(r.id)}
                      onChange={() => toggleRecipient(r.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {r.email}
                        {r.department ? ` · ${r.department}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <div>
              <label className="label" htmlFor="subject">
                Subject
              </label>
              <input
                id="subject"
                className="field"
                value={subject}
                placeholder="Daily project update"
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="mt-4">
              <label className="label" htmlFor="body">
                Message
              </label>
              <textarea
                id="body"
                className="field min-h-[220px] leading-relaxed"
                value={body}
                placeholder={'Good morning sir,\n\nHere is my project update…'}
                onChange={(e) => setBody(e.target.value)}
              />
              <p className="hint">Sent as plain text, so line breaks are preserved exactly as typed.</p>
            </div>
            <AttachmentPicker attachments={attachments} onChange={setAttachments} />
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-base font-semibold text-ink">When to send</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {SCHEDULE_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className={`cursor-pointer rounded-xl border px-4 py-3 text-sm transition-colors ${
                    scheduleType === choice.value ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <input
                      type="radio"
                      name="scheduleType"
                      className="h-4 w-4 text-brand-500"
                      checked={scheduleType === choice.value}
                      onChange={() => setScheduleType(choice.value)}
                    />
                    {choice.label}
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-slate-500">{choice.hint}</span>
                </label>
              ))}
            </div>

            {scheduleType !== 'now' ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="date">
                    {scheduleType === 'repeat' ? 'Start date' : 'Date'}
                  </label>
                  <input
                    id="date"
                    type="date"
                    className="field"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="time">
                    {scheduleType === 'repeat' ? 'Start time' : 'Time'}
                  </label>
                  <input
                    id="time"
                    type="time"
                    className="field"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="tz">
                    Time zone
                  </label>
                  <select id="tz" className="field" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {timezoneOptions().map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {scheduleType === 'repeat' ? (
              <div className="mt-5 border-t border-slate-150 pt-5">
                <label className="label" htmlFor="freq">
                  Repeat frequency
                </label>
                <select
                  id="freq"
                  className="field sm:max-w-xs"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as RepeatFrequency)}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                {frequency === 'weekly' ? (
                  <fieldset className="mt-4">
                    <legend className="label">Days</legend>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((d) => (
                        <label
                          key={d.value}
                          className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${
                            weekdays.includes(d.value) ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mr-2 h-4 w-4 text-brand-500"
                            checked={weekdays.includes(d.value)}
                            onChange={() => toggleWeekday(d.value)}
                          />
                          {d.short}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {frequency === 'custom' ? (
                  <div className="mt-4 sm:max-w-xs">
                    <label className="label" htmlFor="interval">
                      Send every N days
                    </label>
                    <input
                      id="interval"
                      type="number"
                      min={1}
                      max={365}
                      className="field"
                      value={intervalDays}
                      onChange={(e) => setIntervalDays(Number(e.target.value))}
                    />
                  </div>
                ) : null}

                {frequency === 'monthly' ? (
                  <p className="hint mt-3">
                    Repeats on day {Number(startDate.slice(8, 10)) || 1} of each month. Short months fall back to their
                    last day.
                  </p>
                ) : null}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 text-brand-500"
                      checked={noEndDate}
                      onChange={(e) => setNoEndDate(e.target.checked)}
                    />
                    No end date
                  </label>
                  <div>
                    <label className="label" htmlFor="end">
                      End date
                    </label>
                    <input
                      id="end"
                      type="date"
                      className="field"
                      value={endDate}
                      disabled={noEndDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="card p-5">
            <h2 className="text-base font-semibold text-ink">Preview</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-slate-500">To</dt>
                <dd className="text-ink">
                  {chosen.length === 0 ? '—' : chosen.map((r) => `${r.name} <${r.email}>`).join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Subject</dt>
                <dd className="text-ink">{subject || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Schedule</dt>
                <dd className="text-ink">{preview}</dd>
              </div>
              {attachments.length > 0 ? (
                <div>
                  <dt className="text-slate-500">Attachments</dt>
                  <dd className="text-ink">{attachments.map((f) => f.filename).join(', ')}</dd>
                </div>
              ) : null}
            </dl>

            {formError ? <p className="mt-4 text-sm text-red-600">{formError}</p> : null}

            <button className="btn-primary mt-5 w-full" onClick={review} disabled={me?.user?.gmailConnected !== true}>
              {scheduleType === 'now' ? 'Review and send' : 'Review schedule'}
            </button>
            {me?.user?.gmailConnected !== true ? (
              <p className="hint">Connect Gmail in Settings to enable sending.</p>
            ) : (
              <p className="hint">You will see a confirmation before anything is sent.</p>
            )}
          </div>
        </aside>
      </div>

      <Modal
        open={confirmOpen}
        title={scheduleType === 'now' ? 'Send this email?' : 'Confirm this schedule'}
        onClose={() => setConfirmOpen(false)}
        width="max-w-xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Go back
            </button>
            <button className="btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Working…' : scheduleType === 'now' ? 'Send now' : 'Confirm schedule'}
            </button>
          </>
        }
      >
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">To</dt>
            <dd className="mt-1 text-ink">{chosen.map((r) => r.email).join(', ')}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Subject</dt>
            <dd className="mt-1 text-ink">{subject}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Message</dt>
            <dd className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-slate-700">
              {body}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Schedule</dt>
            <dd className="mt-1 text-ink">{preview}</dd>
          </div>
          {attachments.length > 0 ? (
            <div>
              <dt className="font-medium text-slate-500">Attachments</dt>
              <dd className="mt-1 text-ink">
                {attachments.map((f) => `${f.filename} (${formatBytes(f.size_bytes)})`).join(', ')}
              </dd>
            </div>
          ) : null}
          {scheduleType === 'repeat' ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="font-medium text-slate-500">Start</dt>
                <dd className="mt-1 text-ink">{formatDate(startDate, timezone)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">End</dt>
                <dd className="mt-1 text-ink">{noEndDate || !endDate ? 'No end date' : formatDate(endDate, timezone)}</dd>
              </div>
            </div>
          ) : null}
        </dl>
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {scheduleType === 'now'
            ? 'This sends immediately from your connected Gmail account.'
            : 'Recurring emails keep sending until the end date, or until you pause them.'}
        </p>
      </Modal>
    </>
  );
}
