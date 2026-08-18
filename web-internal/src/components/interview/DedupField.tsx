'use client';

/**
 * RAB-08 — a Blok B field that Riset Awal already answered.
 *
 * Instead of an empty input the AM would retype (and whose value the scorer would
 * then ignore — RAB-06), the answer is shown as a locked chip. "Berbeda dari
 * data" does not open a duplicate box here; it sends the AM to the Riset Awal
 * confirmation grid, the ONE place the number and the score move together. So
 * re-entry is gone but correction is not.
 */

import type { DedupInfo } from '@/lib/interview-dedup';

export default function DedupField({
  info,
  onCorrect,
}: {
  info: DedupInfo;
  /** Jump to the Riset Awal step to correct + re-confirm the number. */
  onCorrect: () => void;
}) {
  return (
    <div className="field" style={{ gap: 4 }}>
      <label>
        {info.fieldKey} · {info.label}
        <span className="muted" style={{ fontWeight: 400 }}> · terisi dari data</span>
      </label>
      <div
        className="row"
        style={{
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: 'var(--color-surface-muted, transparent)',
        }}
      >
        <span aria-hidden style={{ color: 'var(--color-success, green)' }}>✓</span>
        <strong>{info.display}</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>{info.source}</span>
        {!info.confirmed && <span className="badge badge-amber">belum dikonfirmasi</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btnGhost btnSm" onClick={onCorrect}>
          Berbeda dari data
        </button>
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        Diambil dari Riset Awal — skor Blok C membaca angka ini, bukan isian di sini. Untuk mengubah, koreksi &
        konfirmasi ulang di langkah Riset Awal.
      </span>
    </div>
  );
}
