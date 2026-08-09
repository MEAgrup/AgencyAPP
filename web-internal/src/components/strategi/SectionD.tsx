'use client';

/**
 * A-13 + A-13c — Section D (Target & KPI), the editable half.
 *
 * A-13 landed what A-08 put on the header (D-5, D-6, the read side of D-3/D-7).
 * **A-13c added the two fields the submit gate could not be passed without:**
 * the D-1/D-2 matrix and the D-8/D-9 assumptions. Until it did, every Strategi
 * showed a permanent gap count and `Ajukan` was always answered
 * `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` — the form
 * had nine of ten sections and still no way through.
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
 *
 * ## Rule 7 is not re-implemented here, and that is deliberate
 *
 * `stretch >= floor` is `ck_strtg_stretch_gmv` in Postgres. This form does not
 * block the keystroke and does not grey out the save: a stretch under the floor
 * is a disagreement about the contract, and the answer the PRD gives it is D-7
 * Sanggahan Target (Rule 19) — evidence filed with SPV, not a softer client-side
 * rule. What the form does do is SHOW the shortfall next to the cell, so the AM
 * meets it here rather than as a rejected save.
 *
 * ## Two server rules are mirrored here, and that is deliberate
 *
 * D-4 (X-15, pemilik 2026-08-09) and Rule 8 both report per channel / per target
 * and would otherwise reach the AM as one opaque line each. The mirrors live in
 * `lib/strategi-target.ts` with tests pinning them to the server's own
 * computation — the only place in this form where a second copy of a server rule
 * earns its keep, because the alternative is a gap the AM cannot locate.
 *
 * ## Rule 8 is mirrored here, and that is also deliberate
 *
 * "Every target carries an assumption" is checked by `checkCompleteness` at
 * submit and would otherwise reach the AM as a single `Rule 8` line with no way
 * to tell WHICH month is bare. The mirror lives in `lib/strategi-target.ts` with
 * tests pinning it to the server's computation — the one place in this form where
 * a second copy of a server rule earns its keep, because the alternative is a gap
 * the AM cannot locate.
 */

import { useMemo } from 'react';
import RepeatList from './RepeatList';
import { LEADING_INDICATOR_MAX, METRIC_LABELS } from '@/lib/strategi';
import type { LeadingIndicator, StrategiDetail } from '@/lib/strategi';
import {
  channelsMissingSupport,
  gmvGridOf,
  gmvCellsToBody,
  offerableTargetKeys,
  readTargetKey,
  supportRowsOf,
  uncoveredTargetKeys,
  type AssumptionRow,
  type GmvCell,
  type SupportTargetRow,
} from '@/lib/strategi-target';
import { formatIDR } from '@/lib/money';

export interface KpiDraft {
  definisi_berhasil_30: string;
  definisi_berhasil_60: string;
  definisi_berhasil_90: string;
  leading_indicator: LeadingIndicator[];
}

/**
 * The three parts of Section D that live in `strategi_target` /
 * `strategi_assumption` rather than on the header.
 *
 * Held as ONE draft because they are saved by one click and validated against
 * each other: D-9 may only reference targets that D-2 defines, so splitting them
 * into two page-level drafts would let the two halves get out of step between
 * autosaves.
 */
export interface TargetDraft {
  /** D-1 floor + D-2 stretch, one cell per channel per contract month. */
  gmv: GmvCell[];
  /** D-4 supporting metrics — sparse, one row per metric the AM chose. */
  pendukung: SupportTargetRow[];
  /** D-8 assumptions, each carrying its D-9 mapping. */
  assumptions: AssumptionRow[];
}

export function kpiDraftOf(d: StrategiDetail): KpiDraft {
  return {
    definisi_berhasil_30: d.definisi_berhasil_30 ?? '',
    definisi_berhasil_60: d.definisi_berhasil_60 ?? '',
    definisi_berhasil_90: d.definisi_berhasil_90 ?? '',
    leading_indicator: d.leading_indicator,
  };
}

export function targetDraftOf(d: StrategiDetail): TargetDraft {
  return {
    gmv: gmvGridOf(d.channels, d.durasi_kontrak_bulan, d.targets),
    pendukung: supportRowsOf(d.targets),
    assumptions: d.assumptions.map((a) => ({
      kode: a.kode,
      asumsi: a.asumsi,
      pemilik: a.pemilik,
      cara_verifikasi: a.cara_verifikasi,
      target_terkait: a.target_terkait,
    })),
  };
}

/** `gmv:Shopee:3` → `Shopee · M3`, for the D-9 checkboxes and the Rule 8 list. */
function targetLabel(key: string): string {
  const parsed = readTargetKey(key);
  return parsed === null ? key : `${parsed.channel} · M${parsed.month}`;
}

