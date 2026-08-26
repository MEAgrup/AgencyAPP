'use client';

/**
 * A-13b — Section C (Diagnosa & Akar Masalah).
 *
 * §4 Rule 6: every diagnosa must state a non-empty free-text reason (C-2) for
 * the chosen bottleneck. ⟳ 2026-08-24 (DECISIONS): C-2 used to require ≥1
 * baseline field-ID citation from a closed set of 50+ IDs with no lookup UI —
 * dropped because it made AMs hunt for codes instead of writing useful
 * evidence. The API still rejects an empty C-2 on save.
 *
 * Saved atomically via `saveStrategiDiagnosa` (one request replaces all four
 * parts together), so leaving C-5/C-6/C-7 incomplete never blocks C-1/C-3/C-4
 * from being stored.
 */

import RepeatList from './RepeatList';
import {
  BOTTLENECK_KINDS,
  CHANNELS,
  type StrategiDetail,
  type StrategiDiagnosaPayload,
} from '@/lib/strategi';

// ---- Draft types ----------------------------------------------------------

export interface DiagnosaDraft {
  channel: string;
  bottleneck: string;
  /** Rule 6: free-text reason/evidence for the chosen bottleneck. Required, non-empty. */
  alasan: string;
  akar_masalah: string;
  gap_kompetitor: string;
}

export interface QuickWinDraft {
  aksi: string;
  channel: string;
  pic_divisi: string;
  dampak_diharapkan: string;
}

export interface RisikoStrukturalDraft {
  risiko: string;
}

export interface PrasyaratKlienDraft {
  item: string;
  pic_klien: string;
  deadline: string;
}

export interface DiagnosaDraftAll {
  diagnosa: DiagnosaDraft[];
  quick_wins: QuickWinDraft[];
  risiko_struktural: RisikoStrukturalDraft[];
  prasyarat_klien: PrasyaratKlienDraft[];
}

export function diagnosaDraftOf(d: StrategiDetail): DiagnosaDraftAll {
  return {
    diagnosa: d.diagnosa.map((r) => ({
      channel: r.channel,
      bottleneck: r.bottleneck,
      alasan: r.alasan,
      akar_masalah: r.akar_masalah ?? '',
      gap_kompetitor: r.gap_kompetitor ?? '',
    })),
    quick_wins: d.quick_wins.map((q) => ({
      aksi: q.aksi,
      channel: q.channel,
      pic_divisi: q.pic_divisi,
      dampak_diharapkan: q.dampak_diharapkan,
    })),
    risiko_struktural: d.risiko_struktural.map((r) => ({ risiko: r.risiko })),
    prasyarat_klien: d.prasyarat_klien.map((p) => ({
      item: p.item,
      pic_klien: p.pic_klien,
      deadline: p.deadline ?? '',
    })),
  };
}

// ---- API payload converter (used by page.tsx saveActive 'C') -----------------

export function diagnosaDraftToPayload(draft: DiagnosaDraftAll): StrategiDiagnosaPayload {
  return {
    diagnosa: draft.diagnosa
      .filter((d) => d.channel && d.bottleneck)
      .map((d) => ({
        channel: d.channel,
        bottleneck: d.bottleneck,
        alasan: d.alasan.trim(),
        akar_masalah: d.akar_masalah || null,
        gap_kompetitor: d.gap_kompetitor || null,
      })),
    // Same partial-save pattern as Section B baseline / Section D GMV cells
    // (page.tsx saveActive): `ck_strqw_isi` requires aksi/channel/pic_divisi/
    // dampak_diharapkan ALL non-empty, so a row missing any one of them (e.g.
    // a Cockpit-imported quick win with no `dampak_diharapkan` yet, or one the
    // AM is still typing) is left out of the save entirely instead of
    // reaching the DB half-filled — that CHECK violation is a raw Postgres
    // error, not a domain ValidationError, so it surfaces as an unmapped 500
    // ("internal server error") rather than a `[...]` message. The row waits;
    // the submit gate (`checkCompleteness`) still reports it missing.
    quick_wins: draft.quick_wins
      .filter((q) => q.aksi.trim() && q.channel.trim() && q.pic_divisi.trim() && q.dampak_diharapkan.trim())
      .map((q, i) => ({
        aksi: q.aksi,
        channel: q.channel,
        pic_divisi: q.pic_divisi,
        dampak_diharapkan: q.dampak_diharapkan,
        urutan: i + 1,
      })),
    risiko_struktural: draft.risiko_struktural
      .filter((r) => r.risiko.trim())
      .map((r, i) => ({ risiko: r.risiko, urutan: i + 1 })),
    // Same reasoning as quick_wins above: `ck_strpreq_isi` requires item AND
    // pic_klien both non-empty (e.g. a Cockpit-imported prasyarat has no
    // `pic_klien` yet — the tool has no client-PIC data to suggest).
    prasyarat_klien: draft.prasyarat_klien
      .filter((p) => p.item.trim() && p.pic_klien.trim())
      .map((p, i) => ({
        item: p.item,
        pic_klien: p.pic_klien,
        deadline: p.deadline || null,
        urutan: i + 1,
      })),
  };
}

