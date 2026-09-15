'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/client';

export interface Me {
  signedIn: boolean;
  googleConfigured: boolean;
  user?: { email: string; name: string; gmailConnected: boolean };
  counts?: { recipients: number; scheduled: number; recurring: number; sent: number };
  scheduler?: { lastRunAt: string; lastDue: number; lastSent: number; lastFailed: number } | null;
}

const SessionContext = createContext<{ me: Me | null; loading: boolean; refresh: () => Promise<void> }>({
  me: null,
  loading: true,
  refresh: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/api/me'));
    } catch {
      setMe({ signedIn: false, googleConfigured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, loading, refresh }), [me, loading, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
