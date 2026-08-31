'use client';

/**
 * Ganti Password — self-service, mirrors web-internal's
 * `(shell)/akun/password/page.tsx`. Posts to /auth/change-password (the
 * SAME endpoint every realm uses — the route branches on the resolved Actor,
 * see its docstring), so this page never touches GoTrue directly.
 *
 * This is also where the force-change gate ((portal)/layout.tsx) sends a
 * contact whose `must_change_password` is true — `refresh()` after a
 * successful change updates the context so the guard stops redirecting here.
 */
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { usePortalAuth } from '@/lib/portal-auth-context';

export default function GantiPasswordPage() {
  const { contact, refresh } = usePortalAuth();
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
      await refresh();
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
          {contact?.must_change_password
            ? 'Wajib diganti sebelum melanjutkan. Minimal 8 karakter.'
            : 'Minimal 8 karakter.'}
        </p>
      </div>

      {error && <div className="alert alertError">{error}</div>}
      {done && <div className="alert alertSuccess">Password berhasil diubah.</div>}

      <form className="card form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="old_password">Password Lama</label>
          <input
            id="old_password"
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new_password">Password Baru</label>
          <input
            id="new_password"
            type="password"
            autoComplete="new-password"
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
