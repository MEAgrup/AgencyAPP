'use client';

/**
 * A-13 — Section H (Risiko & Trigger Revisi): H-1, H-2, H-3, H-4.
 *
 * **H-2 is the list Rule 13 points at.** A revision may only cite a trigger this
 * Strategi declared here — the API refuses the rest with
 * `[trigger revisi ini tidak dideklarasikan di H-2 pada Strategi ini]`. So the
 * picker is a closed checkbox list, never free text: a typed trigger would look
 * accepted here and be refused at the one moment it is needed.
 *
 * **The threshold input appears only where §4 writes an "X".** Two of the seven
 * codes carry one; the API refuses a threshold on the other five AND refuses its
 * absence on these two (`ck_strtrg_ambang` is an equivalence, not an
 * implication). Rendering the box everywhere would offer five guaranteed
 * rejections.
 *
 * ⚠️ **H-4 is hard-internal (§4.1).** It is collected here and must never reach
 * a client-facing view. The `/s/{token}` renderer (A-11) is a separate
 * serialiser precisely so it cannot inherit this form's shape.
 *
 * **H-1 suggestions (⟳ 2026-08-26 DECISIONS) are a picklist, not an
 * autofill.** `getRiskSuggestions` only returns candidate rows keyed off the
 * Strategi's contracted channels (D1); nothing is added to `risks` until the
 * AM clicks one. Once added it is an ordinary draft row — PIC/mitigasi start
 * prefilled but stay fully editable, same as any row the AM typed by hand.
 */

import RepeatList from './RepeatList';
import type { NarasiDraft } from './SectionE';
import { RISK_LEVELS, TRIGGER_REVISI_LABELS } from '@/lib/strategi';
import type { RiskLevel, StrategiDetail } from '@/lib/strategi';
import { getRiskSuggestions } from '@/lib/strategi-risk-suggestions';

export interface RiskDraft {
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
}

export interface TriggerDraft {
  kode: string;
  /** Text, not number: an empty box must stay empty, and `Number('')` is 0. */
  ambang: string;
  catatan: string;
}

// NarasiDraft (re-exported for import convenience — the canonical definition is in SectionE).
export type { NarasiDraft };

export function riskDraftOf(d: StrategiDetail): RiskDraft[] {
  return d.risks.map((r) => ({
    risiko: r.risiko,
    dampak: r.dampak,
    kemungkinan: r.kemungkinan,
    mitigasi: r.mitigasi,
    pic: r.pic,
  }));
}

export function triggerDraftOf(d: StrategiDetail): TriggerDraft[] {
  return d.trigger_revisi.map((t) => ({
    kode: t.kode,
    ambang: t.ambang === null ? '' : String(t.ambang),
    catatan: t.catatan ?? '',
  }));
}

