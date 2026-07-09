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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/me');
      setEmployee(me.employee);
      setRole(me.role);
    } catch {
      setEmployee(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setSession = useCallback((session: MeResponse) => {
    setEmployee(session.employee);
    setRole(session.role);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setEmployee(null);
      setRole(null);
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
