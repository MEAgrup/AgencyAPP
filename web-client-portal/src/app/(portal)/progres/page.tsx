'use client';

/**
 * Progres layanan (M15 Rule 2).
 *
 * Each active service shows a client-facing stage label, rolled up from the work
 * behind it. The internal status names, the brief/asset ids, who is working on
 * it and every SLA date are not hidden here — the server never sends them.
 *
 * The roll-up rule is "the least-finished piece of work wins", so a service
 * reads `In Production` while anything is still in production. That is
 * deliberately conservative: reading `Completed` while two pieces are still
 * being made would be worse than reading a cautious label.
 */
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { getServiceProgress } from '@/lib/portal-data';
import { type PortalServiceProgress } from '@/lib/types';

const URUTAN = ['Queued', 'In Production', 'In Review', 'Finalizing', 'Completed'];

function tone(label: string): string {
  if (label === 'Completed') return 'alertSuccess';
  if (label === 'In Review') return 'alertWarning';
  return 'alertInfo';
}

export default function ProgresPage() {
  const [rows, setRows] = useState<PortalServiceProgress[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getServiceProgress().then(setRows).catch((e) => setErr(errorMessage(e)));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Progres Layanan</h1>
        <p className="muted">Posisi setiap layanan yang sedang berjalan untuk akun Anda.</p>
      </div>

      {err && <div className="alert alertError">{err}</div>}
      {rows === null && !err && <p className="muted">Memuat progres…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="card">
          <p>Belum ada layanan yang berjalan.</p>
        </div>
      )}

      {rows?.map((r) => (
        <div className="card" key={r.nama_layanan}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{r.nama_layanan}</strong>
            <span className={`alert ${tone(r.label)}`} style={{ padding: '2px 10px', fontSize: 13 }}>
              {r.label}
            </span>
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            {r.jumlah_pekerjaan === 0
              ? 'Belum ada pekerjaan yang dimulai.'
              : `${r.jumlah_selesai} dari ${r.jumlah_pekerjaan} pekerjaan selesai.`}
          </div>
          <ol
            className="muted"
            style={{ display: 'flex', gap: 10, listStyle: 'none', padding: 0, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}
          >
            {URUTAN.map((tahap) => (
              <li key={tahap} style={{ fontWeight: tahap === r.label ? 700 : 400, color: tahap === r.label ? 'var(--color-text)' : undefined }}>
                {tahap}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
