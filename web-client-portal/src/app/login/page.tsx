'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { usePortalAuth } from '@/lib/portal-auth-context';
import type { ClientContactMeResponse } from '@/lib/types';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { contact, loading, setSession } = usePortalAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && contact) {
      router.replace('/');
    }
  }, [loading, contact, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // POST /auth/login serves every CDPS auth realm — a client-contact
      // account resolves to { contact } (see the route's docstring).
      const session = await api.post<ClientContactMeResponse>('/auth/login', { email, password });
      setSession(session);
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (contact) {
    return <div className="pageLoading">Memuat...</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1>Client Portal</h1>
          <p>MEA Agency &mdash; CDPS</p>
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
        </form>
        <div className={styles.links}>
          <a href="/lupa-password">Lupa password?</a>
        </div>
      </div>
    </div>
  );
}
