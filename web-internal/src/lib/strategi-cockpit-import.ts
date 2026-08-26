// Adapter: MEA AM Cockpit (local HTML tool, `mea.cockpit.v1`) → Strategi Section C/D/E.
//
// ## Where this payload comes from
//
// The Cockpit tool ingests a CDPS STRG export (this page's own "Salin JSON" /
// "Unduh JSON" buttons — `buildExportJson` in page.tsx) plus optionally a
// Video Factory baseline payload, then computes a bottleneck diagnosis, a
// GMV/ACOS/ROAS bridge, and a pilar/aksi plan client-side. It offers TWO
// outputs: "Copy Draft STRG" (free text meant for a human to retype into this
// form by hand) and "Unduh JSON" (the tool's own state, `schema:
// 'mea.cockpit.v1'`). Only the second is a wire contract — the printed draft
// is deliberately not parsed here; its own header says so ("AM tetap
// memverifikasi tiap field sebelum diajukan; ini draft, bukan pengganti
// CDPS").
//
// ## The SARAN contract (same as strategi-video-factory.ts)
//
// Scalar fields are filled only when the destination field is empty, list
// fields are added only when the destination list is still empty (or, for
// D-4/D-8, only when the specific row does not already exist) — nothing here
// ever overwrites what the AM already typed. The one exception is Section E
// pilar: unlike B/C/D, the UI has no draft editor for E-3…E-10 yet ("tersedia
// di versi berikutnya" — see SectionE.tsx), so there is nothing to stage a
// draft in. `buildCockpitPillars` + `mergeCockpitPillars` produce a body ready
// for the existing `saveStrategiPillars` write instead; the caller still
// decides when to fire it, and it never touches pillars the Cockpit did not
// generate.
//
// ## Placeholder scaffolding is never imported
//
// The printed draft fills gaps with prompts like "(isi di panel 1)" or
// "(belum diisi — lihat tab Target Bulan 1)" — reminders for the AM, not
// content. Because this parser reads the STRUCTURED state instead of that
// text, it never has to detect and strip those placeholders: a field is only
// touched when the tool actually computed or the AM actually typed a value.

import type { LeadingIndicator, StrategiPillar } from './strategi';
import { LEADING_INDICATOR_MAX } from './strategi';
import type {
  DiagnosaDraftAll,
  PrasyaratKlienDraft,
  QuickWinDraft,
  RisikoStrukturalDraft,
} from '@/components/strategi/SectionC';
import type { KpiDraft, TargetDraft } from '@/components/strategi/SectionD';
import type { SupportTargetRow } from './strategi-target';
import type { NarasiDraft } from '@/components/strategi/SectionE';

export const COCKPIT_SCHEMA = 'mea.cockpit.v1';

// ---------------------------------------------------------------------------
// Payload shape — mirrors `ST` in MEA AM Cockpit v1.html closely enough to
// read the fields this adapter needs; everything else on the real object is
// ignored (`unknown`-safe, since the object is otherwise the tool's own
// working state, not a contract this side owns).
// ---------------------------------------------------------------------------

/** One entry of `ST.aksi`, keyed by katalog kode (e.g. `A2`, `D1`). */
export interface CockpitAksiState {
  /** Ticked in the tool's "Rancang Pilar" tab — this is what makes an aksi selected. */
  on?: boolean;
  /** Which of the 3 pilar this aksi was grouped under. */
  grup?: number | string;
  /** Planned figure for the jembatan metric, as typed in the tool. */
  rencana?: string | number;
  /** The jembatan metric value/description, as typed in the tool. */
  target?: string;
  /** "Alasan dipilih" — becomes part of C-3 akar masalah. */
  catatan?: string;
}

/** `ST.baseline` — the normalized + derived baseline the tool computed. */
export interface CockpitBaseline {
  marginTertimbang?: number | null;
  acosMax?: number | null;
  roasMin?: number | null;
  /** Current running ROAS (not the D-4 target) — cited in the C-2 alasan text. */
  roas?: number | null;
  top1GMV?: number | null;
  totalGMVExplicit?: number | null;
  konsentrasiAff?: number | null;
  durasiKontrakBulan?: number | null;
}

