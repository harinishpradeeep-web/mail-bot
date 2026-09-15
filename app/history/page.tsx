'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { EmptyState, ErrorState, Loading, PageHeader, SendBadge } from '@/components/Ui';
import { api, formatInstant } from '@/lib/client';
import type { SendStatus } from '@/lib/types';

interface LogRow {
  id: number;
  recipient_email: string;
  sent_at: string | null;
  status: SendStatus;
  error_message: string | null;
  schedule_id: number;
  subject: string;
  body: string;
  timezone: string;
  recipients?: { id: number; name: string; email: string }[];
  attachments?: { id: number; filename: string; mimeType: string; sizeBytes: number }[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RecipientCell({
  recipients,
  fallbackEmail,
}: {
  recipients?: { id: number; name: string; email: string }[];
  fallbackEmail: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = recipients && recipients.length > 0 ? recipients : [{ id: 0, name: fallbackEmail, email: fallbackEmail }];

  if (list.length <= 1) {
    const item = list[0];
    const hasDistinctName = item?.name && item.name !== item.email;
    return (
      <>
        <span className="block font-medium text-ink">{hasDistinctName ? item.name : item?.email ?? '—'}</span>
        {hasDistinctName ? <span className="block text-xs text-slate-500">{item.email}</span> : null}
      </>
    );
  }

  if (!expanded) {
    return (
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-ink">{list[0]?.name || list[0]?.email}</span>
          <button
            type="button"
            className="chip border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors text-xs py-0.5 px-2 font-medium"
            onClick={() => setExpanded(true)}
          >
            +{list.length - 1} more
          </button>
        </div>
        <span className="block text-xs text-slate-500">{list[0]?.email}</span>
      </div>
    );
  }

  return (
    <div className="max-w-[16rem]">
      <div className="max-h-36 overflow-y-auto divide-y divide-slate-150 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
        {list.map((r, idx) => (
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

export default function HistoryPage() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [open, setOpen] = useState<LogRow | null>(null);

  const load = () => {
    setError(null);
    api<{ logs: LogRow[] }>('/api/logs')
      .then((d) => setRows(d.logs))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const visible = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);

  return (
    <>
      <PageHeader title="Sent history" description="Every delivery attempt, successful or failed." />

      <div className="mb-4 flex gap-2">
        {(['all', 'sent', 'failed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip border ${filter === f ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600'}`}
          >
            {f === 'all' ? 'All' : f === 'sent' ? 'Sent' : 'Failed'}
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!error && rows === null ? <Loading /> : null}

      {rows !== null && visible.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No emails sent yet' : 'Nothing here'}
          body={
            filter === 'all'
              ? 'Once the scheduler sends an email, it is logged here with its result.'
              : 'No deliveries match this filter.'
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse">
            <thead className="border-b border-slate-150 bg-slate-50">
              <tr>
                <th className="th">Recipient</th>
                <th className="th">Subject</th>
                <th className="th">Sent</th>
                <th className="th">Status</th>
                <th className="th text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150">
              {visible.map((row) => (
                <tr key={row.id}>
                  <td className="td">
                    <RecipientCell recipients={row.recipients} fallbackEmail={row.recipient_email} />
                  </td>
                  <td className="td max-w-[18rem]">
                    <span className="block truncate">{row.subject}</span>
                  </td>
                  <td className="td">{formatInstant(row.sent_at, row.timezone)}</td>
                  <td className="td">
                    <SendBadge status={row.status} />
                  </td>
                  <td className="td text-right">
                    <button className="btn-ghost px-2.5 py-1.5" onClick={() => setOpen(row)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal open={Boolean(open)} title={open?.subject ?? ''} onClose={() => setOpen(null)} width="max-w-xl">
        {open ? (
          <div className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="font-medium text-slate-500">To</p>
                <p className="mt-1 text-ink">
                  {open.recipients && open.recipients.length > 0
                    ? open.recipients.map((r) => `${r.name} <${r.email}>`).join(', ')
                    : open.recipient_email}
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-500">Sent</p>
                <p className="mt-1 text-ink">{formatInstant(open.sent_at, open.timezone)}</p>
              </div>
            </div>
            {open.error_message ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                <p className="font-medium">Delivery failed</p>
                <p className="mt-1 break-words">{open.error_message}</p>
              </div>
            ) : null}
            <div>
              <p className="font-medium text-slate-500">Message</p>
              {open.body && open.body.trim() ? (
                <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-slate-700">
                  {open.body}
                </p>
              ) : (
                <p className="mt-1 text-xs italic text-slate-400">No message content</p>
              )}
            </div>
            <div>
              <p className="font-medium text-slate-500">Attachments</p>
              {open.attachments && open.attachments.length > 0 ? (
                <ul className="mt-2 divide-y divide-slate-150 rounded-xl border border-slate-200">
                  {open.attachments.map((att) => (
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
          </div>
        ) : null}
      </Modal>
    </>
  );
}
