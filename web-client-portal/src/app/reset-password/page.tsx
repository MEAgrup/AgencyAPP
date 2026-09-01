'use client';

/**
 * Lupa Password — completion step (spec §3.3 jalur 2). The landing page for
 * the link GoTrue's recovery email sends: GoTrue redirects here with the
 * session in the URL FRAGMENT (`#access_token=...&type=recovery&...`, the
 * standard GoTrue recovery-flow shape — never a query string, so it never
 * reaches server logs). Read client-side only, then handed to
 * POST /auth/client-portal/reset-password, which does the actual GoTrue
 * password update server-side — this page never calls Supabase directly and
 * never stores the token itself beyond the one request.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { usePortalAuth } from '@/lib/portal-auth-context';
import { parseAccessTokenFromHash } from '@/lib/recovery-token';
import type { ClientContactMeResponse } from '@/lib/types';
import styles from '../login/page.module.css';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { setSession } = usePortalAuth();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [checkedToken, setCheckedToken] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccessToken(parseAccessTokenFromHash(window.location.hash));
    setCheckedToken(true);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('[konfirmasi password tidak sama]');
      return;
    }
    if (accessToken === null) {
      return;
    }
    setSubmitting(true);
    try {
      const session = await api.post<ClientContactMeResponse>('/auth/client-portal/reset-password', {
        access_token: accessToken,
        new_password: newPassword,
      });
      setSession(session);
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1>Atur Ulang Password</h1>
          <p>Client Portal &mdash; MEA Agency</p>
        </div>

        {checkedToken && accessToken === null ? (
          <div className="card stack">
            <div className="alert alertError">
              Link ini tidak valid atau sudah kedaluwarsa. Silakan minta link baru.
            </div>
            <div className={styles.links}>
              <Link href="/lupa-password">Minta link baru</Link>
            </div>
          </div>
        ) : (
          <form className="card form" onSubmit={handleSubmit}>
            {error && <div className="alert alertError" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor="new_password">Password Baru</label>
              <input
                id="new_password"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm_password">Ulangi Password Baru</label>
              <input
                id="confirm_password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btnPrimary" disabled={submitting || accessToken === null}>
              {submitting ? 'Menyimpan...' : 'Simpan Password Baru'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