export interface CockpitPayload {
  schema: string;
  channel?: string;
  /** D-1, rancang bulan pertama saja — the tool has no multi-month grid. */
  floor?: number;
  /** D-2. */
  stretch?: number;
  thesis?: string;
  pilarNama?: string[];
  pilarAlasan?: string;
  /** "GMV bulan berjalan" — the konsentrasi-kreator denominator fallback. */
  gmvM?: number;
  aksi?: Record<string, CockpitAksiState>;
  baseline?: CockpitBaseline | null;
  /** D-5 — `h30`/`h60`/`h90` in the tool, typed by the AM or filled by its own
   * "Sarankan dari data" button (from the aksi/jembatan chosen in Pilar). */
  h30?: string;
  h60?: string;
  h90?: string;
}

export type ParseResult =
  | { ok: true; payload: CockpitPayload }
  | { ok: false; error: string };

/**
 * Parse + validate the pasted/uploaded text. BI bracket messages (house rule
 * #5). Only checks the shape needed to tell "wrong file" apart from "real
 * Cockpit export" — everything else is read defensively field-by-field below.
 */
export function parseCockpitPayload(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: '[tempel atau unggah dulu file JSON dari tombol "Unduh JSON" di MEA AM Cockpit]',
    };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: '[format tidak dikenali — pastikan seluruh isi file JSON tersalin/terunggah]',
    };
  }
  if (!obj || typeof obj !== 'object') {
    return {
      ok: false,
      error: '[format tidak dikenali — pastikan seluruh isi file JSON tersalin/terunggah]',
    };
  }
  const rec = obj as Record<string, unknown>;
  if (rec.schema !== COCKPIT_SCHEMA) {
    return {
      ok: false,
      error: '[file ini bukan hasil "Unduh JSON" dari MEA AM Cockpit (skema tidak cocok)]',
    };
  }
  return { ok: true, payload: rec as unknown as CockpitPayload };
}

// ---------------------------------------------------------------------------
// Katalog aksi — cermin `KATALOG` di MEA AM Cockpit v1.html. Kept as a literal
// copy rather than derived, same reasoning as `strategi-target.ts`'s
// `targetKey`: it is a wire contract with a tool this repo does not own, so it
// has to be reproduced, and the test file pins it to the samples above.
// ---------------------------------------------------------------------------

interface KatalogAksi {
  kode: string;
  nama: string;
  divisi: string;
  fieldId: string;
  unit: string;
  jembatan: string;
  /** Tool's own "tanpa budget baru" flag — feeds C-5 quick wins. */
  qw: boolean;
}

