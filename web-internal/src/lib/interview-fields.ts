/**
 * Modul Interview ("Kelola Klien") — the Blok A/B field catalog and the pure
 * mappers between the form draft, the answers wire, and the scorer input.
 *
 * ## What is (and is not) modelled here, and why
 *
 * The Interview spec is a prompt, not a doc file, and there is no server-side
 * question catalog for Blok B0–B11 (only the category-specific Blok B9 set is
 * config-driven, and no route serves it yet). Like the Strategi form, the FE
 * therefore owns the field layout. But the ONLY fields with a defined meaning in
 * the codebase are the ones `packages/core` names: the fifteen SCORED inputs that
 * drive Blok C, the money/percent figures they read, their `sumber_angka`, and
 * the client prerequisite (B7-9). Inventing question text for the ~80 descriptive
 * fields the prompt implies would violate CLAUDE.md ("Never invent fields") and
 * add rows the scorer never reads — so this catalog is deliberately the
 * qualification-driving subset. Descriptive/prefill fields are langkah 8's
 * concern (`PREFILL_MAPPING`), and the config-driven Blok B9 arrives when a route
 * serves it.
 *
 * The enum → BI label maps live here because `packages/core` is explicit that
 * "answers are stored as canonical codes … the UI maps code <-> BI label" — the
 * scorer never string-matches a label, so the display strings are a pure UI
 * concern and never leave this layer.
 *
 * ## The one number-format rule
 *
 * Money is IDR minor units on the wire and in the scorer (1/100 rupiah,
 * `money.ts`). AMs type rupiah. Every rupiah↔minor conversion happens in
 * `rupiahToMinor`/`minorToRupiah` here and nowhere else, so a stray ×100 cannot
 * hide in a component.
 */

import type { InterviewAnswer, InterviewDetail } from './interview';
import {
  DAYA_TAHAN_BUDGET,
  KECEPATAN_APPROVAL,
  KESANGGUPAN_LONJAKAN,
  KESIAPAN_AKSES,
  MODEL_BISNIS,
  PEMBEDA_PRODUK,
  PENANGANAN_CHAT,
  RUANG_HARGA,
  SIKLUS_BELI_ULANG,
  SUMBER_ANGKA,
  hitungKualifikasi,
  type DayaTahanBudget,
  type HasilKualifikasi,
  type KecepatanApproval,
  type KesanggupanLonjakan,
  type KesiapanAkses,
  type KualifikasiInput,
  type ModelBisnis,
  type PembedaProduk,
  type PenangananChat,
  type RuangHarga,
  type SiklusBeliUlang,
  type SumberAngka,
} from './interview-scoring';

// ===========================================================================
// Enum → BI display options (canonical code order preserved for stable UI)
// ===========================================================================

export interface EnumOption<T extends string = string> {
  value: T;
  label: string;
}

export const MODEL_BISNIS_OPTIONS: EnumOption<ModelBisnis>[] = [
  { value: MODEL_BISNIS.Produsen, label: 'Produsen / pabrik sendiri' },
  { value: MODEL_BISNIS.BrandOwner, label: 'Brand owner' },
  { value: MODEL_BISNIS.ImportirLangsung, label: 'Importir langsung' },
  { value: MODEL_BISNIS.DistributorResmi, label: 'Distributor resmi' },
  { value: MODEL_BISNIS.Reseller, label: 'Reseller' },
  { value: MODEL_BISNIS.Dropship, label: 'Dropship — deal-breaker' },
];

export const KESANGGUPAN_LONJAKAN_OPTIONS: EnumOption<KesanggupanLonjakan>[] = [
  { value: KESANGGUPAN_LONJAKAN.Sanggup, label: 'Sanggup' },
  { value: KESANGGUPAN_LONJAKAN.SanggupSebagian, label: 'Sanggup sebagian' },
  { value: KESANGGUPAN_LONJAKAN.BelumSanggup, label: 'Belum sanggup' },
];

