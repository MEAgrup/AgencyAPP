'use client';

/**
 * Lupa Password — request step (spec §3.3 jalur 2). Posts to
 * /auth/client-portal/forgot-password, which ALWAYS responds `{status:'ok'}`
 * regardless of whether the email matched a Client Portal contact (spec §5.3
 * non-disclosure) — so this page shows the exact same success message either
 * way, by construction rather than convention.
 *
 * Admin/AM-set reset (spec §3.3 jalur 1) is the other path and has no UI
 * here — a contact who cannot receive email at all still reaches their AM
 * directly, same as the message below says.
 */
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import styles from '../login/page.module.css';

export default function LupaPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/client-portal/forgot-password', { email });
      setDone(true);
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
          <h1>Lupa Password</h1>
          <p>Client Portal &mdash; MEA Agency</p>
        </div>

        {done ? (
          <div className="card stack">
            <div className="alert alertSuccess">
              Kalau email tersebut terdaftar, link untuk mengatur ulang password sudah kami kirim.
              Periksa kotak masuk (dan folder spam) Anda.
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Tidak menerima email atau tidak bisa mengakses email terdaftar? Hubungi Account Manager
              Anda di MEA Agency untuk pengaturan ulang password.
            </p>
          </div>
        ) : (
          <form className="card form" onSubmit={handleSubmit}>
            {error && <div className="alert alertError" role="alert">{error}</div>}
            <p className="muted" style={{ fontSize: 13 }}>
              Masukkan email login Anda. Kami akan mengirim link untuk mengatur ulang password.
            </p>
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
            <button type="submit" className="btn btnPrimary" disabled={submitting}>
              {submitting ? 'Mengirim...' : 'Kirim Link Reset'}
            </button>
          </form>
        )}

        <div className={styles.links}>
          <Link href="/login">Kembali ke halaman masuk</Link>
        </div>
      </div>
    </div>
  );
}
