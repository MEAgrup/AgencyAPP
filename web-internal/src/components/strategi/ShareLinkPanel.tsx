'use client';

/**
 * A-11 (§7 D20) — the AM's control over the client link `/s/{token}`.
 *
 * The secret is shown EXACTLY ONCE. `GET` returns only status (the server never
 * stores the plaintext), so the full URL is displayable only in the moment right
 * after `create`/`rotate`, while the token is still in this component's state.
 * On a later page load an active link shows as "aktif" with its dates and the
 * only actions are regenerate (which mints a fresh secret) or revoke — never
 * "show me the URL again", because there is no again.
 *
 * The link lives on this same origin (`/api/v1` is relative), so the public URL
 * is `${origin}/s/{token}`.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createStrategiShareLink,
  getStrategiShareLink,
  revokeStrategiShareLink,
  type ShareLinkStatus,
} from '@/lib/strategi';

interface Props {
  strategiId: string;
  /** A link can only be minted once there is an approved active version (§7). */
  active: boolean;
  /** AM-owner or Account lead — the two roles §7 lets mint and revoke. */
  canManage: boolean;
}

function shareUrl(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/s/${token}`;
}

export default function ShareLinkPanel({ strategiId, active, canManage }: Props) {
  const [status, setStatus] = useState<ShareLinkStatus | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    getStrategiShareLink(strategiId)
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setError('Gagal memuat status tautan.'));
    return () => {
      alive = false;
    };
  }, [strategiId, active]);

  const run = useCallback(
    async (fn: () => Promise<ShareLinkStatus>, fresh: string | null) => {
      setBusy(true);
      setError(null);
      setCopied(false);
      try {
        const s = await fn();
        setStatus(s);
        setFreshUrl(fresh);
      } catch {
        setError('Gagal memproses tautan.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const mint = useCallback(async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const made = await createStrategiShareLink(strategiId);
      setStatus(made);
      setFreshUrl(shareUrl(made.token));
    } catch {
      setError('Gagal membuat tautan.');
    } finally {
      setBusy(false);
    }
  }, [strategiId]);

  const revoke = useCallback(
    () => run(() => revokeStrategiShareLink(strategiId), null),
    [run, strategiId],
  );

  const copy = useCallback(() => {
    if (freshUrl === null || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(freshUrl).then(
      () => setCopied(true),
      () => setError('Tidak bisa menyalin — salin manual dari kotak di atas.'),
    );
  }, [freshUrl]);

  if (!active) {
    return (
      <section style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>Tautan Klien</h3>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Tautan read-only untuk klien tersedia setelah Strategi aktif (disetujui).
        </p>
      </section>
    );
  }

  const st = status?.status ?? 'none';

  return (
    <section style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>Tautan Klien</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
        Halaman read-only ber-token: klien selalu melihat versi aktif, tanpa riwayat
        atau diff. Hanya bagian yang ditandai &quot;Bagikan ke Klien&quot; yang tampil.
      </p>

      {freshUrl !== null && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '8px 10px',
              border: '1px solid #d8dce2',
              borderRadius: 6,
              wordBreak: 'break-all',
              background: 'rgba(0,0,0,0.03)',
            }}
          >
            {freshUrl}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', color: '#b45309' }}>
            Salin sekarang — token ini tidak bisa ditampilkan lagi. Buka lagi berarti
            regenerasi (tautan lama langsung mati).
          </p>
          <button type="button" onClick={copy} disabled={busy} style={{ marginTop: 6 }}>
            {copied ? 'Tersalin ✓' : 'Salin tautan'}
          </button>
        </div>
      )}

      {st === 'aktif' && freshUrl === null && (
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>
          Tautan <strong>aktif</strong>
          {status?.tanggal_kedaluwarsa ? ` · kedaluwarsa ${status.tanggal_kedaluwarsa}` : ''}.
          Token hanya ditampilkan sekali saat dibuat; regenerasi untuk mendapat tautan
          baru.
        </p>
      )}
      {st === 'dicabut' && (
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>
          Tautan sudah <strong>dicabut</strong>. Buat tautan baru bila klien perlu akses.
        </p>
      )}
      {st === 'none' && freshUrl === null && (
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>Belum ada tautan klien.</p>
      )}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={mint} disabled={busy}>
            {st === 'aktif' ? 'Regenerasi tautan' : 'Buat tautan klien'}
          </button>
          {st === 'aktif' && (
            <button type="button" onClick={revoke} disabled={busy}>
              Cabut tautan
            </button>
          )}
        </div>
      )}

      {error !== null && (
        <p style={{ fontSize: 12, margin: '8px 0 0', color: '#dc2626' }}>{error}</p>
      )}
    </section>
  );
}