export const SIKLUS_BELI_ULANG_OPTIONS: EnumOption<SiklusBeliUlang>[] = [
  { value: SIKLUS_BELI_ULANG.HabisPakai, label: 'Habis pakai (< 3 bulan)' },
  { value: SIKLUS_BELI_ULANG.Menengah, label: 'Menengah (3–12 bulan)' },
  { value: SIKLUS_BELI_ULANG.SekaliBeli, label: 'Sekali beli' },
];

export const PEMBEDA_PRODUK_OPTIONS: EnumOption<PembedaProduk>[] = [
  { value: PEMBEDA_PRODUK.PembedaJelas, label: 'Pembeda jelas' },
  { value: PEMBEDA_PRODUK.MiripPasaran, label: 'Mirip pasaran' },
  { value: PEMBEDA_PRODUK.ProdukUmum, label: 'Produk umum' },
];

export const RUANG_HARGA_OPTIONS: EnumOption<RuangHarga>[] = [
  { value: RUANG_HARGA.MasihAdaRuang, label: 'Masih ada ruang' },
  { value: RUANG_HARGA.Terbatas, label: 'Terbatas' },
  { value: RUANG_HARGA.TidakAda, label: 'Tidak ada (sudah perang harga)' },
];

export const PENANGANAN_CHAT_OPTIONS: EnumOption<PenangananChat>[] = [
  { value: PENANGANAN_CHAT.TimKhusus, label: 'Tim khusus' },
  { value: PENANGANAN_CHAT.OwnerResponsif, label: 'Owner responsif' },
  { value: PENANGANAN_CHAT.SeringLewatSehari, label: 'Sering lewat sehari' },
];

export const KECEPATAN_APPROVAL_OPTIONS: EnumOption<KecepatanApproval>[] = [
  { value: KECEPATAN_APPROVAL.SatuOrangJelas, label: 'Satu orang jelas' },
  { value: KECEPATAN_APPROVAL.OwnerSibuk, label: 'Owner sibuk' },
  { value: KECEPATAN_APPROVAL.BelumJelas, label: 'Belum jelas' },
];

export const KESIAPAN_AKSES_OPTIONS: EnumOption<KesiapanAkses>[] = [
  { value: KESIAPAN_AKSES.Penuh, label: 'Penuh' },
  { value: KESIAPAN_AKSES.Sebagian, label: 'Sebagian' },
  { value: KESIAPAN_AKSES.Belum, label: 'Belum' },
];

export const DAYA_TAHAN_BUDGET_OPTIONS: EnumOption<DayaTahanBudget>[] = [
  { value: DAYA_TAHAN_BUDGET.Enam, label: '≥ 6 bulan' },
  { value: DAYA_TAHAN_BUDGET.TigaLima, label: '3–5 bulan' },
  { value: DAYA_TAHAN_BUDGET.Dua, label: '2 bulan' },
  { value: DAYA_TAHAN_BUDGET.SatuAtauBelumPasti, label: '≤ 1 bulan atau belum pasti — deal-breaker' },
];

/** B2-7 / B1-5 / B2-9 / B6-3 / B2-3 number source (I3). Note: `dari_margin_kotor`
 *  is offered ONLY on B2-7 (it means "leave net blank, derive it from B2-8"). */
export const SUMBER_ANGKA_OPTIONS: EnumOption<SumberAngka>[] = [
  { value: SUMBER_ANGKA.KlienHitung, label: 'Klien hitung' },
  { value: SUMBER_ANGKA.EstimasiAm, label: 'Estimasi AM' },
];
export const SUMBER_ANGKA_MARGIN_OPTIONS: EnumOption<SumberAngka>[] = [
  { value: SUMBER_ANGKA.KlienHitung, label: 'Klien hitung' },
  { value: SUMBER_ANGKA.DariMarginKotor, label: 'Diturunkan dari margin kotor (B2-8)' },
  { value: SUMBER_ANGKA.EstimasiAm, label: 'Estimasi AM' },
];

// ===========================================================================
// Field catalog
// ===========================================================================

export type FieldTipe = 'enum' | 'money' | 'persen' | 'angka' | 'teks';

