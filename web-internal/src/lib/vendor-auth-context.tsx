'use client';

/**
 * LT-61 — the vendor realm's own auth context, structurally separate from
 * `auth-context.tsx` (employees). A vendor Actor is NOT an employee (see
 * packages/core/src/permission.ts `isVendorActor`), so it gets its own
 * `/vendor/me` read model, its own sessionStorage cache key, and its own
 * provider — never the internal `useAuth()`. The two providers can coexist in
 * the tree (the internal `AuthProvider` wraps the whole app in the root
 * layout) because they read different endpoints and store different keys;
 * mounting both costs one harmless extra `/me` request on `/vendor/*` pages.
 *
 * `POST /auth/logout` is reused as-is with no body — employee and vendor
 * share the same session cookie (`cdps_access_token`), so the default
 * (no `{realm: ...}` hint) clears exactly that one, same as `auth-context.tsx`.
 * The Client Portal realm has its own separate cookie and passes an explicit
 * hint instead — see apps/api/src/app/api/v1/auth/logout/route.ts's doc
 * comment for why (2026-09-01, Client Portal sharing app.meagency.co.id).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { VendorMeResponse, VendorProfile } from '@/lib/types';

interface VendorAuthState {
  vendor: VendorProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (session: VendorMeResponse) => void;
  logout: () => Promise<void>;
}

const VendorAuthContext = createContext<VendorAuthState | undefined>(undefined);

const SESSION_KEY = 'cdps.vendor.session.v1';

function readCachedVendor(): VendorProfile | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<VendorProfile>;
    if (!parsed || typeof parsed !== 'object' || !parsed.vendor_id) {
      return null;
    }
    return { vendor_id: parsed.vendor_id, nama_vendor: parsed.nama_vendor ?? '' };
  } catch {
    return null; // corrupt or storage blocked — behave as a cold load
  }
}

function writeCachedVendor(vendor: VendorProfile | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (vendor === null) {
      window.sessionStorage.removeItem(SESSION_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(vendor));
    }
  } catch {
    // Storage disabled/full — the cache is an optimisation, never a requirement.
  }
}

export function VendorAuthProvider({ children }: { children: ReactNode }) {
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<VendorMeResponse>('/vendor/me');
      setVendor(me.vendor);
      writeCachedVendor(me.vendor);
    } catch {
      setVendor(null);
      writeCachedVendor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedVendor();
    if (cached !== null) {
      setVendor(cached);
      setLoading(false);
    }
    refresh();
  }, [refresh]);

  const setSession = useCallback((session: VendorMeResponse) => {
    setVendor(session.vendor);
    writeCachedVendor(session.vendor);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setVendor(null);
      writeCachedVendor(null);
    }
  }, []);

  return (
    <VendorAuthContext.Provider value={{ vendor, loading, refresh, setSession, logout }}>
      {children}
    </VendorAuthContext.Provider>
  );
}

export function useVendorAuth(): VendorAuthState {
  const ctx = useContext(VendorAuthContext);
  if (!ctx) throw new Error('useVendorAuth must be used within a VendorAuthProvider');
  return ctx;
}
