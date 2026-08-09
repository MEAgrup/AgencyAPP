'use client';

/**
 * A-13b — Section F (Komitmen Resource, soft reference — Rule 10).
 *
 * Section F records what MEA commits to providing. It is a *soft* reference:
 * exceeding it raises a `Lewat Komitmen` warning on the Brief requiring a
 * reason, but it never blocks dispatch (Rule 10).
 *
 * F-5 (divisi & beban tim) is §4.1 HARD-INTERNAL and must never appear on a
 * client-facing export.
 *
 * Saved via `saveStrategiResources` which replaces the full resources list.
 *
 * ## How the form's numbers map onto `strategi_resource`
 *
 * The table has no jsonb column — every commitment has to land in a real column
 * (`nilai`, `jumlah`, `satuan`, …). F-2 and F-3 each carry three numbers per
 * channel, so they become **one row per metric**, told apart by `satuan`:
 *
 * | jenis | channel | nilai | jumlah | satuan | lain |
 * |---|---|---|---|---|---|
 * | `budget_iklan` | ✓ | budget/bulan | — | — | `sumber_dana` |
 * | `konten` | ✓ | — | kuota/bulan | `video` \| `foto` \| `desain` | — |
 * | `kol` | ✓ | nilai sampel (baris `kreator`) | jumlah | `kreator` \| `video_per_kreator` | — |
 * | `live_vendor` | ✓ | tarif | jam/bulan | `jam` | `skema_biaya`, `catatan` = nama vendor |
 * | `divisi` | — | — | estimasi beban | `jam` \| `slot` | `divisi`, `catatan` = role |
 * | `tools` | — | — | — | — | `catatan` = nama tool |
 *
 * A row whose numbers are all blank is dropped rather than written as a row of
 * nulls: `saveResources` replaces the whole list, so a blank row would come
 * back on the next load as a phantom commitment the AM never made.
 *
 * F-7 does NOT live here — it is `strategi.toleransi_over_persen`, saved by the
 * page through `updateStrategiHeader`. It is edited on this screen because it
 * is the tolerance *on these numbers*, not because it shares their storage.
 */

import RepeatList from './RepeatList';
import { DISPATCH_DIVISIONS, type StrategiDetail, type StrategiResource } from '@/lib/strategi';

// ---- Draft types ----------------------------------------------------------

export interface BudgetIklanDraft {
  channel: string;
  nilai: string;
  /** 'klien' | 'paket_mea' */
  sumber_dana: string;
}

export interface KuotaKontenDraft {
  channel: string;
  video: string;
  foto: string;
  desain: string;
}

export interface KuotaKolDraft {
  channel: string;
  jumlah_kreator: string;
  video_per_kreator: string;
  nilai_sampel: string;
}

export interface LiveVendorDraft {
  channel: string;
  jam_per_bulan: string;
  vendor_nama: string;
  /** Rp — the rate the `skema_biaya` below is measured in. */
  tarif: string;
  /** 'per_jam' | 'per_sesi' | 'bagi_hasil' | 'retainer' */
  skema_biaya: string;
}

export interface DivisiBebanDraft {
  divisi: string;
  /** Estimasi beban — a number, kept as text so an empty box stays empty. */
  beban: string;
  /** 'jam' | 'slot' — what `beban` counts. */
  satuan: string;
  /** Role yang dialokasikan (F-5 asks for divisi *and* role). */
  catatan: string;
}

export interface SectionFDraft {
  budget_iklan: BudgetIklanDraft[];
  kuota_konten: KuotaKontenDraft[];
  kuota_kol: KuotaKolDraft[];
  live_vendor: LiveVendorDraft[];
  divisi_beban: DivisiBebanDraft[];
  tools: string[];
  toleransi_over_persen: string;
}

// ---- Draft constructor ---------------------------------------------------