export interface FieldSpec {
  section: string;
  fieldKey: string;
  label: string;
  tipe: FieldTipe;
  /** Which Blok C signal this drives — shown as a hint, purely informational. */
  drives?: string;
  /** Scored input (blank-submit forbidden by the DB). Drives the sidebar. */
  scored: boolean;
  /** Records an I3 `sumber_angka` (numeric fields answered by the client/AM). */
  sumber?: 'standard' | 'margin';
  enumOptions?: EnumOption[];
  hint?: string;
}

/**
 * The disposition of a Blok B section (RAB-10). A bare `wired: false` left the six
 * descriptive sections hanging with no recorded reason; every section now carries
 * an explicit status so "not built" reads as a decision, not an oversight. See
 * `docs/DECISIONS.md` 2026-08-18 (RAB-09/RAB-10) and RAB-18 (the Interview PRD
 * that will own the deferred sections' field catalog).
 *
 * - `wired` — this catalog renders scored/qualification fields for the section.
 * - `ditunda_rab18` — DELIBERATELY out of scope until RAB-18. These sections are
 *   free-text/descriptive; there is no server-side question catalog and the
 *   Interview spec is a prompt, not a doc, so building inputs here would mean
 *   inventing ~80 field keys the scorer never reads — CLAUDE.md forbids that
 *   ("Never invent fields"). They stay collapsed with the reason shown.
 * - `config_driven` — B9 is the category-specific set; it renders once a route
 *   serves it (see interview-fields.ts header), not before.
 */
export type SectionStatus = 'wired' | 'ditunda_rab18' | 'config_driven';

export interface SectionSpec {
  key: string;
  label: string;
  status: SectionStatus;
  /** `status === 'wired'` — the only sections the AM can open today. */
  wired: boolean;
  /** Why an un-wired section is not available, shown on the disabled toggle. */
  catatan?: string;
}

const DITUNDA = 'Sengaja belum dibangun — menunggu PRD Interview (RAB-18) yang mendefinisikan pertanyaannya.';

export const INTERVIEW_SECTIONS: SectionSpec[] = [
  { key: 'B0', label: 'Konteks & Sumber Data', status: 'ditunda_rab18', wired: false, catatan: DITUNDA },
  { key: 'B1', label: 'Model & Skala Bisnis', status: 'wired', wired: true },
  { key: 'B2', label: 'Produk, Margin & Suplai', status: 'wired', wired: true },
  { key: 'B3', label: 'Posisi Harga', status: 'wired', wired: true },
  { key: 'B4', label: 'Operasional & Layanan', status: 'wired', wired: true },
  { key: 'B5', label: 'Kompetisi', status: 'ditunda_rab18', wired: false, catatan: DITUNDA },
  { key: 'B6', label: 'Ekspektasi & Budget', status: 'wired', wired: true },
  { key: 'B7', label: 'Kesiapan Kerja Sama', status: 'wired', wired: true },
  { key: 'B8', label: 'Harga & Penawaran', status: 'ditunda_rab18', wired: false, catatan: DITUNDA },
  {
    key: 'B9',
    label: 'Kategori (config-driven)',
    status: 'config_driven',
    wired: false,
    catatan: 'Set per kategori — muncul saat route config-driven melayaninya.',
  },
  { key: 'B10', label: 'Riwayat & Ekspektasi Lain', status: 'ditunda_rab18', wired: false, catatan: DITUNDA },
  { key: 'B11', label: 'Catatan Internal', status: 'ditunda_rab18', wired: false, catatan: DITUNDA },
];

/**
 * The scored/qualification fields, grouped by section. `drives` names the Blok C
 * cell for the AM; `scored: true` fields are the ones the sidebar and the
 * submit-gate care about. B2-7a/B2-7b are the derivation inputs the margin
 * resolver reads when the AM chooses "diturunkan dari margin kotor" — not scored
 * themselves, stored so the derivation is reproducible.
 */
