'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, Loading, PageHeader, SendBadge, StatusBadge } from '@/components/Ui';
import { useSession } from '@/components/SessionProvider';
import { api, formatInstant, relativeToNow } from '@/lib/client';
import type { EmailLog, ScheduledEmail } from '@/lib/types';

interface ScheduleRow extends ScheduledEmail {
  recipients: { id: number; name: string; email: string }[];
  attachments?: { id: number; filename: string; mimeType?: string; sizeBytes?: number; size_bytes?: number }[];
  scheduleLabel: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RecipientCell({ recipients }: { recipients: { id: number; name: string; email: string }[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!recipients || recipients.length <= 1) {
    return (
      <>
        <span className="block font-medium text-ink">
          {recipients?.[0]?.name ?? 'No recipients'}
        </span>
        <span className="block text-xs text-slate-500">{recipients?.[0]?.email ?? '—'}</span>
      </>
    );
  }

  if (!expanded) {
    return (
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-ink">{recipients[0]?.name}</span>
          <button
            type="button"
            className="chip border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors text-xs py-0.5 px-2 font-medium"
            onClick={() => setExpanded(true)}
          >
            +{recipients.length - 1} more
          </button>
        </div>
        <span className="block text-xs text-slate-500">{recipients[0]?.email}</span>
      </div>
    );
  }

  return (
    <div className="max-w-[16rem]">
      <div className="max-h-36 overflow-y-auto divide-y divide-slate-150 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
        {recipients.map((r, idx) => (
          <div key={r.id || idx} className="py-1.5 first:pt-0 last:pb-0">
            <span className="block text-xs font-medium text-ink">{r.name}</span>
            <span className="block text-[11px] text-slate-500">{r.email}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-800 hover:underline"
        onClick={() => setExpanded(false)}
      >
        Show less
      </button>
    </div>
  );
}

export default function ScheduledPage() {
  const { notify } = useToast();
  const { refresh } = useSession();
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ScheduleRow | null>(null);
  const [viewLogs, setViewLogs] = useState<EmailLog[] | null>(null);
  const [viewAttachments, setViewAttachments] = useState<{ id: number; filename: string; mimeType: string; sizeBytes: number }[] | null>(null);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setError(null);
    api<{ schedules: ScheduleRow[] }>('/api/schedules')
      .then((d) => setRows(d.schedules))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const act = async (row: ScheduleRow, action: 'pause' | 'resume') => {
    setBusyId(row.id);
    try {
      const res = await api<{ message?: string }>(`/api/schedules/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      notify(res.message ?? (action === 'pause' ? 'Schedule paused' : 'Schedule resumed'), 'success');
      load();
      void refresh();
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const open = async (row: ScheduleRow) => {
    setViewing(row);
    setViewLogs(null);
    setViewAttachments(null);
    try {
      const res = await api<{
        logs: EmailLog[];
        attachments?: { id: number; filename: string; mimeType: string; sizeBytes: number }[];
      }>(`/api/schedules/${row.id}`);
      setViewLogs(res.logs);
      setViewAttachments(res.attachments ?? []);
    } catch {
      setViewLogs([]);
      setViewAttachments([]);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/api/schedules/${deleting.id}`, { method: 'DELETE' });
      notify('Schedule deleted', 'success');
      setDeleting(null);
      load();
      void refresh();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Scheduled emails"
        description="Everything waiting to send, running, or finished."
        action={
          <Link href="/compose" className="btn-primary">
            Compose email
          </Link>
        }
      />

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!error && rows === null ? <Loading /> : null}

      {rows !== null && rows.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          body="Once you schedule an email it appears here with its next send time and status."
          action={
            <Link href="/compose" className="btn-primary">
              Compose email
            </Link>
          }
        />
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead className="border-b border-slate-150 bg-slate-50">
              <tr>
                <th className="th">Recipient</th>
                <th className="th">Subject</th>
                <th className="th">Schedule</th>
                <th className="th">Next send</th>
                <th className="th">Status</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="td">
                    <RecipientCell recipients={row.recipients} />
                  </td>
                  <td className="td max-w-[16rem]">
                    <span className="block truncate">{row.subject}</span>
                  </td>
                  <td className="td">
                    <span className="block">{row.scheduleLabel}</span>
                    <span className="block text-xs text-slate-500">{row.timezone}</span>
                  </td>
                  <td className="td">
                    {row.next_send_at ? (
                      <>
                        <span className="block">{formatInstant(row.next_send_at, row.timezone)}</span>
                        <span className="block text-xs text-slate-500">{relativeToNow(row.next_send_at)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="td">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button className="btn-ghost px-2.5 py-1.5" onClick={() => open(row)}>
                        View
                      </button>
                      {['active', 'scheduled'].includes(row.status) ? (
                        <button
                          className="btn-ghost px-2.5 py-1.5"
                          disabled={busyId === row.id}
                          onClick={() => act(row, 'pause')}
                        >
                          Pause
                        </button>
                      ) : null}
                      {['paused', 'failed'].includes(row.status) ? (
                        <button
                          className="btn-ghost px-2.5 py-1.5"
                          disabled={busyId === row.id}
                          onClick={() => act(row, 'resume')}
                        >
                          Resume
                        </button>
                      ) : null}
                      <button
                        className="btn-ghost px-2.5 py-1.5 text-red-600 hover:bg-red-50"
                        onClick={() => setDeleting(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal open={Boolean(viewing)} title={viewing?.subject ?? ''} onClose={() => setViewing(null)} width="max-w-2xl">
        {viewing ? (
          <div className="grid gap-4 text-sm">
            <div>
              <p className="font-medium text-slate-500">To</p>
              <p className="mt-1 text-ink">{viewing.recipients.map((r) => `${r.name} <${r.email}>`).join(', ') || '—'}</p>
            </div>
            <div>
              <p className="font-medium text-slate-500">Schedule</p>
              <p className="mt-1 text-ink">
                {viewing.scheduleLabel} · {viewing.timezone}
                {viewing.end_date ? ` · ends ${viewing.end_date}` : ''}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-500">Message</p>
              {viewing.body && viewing.body.trim() ? (
                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-slate-700">
                  {viewing.body}
                </p>
              ) : (
                <p className="mt-1 text-xs italic text-slate-400">No message content</p>
              )}
            </div>
            <div>
              <p className="font-medium text-slate-500">Attachments</p>
              {viewAttachments && viewAttachments.length > 0 ? (
                <ul className="mt-2 divide-y divide-slate-150 rounded-xl border border-slate-200">
                  {viewAttachments.map((att) => (
                    <li key={att.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span className="truncate font-medium text-ink">{att.filename}</span>
                        <span className="shrink-0 text-slate-500">({formatFileSize(att.sizeBytes)})</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={`/api/attachments/${att.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-ghost px-2 py-1 text-xs text-brand-600 hover:text-brand-800"
                        >
                          View
                        </a>
                        <a
                          href={`/api/attachments/${att.id}?download=1`}
                          download={att.filename}
                          className="btn-ghost px-2 py-1 text-xs text-brand-600 hover:text-brand-800"
                        >
                          Download
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs italic text-slate-400">No attachments</p>
              )}
            </div>
            <div>
              <p className="font-medium text-slate-500">Send log</p>
              {viewLogs === null ? (
                <p className="mt-2 text-slate-500">Loading…</p>
              ) : viewLogs.length === 0 ? (
                <p className="mt-2 text-slate-500">Nothing sent from this schedule yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-150 rounded-xl border border-slate-200">
                  {viewLogs.map((log) => (
                    <li key={log.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{log.recipient_email}</span>
                        <span className="block text-xs text-slate-500">
                          {formatInstant(log.sent_at, viewing.timezone)}
                          {log.error_message ? ` · ${log.error_message}` : ''}
                        </span>
                      </span>
                      <SendBadge status={log.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deleting)}
        title="Delete schedule"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleting(null)}>
              Keep schedule
            </button>
            <button className="btn-danger" onClick={remove}>
              Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This stops all future sends of <strong className="text-ink">{deleting?.subject}</strong> and removes its send
          history. Emails already delivered are unaffected.
        </p>
      </Modal>
    </>
  );
}
