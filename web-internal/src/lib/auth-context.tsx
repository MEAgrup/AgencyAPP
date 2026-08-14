'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Employee, MeResponse, Role } from '@/lib/types';

interface AuthState {
  employee: Employee | null;
  role: Role | null;
  /** True while the initial GET /me check is in flight. */
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (session: MeResponse) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * P-1 — sessionStorage cache of the last known /me answer.
 *
 * KENAPA. `ShellLayout` menahan render `{children}` selama `loading`, jadi
 * SETIAP hard load menunggu GET /me selesai SEBELUM halaman ter-mount dan boleh
 * menembak fetch datanya sendiri. Itu waterfall dua-permintaan berurutan di
 * setiap muat halaman — dan tiap permintaan menempuh browser → web-internal →
 * apps/api → pooler.
 *
 * Dengan hidrasi dari cache, muat kedua dan seterusnya langsung punya sesi,
 * `loading` false sejak awal, dan fetch halaman berangkat BERSAMAAN dengan /me
 * yang tetap divalidasi ulang di latar (stale-while-revalidate).
 *
 * INI BUKAN OTORISASI. Semua gerbang tetap di server (cookie + RLS + gate TS);
 * nilai cache hanya menentukan apa yang DIGAMBAR sementara. Kalau /me latar
 * menolak, sesi dibersihkan dan shell melempar ke /login seperti biasa; peran
 * yang basi paling jauh memunculkan menu yang API-nya tetap menjawab 403.
 * Dipakai sessionStorage (bukan localStorage) supaya mati saat tab ditutup.
 */
const SESSION_KEY = 'cdps.session.v1';

function readCachedSession(): MeResponse | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<MeResponse>;
    if (!parsed || typeof parsed !== 'object' || !parsed.employee || !parsed.role) {
      return null;
    }
    return { employee: parsed.employee, role: parsed.role };
  } catch {
    return null; // corrupt or storage blocked — behave as a cold load
  }
}

function writeCachedSession(session: MeResponse | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (session === null) {
      window.sessionStorage.removeItem(SESSION_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Storage disabled/full — the cache is an optimisation, never a requirement.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // The initial state deliberately matches what the server renders (no session,
  // still loading) — reading sessionStorage in the initialiser would make the
  // client's first render disagree with the server HTML and break hydration.
  // Hydration from cache happens in the effect below instead, which lands one
  // commit later: a microtask, not a network round trip.
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/me');
      setEmployee(me.employee);
      setRole(me.role);
      writeCachedSession(me);
    } catch {
      setEmployee(null);
      setRole(null);
      writeCachedSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Paint from the cached session immediately so the shell stops blocking and
    // the page underneath mounts (and starts ITS fetch) right away…
    const cached = readCachedSession();
    if (cached !== null) {
      setEmployee(cached.employee);
      setRole(cached.role);
      setLoading(false);
    }
    // …then always revalidate. The cache decides what is painted first, never
    // whether the session is still valid.
    refresh();
  }, [refresh]);

  const setSession = useCallback((session: MeResponse) => {
    setEmployee(session.employee);
    setRole(session.role);
    writeCachedSession(session);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setEmployee(null);
      setRole(null);
      writeCachedSession(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ employee, role, loading, refresh, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