export const INTERVIEW_FIELDS: FieldSpec[] = [
  // --- B1 ---
  { section: 'B1', fieldKey: 'B1-4', label: 'Model bisnis / sumber stok', tipe: 'enum', drives: 'C-B1', scored: true, enumOptions: MODEL_BISNIS_OPTIONS },
  { section: 'B1', fieldKey: 'B1-5', label: 'Omzet 3 bulan terakhir', tipe: 'money', drives: 'C-A1 · penyebut C-E1', scored: true, sumber: 'standard' },
  // --- B2 ---
  { section: 'B2', fieldKey: 'B2-7', label: 'Margin bersih (%)', tipe: 'persen', drives: 'C-A2', scored: true, sumber: 'margin', hint: 'Pilih "diturunkan dari margin kotor" untuk menghitung dari B2-8 saat margin bersih belum tersedia.' },
  { section: 'B2', fieldKey: 'B2-7a', label: 'Komisi platform (%)', tipe: 'persen', scored: false, hint: 'Dipakai saat margin bersih diturunkan dari margin kotor. Kosong = pakai default config.' },
  { section: 'B2', fieldKey: 'B2-7b', label: 'Ongkir ditanggung (%)', tipe: 'persen', scored: false, hint: 'Dipakai saat margin bersih diturunkan dari margin kotor. Kosong = pakai default config.' },
  { section: 'B2', fieldKey: 'B2-8', label: 'Margin kotor (%)', tipe: 'persen', drives: 'C-A2 (basis turunan)', scored: true },
  { section: 'B2', fieldKey: 'B2-9', label: 'AOV (nilai order rata-rata)', tipe: 'money', drives: 'C-A3', scored: true, sumber: 'standard' },
  { section: 'B2', fieldKey: 'B2-3', label: 'Jumlah SKU siap jual', tipe: 'angka', drives: 'C-C3', scored: true, sumber: 'standard' },
  { section: 'B2', fieldKey: 'B2-10', label: 'Pembeda produk', tipe: 'enum', drives: 'C-C2', scored: true, enumOptions: PEMBEDA_PRODUK_OPTIONS },
  { section: 'B2', fieldKey: 'B2-11', label: 'Siklus beli ulang', tipe: 'enum', drives: 'C-C1', scored: true, enumOptions: SIKLUS_BELI_ULANG_OPTIONS },
  { section: 'B2', fieldKey: 'B2-13', label: 'Kesanggupan lonjakan 3x / 30 hari', tipe: 'enum', drives: 'C-B2', scored: true, enumOptions: KESANGGUPAN_LONJAKAN_OPTIONS },
  // --- B3 ---
  { section: 'B3', fieldKey: 'B3-3', label: 'Ruang harga', tipe: 'enum', drives: 'C-A4', scored: true, enumOptions: RUANG_HARGA_OPTIONS },
  // --- B4 ---
  { section: 'B4', fieldKey: 'B4-9', label: 'Penanganan chat', tipe: 'enum', drives: 'C-D1', scored: true, enumOptions: PENANGANAN_CHAT_OPTIONS },
  // --- B6 ---
  { section: 'B6', fieldKey: 'B6-3', label: 'Target omzet 3 bulan', tipe: 'money', drives: 'C-E1', scored: true, sumber: 'standard' },
  { section: 'B6', fieldKey: 'B6-5', label: 'Daya tahan budget iklan', tipe: 'enum', drives: 'C-E2', scored: true, enumOptions: DAYA_TAHAN_BUDGET_OPTIONS },
  // --- B7 ---
  { section: 'B7', fieldKey: 'B7-3', label: 'Kesiapan akses (toko, iklan, dashboard)', tipe: 'enum', drives: 'C-D3', scored: true, enumOptions: KESIAPAN_AKSES_OPTIONS },
  { section: 'B7', fieldKey: 'B7-6', label: 'Kecepatan approval', tipe: 'enum', drives: 'C-D2', scored: true, enumOptions: KECEPATAN_APPROVAL_OPTIONS },
  { section: 'B7', fieldKey: 'B7-9', label: 'Prasyarat dari klien (mis. data, aset, akses)', tipe: 'teks', drives: 'Prasyarat · Strategi C-7', scored: false },

  // --- Konteks Section A yang dipindah ke Interview (QA pemilik 2026-08-20 §3.A) ---
  // Enam field deskriptif Section A Strategi kini DITANGKAP di sini, supaya AM tidak
  // mengetik ulang di Strategi (jembatan `PREFILL_MAPPING` sudah memetakan tiap
  // fieldKey → A-n; begitu diisi, `InterviewPrefillPanel` di Strategi memunculkannya).
  // Semua NON-SCORED free-text: scorer/verdict tak membacanya. Tanpa migrasi —
  // `interview_answer` menyimpan (section, field_key) apa pun. Bentuk read-only +
  // pencabutan gerbang di sisi Strategi = PR lanjutan (butuh keputusan bentuk field
  // USP/decision-maker + dampak snapshot). Lihat DECISIONS.md 2026-08-20 §3.A.
  { section: 'B1', fieldKey: 'B1-8', label: 'Titik kirim / origin pengiriman (kota gudang) — A-8', tipe: 'teks', drives: 'Strategi A-8 (fulfillment)', scored: false, hint: 'Dasar hitung ongkir & subsidi platform. Ditarik ke Strategi Section A.' },
  { section: 'B1', fieldKey: 'B1-9', label: 'Riwayat agensi sebelumnya — apa yang gagal & kenapa (A-10)', tipe: 'teks', drives: 'Strategi A-10 (hard-internal)', scored: false, hint: 'Hard-internal — tidak pernah dibagikan ke klien.' },
  { section: 'B2', fieldKey: 'B2-1', label: 'Nama brand (A-1)', tipe: 'teks', drives: 'Strategi A-1', scored: false, hint: 'Kategori otomatis dari data klien (sales) — cukup isi nama brand di sini.' },
  { section: 'B3', fieldKey: 'B3-1', label: 'USP produk — alasan orang beli, bukan kompetitor (A-5)', tipe: 'teks', drives: 'Strategi A-5', scored: false, hint: 'Tulis minimal 3 alasan (satu per baris).' },
  { section: 'B7', fieldKey: 'B7-1', label: 'Aset dari klien — foto, video, sampel, katalog, budget iklan, host live (A-14)', tipe: 'teks', drives: 'Strategi A-14', scored: false },
  { section: 'B7', fieldKey: 'B7-5', label: 'Decision maker — nama, jabatan PIC, siapa yang berhak approve, jalur eskalasi (A-12)', tipe: 'teks', drives: 'Strategi A-12', scored: false },
];

