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
      router.replace(employee.must_change_password ? '/change-password' : '/');
    }
  }, [loading, employee, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.post<MeResponse>('/auth/login', { email, password });
      setSession(session);
      router.replace(session.employee.must_change_password ? '/change-password' : '/');
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
        </form>
      </div>
    </div>
  );
}
