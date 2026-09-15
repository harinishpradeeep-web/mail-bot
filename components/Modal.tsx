'use client';

import { useEffect, type ReactNode } from 'react';

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${width} max-h-[92vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-150 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="btn-ghost -mr-2 px-2 py-1 text-lg leading-none" aria-label="Close">
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-150 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
