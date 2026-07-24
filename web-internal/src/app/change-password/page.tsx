'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { MeResponse } from '@/lib/types';
import styles from './page.module.css';

/**
 * /change-password (O38). Two entry points share this screen:
 *  - forced first-login change: the shell redirects here while
 *    `employee.must_change_password` is true (all provisioned accounts ship with
 *    a shared default), and
 *  - a normal self-service change.
 * On success the API returns the refreshed MeResponse (flag now false); we push
 * it into the session and return to the workspace.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { employee, loading, setSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not signed in → back to login (nothing to change).
  useEffect(() => {
    if (!loading && !employee) {
      router.replace('/login');
    }
  }, [loading, employee, router]);

  const forced = employee?.must_change_password ?? false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('[konfirmasi kata sandi tidak cocok]');
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.post<MeResponse>('/auth/change-password', {
        current_password: current,
        new_password: next,
      });
      setSession(session);
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !employee) {
    return <div className="pageLoading">Memuat...</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1>CDPS — MEA Agency</h1>
          <p>Ganti Kata Sandi</p>
        </div>
        <form className="card form" onSubmit={handleSubmit}>
          <h2>{forced ? 'Ganti kata sandi default' : 'Ganti kata sandi'}</h2>
          {forced && (
            <div className="alert" role="status">
              Untuk keamanan, kata sandi default wajib diganti sebelum melanjutkan.
            </div>
          )}
          {error && <div className="alert alertError" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="current">Kata Sandi Saat Ini</label>
            <input
              id="current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="next">Kata Sandi Baru</label>
            <input
              id="next"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Konfirmasi Kata Sandi Baru</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btnPrimary" disabled={submitting}>
            {submitting ? 'Memproses...' : 'Simpan Kata Sandi'}
          </button>
        </form>
      </div>
    </div>
  );
}