// ---- Labels ---------------------------------------------------------------

const BOTTLENECK_LABELS: Record<string, string> = {
  trafik: 'Trafik',
  konversi: 'Konversi',
  aov: 'AOV',
  repeat_order: 'Repeat order',
  margin: 'Margin',
  operasional: 'Operasional',
  konten: 'Konten',
  harga: 'Harga',
  listing: 'Kualitas listing',
};

// ---- Component ------------------------------------------------------------

export default function SectionC({
  detail,
  draft,
  onChange,
  disabled,
}: {
  detail: StrategiDetail;
  draft: DiagnosaDraftAll;
  onChange: (patch: Partial<DiagnosaDraftAll>) => void;
  disabled: boolean;
}) {
  const contractChannels = detail.channels.map((c) => c.channel);

  // Ensure every contracted channel has a diagnosa row in the draft.
  // Missing ones are created when the AM opens Section C for the first time.
  const ensureChannels = (base: DiagnosaDraft[]) => {
    const existing = new Set(base.map((d) => d.channel));
    const added: DiagnosaDraft[] = contractChannels
      .filter((ch) => !existing.has(ch))
      .map((ch) => ({
        channel: ch,
        bottleneck: '',
        alasan: '',
        akar_masalah: '',
        gap_kompetitor: '',
      }));
    return added.length > 0 ? [...base, ...added] : base;
  };

  // Only run the normalization on first render so autosave does not fire on open.
  // We do it imperatively on change rather than in an effect.
  const diagnosaRows = ensureChannels(draft.diagnosa);

  const setDiagnosa = (channel: string, patch: Partial<DiagnosaDraft>) => {
    onChange({
      diagnosa: diagnosaRows.map((d) => (d.channel === channel ? { ...d, ...patch } : d)),
    });
  };

  return (
    <div className="stack">
      {/* C-1 / C-2 / C-3 / C-4 ------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">C-1 / C-3 / C-4 · Diagnosa per Channel</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Bottleneck utama, alasan/bukti, akar masalah, dan gap vs kompetitor.
        </p>
        {contractChannels.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada channel — isi Section B dulu.
          </p>
        )}
        <div className="stack" style={{ gap: 16 }}>
          {diagnosaRows.map((d) => (
            <div
              key={d.channel}
              style={{
                border: '1px solid var(--border, #e2e2e2)',
                borderRadius: 6,
                padding: 12,
              }}
            >
              <strong style={{ fontSize: 14 }}>{d.channel}</strong>
              <div className="formRow" style={{ marginTop: 8 }}>
                <label className="field">
                  <span className="muted" style={{ fontSize: 12 }}>Bottleneck utama (C-1)</span>
                  <select
                    value={d.bottleneck}
                    disabled={disabled}
                    onChange={(e) => setDiagnosa(d.channel, { bottleneck: e.target.value })}
                  >
                    <option value="">— pilih —</option>
                    {BOTTLENECK_KINDS.map((v) => (
                      <option key={v} value={v}>{BOTTLENECK_LABELS[v] ?? v}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field" style={{ display: 'block', marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Alasan/bukti bottleneck ini dipilih (C-2)
                </span>
                <textarea
                  rows={2}
                  value={d.alasan}
                  disabled={disabled}
                  placeholder="Mis. CvR jauh di bawah benchmark platform, AOV turun sejak bundling hilang"
                  onChange={(e) => setDiagnosa(d.channel, { alasan: e.target.value })}
                />
              </label>
              <label className="field" style={{ display: 'block', marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Akar masalah — kenapa bottleneck terjadi (C-3)</span>
                <textarea
                  rows={2}
                  value={d.akar_masalah}
                  disabled={disabled}
                  onChange={(e) => setDiagnosa(d.channel, { akar_masalah: e.target.value })}
                />
              </label>
              <label className="field" style={{ display: 'block', marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Gap vs kompetitor yang paling menentukan (C-4)</span>
                <textarea
                  rows={2}
                  value={d.gap_kompetitor}
                  disabled={disabled}
                  onChange={(e) => setDiagnosa(d.channel, { gap_kompetitor: e.target.value })}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* C-5 --------------------------------------------------------------- */}
      <RepeatList<QuickWinDraft>
        label="C-5 · Quick Win 14 Hari Pertama"
        hint="Perbaikan yang tidak butuh budget baru. Minimal 1."
        rows={draft.quick_wins}
        min={1}
        onChange={(rows) => onChange({ quick_wins: rows })}
        blank={() => ({ aksi: '', channel: '', pic_divisi: '', dampak_diharapkan: '' })}
        disabled={disabled}
        addLabel="Tambah quick win"
        empty="Belum ada quick win."
      >
        {(row, set) => (
          <>
            <input
              placeholder="Aksi yang dilakukan"
              value={row.aksi}
              disabled={disabled}
              onChange={(e) => set({ aksi: e.target.value })}
            />
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Channel</span>
                <select
                  value={row.channel}
                  disabled={disabled}
                  onChange={(e) => set({ channel: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>PIC Divisi</span>
                <input
                  value={row.pic_divisi}
                  disabled={disabled}
                  onChange={(e) => set({ pic_divisi: e.target.value })}
                />
              </label>
            </div>
            <input
              placeholder="Dampak yang diharapkan"
              value={row.dampak_diharapkan}
              disabled={disabled}
              onChange={(e) => set({ dampak_diharapkan: e.target.value })}
            />
          </>
        )}
      </RepeatList>

      {/* C-6 --------------------------------------------------------------- */}
      <RepeatList<RisikoStrukturalDraft>
        label="C-6 · Risiko Struktural"
        hint="Risiko yang tidak bisa dihilangkan: margin tipis, stok terbatas, kategori jenuh, klien lambat approve."
        rows={draft.risiko_struktural}
        onChange={(rows) => onChange({ risiko_struktural: rows })}
        blank={() => ({ risiko: '' })}
        disabled={disabled}
        addLabel="Tambah risiko struktural"
        empty="Belum ada risiko struktural."
      >
        {(row, set) => (
          <input
            placeholder="Risiko struktural"
            value={row.risiko}
            disabled={disabled}
            onChange={(e) => set({ risiko: e.target.value })}
          />
        )}
      </RepeatList>

      {/* C-7 --------------------------------------------------------------- */}
      <RepeatList<PrasyaratKlienDraft>
        label="C-7 · Prasyarat dari Klien sebelum Eksekusi"
        hint="Apa yang harus dibereskan klien sebelum eksekusi jalan — bukan selama eksekusi (itu E-12)."
        rows={draft.prasyarat_klien}
        onChange={(rows) => onChange({ prasyarat_klien: rows })}
        blank={() => ({ item: '', pic_klien: '', deadline: '' })}
        disabled={disabled}
        addLabel="Tambah prasyarat"
        empty="Belum ada prasyarat."
      >
        {(row, set) => (
          <>
            <input
              placeholder="Item / hal yang harus dibereskan"
              value={row.item}
              disabled={disabled}
              onChange={(e) => set({ item: e.target.value })}
            />
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>PIC klien</span>
                <input
                  value={row.pic_klien}
                  disabled={disabled}
                  onChange={(e) => set({ pic_klien: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Deadline (opsional)</span>
                <input
                  type="date"
                  value={row.deadline}
                  disabled={disabled}
                  onChange={(e) => set({ deadline: e.target.value })}
                />
              </label>
            </div>
          </>
        )}
      </RepeatList>
    </div>
  );
}
