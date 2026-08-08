'use client';

/**
 * A-13 — Section I (Turunan ke Plan & Brief): I-2, I-3, I-4.
 *
 * I-1 and J-4 are absent on purpose. §4 marks both `A` — derived from Sections E
 * and F — so there is nothing to type. Rendering an empty input for a derived
 * field is how a second, editable source of truth gets born.
 *
 * **The dispatch order is positional, not a free number.** Two divisions cannot
 * share position 1 (`uq_strdisp_urutan`), so the order is expressed by moving
 * rows rather than by typing indices — an AM typing "1" twice would get
 * `[urutan dispatch tidak boleh sama]` for something the form let them do.
 */

import { DISPATCH_DIVISIONS, METRIC_LABELS } from '@/lib/strategi';
import type { LeadingIndicator, StrategiDetail } from '@/lib/strategi';

export interface DispatchDraft {
  divisi: string;
  /** I-4, optional. Rides the I-2 row because both are keyed by division. */
  catatan: string;
}

export interface HandoffDraft {
  dispatch: DispatchDraft[];
  metrik_laporan_klien: LeadingIndicator[];
}

export function handoffDraftOf(d: StrategiDetail): HandoffDraft {
  return {
    dispatch: d.dispatch.map((x) => ({ divisi: x.divisi, catatan: x.catatan ?? '' })),
    metrik_laporan_klien: d.metrik_laporan_klien as LeadingIndicator[],
  };
}

export default function SectionI({
  draft,
  onChange,
  disabled,
}: {
  draft: HandoffDraft;
  onChange: (patch: Partial<HandoffDraft>) => void;
  disabled: boolean;
}) {
  const chosen = draft.dispatch.map((d) => d.divisi);

  const toggleDivisi = (divisi: string) => {
    onChange({
      dispatch: chosen.includes(divisi)
        ? draft.dispatch.filter((d) => d.divisi !== divisi)
        : [...draft.dispatch, { divisi, catatan: '' }],
    });
  };

  // Position is array index + 1, assigned by the client on save. Moving a row is
  // the only way to change it, which is what makes a duplicate position
  // unrepresentable rather than merely refused.
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= draft.dispatch.length) return;
    const next = [...draft.dispatch];
    [next[index], next[to]] = [next[to], next[index]];
    onChange({ dispatch: next });
  };

  const toggleMetrik = (v: LeadingIndicator) => {
    onChange({
      metrik_laporan_klien: draft.metrik_laporan_klien.includes(v)
        ? draft.metrik_laporan_klien.filter((x) => x !== v)
        : [...draft.metrik_laporan_klien, v],
    });
  };

  return (
    <div className="stack">
      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>I-2 · Divisi penerima Brief &amp; urutan dispatch</label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Divisi mana yang menerima Brief dari Strategi ini, dan dalam urutan apa. Minimal satu.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {DISPATCH_DIVISIONS.map((d) => (
            <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={chosen.includes(d)}
                disabled={disabled}
                onChange={() => toggleDivisi(d)}
              />
              <span>{d}</span>
            </label>
          ))}
        </div>

        {draft.dispatch.length > 0 && (
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {draft.dispatch.map((d, i) => (
              <div
                key={d.divisi}
                style={{
                  border: '1px solid var(--border, #e2e2e2)',
                  borderRadius: 6,
                  padding: 10,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <span className="badge badge-blue">{i + 1}</span>
                  <strong style={{ flex: 1 }}>{d.divisi}</strong>
                  {!disabled && (
                    <>
                      <button
                        type="button"
                        className="btn btnGhost btnSm"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={`Naikkan ${d.divisi}`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btnGhost btnSm"
                        disabled={i === draft.dispatch.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Turunkan ${d.divisi}`}
                      >
                        ↓
                      </button>
                    </>
                  )}
                </div>
                <label className="field">
                  <span className="muted" style={{ fontSize: 12 }}>
                    I-4 · Catatan khusus untuk divisi ini (opsional) — hal yang mudah salah
                    dipahami
                  </span>
                  <input
                    value={d.catatan}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        dispatch: draft.dispatch.map((x, xi) =>
                          xi === i ? { ...x, catatan: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>I-3 · Metrik untuk laporan klien bulanan</label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Metrik yang Strategi ini janjikan ke laporan bulanan. Minimal satu. Daftar ini adalah
          yang CDPS bisa suplai hari ini — laporan bulanannya sendiri dibuat terpisah dan bisa
          memuat lebih banyak.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {METRIC_LABELS.map((m) => (
            <label key={m.value} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={draft.metrik_laporan_klien.includes(m.value)}
                disabled={disabled}
                onChange={() => toggleMetrik(m.value)}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">I-1 · Ringkasan turunan ke Plan</div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Dihasilkan otomatis dari Section E &amp; F saat Strategi disetujui — tidak diketik di
          sini, dan tidak disimpan sebagai kolom.
        </p>
      </div>
    </div>
  );
}