export default function SectionH({
  risks,
  triggers,
  narasi,
  channels,
  onRisks,
  onTriggers,
  onNarasi,
  disabled,
}: {
  risks: RiskDraft[];
  triggers: TriggerDraft[];
  narasi: NarasiDraft;
  /** D1 channel names (`ChannelDraft.channel`) — picks which channel suggestions apply. */
  channels: string[];
  onRisks: (rows: RiskDraft[]) => void;
  onTriggers: (rows: TriggerDraft[]) => void;
  onNarasi: (patch: Partial<NarasiDraft>) => void;
  disabled: boolean;
}) {
  const suggestions = getRiskSuggestions(channels, risks);

  const addSuggestion = (s: (typeof suggestions)[number]) => {
    onRisks([...risks, { risiko: s.risiko, dampak: s.dampak, kemungkinan: s.kemungkinan, mitigasi: s.mitigasi, pic: '' }]);
  };
  // `lainnya` may repeat (what distinguishes two of them is the note), so it is
  // never treated as already-picked. The other six are single-select.
  const picked = new Set(triggers.map((t) => t.kode).filter((k) => k !== 'lainnya'));

  const toggle = (kode: string) => {
    if (kode === 'lainnya') {
      onTriggers([...triggers, { kode, ambang: '', catatan: '' }]);
      return;
    }
    onTriggers(
      picked.has(kode)
        ? triggers.filter((t) => t.kode !== kode)
        : [...triggers, { kode, ambang: '', catatan: '' }],
    );
  };

  const setTrigger = (index: number, patch: Partial<TriggerDraft>) => {
    onTriggers(triggers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  return (
    <div className="stack">
      {!disabled && suggestions.length > 0 && (
        <div className="field" style={{ display: 'block' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Saran risiko dari channel yang dikontrak dan pola revisi umum — klik untuk
            menambah, lalu sesuaikan mitigasi/PIC-nya. Bukan wajib dipakai.
          </span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {suggestions.map((s) => (
              <button
                key={s.risiko}
                type="button"
                className="btn btnGhost btnSm"
                onClick={() => addSuggestion(s)}
              >
                + {s.risiko}
              </button>
            ))}
          </div>
        </div>
      )}

      <RepeatList<RiskDraft>
        label="H-1 · Risk register"
        hint="Risiko, dampak, kemungkinan, mitigasi, dan siapa PIC-nya. Minimal satu."
        rows={risks}
        min={1}
        onChange={onRisks}
        blank={() => ({ risiko: '', dampak: 'sedang', kemungkinan: 'sedang', mitigasi: '', pic: '' })}
        disabled={disabled}
        addLabel="Tambah risiko"
        empty="Belum ada risiko."
      >
        {(row, set) => (
          <>
            <input
              placeholder="Risiko"
              value={row.risiko}
              disabled={disabled}
              onChange={(e) => set({ risiko: e.target.value })}
            />
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Dampak</span>
                <select
                  value={row.dampak}
                  disabled={disabled}
                  onChange={(e) => set({ dampak: e.target.value as RiskLevel })}
                >
                  {RISK_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Kemungkinan</span>
                <select
                  value={row.kemungkinan}
                  disabled={disabled}
                  onChange={(e) => set({ kemungkinan: e.target.value as RiskLevel })}
                >
                  {RISK_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>PIC</span>
                <input
                  value={row.pic}
                  disabled={disabled}
                  onChange={(e) => set({ pic: e.target.value })}
                />
              </label>
            </div>
            <input
              placeholder="Mitigasi"
              value={row.mitigasi}
              disabled={disabled}
              onChange={(e) => set({ mitigasi: e.target.value })}
            />
          </>
        )}
      </RepeatList>

      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>H-2 · Trigger revisi untuk klien ini</label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Hanya trigger yang dipilih di sini yang bisa dipakai sebagai alasan revisi nanti.
          Minimal satu.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {/* Six single-select codes. `lainnya` is NOT one of them — it may be
              declared more than once, so a checkbox (which can only be on or
              off) cannot represent it. It gets its own add button below. */}
          {TRIGGER_REVISI_LABELS.filter((t) => t.value !== 'lainnya').map((t) => (
            <label key={t.value} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={picked.has(t.value)}
                disabled={disabled}
                onChange={() => toggle(t.value)}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
        {!disabled && (
          <button
            type="button"
            className="btn btnSecondary btnSm"
            style={{ marginTop: 8 }}
            onClick={() => toggle('lainnya')}
          >
            Tambah trigger &ldquo;lainnya&rdquo;
          </button>
        )}

        {triggers.length > 0 && (
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {triggers.map((t, i) => {
              const meta = TRIGGER_REVISI_LABELS.find((x) => x.value === t.kode);
              if (!meta) return null;
              const perluAmbang = meta.ambang !== undefined;
              const perluCatatan = t.kode === 'lainnya';
              if (!perluAmbang && !perluCatatan) return null;
              return (
                <div
                  key={`${t.kode}-${i}`}
                  style={{
                    border: '1px solid var(--border, #e2e2e2)',
                    borderRadius: 6,
                    padding: 10,
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>{meta.label}</strong>
                  {perluAmbang && (
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>
                        Ambang ({meta.ambang!.satuan})
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={meta.ambang!.maks}
                        value={t.ambang}
                        disabled={disabled}
                        onChange={(e) => setTrigger(i, { ambang: e.target.value })}
                      />
                    </label>
                  )}
                  {perluCatatan && (
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>
                        Penjelasan — kapan trigger ini terhitung menyala
                      </span>
                      <input
                        value={t.catatan}
                        disabled={disabled}
                        onChange={(e) => setTrigger(i, { catatan: e.target.value })}
                      />
                    </label>
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      className="btn btnGhost btnSm"
                      onClick={() => onTriggers(triggers.filter((_, x) => x !== i))}
                    >
                      Hapus trigger
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>H-3 · Skenario mundur</span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Apa yang dikerjakan kalau strategi utama gagal di fase 1.
        </span>
        <textarea
          rows={3}
          value={narasi.skenario_mundur}
          disabled={disabled}
          onChange={(e) => onNarasi({ skenario_mundur: e.target.value })}
        />
      </label>

      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>
          H-4 · Kondisi stop / ubah scope{' '}
          <span className="badge badge-amber">Internal saja</span>
        </span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Opsional. <strong>Tidak pernah dibagikan ke klien</strong> — jangan tulis apa pun di
          sini yang tidak boleh mereka baca kalau tautan klien bocor.
        </span>
        <textarea
          rows={3}
          value={narasi.kondisi_stop_scope}
          disabled={disabled}
          onChange={(e) => onNarasi({ kondisi_stop_scope: e.target.value })}
        />
      </label>
    </div>
  );
}
