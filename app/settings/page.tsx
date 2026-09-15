'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { PageHeader } from '@/components/Ui';
import { useSession } from '@/components/SessionProvider';
import { GoogleButton } from '@/components/GoogleButton';
import { api, browserTimezone, formatInstant, relativeToNow } from '@/lib/client';

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled, so Gmail is not connected.',
  missing_code: 'Google did not return an authorisation code. Try connecting again.',
  state_mismatch: 'That sign-in attempt could not be verified. Start the connection again from this page.',
  oauth_failed: 'Google rejected the connection. Check your client ID, client secret and redirect URI in .env.',
  google_not_configured: 'Google OAuth is not configured. Add the credentials to .env — see GMAIL_SETUP.md.',
};

export default function SettingsPage() {
  const { me, refresh } = useSession();
  const { notify } = useToast();
  const params = useSearchParams();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('error');
    if (code) setOauthError(OAUTH_ERRORS[code] ?? 'Connecting Gmail failed. Try again.');
  }, [params]);

  const disconnect = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ revoke: true }) });
      notify('Gmail disconnected', 'success');
      setConfirmDisconnect(false);
      await refresh();
      window.location.href = '/';
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    window.location.href = '/';
  };

  const connected = me?.user?.gmailConnected === true;
  // A tick within the last 5 minutes means something is driving the scheduler.
  const schedulerHealthy = me?.scheduler
    ? Date.now() - new Date(me.scheduler.lastRunAt).getTime() < 5 * 60 * 1000
    : false;

  return (
    <>
      <PageHeader title="Settings" description="Your Gmail connection and app defaults." />

      {oauthError ? (
        <div className="card mb-6 border-red-200 bg-red-50 p-5 text-sm text-red-800">{oauthError}</div>
      ) : null}

      <section className="card p-5">
        <h2 className="text-base font-semibold text-ink">Gmail connection</h2>

        {connected ? (
          <>
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <p className="font-medium text-emerald-900">✅ Gmail connected</p>
              <p className="mt-1 text-emerald-800">Connected account: {me?.user?.email}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <GoogleButton label="Reconnect Gmail" className="btn-secondary" />
              <button className="btn-danger" onClick={() => setConfirmDisconnect(true)}>
                Disconnect Gmail
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Connect Gmail so the scheduler can send on your behalf. Mail Scheduler never asks for your password —
              Google issues a token limited to sending mail.
            </p>
            <div className="mt-4">
              <GoogleButton label="Connect with Google" />
            </div>
          </>
        )}

        <p className="hint">
          Scope requested: <code className="rounded bg-slate-100 px-1">gmail.send</code>. It cannot read your inbox.
        </p>
      </section>


      <section className="card mt-6 p-5">
        <h2 className="text-base font-semibold text-ink">Scheduler</h2>
        <p className="mt-2 text-sm text-slate-600">
          Scheduled emails are sent by a server-side job, not by this page. If the job is not running, schedules are
          saved but nothing goes out.
        </p>
        {schedulerHealthy ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
            <p className="font-medium text-emerald-900">Running</p>
            <p className="mt-1 text-emerald-800">
              Last checked {relativeToNow(me?.scheduler?.lastRunAt ?? null)} ({formatInstant(me?.scheduler?.lastRunAt ?? null)})
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">
              {me?.scheduler ? 'Not running right now' : 'Has never run'}
            </p>
            <p className="mt-1">
              {me?.scheduler
                ? `Last checked ${formatInstant(me.scheduler.lastRunAt)}. Scheduled emails will not send until it resumes.`
                : 'Nothing has called the scheduler yet, so no scheduled email can be sent.'}
            </p>
            <p className="mt-2">
              In development, start it with <code className="rounded bg-white/70 px-1">npm run cron:local</code> (or
              restart <code className="rounded bg-white/70 px-1">npm run dev</code>, which runs it in-process). In
              production, point a cron at <code className="rounded bg-white/70 px-1">/api/cron/send-due</code>.
            </p>
          </div>
        )}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-base font-semibold text-ink">Defaults</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Detected time zone</dt>
            <dd className="text-ink">{browserTimezone()}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Signed in as</dt>
            <dd className="text-ink">{me?.user?.email ?? '—'}</dd>
          </div>
        </dl>
        <p className="hint">
          Time zone is chosen per schedule when composing, so a schedule keeps its local send time even if you travel.
        </p>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-base font-semibold text-ink">Session</h2>
        <p className="mt-2 text-sm text-slate-600">
          Signing out clears this browser session. Your schedules keep running, because sending happens on the server.
        </p>
        <button className="btn-secondary mt-4" onClick={signOut}>
          Sign out
        </button>
      </section>

      <Modal
        open={confirmDisconnect}
        title="Disconnect Gmail"
        onClose={() => setConfirmDisconnect(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirmDisconnect(false)}>
              Stay connected
            </button>
            <button className="btn-danger" onClick={disconnect}>
              Disconnect
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Stored Google tokens are deleted and all scheduled sends will start failing until you reconnect. Your
          recipients and schedules are kept.
        </p>
      </Modal>
    </>
  );
}
