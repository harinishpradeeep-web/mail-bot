'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/Ui';
import { useSession } from '@/components/SessionProvider';
import { api } from '@/lib/client';
import { isEmail } from '@/lib/validate';
import type { Recipient } from '@/lib/types';

type Draft = { name: string; email: string; department: string; notes: string };
const EMPTY: Draft = { name: '', email: '', department: '', notes: '' };

export default function RecipientsPage() {
  const { notify } = useToast();
  const { refresh } = useSession();
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Recipient | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<{ recipients: Recipient[] }>('/api/recipients')
      .then((d) => setRows(d.recipients))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setFieldError(null);
    setFormOpen(true);
  };

  const openEdit = (r: Recipient) => {
    setEditing(r);
    setDraft({ name: r.name, email: r.email, department: r.department ?? '', notes: r.notes ?? '' });
    setFieldError(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) return setFieldError('Enter the recipient’s name.');
    if (!isEmail(draft.email)) return setFieldError('Enter a valid email address, like professor@gmail.com.');

    setSaving(true);
    try {
      const path = editing ? `/api/recipients/${editing.id}` : '/api/recipients';
      await api(path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      notify(editing ? 'Recipient updated' : 'Recipient added', 'success');
      setFormOpen(false);
      load();
      void refresh();
    } catch (e) {
      setFieldError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/api/recipients/${deleting.id}`, { method: 'DELETE' });
      notify(`${deleting.name} removed`, 'success');
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
        title="Recipients"
        description="Save the people you email often. You pick from this list when composing."
        action={
          <button className="btn-primary" onClick={openAdd}>
            Add recipient
          </button>
        }
      />

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!error && rows === null ? <Loading /> : null}

      {rows !== null && rows.length === 0 ? (
        <EmptyState
          title="No recipients yet"
          body="Add a professor or colleague with their Gmail address to start scheduling."
          action={
            <button className="btn-primary" onClick={openAdd}>
              Add recipient
            </button>
          }
        />
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse">
            <thead className="border-b border-slate-150 bg-slate-50">
              <tr>
                <th className="th">Name</th>
                <th className="th">Gmail address</th>
                <th className="th hidden sm:table-cell">Department</th>
                <th className="th hidden md:table-cell">Notes</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium text-ink">{r.name}</td>
                  <td className="td">{r.email}</td>
                  <td className="td hidden sm:table-cell">{r.department || '—'}</td>
                  <td className="td hidden max-w-xs md:table-cell">
                    <span className="line-clamp-2 text-slate-500">{r.notes || '—'}</span>
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2.5 py-1.5" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button className="btn-ghost px-2.5 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setDeleting(r)}>
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

      <Modal
        open={formOpen}
        title={editing ? 'Edit recipient' : 'Add recipient'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add recipient'}
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <div>
            <label className="label" htmlFor="r-name">
              Professor name
            </label>
            <input
              id="r-name"
              className="field"
              value={draft.name}
              placeholder="Dr. Sharma"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="r-email">
              Gmail address
            </label>
            <input
              id="r-email"
              className="field"
              type="email"
              value={draft.email}
              placeholder="professor@gmail.com"
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="r-dept">
              Department <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="r-dept"
              className="field"
              value={draft.department}
              placeholder="Mechanical Engineering"
              onChange={(e) => setDraft({ ...draft, department: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="r-notes">
              Notes <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="r-notes"
              className="field min-h-[80px]"
              value={draft.notes}
              placeholder="Guide for the final year project"
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
          {fieldError ? <p className="text-sm text-red-600">{fieldError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        title="Delete recipient"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleting(null)}>
              Keep recipient
            </button>
            <button className="btn-danger" onClick={remove}>
              Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Deleting <strong className="text-ink">{deleting?.name}</strong> also removes them from any schedule that
          targets them. Schedules left without recipients will stop sending.
        </p>
      </Modal>
    </>
  );
}
