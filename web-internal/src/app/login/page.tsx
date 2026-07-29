'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { MeResponse } from '@/lib/types';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { employee, loading, setSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && employee) {
      router.replace('/');
    }
  }, [loading, employee, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.post<MeResponse>('/auth/login', { email, password });
      setSession(session);
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Only hold back the form once we positively know the user is already
  // authenticated (about to be redirected). Do NOT gate on `loading` — an
  // anonymous visitor should see the login form immediately rather than
  // wait on the GET /me check.
  if (employee) {
    return <div className="pageLoading">Memuat...</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1>CDPS — MEA Agency</h1>
          <p>Client Delivery &amp; Performance System</p>
        </div>
        <form className="card form" onSubmit={handleSubmit}>
          <h2>Masuk</h2>
          {error && <div className="alert alertError" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Kata Sandi</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btnPrimary" disabled={submitting}>
            {submitting ? 'Memproses...' : 'Masuk'}
          </button>
          {/*
            Recovery is admin-driven for now (O44(c) B1): reset-by-email needs an
            SMTP provider on the Supabase project, which is an open infra
            decision. Rather than link to a page that cannot work, state the
            procedure that does — a Director/OD sets a temporary password and the
            next login forces a change.
          */}
          <details className="muted" style={{ marginTop: 12 }}>
            <summary>Lupa password?</summary>
            <p style={{ marginTop: 8 }}>
              Hubungi Director atau Org Development untuk meminta <strong>password
              sementara</strong>. Setelah dibuatkan, login dengan password sementara
              itu lalu Anda akan diminta menggantinya di menu <strong>Ganti
              Password</strong>.
            </p>
          </details>
        </form>
      </div>
    </div>
  );
}
