'use client';

/**
 * A-13 — Section D (Target & KPI), the editable half.
 *
 * D-1/D-2/D-4 (the target matrix) and D-8/D-9 (assumptions) are separate
 * endpoints with their own grain and land in A-13b. What is here is what A-08
 * put on the header: D-5, D-6, and the read side of D-3 and D-7.
 *
 * Three things this component deliberately does NOT let the AM do:
 *
 * - **D-3 is not editable.** It is derived from D-2 (X-11), so it renders as a
 *   number, not an input. A field that looks typeable but is recomputed on save
 *   teaches the AM their edit was ignored.
 * - **D-7 cannot lower a target.** Rule 19 makes a Sanggahan advisory; the form
 *   presents it as evidence filed with SPV, never as a way to change the floor.
 * - **Nothing here submits.** Section writes are Draft-only; the submit button
 *   lives on the page shell with the gap count beside it.
 */

import { LEADING_INDICATOR_MAX, METRIC_LABELS } from '@/lib/strategi';
import type { LeadingIndicator, StrategiDetail } from '@/lib/strategi';
import { formatIDR } from '@/lib/money';

export interface KpiDraft {
  definisi_berhasil_30: string;
  definisi_berhasil_60: string;
  definisi_berhasil_90: string;
  leading_indicator: LeadingIndicator[];
}

export function kpiDraftOf(d: StrategiDetail): KpiDraft {
  return {
    definisi_berhasil_30: d.definisi_berhasil_30 ?? '',
    definisi_berhasil_60: d.definisi_berhasil_60 ?? '',
    definisi_berhasil_90: d.definisi_berhasil_90 ?? '',
    leading_indicator: d.leading_indicator,
  };
}

export default function SectionD({
  detail,
  draft,
  onChange,
  disabled,
}: {
  detail: StrategiDetail;
  draft: KpiDraft;
  onChange: (patch: Partial<KpiDraft>) => void;
  disabled: boolean;
}) {
  const toggleIndicator = (v: LeadingIndicator) => {
    const has = draft.leading_indicator.includes(v);
    if (!has && draft.leading_indicator.length >= LEADING_INDICATOR_MAX) return;
    onChange({
      leading_indicator: has
        ? draft.leading_indicator.filter((x) => x !== v)
        : [...draft.leading_indicator, v],
    });
  };

  return (
    <div className="stack">
      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>D-5 · Definisi berhasil 30 / 60 / 90 hari</label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Apa yang harus terlihat di hari ke-30, ke-60 dan ke-90 supaya strategi ini disebut jalan.
        </p>
        <div className="stack" style={{ gap: 8 }}>
          {([30, 60, 90] as const).map((h) => (
            <label key={h} className="field" style={{ display: 'block' }}>
              <span className="muted" style={{ fontSize: 12 }}>{h} hari</span>
              <textarea
                rows={2}
                disabled={disabled}
                value={draft[`definisi_berhasil_${h}` as const]}
                onChange={(e) =>
                  onChange({ [`definisi_berhasil_${h}`]: e.target.value } as Partial<KpiDraft>)
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>
          D-6 · Leading indicator mingguan{' '}
          <span className="muted" style={{ fontWeight: 400 }}>
            ({draft.leading_indicator.length}/{LEADING_INDICATOR_MAX})
          </span>
        </label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Angka yang dipantau tiap minggu. Maksimal {LEADING_INDICATOR_MAX} — kalau semuanya
          dipantau, tidak ada yang dipantau.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {METRIC_LABELS.map((m) => {
            const checked = draft.leading_indicator.includes(m.value);
            // The cap is shown by disabling the unchecked boxes rather than by
            // an error after the fact: the API and `ck_strategi_leading_indicator`
            // both refuse a sixth, so offering it would only produce a rejection.
            const capped = !checked && draft.leading_indicator.length >= LEADING_INDICATOR_MAX;
            return (
              <label key={m.value} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || capped}
                  onChange={() => toggleIndicator(m.value)}
                />
                <span style={{ opacity: capped ? 0.5 : 1 }}>{m.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">D-3 · Komposisi kontribusi channel</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Dihitung dari target GMV per channel (D-2) — tidak diketik, dan berubah sendiri saat
          D-2 berubah.
        </p>
        {detail.komposisi_kontribusi.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada target GMV, jadi belum ada komposisi.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th style={{ textAlign: 'right' }}>Total GMV</th>
                <th style={{ textAlign: 'right' }}>Kontribusi</th>
              </tr>
            </thead>
            <tbody>
              {detail.komposisi_kontribusi.map((k) => (
                <tr key={k.channel}>
                  <td>{k.channel}</td>
                  <td style={{ textAlign: 'right' }}>{formatIDR(k.target_gmv)}</td>
                  {/* Rumah #7: pembagian nol dirender —, bukan 0% dan bukan error. */}
                  <td style={{ textAlign: 'right' }}>
                    {k.persen === null ? '—' : `${k.persen}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="cardHeader">
          D-7 · Sanggahan Target <span className="badge badge-amber">Internal saja</span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Catatan untuk SPV &amp; Head of Sales kalau target kontrak dinilai tidak realistis.
          Ia <strong>tidak mengubah</strong> target kontrak — stretch tetap wajib ≥ floor.
        </p>
        {detail.sanggahan_alasan === null ? (
          <p className="muted" style={{ fontSize: 13 }}>Belum ada sanggahan.</p>
        ) : (
          <div className="stack" style={{ gap: 4, fontSize: 13 }}>
            <div>{detail.sanggahan_alasan}</div>
            <div className="muted">
              Pembanding {formatIDR(detail.sanggahan_angka_pembanding)} · menurut AM realistis{' '}
              {formatIDR(detail.sanggahan_target_realistis)}
            </div>
            <div className="muted">
              Diajukan {detail.sanggahan_diajukan_oleh} · {detail.sanggahan_diajukan_pada}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
