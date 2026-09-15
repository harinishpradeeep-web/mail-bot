'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/SessionProvider';
import { EmptyState, ErrorState, Loading, PageHeader, StatCard, StatusBadge } from '@/components/Ui';
import { GoogleButton } from '@/components/GoogleButton';
import { api, formatInstant, relativeToNow } from '@/lib/client';
import type { ScheduledEmail } from '@/lib/types';

interface ScheduleRow extends ScheduledEmail {
  recipients: { id: number; name: string; email: string }[];
  scheduleLabel: string;
}

export default function DashboardPage() {
  const { me } = useSession();
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<{ schedules: ScheduleRow[] }>('/api/schedules')
      .then((d) => setSchedules(d.schedules))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const upcoming = (schedules ?? [])
    .filter((s) => s.next_send_at && ['active', 'scheduled'].includes(s.status))
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title={`Hello${me?.user?.name ? `, ${me.user.name.split(' ')[0]}` : ''}`}
        description="Who gets the email, what goes out, when it sends, and whether it is still running."
        action={
          <Link href="/compose" className="btn-primary">
            Compose email
          </Link>
        }
      />

      {me?.user && !me.user.gmailConnected ? (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 border-amber-200 bg-amber-50 p-5">
          <div>
            <p className="font-medium text-amber-900">Connect Gmail to start sending</p>
            <p className="mt-1 text-sm text-amber-800">
              Schedules can be drafted, but nothing will send until Gmail is connected.
            </p>
          </div>
          <GoogleButton label="Connect with Google" />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Recipients" value={me?.counts?.recipients ?? 0} />
        <StatCard label="Scheduled emails" value={me?.counts?.scheduled ?? 0} foot="Waiting, running or paused" />
        <StatCard label="Emails sent" value={me?.counts?.sent ?? 0} foot="Successful deliveries" />
        <StatCard label="Active recurring" value={me?.counts?.recurring ?? 0} foot="Repeating schedules" />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Sending next</h2>
          <Link href="/scheduled" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            All schedules
          </Link>
        </div>

        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!error && schedules === null ? <Loading /> : null}

        {!error && schedules !== null && upcoming.length === 0 ? (
          <EmptyState
            title="Nothing queued"
            body="Add a recipient, write your message, and pick a time. Recurring sends keep going on their own."
            action={
              <Link href="/compose" className="btn-primary">
                Compose email
              </Link>
            }
          />
        ) : null}

        {upcoming.length > 0 ? (
          <ul className="card divide-y divide-slate-150">
            {upcoming.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{s.subject}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {s.recipients.map((r) => r.name).join(', ') || 'No recipients'} · {s.scheduleLabel}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <p className="text-sm font-medium text-ink">{formatInstant(s.next_send_at, s.timezone)}</p>
                    <p className="text-xs text-slate-500">
                      {relativeToNow(s.next_send_at)} · {s.timezone}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
