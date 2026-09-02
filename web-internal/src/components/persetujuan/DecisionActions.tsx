'use client';

/**
 * Pasangan tombol keputusan untuk `/persetujuan`.
 *
 * Satu komponen untuk kedelapan antrian supaya bentuk keputusannya seragam:
 * hijau kiri (setujui), merah kanan (tolak), catatan di atasnya, pesan error
 * server ditampilkan APA ADANYA (pesan `[...]` Bahasa Indonesia dari engine
 * adalah spesifikasi — jangan pernah diparafrase di FE).
 *
 * Catatan wajib untuk Tolak bukan hiasan: `decideNegotiation` /
 * `decideRenewal` menolak note kosong di server, dan pada antrian yang tidak
 * mewajibkannya pun penolakan tanpa alasan adalah yang membuat pengaju
 * mengajukan hal yang sama minggu depan. Tombolnya dinonaktifkan sampai
 * catatannya terisi, jadi kegagalannya terbaca sebelum request dikirim.
 */
import { useState, type ReactNode } from 'react';

export type DecisionKind = 'approve' | 'reject';

export interface DecisionActionsProps {
  onDecide: (kind: DecisionKind, note: string) => void | Promise<void>;
  /** Aksi yang sedang berjalan (baris ini saja), atau null. */
  busy?: DecisionKind | 'extra' | null;
  approveLabel?: string;
  rejectLabel?: string;
  noteLabel?: string;
  notePlaceholder?: string;
  /** false untuk antrian yang endpoint-nya tidak menerima catatan sama sekali. */
  showNote?: boolean;
  /** Tolak butuh catatan (default true). */
  noteRequiredForReject?: boolean;
  /** Setujui juga butuh catatan (jarang; default false). */
  noteRequiredForApprove?: boolean;
  /** Kalimat konfirmasi; kembalikan '' untuk melewatkan window.confirm. */
  confirmText?: (kind: DecisionKind) => string;
  error?: string | null;
  /** Tombol ketiga (mis. "Revisi / Counter" pada negosiasi sales). */
  extra?: ReactNode;
  /** Kalimat di bawah tombol — konsekuensi keputusan, sependek mungkin. */
  hint?: ReactNode;
  disabled?: boolean;
  /** id unik untuk menautkan <label> ke textarea-nya. */
  fieldId: string;
}

export default function DecisionActions({
  onDecide,
  busy = null,
  approveLabel = 'Setujui',
  rejectLabel = 'Tolak',
  noteLabel = 'Catatan keputusan',
  notePlaceholder = 'Wajib diisi bila menolak — pengaju hanya melihat kalimat ini.',
  showNote = true,
  noteRequiredForReject = true,
  noteRequiredForApprove = false,
  confirmText,
  error,
  extra,
  hint,
  disabled = false,
  fieldId,
}: DecisionActionsProps) {
  const [note, setNote] = useState('');
  const trimmed = note.trim();
  const anyBusy = busy !== null;

  function fire(kind: DecisionKind) {
    const text = confirmText?.(kind);
    if (text && !window.confirm(text)) return;
    onDecide(kind, trimmed);
  }

  const approveBlocked = disabled || anyBusy || (showNote && noteRequiredForApprove && trimmed === '');
  const rejectBlocked = disabled || anyBusy || (showNote && noteRequiredForReject && trimmed === '');

  return (
    <div className="stack" style={{ gap: 8 }}>
      {error && (
        <div className="alert alertError" role="alert">
          {error}
        </div>
      )}
      {showNote && (
        <div className="field">
          <label htmlFor={fieldId}>{noteLabel}</label>
          <textarea
            id={fieldId}
            rows={2}
            value={note}
            placeholder={notePlaceholder}
            disabled={disabled || anyBusy}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btnApprove" disabled={approveBlocked} onClick={() => fire('approve')}>
          {busy === 'approve' ? 'Memproses...' : approveLabel}
        </button>
        <button type="button" className="btn btnReject" disabled={rejectBlocked} onClick={() => fire('reject')}>
          {busy === 'reject' ? 'Memproses...' : rejectLabel}
        </button>
        {extra}
      </div>
      {hint && (
        <p className="muted" style={{ fontSize: 12 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
