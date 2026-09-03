'use client';

/**
 * Form komplain (M15 Rule 5) — kirim saja.
 *
 * There is deliberately no history list on this page. M15 Rule 6 confirmed
 * complaint history is submit-only: follow-up happens with the Account Manager,
 * and showing a status column here would promise a self-service resolution
 * flow that does not exist.
 *
 * The attachment is a LINK, not an upload: CDPS has no file storage yet, so
 * accepting a file here would mean quietly dropping it. A value that is not a
 * link is refused by the server rather than stored as a dead reference.
 */
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { submitComplaint } from '@/lib/portal-data';

const SEVERITY = [
  { value: '', label: 'Tidak perlu dipilih' },
  { value: 'Low', label: 'Ringan' },
  { value: 'Medium', label: 'Sedang' },
  { value: 'High', label: 'Mendesak' },
];

export default function KomplainPage() {
  const [deskripsi, setDeskripsi] = useState('');
  const [severity, setSeverity] = useState('');
  const [lampiran, setLampiran] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);

  async function kirim() {
    setBusy(true);
    setErr(null);
    try {
      const res = await submitComplaint({
        deskripsi,
        severity: severity === '' ? null : severity,
        lampiran: lampiran.trim() === '' ? null : lampiran.trim(),
      });
      setAck(res.pesan);
      setDeskripsi('');
      setSeverity('');
      setLampiran('');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Ajukan Komplain</h1>
        <p className="muted">
          Komplain Anda langsung masuk ke Account Manager yang menangani akun ini.
        </p>
      </div>

      {ack && <div className="alert alertSuccess">{ack}</div>}
      {err && <div className="alert alertError">{err}</div>}

      <div className="card">
        <div className="form">
          <div className="field">
            <label htmlFor="deskripsi">Ceritakan masalahnya</label>
            <textarea
              id="deskripsi"
              rows={6}
              value={deskripsi}
              disabled={busy}
              placeholder="Contoh: angka GMV di laporan bulan ini berbeda dengan yang saya lihat di Seller Center."
              onChange={(e) => setDeskripsi(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="severity">Seberapa mendesak? (opsional)</label>
            <select id="severity" value={severity} disabled={busy} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITY.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="lampiran">Tautan lampiran (opsional)</label>
            <input
              id="lampiran"
              value={lampiran}
              disabled={busy}
              placeholder="https://drive.google.com/..."
              onChange={(e) => setLampiran(e.target.value)}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Unggah tangkapan layar ke Google Drive atau layanan sejenis, lalu tempel tautannya di sini.
            </span>
          </div>

          <button
            type="button"
            className="btn btnPrimary"
            disabled={busy || deskripsi.trim() === ''}
            onClick={() => void kirim()}
          >
            {busy ? 'Mengirim…' : 'Kirim komplain'}
          </button>
        </div>
      </div>
    </div>
  );
}
