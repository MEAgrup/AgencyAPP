'use client';

/**
 * The pinned live-scoring sidebar (langkah 7 §7).
 *
 * It renders `previewKualifikasi(draft)`, which runs the SAME `hitungKualifikasi`
 * the server persists on submit (preview = submit). Nothing here writes — it
 * recomputes on every keystroke. The persisted qualification (from the last
 * POST /score) is shown alongside so a divergence between "what I'm typing" and
 * "what was saved" is visible; the persisted verdict is the authority, the
 * preview is advisory.
 */

import {
  HAMBATAN_LABELS,
  KUALITAS_DATA_LABELS,
  VERDICT_LABELS,
  verdictTone,
  type InterviewKualifikasi,
} from '@/lib/interview';
import type { PreviewResult } from '@/lib/interview-fields';

const BLOCK_MAX: Record<string, number> = { A: 30, B: 20, C: 20, D: 15, E: 15 };
const BLOCK_LABEL: Record<string, string> = {
  A: 'Ekonomi Unit',
  B: 'Kesiapan Suplai',
  C: 'Produk & Pasar',
  D: 'Operasional',
  E: 'Ekspektasi & Daya Tahan',
};

function fmtRoas(roas: number | null): string {
  return roas === null ? '—' : `${roas.toFixed(1)}x`;
}

export default function ScoringSidebar({
  preview,
  persisted,
}: {
  preview: PreviewResult;
  persisted: InterviewKualifikasi | null;
}) {
  const h = preview.hasil;
  const perBlok = (h?.skorPerBlok ?? {}) as Record<string, number>;

  return (
    <aside className="card" style={{ position: 'sticky', top: 16 }}>
      <div className="cardHeader" style={{ marginBottom: 8 }}>
        Skoring (preview)
        {preview.ready && h && (
          <span className={`badge badge-${verdictTone(h.verdict)}`}>{VERDICT_LABELS[h.verdict] ?? h.verdict}</span>
        )}
      </div>

      {!preview.ready ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            Lengkapi field skor (★) untuk melihat skor & verdict provisional:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {preview.missing.map((m) => (
              <li key={m.fieldKey}>
                <code>{m.fieldKey}</code> {m.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        h && (
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
                {h.skorTotal}
                <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
                  {' '}
                  / 100
                </span>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Verdict provisional — advisory, tidak memblok.
              </div>
            </div>

            <div className="stack" style={{ gap: 6 }}>
              {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => {
                const val = perBlok[k] ?? 0;
                const max = BLOCK_MAX[k];
                const pct = Math.round((val / max) * 100);
                return (
                  <div key={k}>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                      <span>
                        {k}. {BLOCK_LABEL[k]}
                      </span>
                      <span className="muted">
                        {val}/{max}
                      </span>
                    </div>
                    <div style={{ height: 6, background: 'var(--color-bg)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span className="muted">BEP ROAS</span>
              <span>
                <strong>{fmtRoas(h.bepRoas)}</strong> <span className="muted">· {h.bepRoasBand}</span>
              </span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span className="muted">Rasio target</span>
              <span>{h.rasioTarget === null ? '—' : `${h.rasioTarget}x`}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span className="muted">Kualitas data</span>
              <span>{KUALITAS_DATA_LABELS[h.kualitasData] ?? h.kualitasData}</span>
            </div>

            {h.hambatanMendasar.length > 0 && (
              <div className="alert alertError" style={{ fontSize: 12 }}>
                <strong>Deal-breaker</strong> — verdict dipaksa Tidak Siap:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {h.hambatanMendasar.map((db, i) => (
                    <li key={i}>
                      {HAMBATAN_LABELS[db.kode] ?? db.kode} <span className="muted">({db.nilai})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {h.flags.length > 0 && (
              <div className="alert alertInfo" style={{ fontSize: 12 }}>
                {h.flags.map((f) => (
                  <div key={f}>⚑ {f === 'margin_zona_abu_abu' ? 'Margin di zona abu-abu' : 'BEP ROAS di atas target internal advertiser'}</div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {persisted && (
        <div className="stack" style={{ gap: 4, marginTop: 12, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Tersimpan (skor terakhir)</span>
            <span className={`badge badge-${verdictTone(persisted.verdict_kualifikasi)}`}>
              {VERDICT_LABELS[persisted.verdict_kualifikasi] ?? persisted.verdict_kualifikasi}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {persisted.skor_kualifikasi}/100 · dihitung {new Date(persisted.dihitung_pada).toLocaleString('id-ID')}
          </div>
          {preview.ready && h && (h.skorTotal !== persisted.skor_kualifikasi || h.verdict !== persisted.verdict_kualifikasi) && (
            <div className="muted" style={{ fontSize: 11 }}>
              Preview berbeda dari yang tersimpan — tekan “Hitung &amp; simpan skor”.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
