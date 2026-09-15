'use client';

import type { ReactNode } from 'react';
import type { ScheduleStatus, SendStatus } from '@/lib/types';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function StatCard({ label, value, foot }: { label: string; value: number | string; foot?: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">{value}</p>
      {foot ? <p className="mt-1 text-xs text-slate-500">{foot}</p> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
      <p>{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="btn-secondary mt-3">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card flex items-center gap-3 px-5 py-6 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" aria-hidden />
      {label}
    </div>
  );
}

const SCHEDULE_STATUS: Record<ScheduleStatus, { label: string; dot: string; className: string }> = {
  active: { label: 'Active', dot: 'bg-emerald-500', className: 'bg-emerald-50 text-emerald-800' },
  scheduled: { label: 'Scheduled', dot: 'bg-amber-500', className: 'bg-amber-50 text-amber-800' },
  processing: { label: 'Sending', dot: 'bg-brand-500', className: 'bg-brand-50 text-brand-800' },
  paused: { label: 'Paused', dot: 'bg-slate-400', className: 'bg-slate-100 text-slate-700' },
  failed: { label: 'Failed', dot: 'bg-red-500', className: 'bg-red-50 text-red-700' },
  completed: { label: 'Completed', dot: 'bg-brand-500', className: 'bg-brand-50 text-brand-800' },
};

export function StatusBadge({ status }: { status: ScheduleStatus }) {
  const s = SCHEDULE_STATUS[status] ?? SCHEDULE_STATUS.scheduled;
  return (
    <span className={`chip ${s.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

export function SendBadge({ status }: { status: SendStatus }) {
  const map: Record<SendStatus, string> = {
    sent: 'bg-emerald-50 text-emerald-800',
    failed: 'bg-red-50 text-red-700',
    pending: 'bg-amber-50 text-amber-800',
  };
  return <span className={`chip ${map[status]}`}>{status === 'sent' ? 'Sent' : status === 'failed' ? 'Failed' : 'In progress'}</span>;
}