/** The client prerequisite question — surfaced on the client print view. */
export const PRASYARAT_FIELD_KEY = 'B7-9';

export function fieldsOfSection(section: string): FieldSpec[] {
  return INTERVIEW_FIELDS.filter((f) => f.section === section);
}

// ===========================================================================
// Draft model — one entry per catalog field
// ===========================================================================

export interface FieldValue {
  /** Raw text as typed (rupiah for money, plain number for percent/angka, code for enum). */
  raw: string;
  /** I3 source, when the field records one. '' = unset. */
  sumber?: SumberAngka | '';
  /** Written basis, required when `sumber === estimasi_am`. */
  dasar?: string;
}

/** The whole Blok B draft: field-key → value. */
export type InterviewDraft = Record<string, FieldValue>;

export function emptyDraft(): InterviewDraft {
  const d: InterviewDraft = {};
  for (const f of INTERVIEW_FIELDS) {
    d[f.fieldKey] = { raw: '', sumber: f.sumber ? '' : undefined, dasar: '' };
  }
  return d;
}

// ---------------------------------------------------------------------------
// Money helpers — the single rupiah↔minor conversion point
// ---------------------------------------------------------------------------

/** Rupiah string → minor-unit bigint (×100). Blank/invalid → null. */
export function rupiahToMinor(raw: string): bigint | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t.replace(/[.\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 100));
}

/** Minor-unit (bigint | string | number) → rupiah string for the input. */
export function minorToRupiah(minor: bigint | string | number | null | undefined): string {
  if (minor === null || minor === undefined || minor === '') return '';
  const n = typeof minor === 'bigint' ? Number(minor) : Number(minor);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n) / 100);
}

