'use client';

/**
 * Client Portal's own auth context — mirrors
 * web-internal/src/lib/vendor-auth-context.tsx's shape exactly (same
 * sessionStorage-cache-then-revalidate pattern), adapted to a standalone app
 * rather than a route group sharing a tree with an internal `AuthProvider`.
 *
 * `POST /auth/logout` is shared with every realm, but this one passes
 * `{realm: 'client-portal'}` so it clears THIS realm's own cookie
 * (`cdps_client_access_token`) rather than the general one employee/vendor
 * share — see `logout()` below and the route's doc comment for why
 * (2026-09-01, Client Portal sharing app.meagency.co.id with web-internal).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { clearActivity } from '@/lib/idle-timeout';
import type { ClientContactMeResponse, ClientContactProfile } from '@/lib/types';

interface PortalAuthState {
  contact: ClientContactProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (session: ClientContactMeResponse) => void;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthState | undefined>(undefined);

const SESSION_KEY = 'cdps.portal.session.v1';

function readCachedContact(): ClientContactProfile | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ClientContactProfile>;
    if (!parsed || typeof parsed !== 'object' || !parsed.client_id) {
      return null;
    }
    return {
      nama: parsed.nama ?? '',
      email: parsed.email ?? '',
      client_id: parsed.client_id,
      nama_klien: parsed.nama_klien ?? '',
      must_change_password: parsed.must_change_password ?? false,
    };
  } catch {
    return null; // corrupt or storage blocked — behave as a cold load
  }
}

function writeCachedContact(contact: ClientContactProfile | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (contact === null) {
      window.sessionStorage.removeItem(SESSION_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(contact));
    }
  } catch {
    // Storage disabled/full — the cache is an optimisation, never a requirement.
  }
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [contact, setContact] = useState<ClientContactProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<ClientContactMeResponse>('/client-portal/me');
      setContact(me.contact);
      writeCachedContact(me.contact);
    } catch {
      setContact(null);
      writeCachedContact(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedContact();
    if (cached !== null) {
      setContact(cached);
      setLoading(false);
    }
    refresh();
  }, [refresh]);

  const setSession = useCallback((session: ClientContactMeResponse) => {
    setContact(session.contact);
    writeCachedContact(session.contact);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      // { realm: 'client-portal' } tells the shared /auth/logout which
      // cookie to clear — Client Portal now shares app.meagency.co.id with
      // web-internal, so a browser can hold both an internal AND a
      // client-contact session cookie; logging out here must not also end
      // the other one. See apps/api/.../auth/logout/route.ts's doc comment.
      await api.post('/auth/logout', { realm: 'client-portal' });
    } finally {
      setContact(null);
      writeCachedContact(null);
      clearActivity();
    }
  }, []);

  return (
    <PortalAuthContext.Provider value={{ contact, loading, refresh, setSession, logout }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth(): PortalAuthState {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within a PortalAuthProvider');
  return ctx;
}