/** `null`/`undefined` → empty box. `String(null)` would print the word "null". */
function txt(v: string | number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Regroups the per-metric rows of one `jenis` back into one draft row per
 * channel. Channel order follows first appearance, so a reload does not
 * reshuffle the list under the AM's cursor.
 */
function byChannel(rows: StrategiResource[]): Map<string, StrategiResource[]> {
  const out = new Map<string, StrategiResource[]>();
  for (const r of rows) {
    const key = r.channel ?? '';
    const bucket = out.get(key);
    if (bucket) bucket.push(r);
    else out.set(key, [r]);
  }
  return out;
}

export function sectionFDraftOf(d: StrategiDetail): SectionFDraft {
  const byJenis = (jenis: string) => d.resources.filter((r: StrategiResource) => r.jenis === jenis);
  const pick = (rows: StrategiResource[], satuan: string) => rows.find((r) => r.satuan === satuan);

  const kuota_konten: KuotaKontenDraft[] = [];
  for (const [channel, rows] of byChannel(byJenis('konten'))) {
    kuota_konten.push({
      channel,
      video: txt(pick(rows, 'video')?.jumlah),
      foto: txt(pick(rows, 'foto')?.jumlah),
      desain: txt(pick(rows, 'desain')?.jumlah),
    });
  }

  const kuota_kol: KuotaKolDraft[] = [];
  for (const [channel, rows] of byChannel(byJenis('kol'))) {
    const kreator = pick(rows, 'kreator');
    kuota_kol.push({
      channel,
      jumlah_kreator: txt(kreator?.jumlah),
      video_per_kreator: txt(pick(rows, 'video_per_kreator')?.jumlah),
      nilai_sampel: txt(kreator?.nilai),
    });
  }

  return {
    budget_iklan: byJenis('budget_iklan').map((r) => ({
      channel: r.channel ?? '',
      nilai: txt(r.nilai),
      sumber_dana: r.sumber_dana ?? '',
    })),
    kuota_konten,
    kuota_kol,
    live_vendor: byJenis('live_vendor').map((r) => ({
      channel: r.channel ?? '',
      jam_per_bulan: txt(r.jumlah),
      vendor_nama: r.catatan,
      tarif: txt(r.nilai),
      skema_biaya: r.skema_biaya ?? '',
    })),
    divisi_beban: byJenis('divisi').map((r) => ({
      divisi: r.divisi ?? '',
      beban: txt(r.jumlah),
      satuan: r.satuan ?? 'jam',
      catatan: r.catatan,
    })),
    tools: byJenis('tools').map((r) => r.catatan),
    toleransi_over_persen:
      d.toleransi_over_persen !== null ? String(d.toleransi_over_persen) : '20',
  };
}

// ---- Helpers for converting draft → resource rows for the API ------------
// (called from page.tsx saveActive, so the page does not need to know the shape)

export function sectionFToResources(draft: SectionFDraft): unknown[] {
  const rows: unknown[] = [];

  // One row per metric — see the table in the module note. `kuota` is emitted
  // only when the AM typed something: a blank box means "not committed", which
  // is a different statement from "committed to zero".
  const kuota = (jenis: string, channel: string, satuan: string, jumlah: string, nilai?: string) => {
    if (!jumlah.trim() && !(nilai ?? '').trim()) return;
    rows.push({
      jenis,
      channel: channel || null,
      jumlah: jumlah.trim() ? Number(jumlah) : null,
      satuan,
      nilai: (nilai ?? '').trim() || null,
    });
  };

  for (const r of draft.budget_iklan) {
    // F-1 is the one commitment the server refuses half of: `ck_strres_budget_sumber`
    // requires nilai AND sumber_dana together, so a partial row is dropped here
    // rather than sent to be rejected as `[data tidak lengkap …]`.
    if (!r.nilai.trim() || !r.sumber_dana) continue;
    rows.push({
      jenis: 'budget_iklan',
      channel: r.channel || null,
      nilai: r.nilai.trim(),
      sumber_dana: r.sumber_dana,
    });
  }
  for (const r of draft.kuota_konten) {
    kuota('konten', r.channel, 'video', r.video);
    kuota('konten', r.channel, 'foto', r.foto);
    kuota('konten', r.channel, 'desain', r.desain);
  }
  for (const r of draft.kuota_kol) {
    kuota('kol', r.channel, 'kreator', r.jumlah_kreator, r.nilai_sampel);
    kuota('kol', r.channel, 'video_per_kreator', r.video_per_kreator);
  }
  for (const r of draft.live_vendor) {
    if (!r.jam_per_bulan.trim() && !r.vendor_nama.trim()) continue;
    rows.push({
      jenis: 'live_vendor',
      channel: r.channel || null,
      jumlah: r.jam_per_bulan.trim() ? Number(r.jam_per_bulan) : null,
      satuan: 'jam',
      nilai: r.tarif.trim() || null,
      catatan: r.vendor_nama,
      skema_biaya: r.skema_biaya || null,
    });
  }
  for (const r of draft.divisi_beban) {
    // `ck_strres_divisi` refuses a blank divisi outright.
    if (!r.divisi) continue;
    rows.push({
      jenis: 'divisi',
      divisi: r.divisi,
      jumlah: r.beban.trim() ? Number(r.beban) : null,
      satuan: r.satuan || 'jam',
      catatan: r.catatan,
    });
  }
  for (const tool of draft.tools) {
    if (!tool.trim()) continue;
    rows.push({ jenis: 'tools', catatan: tool.trim() });
  }
  return rows;
}

// ---- Component ------------------------------------------------------------

const SUMBER_DANA_OPTIONS = [
  { value: 'klien', label: 'Dana klien' },
  { value: 'paket_mea', label: 'Paket MEA' },
];

const SKEMA_BIAYA_OPTIONS = [
  { value: 'per_jam', label: 'Per jam' },
  { value: 'per_sesi', label: 'Per sesi' },
  { value: 'bagi_hasil', label: 'Bagi hasil' },
  { value: 'retainer', label: 'Retainer' },
];

export default function SectionF({
  detail,
  draft,
  onChange,
  disabled,
}: {
  detail: StrategiDetail;
  draft: SectionFDraft;
  onChange: (patch: Partial<SectionFDraft>) => void;
  disabled: boolean;
}) {
  const contractChannels = detail.channels.map((c) => c.channel);

  return (
    <div className="stack">
      {/* F-1 --------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">F-1 · Budget Iklan per Channel</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Budget per bulan per channel (Rp) dan sumber dananya.
        </p>
        <RepeatList<BudgetIklanDraft>
          label=""
          rows={draft.budget_iklan}
          onChange={(rows) => onChange({ budget_iklan: rows })}
          blank={() => ({ channel: contractChannels[0] ?? '', nilai: '', sumber_dana: 'klien' })}
          disabled={disabled}
          addLabel="Tambah budget channel"
          empty="Belum ada budget iklan."
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
                  {contractChannels.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Budget/bulan (Rp)</span>
                <input
                  type="number"
                  min={0}
                  value={row.nilai}
                  disabled={disabled}
                  onChange={(e) => set({ nilai: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Sumber dana</span>
                <select
                  value={row.sumber_dana}
                  disabled={disabled}
                  onChange={(e) => set({ sumber_dana: e.target.value })}
                >
                  {SUMBER_DANA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </RepeatList>
      </div>

      {/* F-2 --------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">F-2 · Kuota Konten per Channel</div>
        <RepeatList<KuotaKontenDraft>
          label=""
          rows={draft.kuota_konten}
          onChange={(rows) => onChange({ kuota_konten: rows })}
          blank={() => ({
            channel: contractChannels[0] ?? '',
            video: '',
            foto: '',
            desain: '',
          })}
          disabled={disabled}
          addLabel="Tambah kuota konten"
          empty="Belum ada kuota konten."
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
                  {contractChannels.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Video/bulan</span>
                <input type="number" min={0} value={row.video} disabled={disabled}
                  onChange={(e) => set({ video: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Foto/bulan</span>
                <input type="number" min={0} value={row.foto} disabled={disabled}
                  onChange={(e) => set({ foto: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Desain grafis/bulan</span>
                <input type="number" min={0} value={row.desain} disabled={disabled}
                  onChange={(e) => set({ desain: e.target.value })} />
              </label>
            </div>
          )}
        </RepeatList>
      </div>

      {/* F-3 --------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">F-3 · Kuota KOL</div>
        <RepeatList<KuotaKolDraft>
          label=""
          rows={draft.kuota_kol}
          onChange={(rows) => onChange({ kuota_kol: rows })}
          blank={() => ({ channel: contractChannels[0] ?? '', jumlah_kreator: '', video_per_kreator: '', nilai_sampel: '' })}
          disabled={disabled}
          addLabel="Tambah kuota KOL"
          empty="Belum ada kuota KOL."
        >
          {(row, set) => (
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Channel</span>
                <select value={row.channel} disabled={disabled}
                  onChange={(e) => set({ channel: e.target.value })}>
                  <option value="">— pilih —</option>
                  {contractChannels.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Jumlah kreator</span>
                <input type="number" min={0} value={row.jumlah_kreator} disabled={disabled}
                  onChange={(e) => set({ jumlah_kreator: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Video/kreator</span>
                <input type="number" min={0} value={row.video_per_kreator} disabled={disabled}
                  onChange={(e) => set({ video_per_kreator: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Nilai sampel (Rp)</span>
                <input type="number" min={0} value={row.nilai_sampel} disabled={disabled}
                  onChange={(e) => set({ nilai_sampel: e.target.value })} />
              </label>
            </div>
          )}
        </RepeatList>
      </div>

      {/* F-4 --------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">F-4 · Jam Live Vendor</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Live Stream dijalankan vendor — tidak menarik kapasitas divisi internal (F-5).
        </p>
        <RepeatList<LiveVendorDraft>
          label=""
          rows={draft.live_vendor}
          onChange={(rows) => onChange({ live_vendor: rows })}
          blank={() => ({
            channel: contractChannels[0] ?? '',
            jam_per_bulan: '',
            vendor_nama: '',
            tarif: '',
            skema_biaya: 'per_jam',
          })}
          disabled={disabled}
          addLabel="Tambah slot live vendor"
          empty="Belum ada slot live vendor."
        >
          {(row, set) => (
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Channel</span>
                <select value={row.channel} disabled={disabled}
                  onChange={(e) => set({ channel: e.target.value })}>
                  <option value="">— pilih —</option>
                  {contractChannels.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Jam/bulan</span>
                <input type="number" min={0} value={row.jam_per_bulan} disabled={disabled}
                  onChange={(e) => set({ jam_per_bulan: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Nama vendor</span>
                <input value={row.vendor_nama} disabled={disabled}
                  onChange={(e) => set({ vendor_nama: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Skema biaya</span>
                <select value={row.skema_biaya} disabled={disabled}
                  onChange={(e) => set({ skema_biaya: e.target.value })}>
                  {SKEMA_BIAYA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Tarif (Rp)</span>
                <input type="number" min={0} value={row.tarif} disabled={disabled}
                  onChange={(e) => set({ tarif: e.target.value })} />
              </label>
            </div>
          )}
        </RepeatList>
      </div>

      {/* F-5 --------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">
          F-5 · Divisi &amp; Beban Tim <span className="badge badge-red">Hard-internal</span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Divisi yang dialokasikan. <strong>Tidak pernah dibagikan ke klien.</strong>
        </p>
        <RepeatList<DivisiBebanDraft>
          label=""
          rows={draft.divisi_beban}
          onChange={(rows) => onChange({ divisi_beban: rows })}
          blank={() => ({ divisi: '', beban: '', satuan: 'jam', catatan: '' })}
          disabled={disabled}
          addLabel="Tambah divisi"
          empty="Belum ada divisi yang dialokasikan."
        >
          {(row, set) => (
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Divisi</span>
                <select value={row.divisi} disabled={disabled}
                  onChange={(e) => set({ divisi: e.target.value })}>
                  <option value="">— pilih —</option>
                  {DISPATCH_DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Estimasi beban</span>
                <input type="number" min={0} value={row.beban} disabled={disabled}
                  onChange={(e) => set({ beban: e.target.value })} />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Satuan</span>
                <select value={row.satuan} disabled={disabled}
                  onChange={(e) => set({ satuan: e.target.value })}>
                  <option value="jam">Jam/bulan</option>
                  <option value="slot">Slot</option>
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Role yang dialokasikan</span>
                <input value={row.catatan} disabled={disabled}
                  onChange={(e) => set({ catatan: e.target.value })} />
              </label>
            </div>
          )}
        </RepeatList>
      </div>

      {/* F-6 --------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">F-6 · Tools yang Dipakai</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Opsional. Report engine, SKU screener, Sebari, Linkreator, dll.
        </p>
        {draft.tools.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Belum ada tools.</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {draft.tools.map((tool, i) => (
              // Index keys are safe here only because the row IS the value —
              // there is no per-row state for React to mismatch. Anywhere a row
              // is a struct, use RepeatList instead.
              <div key={i} className="row" style={{ gap: 6 }}>
                <input
                  value={tool}
                  disabled={disabled}
                  placeholder="Nama tool"
                  style={{ flex: 1 }}
                  onChange={(e) =>
                    onChange({ tools: draft.tools.map((t, x) => (x === i ? e.target.value : t)) })
                  }
                />
                {!disabled && (
                  <button
                    type="button"
                    className="btn btnGhost btnSm"
                    onClick={() => onChange({ tools: draft.tools.filter((_, x) => x !== i) })}
                  >
                    Hapus
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!disabled && (
          <button
            type="button"
            className="btn btnSecondary btnSm"
            style={{ marginTop: 8 }}
            onClick={() => onChange({ tools: [...draft.tools, ''] })}
          >
            Tambah tool
          </button>
        )}
      </div>

      {/* F-7 --------------------------------------------------------------- */}
      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>
          F-7 · Toleransi Over-komitmen <span className="badge badge-amber">Internal saja</span>
        </span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Persentase melebihi komitmen resource sebelum eskalasi ke SPV (default 20%).
        </span>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={draft.toleransi_over_persen}
          disabled={disabled}
          onChange={(e) => onChange({ toleransi_over_persen: e.target.value })}
          style={{ width: 100 }}
        />
        <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>%</span>
      </label>
    </div>
  );
}