const KATALOG: KatalogAksi[] = [
  { kode: 'V1', nama: 'Hook baru / 3 hook baku', divisi: 'Creative', fieldId: 'B-7.1', unit: 'VV', jembatan: 'Median VV video toko', qw: false },
  { kode: 'V2', nama: 'Naikkan kuota video', divisi: 'Creative', fieldId: 'B-7.1', unit: 'video', jembatan: 'Video bertayangan / bulan', qw: false },
  { kode: 'V3', nama: 'Replika video menjual', divisi: 'Creative', fieldId: 'B-7.1', unit: '%', jembatan: 'Hit rate video baru', qw: false },
  { kode: 'V4', nama: 'Audit / perbaikan akun official', divisi: 'Creative', fieldId: 'B-2.2', unit: 'VV', jembatan: 'Median VV akun toko', qw: false },
  { kode: 'V5', nama: 'Perbaikan listing hero SKU', divisi: 'Creative', fieldId: 'B-3.6', unit: '%', jembatan: 'CTOR hero SKU', qw: true },
  { kode: 'V6', nama: 'Pindah kuota ke SKU margin besar', divisi: 'Creative', fieldId: 'B-3.3', unit: '%', jembatan: 'Porsi GMV SKU sasaran', qw: false },
  { kode: 'L1', nama: 'Mulai / tambah jam live', divisi: 'Live Stream', fieldId: 'B-7.2', unit: 'jam', jembatan: 'Jam live / minggu', qw: false },
  { kode: 'L2', nama: 'Ganti / latih host', divisi: 'Live Stream', fieldId: 'B-7.4', unit: 'Rp', jembatan: 'GMV per jam live', qw: false },
  { kode: 'L3', nama: 'Rombak rundown & urutan produk', divisi: 'Live Stream', fieldId: 'B-7.4', unit: 'Rp', jembatan: 'GMV per jam live', qw: true },
  { kode: 'L4', nama: 'Flash deal terjadwal', divisi: 'Live Stream', fieldId: 'B-7.2', unit: 'Rp', jembatan: 'GMV live / minggu', qw: true },
  { kode: 'A1', nama: 'Naikkan komisi terbuka', divisi: 'KOL', fieldId: 'B-6.3', unit: 'kreator', jembatan: 'Kreator posting / minggu', qw: false },
  { kode: 'A2', nama: 'Aktivasi kreator terdaftar', divisi: 'KOL', fieldId: 'B-6.1', unit: 'kreator', jembatan: 'Kreator posting / minggu', qw: true },
  { kode: 'A3', nama: 'Rekrut lapis kedua (MCN/MEAGO)', divisi: 'KOL', fieldId: 'B-6.4', unit: '%', jembatan: 'Porsi GMV kreator terbesar', qw: false },
  { kode: 'A4', nama: 'Program sampel / seeding', divisi: 'KOL', fieldId: 'B-6.5', unit: 'kreator', jembatan: 'Kreator posting / minggu', qw: false },
  { kode: 'A5', nama: 'Campaign terarah ke kreator tertentu', divisi: 'KOL', fieldId: 'B-6.2', unit: 'Rp', jembatan: 'GMV affiliate', qw: false },
  { kode: 'D1', nama: 'Seleksi kreatif pakai CTR klik produk', divisi: 'Ads', fieldId: 'B-5.5', unit: '%', jembatan: '% spend kreatif 0 order', qw: true },
  { kode: 'D2', nama: 'Aturan mati: 2× CPA tanpa order', divisi: 'Ads', fieldId: 'B-5.5', unit: 'Rp', jembatan: 'Rp spend terbuang / minggu', qw: true },
  { kode: 'D3', nama: 'Rombak struktur kampanye', divisi: 'Ads', fieldId: 'B-5.4', unit: 'x', jembatan: 'ROAS blended', qw: false },
  { kode: 'D4', nama: 'Ubah budget harian', divisi: 'Ads', fieldId: 'B-5.1', unit: 'x', jembatan: 'ROAS blended', qw: false },
  { kode: 'D5', nama: 'GMV Max dinyalakan / dimatikan', divisi: 'Ads', fieldId: 'B-5.4', unit: 'x', jembatan: 'ROAS blended', qw: false },
];

const KATALOG_BY_KODE = new Map(KATALOG.map((a) => [a.kode, a]));

/** Cockpit `divisi` → `strategi_pillar.jenis` (PILLAR_KINDS). */
const DIVISI_TO_JENIS: Record<string, string> = {
  Creative: 'konten',
  'Live Stream': 'live',
  KOL: 'affiliate',
  Ads: 'iklan',
};

/**
 * Aksi → D-6 leading indicator, restricted to the katalog jembatan that map
 * CONFIDENTLY onto the closed 10-value vocabulary (`METRIC_LABELS`). Most
 * jembatan (median VV, CTOR, % spend 0 order, GMV per jam live, …) have no
 * counterpart there and are deliberately left out — a wrong-but-plausible
 * indicator is worse than an indicator the AM still has to pick by hand.
 */
const JEMBATAN_TO_METRIC: Record<string, LeadingIndicator> = {
  V2: 'jumlah_video',
  L1: 'jam_live',
  A1: 'affiliate_aktif',
  A2: 'affiliate_aktif',
  A4: 'affiliate_aktif',
  D3: 'roas_min',
  D4: 'roas_min',
  D5: 'roas_min',
};

// ---------------------------------------------------------------------------
// Derived reads — mirrors of the small pieces of arithmetic `strgDraftText`
// does at print time (K1 margin threshold, konsentrasi kreator). The tool
// already computed marginTertimbang/acosMax/roasMin into `ST.baseline`, so
// nothing numeric is RE-derived here except the one figure the tool computes
// as a function of two fields (`konsentrasi()`), not a stored field.
// ---------------------------------------------------------------------------