// ===========================================================================
// draft ← detail (rebuild the form from loaded answers)
// ===========================================================================

export function draftFromDetail(detail: InterviewDetail): InterviewDraft {
  const d = emptyDraft();
  const byKey = new Map<string, InterviewAnswer>();
  for (const a of detail.answers) byKey.set(a.field_key, a);
  for (const f of INTERVIEW_FIELDS) {
    const a = byKey.get(f.fieldKey);
    if (!a) continue;
    let raw = '';
    if (f.tipe === 'enum') raw = a.nilai_enum ?? '';
    else if (f.tipe === 'money') raw = minorToRupiah(a.nilai_uang);
    else if (f.tipe === 'persen' || f.tipe === 'angka') raw = a.nilai_angka == null ? '' : String(a.nilai_angka);
    else raw = a.nilai_teks ?? '';
    d[f.fieldKey] = {
      raw,
      sumber: f.sumber ? ((a.sumber_angka as SumberAngka | null) ?? '') : undefined,
      dasar: a.dasar_estimasi ?? '',
    };
  }
  return d;
}

// ===========================================================================
// draft → answers wire (for PUT /interview/{id}/answers)
// ===========================================================================

/** One answer row, snake_case, as `interviewAnswersFromWire` expects. */
export interface AnswerWire {
  section: string;
  field_key: string;
  nilai_teks: string | null;
  nilai_angka: number | null;
  nilai_uang: string | null;
  nilai_bool: boolean | null;
  nilai_enum: string | null;
  nilai_jsonb: unknown;
  sumber_angka: string | null;
  dasar_estimasi: string | null;
  wajib_kosong: boolean;
}

/**
 * Builds the answer rows to upsert. Only fields with a value are sent (the
 * endpoint upserts per key, so omitting an empty field simply leaves it unsaved —
 * the right behaviour for a draft). A field marked `estimasi_am` WITHOUT a written
 * basis is skipped rather than sent: the DB rejects it (`ck_answer_estimasi_basis`)
 * and letting autosave 400 every 20s over a half-typed estimate is worse than
 * waiting for the basis. `isAnswersDraftValid` reports those so the page can nudge.
 */
export function buildAnswersPayload(draft: InterviewDraft): AnswerWire[] {
  const out: AnswerWire[] = [];
  for (const f of INTERVIEW_FIELDS) {
    const v = draft[f.fieldKey];
    if (!v) continue;
    const raw = v.raw.trim();
    if (raw === '') continue;
    // A baseless estimate would be rejected by the DB — hold it back.
    if (f.sumber && v.sumber === SUMBER_ANGKA.EstimasiAm && (v.dasar ?? '').trim() === '') continue;

    const row: AnswerWire = {
      section: f.section,
      field_key: f.fieldKey,
      nilai_teks: null,
      nilai_angka: null,
      nilai_uang: null,
      nilai_bool: null,
      nilai_enum: null,
      nilai_jsonb: null,
      sumber_angka: f.sumber && v.sumber ? v.sumber : null,
      dasar_estimasi: f.sumber && v.sumber === SUMBER_ANGKA.EstimasiAm ? (v.dasar ?? '').trim() : null,
      wajib_kosong: false,
    };
    if (f.tipe === 'enum') row.nilai_enum = raw;
    else if (f.tipe === 'money') {
      const minor = rupiahToMinor(raw);
      if (minor === null) continue;
      row.nilai_uang = String(minor);
    } else if (f.tipe === 'persen' || f.tipe === 'angka') {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      row.nilai_angka = n;
    } else {
      row.nilai_teks = raw;
    }
    out.push(row);
  }
  return out;
}

/** Field keys whose estimate is missing its written basis (blocks a clean save). */
export function estimasiTanpaDasar(draft: InterviewDraft): string[] {
  return INTERVIEW_FIELDS.filter((f) => {
    const v = draft[f.fieldKey];
    return !!f.sumber && !!v && v.raw.trim() !== '' && v.sumber === SUMBER_ANGKA.EstimasiAm && (v.dasar ?? '').trim() === '';
  }).map((f) => f.fieldKey);
}

