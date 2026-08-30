'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useVendorAuth } from '@/lib/vendor-auth-context';
import type { VendorMeResponse } from '@/lib/types';
import styles from './page.module.css';

export default function VendorLoginPage() {
  const router = useRouter();
  const { vendor, loading, setSession } = useVendorAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && vendor) {
      router.replace('/vendor');
    }
  }, [loading, vendor, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // LT-61: POST /auth/login serves both realms — a vendor account resolves
      // to { vendor } instead of { employee, role } (see the route's docstring).
      const session = await api.post<VendorMeResponse>('/auth/login', { email, password });
      setSession(session);
      router.replace('/vendor');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (vendor) {
    return <div className="pageLoading">Memuat...</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1>Portal Vendor Live Stream</h1>
          <p>CDPS &mdash; MEA Agency</p>
        </div>
        <form className="card form" onSubmit={handleSubmit}>
          <h2>Masuk</h2>
          {error && <div className="alert alertError" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="vendor-email">Email</label>
            <input
              id="vendor-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="vendor-password">Kata Sandi</label>
            <input
              id="vendor-password"
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
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Lupa password atau belum punya akun? Hubungi Account Manager Anda di MEA Agency.
          </p>
        </form>
      </div>
    </div>
  );
}
