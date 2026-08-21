'use client';

/**
 * Panel "Tempel dari Video Factory" — jembatan `/tools/video-factory` → Section B.
 *
 * AM menjalankan analisa baseline di Video Factory, menekan "Copy untuk CDPS
 * Section B", lalu menempel payload di sini. Panel mem-parse + menerapkannya ke
 * channel TikTok Shop pada draft (SARAN saja: hanya field kosong yang diisi,
 * AM tetap meninjau lalu menyimpan lewat jalur Section B biasa).
 *
 * Sama seperti BaselinePrefillPanel (Riset Awal), panel ini TIDAK menulis ke
 * server — ia hanya mengubah draft di memori lewat `onApply`.
 */

import { useState } from 'react';
import type { ChannelDraft } from './SectionB';
import {
  applyVideoFactoryPrefill,
  parseVideoFactoryPayload,
  type ApplySummary,
} from '@/lib/strategi-video-factory';

export default function VideoFactoryImportPanel({
  channels,
  onApply,
  disabled,
}: {
  channels: ChannelDraft[];
  onApply: (channels: ChannelDraft[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ApplySummary | null>(null);

  const apply = () => {
    setError(null);
    setSummary(null);
    const parsed = parseVideoFactoryPayload(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const { channels: next, summary: s } = applyVideoFactoryPrefill(channels, parsed.payload);
    onApply(next);
    setSummary(s);
    setText('');
  };

  return (
    <section
      className="card"
      style={{
        marginBottom: 16,
        padding: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface-muted, transparent)',
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Tempel dari Video Factory</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>±60% Section B otomatis</span>
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
        Di Video Factory, jalankan analisa baseline lalu tekan{' '}
        <b>“Copy untuk CDPS Section B”</b>, dan tempel di sini. Hanya field yang{' '}
        <b>masih kosong</b> yang diisi — angka yang sudah Anda ketik tidak ditimpa. Field yang tidak
        ada di export TikTok Shop (umur toko, komposisi trafik, penalti, kompetitor, dll.) tetap
        diisi manual. Ini <b>saran</b>: tinjau lalu simpan seperti biasa.
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
              Terapkan ke Section B
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
          {summary.channelCreated
            ? `Channel “${summary.channelLabel}” ditambahkan. `
            : `Channel “${summary.channelLabel}” diisi. `}
          {summary.fieldsFilled} field terisi
          {summary.fieldsSkipped > 0
            ? `, ${summary.fieldsSkipped} dilewati (sudah ada isinya).`
            : '.'}{' '}
          Tinjau nilainya lalu simpan.
        </div>
      )}
    </section>
  );
}