const MARGIN_THRESHOLD = 40;
const KONSENTRASI_THRESHOLD = 30;

function marginFail(baseline: CockpitBaseline | null | undefined): boolean {
  return !!baseline && baseline.marginTertimbang != null && baseline.marginTertimbang < MARGIN_THRESHOLD;
}

/** `totalBase()` in the tool: explicit baseline GMV, else the AM's manual "GMV bulan berjalan". */
function totalBaseGmv(payload: CockpitPayload): number | null {
  const explicit = payload.baseline?.totalGMVExplicit;
  if (explicit != null) return explicit;
  if (payload.gmvM != null && payload.gmvM > 0) return payload.gmvM;
  return null;
}

/** Mirrors `konsentrasi()` — top creator's share of GMV, or null if there is nothing to divide by. */
export function konsentrasiPersen(payload: CockpitPayload): number | null {
  const b = payload.baseline;
  if (!b || b.top1GMV == null) return null;
  const total = totalBaseGmv(payload);
  if (total) return (b.top1GMV / total) * 100;
  if (b.konsentrasiAff != null) return b.konsentrasiAff;
  return null;
}

function konsentrasiFail(payload: CockpitPayload): boolean {
  const p = konsentrasiPersen(payload);
  return p != null && p >= KONSENTRASI_THRESHOLD;
}