// ===========================================================================
// draft → scorer input (local preview) and score wire (POST /score)
// ===========================================================================

function num(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Which scored fields are still missing/invalid, grouped for the sidebar. */
export interface PreviewMissing {
  fieldKey: string;
  label: string;
}

export interface PreviewResult {
  ready: boolean;
  hasil: HasilKualifikasi | null;
  missing: PreviewMissing[];
}

/**
 * Builds the `KualifikasiInput` from the draft. Returns `null` when a required
 * scored input is missing/invalid — the caller shows what is missing rather than
 * feeding the scorer garbage (an empty enum would index a points map as
 * `undefined` and produce NaN).
 */
export function buildScoreInput(draft: InterviewDraft): { input: KualifikasiInput | null; missing: PreviewMissing[] } {
  const missing: PreviewMissing[] = [];
  const need = (fieldKey: string) => {
    const f = INTERVIEW_FIELDS.find((x) => x.fieldKey === fieldKey)!;
    missing.push({ fieldKey, label: f.label });
    return undefined;
  };

  const enumVal = <T extends string>(fieldKey: string): T | undefined => {
    const raw = (draft[fieldKey]?.raw ?? '').trim();
    return raw === '' ? (need(fieldKey) as undefined) : (raw as T);
  };
  const moneyVal = (fieldKey: string, requirePositive: boolean): bigint | undefined => {
    const minor = rupiahToMinor(draft[fieldKey]?.raw ?? '');
    if (minor === null || (requirePositive && minor <= 0n)) return need(fieldKey) as undefined;
    return minor;
  };

  // Margin (B2-7) — either a stated/estimated net, or derived from gross (B2-8).
  const m = draft['B2-7'];
  const marginRaw = num(m?.raw ?? '');
  const marginSumber = (m?.sumber ?? '') as SumberAngka | '';
  const kotor = num(draft['B2-8']?.raw ?? '');
  let marginBersih: number | null = null;
  let marginBersihSumber: SumberAngka | null = null;
  if (marginSumber === SUMBER_ANGKA.DariMarginKotor) {
    if (kotor === null) need('B2-8');
    marginBersih = null;
    marginBersihSumber = null; // let the resolver derive from gross
  } else if (marginRaw !== null && marginSumber !== '') {
    marginBersih = marginRaw;
    marginBersihSumber = marginSumber;
  } else {
    need('B2-7');
  }

  const modelBisnis = enumVal<ModelBisnis>('B1-4');
  const aov = moneyVal('B2-9', true);
  const ruangHarga = enumVal<RuangHarga>('B3-3');
  const kesanggupanLonjakan = enumVal<KesanggupanLonjakan>('B2-13');
  const siklusBeliUlang = enumVal<SiklusBeliUlang>('B2-11');
  const pembedaProduk = enumVal<PembedaProduk>('B2-10');
  const skuRaw = num(draft['B2-3']?.raw ?? '');
  const skuSiap = skuRaw === null ? (need('B2-3') as unknown as number) : skuRaw;
  const penangananChat = enumVal<PenangananChat>('B4-9');
  const kecepatanApproval = enumVal<KecepatanApproval>('B7-6');
  const kesiapanAkses = enumVal<KesiapanAkses>('B7-3');
  const omzet = moneyVal('B1-5', true);
  const targetOmzet = moneyVal('B6-3', true);
  const dayaTahanBudget = enumVal<DayaTahanBudget>('B6-5');

  if (missing.length > 0) return { input: null, missing };

  const input: KualifikasiInput = {
    marginBersih,
    marginBersihSumber,
    marginBersihDasarEstimasi: marginSumber === SUMBER_ANGKA.EstimasiAm ? (m?.dasar ?? null) : null,
    marginKotor: kotor,
    komisiPlatformPersen: num(draft['B2-7a']?.raw ?? ''),
    ongkirPersen: num(draft['B2-7b']?.raw ?? ''),
    ongkirPerPesanan: null,
    aov: aov!,
    aovSumber: (draft['B2-9']?.sumber || undefined) as SumberAngka | undefined,
    ruangHarga: ruangHarga!,
    modelBisnis: modelBisnis!,
    kesanggupanLonjakan: kesanggupanLonjakan!,
    siklusBeliUlang: siklusBeliUlang!,
    pembedaProduk: pembedaProduk!,
    skuSiap,
    skuSiapSumber: (draft['B2-3']?.sumber || undefined) as SumberAngka | undefined,
    penangananChat: penangananChat!,
    kecepatanApproval: kecepatanApproval!,
    kesiapanAkses: kesiapanAkses!,
    omzet: omzet!,
    omzetSumber: (draft['B1-5']?.sumber || undefined) as SumberAngka | undefined,
    targetOmzet: targetOmzet!,
    targetOmzetSumber: (draft['B6-3']?.sumber || undefined) as SumberAngka | undefined,
    dayaTahanBudget: dayaTahanBudget!,
    resetEkspektasiTertulis: null,
  };
  return { input, missing: [] };
}

/**
 * previewKualifikasi runs the SAME `hitungKualifikasi` the server persists on
 * submit (preview = submit). It never mutates anything — the sidebar reads it on
 * every keystroke.
 */
export function previewKualifikasi(draft: InterviewDraft): PreviewResult {
  const { input, missing } = buildScoreInput(draft);
  if (input === null) return { ready: false, hasil: null, missing };
  try {
    return { ready: true, hasil: hitungKualifikasi(input), missing: [] };
  } catch {
    // resolveMargin can still throw if margin cannot be resolved — surface B2-7.
    return { ready: false, hasil: null, missing: [{ fieldKey: 'B2-7', label: 'Margin bersih (%)' }] };
  }
}

/** The score wire body (snake_case) for POST /interview/{id}/score. */
export interface ScoreWire {
  margin_bersih: number | null;
  margin_bersih_sumber: string | null;
  margin_bersih_dasar_estimasi: string | null;
  margin_kotor: number | null;
  komisi_platform_persen: number | null;
  ongkir_persen: number | null;
  aov: string;
  aov_sumber: string | null;
  ruang_harga: string;
  model_bisnis: string;
  kesanggupan_lonjakan: string;
  siklus_beli_ulang: string;
  pembeda_produk: string;
  sku_siap: number;
  sku_siap_sumber: string | null;
  penanganan_chat: string;
  kecepatan_approval: string;
  kesiapan_akses: string;
  omzet: string;
  omzet_sumber: string | null;
  target_omzet: string;
  target_omzet_sumber: string | null;
  daya_tahan_budget: string;
}

/** Converts a validated `KualifikasiInput` to the snake_case score wire body. */
export function toScoreWire(input: KualifikasiInput): ScoreWire {
  return {
    margin_bersih: input.marginBersih ?? null,
    margin_bersih_sumber: input.marginBersihSumber ?? null,
    margin_bersih_dasar_estimasi: input.marginBersihDasarEstimasi ?? null,
    margin_kotor: input.marginKotor ?? null,
    komisi_platform_persen: input.komisiPlatformPersen ?? null,
    ongkir_persen: input.ongkirPersen ?? null,
    aov: String(input.aov),
    aov_sumber: input.aovSumber ?? null,
    ruang_harga: input.ruangHarga,
    model_bisnis: input.modelBisnis,
    kesanggupan_lonjakan: input.kesanggupanLonjakan,
    siklus_beli_ulang: input.siklusBeliUlang,
    pembeda_produk: input.pembedaProduk,
    sku_siap: input.skuSiap,
    sku_siap_sumber: input.skuSiapSumber ?? null,
    penanganan_chat: input.penangananChat,
    kecepatan_approval: input.kecepatanApproval,
    kesiapan_akses: input.kesiapanAkses,
    omzet: String(input.omzet),
    omzet_sumber: input.omzetSumber ?? null,
    target_omzet: String(input.targetOmzet),
    target_omzet_sumber: input.targetOmzetSumber ?? null,
    daya_tahan_budget: input.dayaTahanBudget,
  };
}
