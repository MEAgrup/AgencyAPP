'use client';

/**
 * RAB-09 — what the client's completed Interview hands to this Strategi (Blok D).
 *
 * The verdict never blocks Strategi (v5 decision): this panel is advisory. It
 * surfaces the verdict-driven flags (conservative goals, mitigation note
 * required, prasyarat → Section C-7) and the concrete prefill SUGGESTIONS the AM
 * may copy into Section A/C/E. It writes nothing — the AM types/confirms each
 * value in the normal editor (M6A "usulan → konfirmasi"), which is why no
 * interview-provenance column exists on `strategi`.
 *
 * Rendered only when the client has a scored, completed interview; otherwise the
 * parent passes `null` and this is not shown at all.
 */

import Link from 'next/link';
import type { StrategiPrefill } from '@/lib/strategi';

const VERDICT_LABEL: Record<string, string> = {
  growth_ready: 'Growth Ready',
  bersyarat: 'Bersyarat',
  risiko_tinggi: 'Risiko Tinggi',
  tidak_siap: 'Tidak Siap',
};

const FLAG_LABEL: Record<string, string> = {
  sasaran_konservatif: 'Sasaran konservatif',
  hambatan_mendasar_tercatat: 'Hambatan mendasar tercatat',
  risiko_tinggi: 'Risiko tinggi',
};

export default function InterviewPrefillPanel({ prefill }: { prefill: StrategiPrefill }) {
  const verdictLabel = VERDICT_LABEL[prefill.verdict] ?? prefill.verdict;
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
        <strong>Dari Interview</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>verdict: {verdictLabel}</span>
        {prefill.flags.map((f) => (
          <span key={f} className="badge badge-amber" style={{ fontWeight: 400 }}>
            {FLAG_LABEL[f] ?? f}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <Link href={`/account/interview/${prefill.interview_id}`} className="btn btnGhost btnSm">
          Buka Interview
        </Link>
      </div>

      {prefill.wajib_catatan_mitigasi && (
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          ⚠️ Verdict ini butuh <strong>catatan mitigasi risiko</strong> di narasi sebelum Strategi diajukan.
        </p>
      )}
      {prefill.copy_prasyarat_ke_c7 && (
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Prasyarat klien dari Interview sebaiknya disalin ke <strong>Section C-7</strong> sebagai kerja minggu-1.
        </p>
      )}

      {prefill.items.length === 0 ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Belum ada isian Interview yang bisa diusulkan ke Section A (seksi Blok B sumbernya belum diisi).
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Usulan dari Interview — salin ke field terkait, lalu konfirmasi. Bukan pengisian otomatis.
          </p>
          <table className="table" style={{ marginTop: 4, fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Field</th>
                <th style={{ textAlign: 'left' }}>Usulan</th>
                <th style={{ textAlign: 'left' }}>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {prefill.items.map((it) => (
                <tr key={`${it.interview_field}-${it.strategi_field}`}>
                  <td>
                    <strong>{it.strategi_field}</strong>{' '}
                    <span className="muted">← {it.interview_field}</span>
                  </td>
                  <td>{it.nilai}</td>
                  <td className="muted">{it.catatan ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