/** Mirrors `dipilihBaru()` — aksi ticked in the tool AND still a known katalog kode. */
export function selectedAksi(payload: CockpitPayload): string[] {
  const aksi = payload.aksi ?? {};
  return Object.keys(aksi).filter((k) => aksi[k]?.on && KATALOG_BY_KODE.has(k));
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

// ---------------------------------------------------------------------------
// Section C — diagnosa & akar masalah
// ---------------------------------------------------------------------------

export interface ApplyCount {
  filled: number;
}

/**
 * Fills the diagnosa row for the Cockpit's channel only, and only the parts
 * still empty. Does not create a new row — Section C already seeds one row
 * per contracted channel (`ensureChannels`), and a channel absent from that
 * list is not one this Strategi's contract covers.
 */
export function applyCockpitToDiagnosa(
  draft: DiagnosaDraftAll,
  payload: CockpitPayload,
): { draft: DiagnosaDraftAll } & ApplyCount {
  const channel = (payload.channel ?? '').trim();
  const b = payload.baseline ?? null;
  const mFail = marginFail(b);
  const kFail = konsentrasiFail(payload);
  const kPct = konsentrasiPersen(payload);
  const selected = selectedAksi(payload);
  let filled = 0;

  const diagnosa = draft.diagnosa.map((row) => {
    if (!channel || row.channel !== channel) return row;
    let next = row;

    if (!next.bottleneck) {
      const bottleneck = mFail ? 'margin' : kFail ? 'trafik' : '';
      if (bottleneck) {
        next = { ...next, bottleneck };
        filled += 1;
      }
    }

    if (!next.alasan.trim()) {
      const parts: string[] = [];
      if (mFail) {
        parts.push(
          b?.marginTertimbang != null
            ? `Margin tertimbang ${fmt1(b.marginTertimbang)}% di bawah ambang 40% [B-3.3]`
            : 'Margin tertimbang di bawah ambang 40% [B-3.3]',
        );
      }
      if (kFail) {
        parts.push(
          kPct != null
            ? `Konsentrasi kreator ${fmt1(kPct)}% di atas ambang 30% [B-6.4]`
            : 'Konsentrasi kreator di atas ambang 30% [B-6.4]',
        );
      }
      if (b?.roas != null) {
        parts.push(`ROAS berjalan ${fmt1(b.roas)} [B-5.4]`);
      }
      if (parts.length) {
        next = { ...next, alasan: parts.join('; ') };
        filled += 1;
      }
    }

    if (!next.akar_masalah.trim()) {
      const lines = selected
        .map((k) => ({ k, catatan: payload.aksi?.[k]?.catatan?.trim() ?? '' }))
        .filter((x) => x.catatan)
        .map((x) => `[${x.k}] ${x.catatan}`);
      if (lines.length) {
        next = { ...next, akar_masalah: lines.join('\n') };
        filled += 1;
      }
    }

    return next;
  });

  const hasContent = <T,>(rows: T[], isBlank: (r: T) => boolean) => rows.some((r) => !isBlank(r));

  let quick_wins = draft.quick_wins;
  if (!hasContent(quick_wins, (q) => !q.aksi.trim())) {
    const rows: QuickWinDraft[] = selected
      .map((k) => KATALOG_BY_KODE.get(k))
      .filter((a): a is KatalogAksi => !!a && a.qw)
      .map((a) => ({
        aksi: `${a.kode} ${a.nama}`,
        channel,
        pic_divisi: a.divisi,
        dampak_diharapkan: '',
      }));
    if (rows.length) {
      quick_wins = [...quick_wins.filter((q) => q.aksi.trim()), ...rows];
      filled += rows.length;
    }
  }

  let risiko_struktural = draft.risiko_struktural;
  if (!hasContent(risiko_struktural, (r) => !r.risiko.trim())) {
    const rows: RisikoStrukturalDraft[] = [];
    if (mFail && b?.marginTertimbang != null) {
      rows.push({
        risiko: `Margin tertimbang ${fmt1(b.marginTertimbang)}% di bawah ambang 40% (K1) — tidak bisa dihilangkan tanpa klien mengubah harga/HPP [B-3.3]`,
      });
    }
    if (kFail && kPct != null) {
      rows.push({ risiko: `Konsentrasi kreator ${fmt1(kPct)}% di atas ambang 30% [B-6.4]` });
    }
    if (b?.durasiKontrakBulan != null && b.durasiKontrakBulan <= 1) {
      rows.push({
        risiko: `Kontrak ${b.durasiKontrakBulan} bulan — terlalu pendek untuk pengungkit >4 minggu`,
      });
    }
    if (rows.length) {
      risiko_struktural = rows;
      filled += rows.length;
    }
  }

  let prasyarat_klien = draft.prasyarat_klien;
  if (!hasContent(prasyarat_klien, (p) => !p.item.trim())) {
    const rows: PrasyaratKlienDraft[] = [];
    if (mFail) {
      rows.push({
        item: 'Konfirmasi margin bersih riil per SKU sebelum target GMV disusun',
        pic_klien: '',
        deadline: '',
      });
    }
    if (rows.length) {
      prasyarat_klien = rows;
      filled += rows.length;
    }
  }

  return { draft: { diagnosa, quick_wins, risiko_struktural, prasyarat_klien }, filled };
}

// ---------------------------------------------------------------------------
// Section D — target & KPI
// ---------------------------------------------------------------------------

export function applyCockpitToTargets(
  draft: TargetDraft,
  payload: CockpitPayload,
): { draft: TargetDraft } & ApplyCount {
  const channel = (payload.channel ?? '').trim();
  const b = payload.baseline ?? null;
  let filled = 0;

  let gmv = draft.gmv;
  if (channel && payload.floor && payload.stretch) {
    gmv = draft.gmv.map((c) => {
      if (c.channel !== channel || c.month_index !== 1) return c;
      if (c.nilai_floor.trim() || c.nilai_stretch.trim()) return c;
      filled += 1;
      return {
        ...c,
        nilai_floor: String(Math.round(payload.floor as number)),
        nilai_stretch: String(Math.round(payload.stretch as number)),
      };
    });
  }

  let pendukung = draft.pendukung;
  if (channel) {
    const already = (metric: string) =>
      pendukung.some((r) => r.channel === channel && r.month_index === 1 && r.metric === metric);
    const additions: SupportTargetRow[] = [];
    if (b?.acosMax != null && !already('acos_maks')) {
      additions.push({ channel, month_index: 1, metric: 'acos_maks', nilai_stretch: fmt1(b.acosMax) });
    }
    if (b?.roasMin != null && !already('roas_min')) {
      additions.push({ channel, month_index: 1, metric: 'roas_min', nilai_stretch: fmt1(b.roasMin) });
    }
    if (additions.length) {
      pendukung = [...pendukung, ...additions];
      filled += additions.length;
    }
  }

  let assumptions = draft.assumptions;
  if (marginFail(b)) {
    const asumsi = 'Klien bersedia menaikkan harga/memangkas HPP sampai margin ≥ 40%';
    if (!assumptions.some((a) => a.asumsi.trim() === asumsi)) {
      assumptions = [
        ...assumptions,
        {
          kode: `AS-${assumptions.length + 1}`,
          asumsi,
          pemilik: 'klien',
          cara_verifikasi: '',
          target_terkait: [],
        },
      ];
      filled += 1;
    }
  }

  return { draft: { gmv, pendukung, assumptions }, filled };
}

/**
 * D-5 (`h30`/`h60`/`h90`) and D-6 leading indicator (restricted to
 * `JEMBATAN_TO_METRIC`'s confident subset).
 *
 * D-5 was the one field on this header the tool never exported — it had no
 * `h30`/`h60`/`h90` state at all, so there was nothing for an adapter to read
 * (owner QA 2026-08-25). Filled the same way as everything else here: only
 * when the draft's box is still blank.
 */
export function applyCockpitToKpi(
  draft: KpiDraft,
  payload: CockpitPayload,
): { draft: KpiDraft } & ApplyCount {
  const set = new Set(draft.leading_indicator);
  let filled = 0;
  for (const k of selectedAksi(payload)) {
    if (set.size >= LEADING_INDICATOR_MAX) break;
    const metric = JEMBATAN_TO_METRIC[k];
    if (metric && !set.has(metric)) {
      set.add(metric);
      filled += 1;
    }
  }

  let definisi_berhasil_30 = draft.definisi_berhasil_30;
  let definisi_berhasil_60 = draft.definisi_berhasil_60;
  let definisi_berhasil_90 = draft.definisi_berhasil_90;
  const h30 = (payload.h30 ?? '').trim();
  const h60 = (payload.h60 ?? '').trim();
  const h90 = (payload.h90 ?? '').trim();
  if (!definisi_berhasil_30.trim() && h30) {
    definisi_berhasil_30 = h30;
    filled += 1;
  }
  if (!definisi_berhasil_60.trim() && h60) {
    definisi_berhasil_60 = h60;
    filled += 1;
  }
  if (!definisi_berhasil_90.trim() && h90) {
    definisi_berhasil_90 = h90;
    filled += 1;
  }

  return {
    draft: {
      ...draft,
      leading_indicator: [...set],
      definisi_berhasil_30,
      definisi_berhasil_60,
      definisi_berhasil_90,
    },
    filled,
  };
}

// ---------------------------------------------------------------------------
// Section E — E-1 / E-13 narasi
// ---------------------------------------------------------------------------

export function applyCockpitToNarasi(
  draft: NarasiDraft,
  payload: CockpitPayload,
): { draft: NarasiDraft } & ApplyCount {
  let next = draft;
  let filled = 0;
  const thesis = (payload.thesis ?? '').trim();
  if (!next.growth_thesis.trim() && thesis) {
    next = { ...next, growth_thesis: thesis };
    filled += 1;
  }
  const alasan = (payload.pilarAlasan ?? '').trim();
  if (!next.urutan_eksekusi_alasan.trim() && alasan) {
    next = { ...next, urutan_eksekusi_alasan: alasan };
    filled += 1;
  }
  return { draft: next, filled };
}

// ---------------------------------------------------------------------------
// Section E — pilar (E-3…E-10). No draft editor exists yet for these, so this
// builds a save-ready body instead of a draft patch — see the module note.
// ---------------------------------------------------------------------------

/** What `PUT /strategi/{id}/pillars` accepts — snake_case per the wire boundary. */
export interface CockpitPillarBody {
  jenis: string;
  channel: string | null;
  urutan: number;
  sku: string | null;
  peran: string | null;
  aksi: string;
  target: string;
  harga_normal: string | null;
  harga_promo: string | null;
  floor_price: string | null;
  vendor_id: string | null;
  slot_jam: number | null;
  tarif: string | null;
  target_gmv_per_jam: string | null;
  detail: Record<string, unknown>;
}

/**
 * One pillar row per selected aksi, grouped by the tool's 3 pilar slots
 * (`ST.aksi[k].grup`). An aksi ticked but never grouped is dropped — the tool
 * itself flags it "belum dikelompokkan" and it has no `grup` to file under.
 */
export function buildCockpitPillars(payload: CockpitPayload): CockpitPillarBody[] {
  const channel = (payload.channel ?? '').trim() || null;
  const aksiState = payload.aksi ?? {};
  const selected = selectedAksi(payload);
  const out: CockpitPillarBody[] = [];
  let urutan = 1;

  for (let grup = 1; grup <= 3; grup += 1) {
    const keys = selected.filter((k) => String(aksiState[k]?.grup ?? '') === String(grup));
    if (!keys.length) continue;
    const nama = payload.pilarNama?.[grup - 1]?.trim();
    // Which of the tool's 3 pilar slots this row came from — NOT the DB
    // `peran` column, which is a closed SKU-role enum ('hero'/'pendamping'/
    // 'bundling'/'baru'/'dimatikan', `ck_strpil_peran`). The Cockpit never
    // assigns a SKU role, so `peran` stays null and this label travels in
    // `detail` instead — putting it in `peran` violates the CHECK constraint
    // and `savePillars`'s INSERT throws an unmapped Postgres error (surfaces
    // to the AM as "internal server error").
    const pilarLabel = nama ? `Pilar ${grup} — ${nama}` : `Pilar ${grup}`;

    for (const k of keys) {
      const kat = KATALOG_BY_KODE.get(k);
      if (!kat) continue;
      const s = aksiState[k] ?? {};
      const rencana = s.rencana != null && String(s.rencana).trim() !== '' ? String(s.rencana).trim() : '?';
      const jembatan = s.target?.trim();
      out.push({
        jenis: DIVISI_TO_JENIS[kat.divisi] ?? 'operasional',
        channel,
        urutan: urutan++,
        sku: null,
        peran: null,
        aksi: `${k} ${kat.nama}`,
        target: `${rencana} ${kat.unit}${jembatan ? `, jembatan ${jembatan}` : ''}`.trim(),
        harga_normal: null,
        harga_promo: null,
        floor_price: null,
        vendor_id: null,
        slot_jam: null,
        tarif: null,
        target_gmv_per_jam: null,
        detail: { sumber: COCKPIT_SCHEMA, kode_aksi: k, field_id_bukti: kat.fieldId, pilar: pilarLabel },
      });
    }
  }
  return out;
}

/**
 * `saveStrategiPillars` replaces the WHOLE Section E pillar list, so a naive
 * "just send the fresh ones" would wipe every out-of-scope row (E-11) and
 * every other pillar the AM already has. This keeps everything except rows
 * that match a fresh one on (jenis, channel, aksi) — the same identity a
 * re-applied Cockpit import would produce — so re-pasting the same file
 * updates in place instead of duplicating.
 */
export function mergeCockpitPillars(
  existing: readonly StrategiPillar[],
  fresh: readonly CockpitPillarBody[],
): CockpitPillarBody[] {
  const replaced = (p: StrategiPillar) =>
    fresh.some((f) => f.jenis === p.jenis && f.channel === p.channel && f.aksi === p.aksi);
  const kept: CockpitPillarBody[] = existing
    .filter((p) => !replaced(p))
    .map((p) => ({
      jenis: p.jenis,
      channel: p.channel,
      urutan: p.urutan,
      sku: p.sku,
      peran: p.peran,
      aksi: p.aksi,
      target: p.target,
      harga_normal: p.harga_normal,
      harga_promo: p.harga_promo,
      floor_price: p.floor_price,
      vendor_id: p.vendor_id,
      slot_jam: p.slot_jam,
      tarif: p.tarif,
      target_gmv_per_jam: p.target_gmv_per_jam,
      detail: p.detail,
    }));
  return [...kept, ...fresh].map((p, i) => ({ ...p, urutan: i + 1 }));
}
