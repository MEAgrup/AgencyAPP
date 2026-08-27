'use client';

/**
 * Panel "Tempel dari Video Factory" — jembatan `/tools/video-factory` (nav "AM -
 * baseline riset") → entri manual Riset Awal (RAB-04 `ManualForm`).
 *
 * AM menjalankan analisa baseline di Video Factory, menekan "Copy untuk CDPS
 * Section B", lalu menempel payload di sini. Panel mem-parse + menerapkannya ke
 * field manual platform ini (SARAN saja: hanya field kosong yang diisi, AM tetap
 * meninjau lalu menekan "Submit baseline platform" seperti biasa). Tool hanya
 * bisa membaca export TikTok Shop/Tokopedia — payload yang channel-nya tidak
 * cocok dengan platform tab ini ditolak, bukan diam-diam ditempel.
 *
 * Sama seperti `VideoFactoryImportPanel` (Strategi Section B), panel ini TIDAK
 * menulis ke server — ia hanya mengubah state form lewat `onApply`.
 */

import { useState } from 'react';
import {
  applyVideoFactoryToManual,
  parseVideoFactoryPayload,
  type ManualApplySummary,
  type ManualBaselineFields,
} from '@/lib/riset-awal-video-factory';

export default function VideoFactoryBaselineImportPanel({
  platformLabel,
  fields,
  onApply,
  disabled,
}: {
  platformLabel: string;
  fields: ManualBaselineFields;
  onApply: (fields: ManualBaselineFields) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ManualApplySummary | null>(null);

  const apply = () => {
    setError(null);
    setSummary(null);
    const parsed = parseVideoFactoryPayload(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const result = applyVideoFactoryToManual(fields, parsed.payload, platformLabel);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onApply(result.fields);
    setSummary(result.summary);
    setText('');
  };

  return (
    <section
      className="card"
      style={{
        marginBottom: 10,
        padding: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface-muted, transparent)',
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Tempel dari Video Factory</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>GMV, order, jumlah SKU</span>
        <span style={{ flex: 1 }} />
        <a
          href="/tools/video-factory"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btnGhost btnSm"
        >
          Buka Video Factory
        </a>
        {!disabled && (
          <button type="button" className="btn btnSecondary btnSm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Tutup' : 'Tempel payload'}
          </button>
        )}
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Di Video Factory, jalankan analisa baseline atas export <b>{platformLabel}</b> lalu tekan{' '}
        <b>“Copy untuk CDPS Section B”</b>, dan tempel di sini. Hanya GMV/bulan, order/bulan, dan
        jumlah SKU yang bisa diisi otomatis — AOV, belanja iklan, dan ROAS tetap manual (tool tidak
        punya rincian itu). Field yang <b>masih kosong</b> saja yang diisi; angka yang sudah Anda
        ketik tidak ditimpa. Ini <b>saran</b>: tinjau lalu submit seperti biasa.
      </p>

      {open && !disabled && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Tempel JSON hasil "Copy untuk CDPS Section B" di sini…'
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 120,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              padding: 8,
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              resize: 'vertical',
            }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btnPrimary btnSm" onClick={apply} disabled={!text.trim()}>
              Terapkan ke baseline
            </button>
            <button
              type="button"
              className="btn btnGhost btnSm"
              onClick={() => {
                setText('');
                setError(null);
                setSummary(null);
              }}
            >
              Bersihkan
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alertError" style={{ fontSize: 12, marginTop: 8 }}>
          {error}
        </div>
      )}

      {summary && (
        <div className="alert alertInfo" style={{ fontSize: 12, marginTop: 8 }}>
          {summary.fieldsFilled} field terisi
          {summary.fieldsSkipped > 0 ? `, ${summary.fieldsSkipped} dilewati (sudah ada isinya).` : '.'}{' '}
          Tinjau nilainya lalu submit.
        </div>
      )}
    </section>
  );
}
