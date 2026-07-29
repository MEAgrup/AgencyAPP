'use client';

/**
 * Ganti Password (O44(c) part A).
 *
 * Posts to /auth/change-password, which does the whole exchange server-side
 * against GoTrue — this page never touches Supabase directly, so no token or
 * anon key is ever handled in the browser (the BFF pattern the rest of auth
 * already follows).
 *
 * The confirm field is checked here purely as a typo guard; every real rule
 * (length in characters, byte ceiling, old-password match) is enforced
 * server-side and surfaced verbatim as a `[...]` message.
 */

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export default function GantiPasswordPage() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword !== confirm) {
      setError('[konfirmasi password tidak sama]');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setDone(true);
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Ganti Password</h1>
        <p className="muted">
          Minimal 8 karakter. Sesi lain akan diperbarui setelah password berhasil diubah.
        </p>
      </div>

      {error && <div className="alert alertError">{error}</div>}
      {done && <div className="alert alertSuccess">Password berhasil diubah.</div>}

      <form className="card form stack" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="old_password">Password Lama</label>
          <input
            id="old_password"
            type="password"
            autoComplete="current-password"
            className="input"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="new_password">Password Baru</label>
          <input
            id="new_password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirm_password">Ulangi Password Baru</label>
          <input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <div className="row">
          <button type="submit" className="btn btnPrimary" disabled={submitting}>
            {submitting ? 'Menyimpan...' : 'Simpan Password Baru'}
          </button>
        </div>
      </form>
    </div>
  );
}
