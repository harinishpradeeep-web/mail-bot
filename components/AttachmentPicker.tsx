'use client';

import { useRef, useState } from 'react';
import { formatBytes } from '@/lib/attachment-limits';

export interface UploadedAttachment {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Files upload as soon as they are chosen, so a scheduled email's attachments
 * live on the server rather than in this component's state.
 */
export function AttachmentPicker({
  attachments,
  onChange,
  disabled,
}: {
  attachments: UploadedAttachment[];
  onChange: (next: UploadedAttachment[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = attachments.reduce((sum, f) => sum + f.size_bytes, 0);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('files', file);

      const res = await fetch('/api/attachments', { method: 'POST', body: form });
      const json = (await res.json().catch(() => ({}))) as { attachments?: UploadedAttachment[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'That file could not be attached.');

      onChange([...attachments, ...(json.attachments ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be attached.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = ''; // allow re-picking the same file
    }
  };

  const remove = async (id: number) => {
    setError(null);
    const previous = attachments;
    onChange(attachments.filter((f) => f.id !== id));
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('That attachment could not be removed.');
    } catch (err) {
      onChange(previous); // put it back rather than lie about the state
      setError(err instanceof Error ? err.message : 'That attachment could not be removed.');
    }
  };

  return (
    <div className="mt-5 border-t border-slate-150 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Attachments</p>
          <p className="hint mt-0">
            {attachments.length === 0
              ? 'Optional. Up to 10 files, 10 MB each.'
              : `${attachments.length} file${attachments.length === 1 ? '' : 's'} · ${formatBytes(total)}`}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Adding…' : 'Add files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {attachments.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-150 rounded-xl border border-slate-200">
          {attachments.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{file.filename}</span>
                <span className="block text-xs text-slate-500">{formatBytes(file.size_bytes)}</span>
              </span>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                onClick={() => void remove(file.id)}
                aria-label={`Remove ${file.filename}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