export default function SectionD({
  detail,
  draft,
  targets,
  onChange,
  onTargets,
  disabled,
}: {
  detail: StrategiDetail;
  draft: KpiDraft;
  targets: TargetDraft;
  onChange: (patch: Partial<KpiDraft>) => void;
  onTargets: (patch: Partial<TargetDraft>) => void;
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

  const months = Math.max(0, Math.trunc(detail.durasi_kontrak_bulan || 0));

  // Recomputed from the draft on every keystroke, never from `detail`: the AM
  // types the matrix and the assumptions in the same section and the same save,
  // so a picker fed by saved rows would be empty on a fresh Strategi.
  const offerable = useMemo(() => offerableTargetKeys(targets.gmv), [targets.gmv]);
  const uncovered = useMemo(
    () => uncoveredTargetKeys(targets.gmv, targets.assumptions),
    [targets.gmv, targets.assumptions],
  );
  const incomplete = useMemo(() => gmvCellsToBody(targets.gmv).incomplete, [targets.gmv]);
  const kurangPendukung = useMemo(
    () => channelsMissingSupport(detail.channels, targets.pendukung),
    [detail.channels, targets.pendukung],
  );

  const setCell = (channel: string, month: number, patch: Partial<GmvCell>) => {
    onTargets({
      gmv: targets.gmv.map((c) =>
        c.channel === channel && c.month_index === month ? { ...c, ...patch } : c,
      ),
    });
  };

  /**
   * Copies M1 down the rest of the channel's column.
   *
   * Not a shortcut for its own sake: X-04 anchors each channel's target to that
   * channel's own baseline, so a flat monthly figure is the ordinary starting
   * point and a twelve-month contract is otherwise twenty-four boxes of the same
   * two numbers. It fills the draft, it does not save — every month stays
   * individually editable afterwards.
   */
  const fillDown = (channel: string) => {
    const first = targets.gmv.find((c) => c.channel === channel && c.month_index === 1);
    if (!first) return;
    onTargets({
      gmv: targets.gmv.map((c) =>
        c.channel === channel && c.month_index > 1
          ? { ...c, nilai_floor: first.nilai_floor, nilai_stretch: first.nilai_stretch }
          : c,
      ),
    });
  };

  const toggleTerkait = (index: number, key: string) => {
    onTargets({
      assumptions: targets.assumptions.map((a, i) => {
        if (i !== index) return a;
        const has = a.target_terkait.includes(key);
        return {
          ...a,
          target_terkait: has
            ? a.target_terkait.filter((k) => k !== key)
            : [...a.target_terkait, key],
        };
      }),
    });
  };

  return (
    <div className="stack">
      {/* D-1 + D-2 --------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">D-1 · Floor kontrak &amp; D-2 · Stretch target GMV</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Per channel, per bulan kontrak (M1…M{months}). Stretch wajib{' '}
          <strong>≥</strong> floor — itu ditegakkan database, dan kalau menurut Anda floor-nya
          tidak realistis jalurnya adalah D-7 Sanggahan Target di bawah, bukan menurunkan angkanya.
        </p>

        {detail.channels.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada channel di Section B — target GMV mengikuti channel kontrak.
          </p>
        ) : months === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Durasi kontrak belum diisi, jadi belum ada bulan untuk ditargetkan.
          </p>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            {detail.channels.map((ch) => (
              <div key={ch.id}>
                <div className="row" style={{ alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{ch.channel}</strong>
                  <span style={{ flex: 1 }} />
                  {!disabled && months > 1 && (
                    <button
                      type="button"
                      className="btn btnGhost btnSm"
                      onClick={() => fillDown(ch.channel)}
                      title="Salin angka M1 ke seluruh bulan berikutnya"
                    >
                      Samakan semua bulan dengan M1
                    </button>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Bulan</th>
                        <th style={{ textAlign: 'left' }}>Floor kontrak (D-1)</th>
                        <th style={{ textAlign: 'left' }}>Stretch GMV (D-2)</th>
                        <th style={{ textAlign: 'left' }}>Selisih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.gmv
                        .filter((c) => c.channel === ch.channel)
                        .map((c) => {
                          const f = c.nilai_floor.trim();
                          const s = c.nilai_stretch.trim();
                          const kurang =
                            f !== '' && s !== '' && Number(s) < Number(f);
                          const setengah = (f === '') !== (s === '');
                          return (
                            <tr key={c.month_index}>
                              <td style={{ whiteSpace: 'nowrap' }}>M{c.month_index}</td>
                              <td>
                                <input
                                  placeholder="Rp."
                                  value={c.nilai_floor}
                                  disabled={disabled}
                                  aria-label={`Floor ${ch.channel} bulan ${c.month_index}`}
                                  onChange={(e) =>
                                    setCell(ch.channel, c.month_index, {
                                      nilai_floor: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  placeholder="Rp."
                                  value={c.nilai_stretch}
                                  disabled={disabled}
                                  aria-label={`Stretch ${ch.channel} bulan ${c.month_index}`}
                                  onChange={(e) =>
                                    setCell(ch.channel, c.month_index, {
                                      nilai_stretch: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td style={{ fontSize: 12 }}>
                                {setengah ? (
                                  <span className="badge badge-amber">
                                    isi keduanya untuk tersimpan
                                  </span>
                                ) : kurang ? (
                                  <span className="badge badge-amber">
                                    stretch di bawah floor — akan ditolak
                                  </span>
                                ) : f !== '' && s !== '' ? (
                                  <span className="muted">
                                    +{formatIDR(Number(s) - Number(f))}
                                  </span>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* A cell with one figure typed cannot be stored — `nilai_stretch` is NOT
            NULL and `ck_strtg_stretch_gmv` demands a floor beside it. It is
            skipped rather than sent (an autosave that fails every 20s would take
            the complete cells down with it), so the AM has to be TOLD, or the
            number quietly disappears on the next load. */}
        {incomplete.length > 0 && (
          <div className="alert alertInfo" style={{ fontSize: 12, marginTop: 8 }}>
            {incomplete.length} sel baru terisi separuh dan <strong>tidak ikut tersimpan</strong> —
            floor dan stretch harus terisi keduanya:{' '}
            {incomplete.map((c) => `${c.channel} M${c.month_index}`).join(', ')}.
          </div>
        )}
      </div>

      {/* D-4 --------------------------------------------------------------- */}
      {/* Gated since X-15 (pemilik, 2026-08-09) at MINIMAL SATU baris per
          channel — bukan matriks penuh. Ditampilkan per channel karena itulah
          bentuk kode servernya (`D-4/{channel}`); `min` pada RepeatList hanya
          bisa menghitung seluruh daftar dan akan menghijau saat satu channel
          punya dua baris sementara channel lain punya nol. */}
      {kurangPendukung.length > 0 && (
        <div className="alert alertInfo" style={{ fontSize: 12 }}>
          <strong>D-4</strong> — {kurangPendukung.length} channel belum punya satu pun target
          metrik pendukung: {kurangPendukung.join(', ')}. Cukup satu baris per channel; itu yang
          membuat &ldquo;GMV meleset&rdquo; nanti bisa ditelusuri ke angka, bukan ke opini.
        </div>
      )}
      <RepeatList<SupportTargetRow>
        label="D-4 · Target metrik pendukung"
        hint="Minimal satu per channel (wajib). Pilih metrik yang paling menentukan untuk klien ini — pengunjung, CR, AOV, ROAS minimum, ACOS maksimum, SKU winner baru, affiliate aktif, jam live, jumlah video. Angka saja; floor hanya berlaku untuk GMV."
        rows={targets.pendukung}
        onChange={(rows) => onTargets({ pendukung: rows })}
        blank={() => ({
          channel: detail.channels[0]?.channel ?? '',
          month_index: 1,
          metric: 'pengunjung',
          nilai_stretch: '',
        })}
        disabled={disabled}
        addLabel="Tambah target pendukung"
        empty="Belum ada target metrik pendukung."
      >
        {(row, set) => (
          <div className="formRow">
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Channel</span>
              <select
                value={row.channel}
                disabled={disabled}
                onChange={(e) => set({ channel: e.target.value })}
              >
                <option value="">— pilih —</option>
                {/* Only contracted channels: `strategi_target` has no FK to
                    `strategi_channel`, so a typo'd channel here would store a
                    target for a channel nobody delivers and never be gated. */}
                {detail.channels.map((c) => (
                  <option key={c.id} value={c.channel}>
                    {c.channel}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Bulan</span>
              <select
                value={row.month_index}
                disabled={disabled}
                onChange={(e) => set({ month_index: Number(e.target.value) })}
              >
                {Array.from({ length: Math.max(1, months) }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    M{m}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Metrik</span>
              <select
                value={row.metric}
                disabled={disabled}
                onChange={(e) => set({ metric: e.target.value })}
              >
                {/* GMV is absent on purpose: it is the D-2 matrix above, and the
                    two share a primary key (`strategi_id, channel, month_index,
                    metric`). Offering it here would let one row silently
                    overwrite the other on save. */}
                {METRIC_LABELS.filter((m) => m.value !== 'gmv').map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Target</span>
              <input
                value={row.nilai_stretch}
                disabled={disabled}
                onChange={(e) => set({ nilai_stretch: e.target.value })}
              />
            </label>
          </div>
        )}
      </RepeatList>

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

      {/* D-8 + D-9 --------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">
          D-8 · Asumsi di balik target{' '}
          <span className="badge badge-green">boleh dibagikan ke klien</span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Hal yang harus benar supaya target tercapai — budget iklan cair tiap tanggal 1, stok hero
          SKU aman, klien approve konten ≤48 jam. §6 sengaja menandainya shareable: menunjukkannya
          saat kickoff mengubah &ldquo;kenapa target tidak kejar&rdquo; dari perdebatan jadi
          checklist yang kedua pihak sudah setujui.
        </p>

        {/* Rule 8 — the reason this panel exists rather than a bare "min 3"
            counter. `checkCompleteness` reports one line, `Rule 8`, for any
            number of bare targets; without this the AM cannot tell which month
            it means, and D-9 is where they fix it. */}
        {uncovered.length > 0 ? (
          <div className="alert alertInfo" style={{ fontSize: 12 }}>
            <strong>Rule 8</strong> — {uncovered.length} target GMV belum ditutup asumsi mana pun.
            Centang target ini di salah satu asumsi di bawah:{' '}
            {uncovered.map(targetLabel).join(', ')}.
          </div>
        ) : offerable.length > 0 ? (
          <div className="alert alertInfo" style={{ fontSize: 12 }}>
            <strong>Rule 8</strong> — semua {offerable.length} target GMV sudah tertutup asumsi.
          </div>
        ) : null}

        <RepeatList<AssumptionRow>
          label="Daftar asumsi"
          hint="Minimal 3 (§4). Tiap asumsi butuh pemilik dan cara verifikasi — asumsi tanpa cara verifikasi tidak bisa dinyatakan gugur, dan asumsi yang gugur adalah yang nanti membenarkan revisi (Rule 13)."
          rows={targets.assumptions}
          min={3}
          onChange={(rows) => onTargets({ assumptions: rows })}
          blank={() => ({
            kode: `AS-${targets.assumptions.length + 1}`,
            asumsi: '',
            pemilik: '',
            cara_verifikasi: '',
            target_terkait: [],
          })}
          disabled={disabled}
          addLabel="Tambah asumsi"
          empty="Belum ada asumsi — minimal 3 wajib sebelum bisa diajukan."
        >
          {(row, set, index) => (
            <>
              <div className="formRow">
                <label className="field" style={{ maxWidth: 120 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Kode</span>
                  <input
                    value={row.kode}
                    disabled={disabled}
                    onChange={(e) => set({ kode: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="muted" style={{ fontSize: 12 }}>Pemilik</span>
                  <input
                    placeholder="Siapa yang bertanggung jawab asumsi ini benar"
                    value={row.pemilik}
                    disabled={disabled}
                    onChange={(e) => set({ pemilik: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="muted" style={{ fontSize: 12 }}>Cara verifikasi</span>
                  <input
                    placeholder="Bagaimana kita tahu ini masih benar"
                    value={row.cara_verifikasi}
                    disabled={disabled}
                    onChange={(e) => set({ cara_verifikasi: e.target.value })}
                  />
                </label>
              </div>
              <label className="field" style={{ display: 'block' }}>
                <span className="muted" style={{ fontSize: 12 }}>Asumsi</span>
                <textarea
                  rows={2}
                  placeholder="Apa yang harus benar supaya target ini tercapai"
                  value={row.asumsi}
                  disabled={disabled}
                  onChange={(e) => set({ asumsi: e.target.value })}
                />
              </label>

              {/* D-9 — the mapping. Offered from the DRAFT matrix above, so it
                  works before the first save; the page prunes anything that no
                  longer exists at save time, because one dangling reference
                  makes the server refuse the whole call. */}
              <div className="field" style={{ display: 'block' }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  D-9 · Target yang ditinjau kalau asumsi ini gugur
                </span>
                {offerable.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                    Belum ada target GMV yang lengkap di D-2 untuk ditunjuk.
                  </p>
                ) : (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                    {offerable.map((k) => (
                      <label
                        key={k}
                        style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12 }}
                      >
                        <input
                          type="checkbox"
                          checked={row.target_terkait.includes(k)}
                          disabled={disabled}
                          onChange={() => toggleTerkait(index, k)}
                        />
                        <span>{targetLabel(k)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </RepeatList>

        {/* The `Gugur` flip is NOT here. It is reachable while the Strategi is
            `Aktif` — the one Section D write that is not Draft-only, because an
            assumption breaks during execution, not while drafting. Putting the
            control on this form would make it unreachable at the only moment it
            means anything. */}
      </div>
    </div>
  );
}
