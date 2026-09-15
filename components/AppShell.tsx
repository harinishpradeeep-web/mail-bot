'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useSession } from './SessionProvider';
import { GoogleButton } from './GoogleButton';
import { Loading } from './Ui';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/recipients', label: 'Recipients' },
  { href: '/compose', label: 'Compose email' },
  { href: '/scheduled', label: 'Scheduled emails' },
  { href: '/history', label: 'Sent history' },
  { href: '/settings', label: 'Settings' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`rounded-xl px-3 py-2.5 text-sm transition-colors ${
              active ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectionPill() {
  const { me } = useSession();
  if (!me?.user) return null;
  const connected = me.user.gmailConnected;
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-xs ${connected ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <p className={connected ? 'font-medium text-emerald-900' : 'font-medium text-amber-900'}>
        {connected ? '✅ Gmail connected' : 'Gmail not connected'}
      </p>
      <p className="mt-0.5 truncate text-slate-600" title={me.user.email}>
        {me.user.email}
      </p>
    </div>
  );
}

function SignInScreen() {
  const { me } = useSession();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="text-sm font-medium text-brand-600">Mail Scheduler</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Schedule emails from your own Gmail account
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Sign in with Google to connect Gmail. Emails are sent by a server-side scheduler, so they go out on time
          whether or not this page is open.
        </p>
      </div>

      {me?.googleConfigured ? (
        <div className="card p-5">
          <GoogleButton label="Continue with Google" />
          <p className="hint">
            Mail Scheduler never asks for your Gmail password. Google returns a token that can only send mail, and it
            is stored encrypted on the server.
          </p>
        </div>
      ) : (
        <div className="card border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-medium">Google OAuth is not configured yet.</p>
          <p className="mt-2">
            Add <code className="rounded bg-white/70 px-1">GOOGLE_CLIENT_ID</code>,{' '}
            <code className="rounded bg-white/70 px-1">GOOGLE_CLIENT_SECRET</code> and{' '}
            <code className="rounded bg-white/70 px-1">GOOGLE_REDIRECT_URI</code> to <code>.env</code>, then restart the
            dev server. Step-by-step instructions are in <code>GMAIL_SETUP.md</code>.
          </p>
        </div>
      )}
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <Loading label="Starting Mail Scheduler…" />
      </div>
    );
  }

  if (!me?.signedIn) return <SignInScreen />;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <div>
          <Link href="/" className="mb-6 block px-3">
            <span className="text-base font-semibold tracking-tight text-ink">Mail Scheduler</span>
          </Link>
          <NavLinks />
        </div>
        <ConnectionPill />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <span className="font-semibold text-ink">Mail Scheduler</span>
          <button className="btn-secondary px-3 py-2" onClick={() => setMobileOpen((v) => !v)} aria-expanded={mobileOpen}>
            {mobileOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        {mobileOpen ? (
          <div className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <NavLinks onNavigate={() => setMobileOpen(false)} />
            <div className="mt-3">
              <ConnectionPill />
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
