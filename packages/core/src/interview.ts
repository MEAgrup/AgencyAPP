/**
 * Interview module (tab 1 of "Kelola Klien") — the qualification scoring engine
 * and its surrounding pure logic.
 *
 * ## What lives here and why it is ONE file
 *
 * Blok C of the Interview spec is a 100-point qualification score that predicts
 * whether a client's unit economics can survive a contract. The spec is emphatic
 * that the scorer is a single pure function called from BOTH the live form
 * preview AND the submit path — "One implementation, never two." So the scorer,
 * the verdict rule, the margin-basis resolution, the BEP-ROAS computation, the
 * data-quality classifier and the config shape all live together here, in
 * `packages/core`, exactly like `visibility.ts` holds the frozen hard-internal
 * set: the invariant is enforced in code, mirrored by DB checks, and never
 * duplicated in the page that renders it.
 *
 * ## Non-negotiables encoded here (Interview spec + CLAUDE.md)
 *
 *  - **The verdict is advisory. It never blocks.** There is no routing enum, no
 *    reject path, no override column. `verdict` is computed, recorded, and used
 *    downstream only to attach conservative flags to the Strategi (Blok D).
 *  - **A deal-breaker beats the score (I14).** One `hambatan_mendasar` forces
 *    `tidak_siap` even at 90+. This is the FIRST branch of `hitungVerdict`, and a
 *    DB check mirrors it: a row with a non-empty deal-breaker set and any other
 *    verdict is rejected. There is deliberately no override.
 *  - **Thresholds are config, snapshotted per interview (I15).** Every band
 *    boundary is DATA in `KualifikasiConfig`, never a literal in the scoring
 *    branches, so recalibrating never rewrites a past verdict — the caller passes
 *    the interview's stored `config_snapshot` back in.
 *  - **Dual margin, single scoring basis (I21).** Net margin is resolved in a
 *    fixed order (client → derived-from-gross → AM estimate); scoring and BEP
 *    ROAS always run on net. A derived figure is reproducible from
 *    `marginDerivasiInput` alone.
 *  - **Money is IDR integer minor units** (`money.ts`: 1/100 rupiah). AOV and
 *    omzet bands compare in minor units. Percentages are plain numbers (35 = 35%).
 *
 * Nothing here reaches a database. Persistence, RLS and the state machine are the
 * migration's and `packages/db`'s job; this module is pure and unit-tested per
 * band boundary and per deal-breaker.
 */

import type { Money } from './money';

// ===========================================================================
// State machine — the `interview` machine (edges live in the migration)
// ===========================================================================

/** The state-machine name registered in `sm_machines` by the Interview migration. */
export const INTERVIEW_MACHINE = 'interview';

/**
 * Interview lifecycle states. BI labels, because §Blok A / the state machine
 * spell them in Bahasa Indonesia. The actual edges are DB data (sm_edges); these
 * constants are the TS mirror used by handlers and the UI. Bracketed like the
 * other CDPS machines so a raw string never drifts from the seeded state name.
 */
export const INTERVIEW_STATES = {
  BelumDijadwalkan: 'Belum Dijadwalkan',
  Terjadwal: 'Terjadwal',
  DijadwalkanUlang: 'Dijadwalkan Ulang',
  SedangBerlangsung: 'Sedang Berlangsung',
  DraftIsian: 'Draft Isian',
  ButuhDataKlien: 'Butuh Data Klien',
  Diajukan: 'Diajukan',
  Selesai: 'Selesai',
  SelesaiDenganCatatan: 'Selesai Dengan Catatan',
  Dikembalikan: 'Dikembalikan',
  Dibatalkan: 'Dibatalkan',
} as const;

export type InterviewState = (typeof INTERVIEW_STATES)[keyof typeof INTERVIEW_STATES];

/**
 * The two completion states that unlock Strategi (Blok D). Completion — NOT the
 * verdict value — is the only prerequisite for creating a Strategi.
 */
export const INTERVIEW_COMPLETE_STATES: readonly InterviewState[] = [
  INTERVIEW_STATES.Selesai,
  INTERVIEW_STATES.SelesaiDenganCatatan,
];

/** True once the Interview is complete enough to hand off to Strategi. */
export function isInterviewComplete(state: string): boolean {
  return (INTERVIEW_COMPLETE_STATES as readonly string[]).includes(state);
}

// ===========================================================================
// Per-field number source (I3) and margin basis (I21)
// ===========================================================================

/**
 * I3 — "ask first, estimate second, never leave blank." Every scored numeric
 * field records where its number came from. An `estimasi_am` requires a written
 * basis (enforced by a DB check); a blank never satisfies a scored field.
 */
export const SUMBER_ANGKA = {
  KlienHitung: 'klien_hitung',
  DariMarginKotor: 'dari_margin_kotor',
  EstimasiAm: 'estimasi_am',
} as const;
export type SumberAngka = (typeof SUMBER_ANGKA)[keyof typeof SUMBER_ANGKA];

/** I21 / C-A2 — which basis the net margin used for scoring was resolved from. */
export const MARGIN_BASIS = {
  BersihKlien: 'bersih_klien',
  DiturunkanDariKotor: 'diturunkan_dari_kotor',
  EstimasiAm: 'estimasi_am',
} as const;
export type MarginBersihBasis = (typeof MARGIN_BASIS)[keyof typeof MARGIN_BASIS];

// ===========================================================================
// Scoring-input enums (canonical codes; BI display lives in the UI layer)
// ===========================================================================
//
// Answers are stored as these stable codes, not BI prose, so the scorer never
// string-matches a label. The UI maps code <-> BI label.

/** B1-4 model bisnis → C-B1 sumber stok. `dropship` is a deal-breaker. */
export const MODEL_BISNIS = {
  Produsen: 'produsen',
  BrandOwner: 'brand_owner',
  ImportirLangsung: 'importir_langsung',
  DistributorResmi: 'distributor_resmi',
  Reseller: 'reseller',
  Dropship: 'dropship',
} as const;
export type ModelBisnis = (typeof MODEL_BISNIS)[keyof typeof MODEL_BISNIS];

/** B2-13 kesanggupan lonjakan 3x/30 hari → C-B2. */
export const KESANGGUPAN_LONJAKAN = {
  Sanggup: 'sanggup',
  SanggupSebagian: 'sanggup_sebagian',
  BelumSanggup: 'belum_sanggup',
} as const;
export type KesanggupanLonjakan = (typeof KESANGGUPAN_LONJAKAN)[keyof typeof KESANGGUPAN_LONJAKAN];

/** B2-11 siklus beli ulang → C-C1. */
export const SIKLUS_BELI_ULANG = {
  HabisPakai: 'habis_pakai', // < 3 bulan
  Menengah: 'menengah', // 3–12 bulan
  SekaliBeli: 'sekali_beli',
} as const;
export type SiklusBeliUlang = (typeof SIKLUS_BELI_ULANG)[keyof typeof SIKLUS_BELI_ULANG];

/** B2-10 pembeda produk → C-C2. */
export const PEMBEDA_PRODUK = {
  PembedaJelas: 'pembeda_jelas',
  MiripPasaran: 'mirip_pasaran',
  ProdukUmum: 'produk_umum',
} as const;
export type PembedaProduk = (typeof PEMBEDA_PRODUK)[keyof typeof PEMBEDA_PRODUK];

/** B3-3 ruang harga → C-A4. */
export const RUANG_HARGA = {
  MasihAdaRuang: 'masih_ada_ruang',
  Terbatas: 'terbatas',
  TidakAda: 'tidak_ada', // sudah perang harga
} as const;
export type RuangHarga = (typeof RUANG_HARGA)[keyof typeof RUANG_HARGA];

/** B4-9 penanganan chat → C-D1. */
export const PENANGANAN_CHAT = {
  TimKhusus: 'tim_khusus',
  OwnerResponsif: 'owner_responsif',
  SeringLewatSehari: 'sering_lewat_sehari',
} as const;
export type PenangananChat = (typeof PENANGANAN_CHAT)[keyof typeof PENANGANAN_CHAT];

/** B7-6 kecepatan approval → C-D2. */
export const KECEPATAN_APPROVAL = {
  SatuOrangJelas: 'satu_orang_jelas',
  OwnerSibuk: 'owner_sibuk',
  BelumJelas: 'belum_jelas',
} as const;
export type KecepatanApproval = (typeof KECEPATAN_APPROVAL)[keyof typeof KECEPATAN_APPROVAL];

/** B7-3 akses → C-D3. */
export const KESIAPAN_AKSES = {
  Penuh: 'penuh',
  Sebagian: 'sebagian',
  Belum: 'belum',
} as const;
export type KesiapanAkses = (typeof KESIAPAN_AKSES)[keyof typeof KESIAPAN_AKSES];

/** B6-5 daya tahan budget → C-E2. `<=1 bulan atau belum pasti` is a deal-breaker. */
export const DAYA_TAHAN_BUDGET = {
  Enam: 'ge_6_bulan',
  TigaLima: '3_5_bulan',
  Dua: '2_bulan',
  SatuAtauBelumPasti: 'le_1_bulan_atau_belum_pasti',
} as const;
export type DayaTahanBudget = (typeof DAYA_TAHAN_BUDGET)[keyof typeof DAYA_TAHAN_BUDGET];

// ===========================================================================
// Verdict + data-quality enums
// ===========================================================================

export const VERDICT = {
  GrowthReady: 'growth_ready',
  Bersyarat: 'bersyarat',
  RisikoTinggi: 'risiko_tinggi',
  TidakSiap: 'tidak_siap',
} as const;
export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

export const KUALITAS_DATA = {
  Terverifikasi: 'terverifikasi',
  SebagianEstimasi: 'sebagian_estimasi',
  MayoritasEstimasi: 'mayoritas_estimasi',
} as const;
export type KualitasData = (typeof KUALITAS_DATA)[keyof typeof KUALITAS_DATA];

export const PRASYARAT_STATUS = {
  Belum: 'belum',
  Jalan: 'jalan',
  Selesai: 'selesai',
} as const;
export type PrasyaratStatus = (typeof PRASYARAT_STATUS)[keyof typeof PRASYARAT_STATUS];

/** Deal-breaker codes — which C-block fired, kept with the value that fired it. */
export const HAMBATAN = {
  MarginDiBawahMinimum: 'margin_di_bawah_minimum', // C-A2 <15%
  Dropship: 'dropship', // C-B1
  RasioTargetTerlaluTinggi: 'rasio_target_terlalu_tinggi', // C-E1 >5x (no reset)
  DayaTahanBudgetTerlaluPendek: 'daya_tahan_budget_terlalu_pendek', // C-E2 <=1 bln
} as const;
export type HambatanKode = (typeof HAMBATAN)[keyof typeof HAMBATAN];

/** One fired deal-breaker: which rule + the value that tripped it. */
export interface HambatanMendasar {
  kode: HambatanKode;
  nilai: string; // human-readable value that fired it (for the record)
}

/** Advisory flags raised during scoring (never change the score itself). */
export const FLAG = {
  MarginZonaAbuAbu: 'margin_zona_abu_abu', // C-A2 grey zone (I22-adjacent)
  BepDiAtasTargetAdvertiser: 'bep_di_atas_target_advertiser', // BEP ROAS > internal target
} as const;
export type Flag = (typeof FLAG)[keyof typeof FLAG];

// ===========================================================================
// Field-key registry (Blok B) + the two frozen sets
// ===========================================================================
//
// Answers are rows keyed by (section, field_key) — not wide columns — so a
// reduced `interview_profile` (I4) can drop sections without schema churn.
// Only the keys that the scorer, the hard-internal filter, or the prefill
// mapping reference are enumerated here; the full question catalog is data.

/** Blok B section keys. */
export const SECTIONS = {
  B0: 'B0',
  B1: 'B1',
  B2: 'B2',
  B3: 'B3',
  B4: 'B4',
  B5: 'B5',
  B6: 'B6',
  B7: 'B7',
  B8: 'B8',
  B9: 'B9',
  B10: 'B10',
  B11: 'B11',
} as const;
export type Section = (typeof SECTIONS)[keyof typeof SECTIONS];

/**
 * The scoring-input field keys (single-source rule): stored once in Blok B,
 * referenced by Blok C. A scored field may NEVER be submitted blank
 * (`wajib_kosong`) — an estimate or a derived value satisfies it, a blank never
 * does. This list is mirrored by a DB check so a direct API call cannot slip a
 * blank scored field past submit.
 */
export const SCORED_FIELD_KEYS: readonly string[] = [
  'B1-4', // model bisnis        -> C-B1
  'B1-5', // omzet 3 bln         -> C-A1 (denominator) + C-E1
  'B2-3', // SKU siap jual       -> C-C3
  'B2-7', // margin bersih       -> C-A2 (primary)
  'B2-8', // margin kotor        -> C-A2 fallback basis (I21)
  'B2-9', // AOV                 -> C-A3
  'B2-10', // pembeda produk     -> C-C2
  'B2-11', // siklus beli ulang  -> C-C1
  'B2-13', // kesanggupan lonjakan -> C-B2
  'B3-3', // ruang harga         -> C-A4
  'B4-9', // penanganan chat     -> C-D1
  'B6-3', // target omzet 3 bln  -> C-E1
  'B6-5', // daya tahan budget   -> C-E2
  'B7-3', // akses               -> C-D3
  'B7-6', // kecepatan approval  -> C-D2
];

/** True if a field key is a scoring input (blank-submit is forbidden for these). */
export function isScoredField(fieldKey: string): boolean {
  return SCORED_FIELD_KEYS.includes(fieldKey);
}

/**
 * HARD-INTERNAL fields (I13) — never client-visible, not toggleable. All of Blok
 * C and Blok B11, plus specific commercially-sensitive Blok B answers. Mirrored
 * by a DB check and rejected by the TS predicate; the two must not diverge (the
 * `visibility.ts` pattern). A `default` fallback is deliberately absent for the
 * same reason as in `visibility.ts`: an unclassified field must be an explicit
 * decision, never a silent publish or a silent hide.
 *
 * Blok C is referenced by its logical marker `C` (the whole qualification block,
 * which is a separate 1:1 record, is internal in its entirety).
 */
export const HARD_INTERNAL_FIELD_KEYS: readonly string[] = [
  'C', // the entire qualification record (score, verdict, breakdown)
  'B11-1',
  'B11-2',
  'B11-3',
  'B11-4',
  'B11-5',
  'B11-6',
  'B2-7', // margin bersih
  'B2-8', // margin kotor
  'B5-9', // sikap perang harga
  'B6-5', // daya tahan budget
  'B6-6', // budget iklan + sumber dana
];

/** True if a field must never appear in a Sales-role or client-facing payload. */
export function isHardInternal(fieldKey: string): boolean {
  // Any Blok C field (prefixed `C-`) is internal in its entirety, alongside the
  // explicit list. The whole qualification record is one internal unit.
  if (fieldKey === 'C' || fieldKey.startsWith('C-')) {
    return true;
  }
  return HARD_INTERNAL_FIELD_KEYS.includes(fieldKey);
}

// ===========================================================================
// Threshold configuration (I15) — every band boundary is DATA, not a literal
// ===========================================================================

/** A scored band: [`min`, `max`) half-open (inclusive-lower, exclusive-upper). */
export interface Band<T = number> {
  min: T; // inclusive
  poin: number;
}

/**
 * The full threshold config, snapshotted per interview. `config_snapshot` stores
 * exactly this object so a later recalibration of `kualifikasi_config` cannot
 * change a past verdict — the caller passes the stored snapshot back in.
 *
 * Bands are expressed as ordered "min-inclusive" cut points, evaluated top-down;
 * the first band whose `min` the value meets wins. Money bands (`aovBands`)
 * carry `min` in **minor units** (money.ts) so they compare exactly.
 */
export interface KualifikasiConfig {
  // Verdict thresholds
  skorGrowthReady: number; // >= -> growth_ready (default 75)
  skorBersyaratMin: number; // >= -> bersyarat, else risiko_tinggi (default 55)
  // Deal-breaker thresholds
  marginHambatanPersen: number; // net margin < this -> deal-breaker (default 15)
  marginZonaAbuAbuToleransi: number; // ± pp band around the deal-breaker (default 3)
  rasioTargetHambatan: number; // target ratio > this -> deal-breaker (default 5)
  dayaTahanHambatanBulan: number; // <= this months -> deal-breaker (default 1)
  targetRoasAdvertiser: number; // internal advertiser ROAS target (default 7.5)
  // C-A2 net-margin score bands (percent, min-inclusive, descending)
  marginBands: Band[];
  // C-A3 AOV score bands (minor units, min-inclusive, descending)
  aovBands: Band<bigint>[];
  // C-C3 SKU-siap score bands (count, min-inclusive, descending)
  skuBands: Band[];
  // C-E1 target-ratio score bands (ratio, max-inclusive ascending — see note)
  rasioTargetBands: Band[];
}

/**
 * DEFAULT_KUALIFIKASI_CONFIG mirrors the seed of `kualifikasi_config` v1. These
 * are the calibration starting point, expected to move in the first weeks — that
 * is exactly why they are config and snapshotted, not constants.
 */
export const DEFAULT_KUALIFIKASI_CONFIG: KualifikasiConfig = {
  skorGrowthReady: 75,
  skorBersyaratMin: 55,
  marginHambatanPersen: 15,
  marginZonaAbuAbuToleransi: 3,
  rasioTargetHambatan: 5,
  dayaTahanHambatanBulan: 1,
  targetRoasAdvertiser: 7.5,
  // C-A2: >=35 ->12, [25,35) ->9, [20,25) ->6, [15,20) ->3, <15 -> deal-breaker
  marginBands: [
    { min: 35, poin: 12 },
    { min: 25, poin: 9 },
    { min: 20, poin: 6 },
    { min: 15, poin: 3 },
  ],
  // C-A3 (minor units): >=Rp150k ->8, >=Rp80k ->6, >=Rp50k ->4, <Rp50k ->2
  aovBands: [
    { min: 15_000_000n, poin: 8 },
    { min: 8_000_000n, poin: 6 },
    { min: 5_000_000n, poin: 4 },
    { min: 0n, poin: 2 },
  ],
  // C-C3: >=30 ->5, [10,30) ->4, [3,10) ->2, <3 ->1
  skuBands: [
    { min: 30, poin: 5 },
    { min: 10, poin: 4 },
    { min: 3, poin: 2 },
    { min: 0, poin: 1 },
  ],
  // C-E1: <=2 ->7, (2,3] ->5, (3,5] ->2, >5 -> deal-breaker. Stored as
  // max-inclusive ascending cut points (see scoreRasioTarget).
  rasioTargetBands: [
    { min: 2, poin: 7 }, // interpreted as "ratio <= 2"
    { min: 3, poin: 5 }, // "ratio <= 3"
    { min: 5, poin: 2 }, // "ratio <= 5"
  ],
};

// ===========================================================================
// Scoring inputs
// ===========================================================================

/** Static enum-scored inputs (no `sumber_angka`; qualitative client answers). */
export interface KualifikasiInput {
  // C-A · Ekonomi Unit
  /** B2-7 net margin % as given by the client (klien_hitung/estimasi_am). */
  marginBersih?: number | null;
  /** `sumber_angka` recorded on B2-7. */
  marginBersihSumber?: SumberAngka | null;
  /** B2-7c basis text — required when marginBersihSumber = estimasi_am. */
  marginBersihDasarEstimasi?: string | null;
  /** B2-8 gross margin % (always asked; fallback basis for deriving net). */
  marginKotor?: number | null;
  /** B2-7a per-channel platform commission % (client-stated), else config default. */
  komisiPlatformPersen?: number | null;
  /** B2-7b shipping the client bears, as % of price (client-stated), else config. */
  ongkirPersen?: number | null;
  /** B2-7b alt: shipping as Rp/pesanan (minor units) — normalised via AOV. */
  ongkirPerPesanan?: Money | null;
  /** B2-9 AOV in minor units → C-A3, and normalises ongkirPerPesanan → %. */
  aov: Money;
  /** `sumber_angka` on B2-9 (for kualitas_data). */
  aovSumber?: SumberAngka;
  /** B3-3 ruang harga → C-A4. */
  ruangHarga: RuangHarga;

  // C-B · Kesiapan Suplai
  modelBisnis: ModelBisnis; // B1-4 → C-B1
  kesanggupanLonjakan: KesanggupanLonjakan; // B2-13 → C-B2

  // C-C · Produk & Pasar
  siklusBeliUlang: SiklusBeliUlang; // B2-11 → C-C1
  pembedaProduk: PembedaProduk; // B2-10 → C-C2
  skuSiap: number; // B2-3 → C-C3
  skuSiapSumber?: SumberAngka;

  // C-D · Kesiapan Operasional
  penangananChat: PenangananChat; // B4-9 → C-D1
  kecepatanApproval: KecepatanApproval; // B7-6 → C-D2
  kesiapanAkses: KesiapanAkses; // B7-3 → C-D3

  // C-E · Ekspektasi & Daya Tahan
  omzet: Money; // B1-5 → C-A1 (unscored) + denominator for C-E1
  omzetSumber?: SumberAngka;
  targetOmzet: Money; // B6-3 → C-E1 numerator
  targetOmzetSumber?: SumberAngka;
  dayaTahanBudget: DayaTahanBudget; // B6-5 → C-E2
  /**
   * A written expectation reset agreed during the meeting (I / C-E1). When
   * present, `targetBaru` replaces B6-3 and the ratio is recomputed — the score
   * is recomputed, never hand-patched.
   */
  resetEkspektasiTertulis?: {
    targetBaru: Money;
    disetujuiOleh: string;
    disetujuiPada: string; // WIB ISO timestamp
  } | null;

  // Derivation defaults (from margin_deduksi_config) when the client did not
  // state a deduction. The scorer records which was used in marginDerivasiInput.
  defaultKomisiPlatformPersen?: number | null;
  defaultOngkirPersen?: number | null;
}

// ===========================================================================
// Margin-basis resolution (I21 / C-A2)
// ===========================================================================

/** The resolved net margin plus the basis and (when derived) reproducible inputs. */
export interface MarginResolusi {
  marginBersih: number; // resolved net margin %
  basis: MarginBersihBasis;
  marginKotor: number | null;
  derivasiInput: Record<string, unknown> | null;
}

/**
 * resolveMargin picks the net margin used for scoring, in the fixed order the
 * spec locks (I21): (1) client-stated net, (2) derived from gross, (3) AM
 * estimate on net. Every input used in a derivation is stored in `derivasiInput`
 * so the arithmetic is reproducible later — a derived number nobody can re-check
 * is the same as a guess.
 *
 * Throws when none of the three paths can be satisfied — a scored field can never
 * be blank, so the caller must have rejected the answer before scoring.
 */
export function resolveMargin(input: KualifikasiInput): MarginResolusi {
  const kotor = input.marginKotor ?? null;

  // (1) client-stated net.
  if (input.marginBersihSumber === SUMBER_ANGKA.KlienHitung && input.marginBersih != null) {
    return { marginBersih: input.marginBersih, basis: MARGIN_BASIS.BersihKlien, marginKotor: kotor, derivasiInput: null };
  }

  // (3) AM estimate on net — checked before (2) only when the AM explicitly
  // estimated net; otherwise a present gross means we derive. The spec's order
  // is 1→2→3, so we only reach an estimate when net is NOT derivable from gross.
  const canDerive = (input.marginBersih == null || input.marginBersihSumber == null) && kotor != null;

  if (!canDerive && input.marginBersihSumber === SUMBER_ANGKA.EstimasiAm && input.marginBersih != null) {
    return { marginBersih: input.marginBersih, basis: MARGIN_BASIS.EstimasiAm, marginKotor: kotor, derivasiInput: null };
  }

  // (2) derive net from gross: net% = kotor% − komisi_platform% − ongkir%.
  if (canDerive && kotor != null) {
    const komisi = input.komisiPlatformPersen ?? input.defaultKomisiPlatformPersen ?? 0;
    const komisiSumber = input.komisiPlatformPersen != null ? SUMBER_ANGKA.KlienHitung : 'config';
    let ongkirPersen = input.ongkirPersen ?? null;
    let ongkirSumber: string;
    if (ongkirPersen != null) {
      ongkirSumber = SUMBER_ANGKA.KlienHitung;
    } else if (input.ongkirPerPesanan != null && input.aov > 0n) {
      // Normalise Rp/pesanan → % of price using AOV. Both in minor units, so
      // the ratio is unit-free; ×100 for a percentage, rounded to 2 dp.
      ongkirPersen = Math.round((Number(input.ongkirPerPesanan) / Number(input.aov)) * 100 * 100) / 100;
      ongkirSumber = 'dari_rp_per_pesanan';
    } else {
      ongkirPersen = input.defaultOngkirPersen ?? 0;
      ongkirSumber = 'config';
    }
    const net = Math.round((kotor - komisi - ongkirPersen) * 100) / 100;
    return {
      marginBersih: net,
      basis: MARGIN_BASIS.DiturunkanDariKotor,
      marginKotor: kotor,
      derivasiInput: {
        margin_kotor_persen: kotor,
        komisi_platform_persen: komisi,
        komisi_platform_sumber: komisiSumber,
        ongkir_persen: ongkirPersen,
        ongkir_sumber: ongkirSumber,
        ongkir_per_pesanan_minor: input.ongkirPerPesanan != null ? String(input.ongkirPerPesanan) : null,
        aov_minor: String(input.aov),
        rumus: 'net = kotor - komisi_platform - ongkir',
      },
    };
  }

  // Estimate on net as the last resort (basis 3) when gross is unavailable.
  if (input.marginBersihSumber === SUMBER_ANGKA.EstimasiAm && input.marginBersih != null) {
    return { marginBersih: input.marginBersih, basis: MARGIN_BASIS.EstimasiAm, marginKotor: kotor, derivasiInput: null };
  }

  throw new Error('interview: margin bersih tidak dapat diselesaikan — B2-7 kosong tanpa B2-8 atau estimasi');
}

// ===========================================================================
// BEP ROAS (I16) — computed, never typed
// ===========================================================================

/** BEP ROAS interpretation band label (BI). */
export interface BepRoasHasil {
  roas: number | null; // null when margin <= 0 (div-by-zero → '—' in the UI)
  bandLabel: string;
  diAtasTargetAdvertiser: boolean;
}

/**
 * hitungBepRoas computes `100 ÷ margin_bersih_persen` on the resolved net margin
 * and classifies it. Division by a non-positive margin returns `null` (rendered
 * `—`, never an error — CLAUDE.md #7). The advertiser internal ROAS target is
 * config, not a constant.
 */
export function hitungBepRoas(marginBersihPersen: number, targetRoasAdvertiser: number): BepRoasHasil {
  if (!(marginBersihPersen > 0)) {
    return { roas: null, bandLabel: '—', diAtasTargetAdvertiser: false };
  }
  const roas = Math.round((100 / marginBersihPersen) * 10) / 10; // 1 dp, e.g. 6.7
  const diAtas = roas > targetRoasAdvertiser;
  let bandLabel: string;
  if (marginBersihPersen >= 35) bandLabel = 'Ruang lega';
  else if (marginBersihPersen >= 25) bandLabel = 'Sehat';
  else if (marginBersihPersen >= 20) bandLabel = 'Tipis — ads harus sangat efisien';
  else if (marginBersihPersen >= 15) bandLabel = 'Nyaris tidak ada ruang';
  else bandLabel = 'Di atas target internal advertiser (7,5x)';
  return { roas, bandLabel, diAtasTargetAdvertiser: diAtas };
}

// ===========================================================================
// Band helpers
// ===========================================================================

/** First "min-inclusive descending" band the value meets; `fallback` if none. */
function scoreDescending(value: number, bands: Band[], fallback: number): number {
  for (const b of bands) {
    if (value >= b.min) return b.poin;
  }
  return fallback;
}

function scoreDescendingBig(value: bigint, bands: Band<bigint>[], fallback: number): number {
  for (const b of bands) {
    if (value >= b.min) return b.poin;
  }
  return fallback;
}

// ===========================================================================
// The scorer
// ===========================================================================

export interface SkorPerBlok {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
}

export interface HasilKualifikasi {
  skorPerBlok: SkorPerBlok;
  skorTotal: number;
  hambatanMendasar: HambatanMendasar[];
  verdict: Verdict;
  bepRoas: number | null;
  bepRoasBand: string;
  marginBersih: number;
  marginBersihBasis: MarginBersihBasis;
  marginKotor: number | null;
  marginDerivasiInput: Record<string, unknown> | null;
  rasioTarget: number | null;
  kualitasData: KualitasData;
  sumberAngkaPerField: Record<string, SumberAngka | 'config'>;
  flags: Flag[];
  configSnapshot: KualifikasiConfig;
}

const POIN_C_A4: Record<RuangHarga, number> = {
  [RUANG_HARGA.MasihAdaRuang]: 10,
  [RUANG_HARGA.Terbatas]: 5,
  [RUANG_HARGA.TidakAda]: 0,
};
const POIN_C_B1: Record<ModelBisnis, number | null> = {
  [MODEL_BISNIS.Produsen]: 10,
  [MODEL_BISNIS.BrandOwner]: 8,
  [MODEL_BISNIS.ImportirLangsung]: 8,
  [MODEL_BISNIS.DistributorResmi]: 5,
  [MODEL_BISNIS.Reseller]: 2,
  [MODEL_BISNIS.Dropship]: null, // deal-breaker
};
const POIN_C_B2: Record<KesanggupanLonjakan, number> = {
  [KESANGGUPAN_LONJAKAN.Sanggup]: 10,
  [KESANGGUPAN_LONJAKAN.SanggupSebagian]: 5,
  [KESANGGUPAN_LONJAKAN.BelumSanggup]: 0,
};
const POIN_C_C1: Record<SiklusBeliUlang, number> = {
  [SIKLUS_BELI_ULANG.HabisPakai]: 8,
  [SIKLUS_BELI_ULANG.Menengah]: 5,
  [SIKLUS_BELI_ULANG.SekaliBeli]: 2,
};
const POIN_C_C2: Record<PembedaProduk, number> = {
  [PEMBEDA_PRODUK.PembedaJelas]: 7,
  [PEMBEDA_PRODUK.MiripPasaran]: 4,
  [PEMBEDA_PRODUK.ProdukUmum]: 1,
};
const POIN_C_D1: Record<PenangananChat, number> = {
  [PENANGANAN_CHAT.TimKhusus]: 6,
  [PENANGANAN_CHAT.OwnerResponsif]: 4,
  [PENANGANAN_CHAT.SeringLewatSehari]: 1,
};
const POIN_C_D2: Record<KecepatanApproval, number> = {
  [KECEPATAN_APPROVAL.SatuOrangJelas]: 5,
  [KECEPATAN_APPROVAL.OwnerSibuk]: 2,
  [KECEPATAN_APPROVAL.BelumJelas]: 0,
};
const POIN_C_D3: Record<KesiapanAkses, number> = {
  [KESIAPAN_AKSES.Penuh]: 4,
  [KESIAPAN_AKSES.Sebagian]: 2,
  [KESIAPAN_AKSES.Belum]: 0,
};

/** C-E1 target-ratio: <=first ->poin, ..., else deal-breaker. Returns null when a deal-breaker. */
function scoreRasioTarget(rasio: number, bands: Band[]): number | null {
  for (const b of bands) {
    if (rasio <= b.min) return b.poin;
  }
  return null; // exceeds the top cut point -> deal-breaker
}

/** C-E2 daya tahan → points, or null (deal-breaker) for the shortest band. */
function scoreDayaTahan(d: DayaTahanBudget): number | null {
  switch (d) {
    case DAYA_TAHAN_BUDGET.Enam:
      return 8;
    case DAYA_TAHAN_BUDGET.TigaLima:
      return 5;
    case DAYA_TAHAN_BUDGET.Dua:
      return 2;
    case DAYA_TAHAN_BUDGET.SatuAtauBelumPasti:
      return null; // deal-breaker
  }
}

/**
 * hitungKualifikasi — the pure scorer. Deal-breakers are collected but do NOT
 * zero the block scores: the spec wants the full breakdown recorded even when a
 * deal-breaker fires (a 90+ total with one deal-breaker is a real, reportable
 * case). The verdict function is what applies deal-breaker precedence.
 */
export function hitungKualifikasi(
  input: KualifikasiInput,
  config: KualifikasiConfig = DEFAULT_KUALIFIKASI_CONFIG,
): HasilKualifikasi {
  const hambatan: HambatanMendasar[] = [];
  const flags: Flag[] = [];

  // ---- C-A · Ekonomi Unit (30) --------------------------------------------
  const margin = resolveMargin(input);
  const marginDerivedOrEstimated = margin.basis !== MARGIN_BASIS.BersihKlien;

  let poinMargin: number;
  if (margin.marginBersih < config.marginHambatanPersen) {
    poinMargin = 0;
    hambatan.push({ kode: HAMBATAN.MarginDiBawahMinimum, nilai: `${margin.marginBersih}%` });
  } else {
    poinMargin = scoreDescending(margin.marginBersih, config.marginBands, 0);
  }
  // Grey zone (I22-adjacent): derived/estimated margin within ± tolerance of the
  // deal-breaker line. Flag only — never changes the band score or the outcome.
  if (marginDerivedOrEstimated) {
    const lo = config.marginHambatanPersen - config.marginZonaAbuAbuToleransi;
    const hi = config.marginHambatanPersen + config.marginZonaAbuAbuToleransi;
    if (margin.marginBersih >= lo && margin.marginBersih <= hi) {
      flags.push(FLAG.MarginZonaAbuAbu);
    }
  }
  const poinAov = scoreDescendingBig(input.aov, config.aovBands, 0);
  const poinRuang = POIN_C_A4[input.ruangHarga];
  const blokA = poinMargin + poinAov + poinRuang;

  // BEP ROAS (I16) — computed on the resolved net margin.
  const bep = hitungBepRoas(margin.marginBersih, config.targetRoasAdvertiser);
  if (bep.diAtasTargetAdvertiser) {
    flags.push(FLAG.BepDiAtasTargetAdvertiser);
  }

  // ---- C-B · Kesiapan Suplai (20) ------------------------------------------
  const poinB1 = POIN_C_B1[input.modelBisnis];
  if (poinB1 === null) {
    hambatan.push({ kode: HAMBATAN.Dropship, nilai: input.modelBisnis });
  }
  const poinB2 = POIN_C_B2[input.kesanggupanLonjakan];
  const blokB = (poinB1 ?? 0) + poinB2;

  // ---- C-C · Produk & Pasar (20) -------------------------------------------
  const poinC1 = POIN_C_C1[input.siklusBeliUlang];
  const poinC2 = POIN_C_C2[input.pembedaProduk];
  const poinC3 = scoreDescending(input.skuSiap, config.skuBands, 1);
  const blokC = poinC1 + poinC2 + poinC3;

  // ---- C-D · Kesiapan Operasional (15) -------------------------------------
  const blokD = POIN_C_D1[input.penangananChat] + POIN_C_D2[input.kecepatanApproval] + POIN_C_D3[input.kesiapanAkses];

  // ---- C-E · Ekspektasi & Daya Tahan (15) ----------------------------------
  const effectiveTarget = input.resetEkspektasiTertulis?.targetBaru ?? input.targetOmzet;
  let rasioTarget: number | null = null;
  let poinE1 = 0;
  if (input.omzet > 0n) {
    rasioTarget = Math.round((Number(effectiveTarget) / Number(input.omzet)) * 100) / 100;
    const e1 = scoreRasioTarget(rasioTarget, config.rasioTargetBands);
    if (e1 === null) {
      hambatan.push({ kode: HAMBATAN.RasioTargetTerlaluTinggi, nilai: `${rasioTarget}x` });
      poinE1 = 0;
    } else {
      poinE1 = e1;
    }
  }
  const e2 = scoreDayaTahan(input.dayaTahanBudget);
  let poinE2 = 0;
  if (e2 === null) {
    hambatan.push({ kode: HAMBATAN.DayaTahanBudgetTerlaluPendek, nilai: input.dayaTahanBudget });
  } else {
    poinE2 = e2;
  }
  const blokE = poinE1 + poinE2;

  const skorPerBlok: SkorPerBlok = { A: blokA, B: blokB, C: blokC, D: blokD, E: blokE };
  const skorTotal = blokA + blokB + blokC + blokD + blokE;

  // ---- Data quality (I22) --------------------------------------------------
  const sumberAngkaPerField: Record<string, SumberAngka | 'config'> = {};
  // Margin's effective source is its basis mapped to a sumber_angka.
  sumberAngkaPerField['B2-7'] =
    margin.basis === MARGIN_BASIS.BersihKlien
      ? SUMBER_ANGKA.KlienHitung
      : margin.basis === MARGIN_BASIS.DiturunkanDariKotor
        ? SUMBER_ANGKA.DariMarginKotor
        : SUMBER_ANGKA.EstimasiAm;
  if (input.aovSumber) sumberAngkaPerField['B2-9'] = input.aovSumber;
  if (input.skuSiapSumber) sumberAngkaPerField['B2-3'] = input.skuSiapSumber;
  if (input.omzetSumber) sumberAngkaPerField['B1-5'] = input.omzetSumber;
  if (input.targetOmzetSumber) sumberAngkaPerField['B6-3'] = input.targetOmzetSumber;
  const nonClient = Object.values(sumberAngkaPerField).filter((s) => s !== SUMBER_ANGKA.KlienHitung).length;
  const kualitasData: KualitasData =
    nonClient === 0 ? KUALITAS_DATA.Terverifikasi : nonClient <= 2 ? KUALITAS_DATA.SebagianEstimasi : KUALITAS_DATA.MayoritasEstimasi;

  const verdict = hitungVerdict(skorTotal, hambatan, config);

  return {
    skorPerBlok,
    skorTotal,
    hambatanMendasar: hambatan,
    verdict,
    bepRoas: bep.roas,
    bepRoasBand: bep.bandLabel,
    marginBersih: margin.marginBersih,
    marginBersihBasis: margin.basis,
    marginKotor: margin.marginKotor,
    marginDerivasiInput: margin.derivasiInput,
    rasioTarget,
    kualitasData,
    sumberAngkaPerField,
    flags,
    configSnapshot: config,
  };
}

// ===========================================================================
// Verdict (I14) — deal-breaker precedence is the FIRST branch, absolute
// ===========================================================================

/**
 * hitungVerdict applies the verdict rules. A deal-breaker forces `tidak_siap`
 * regardless of the total — this is the first branch and it is not overridable
 * (there is no override path, because work proceeds regardless of verdict). The
 * remaining bands read off the configured thresholds.
 */
export function hitungVerdict(
  skorTotal: number,
  hambatan: readonly HambatanMendasar[],
  config: KualifikasiConfig = DEFAULT_KUALIFIKASI_CONFIG,
): Verdict {
  if (hambatan.length > 0) {
    return VERDICT.TidakSiap; // absolute precedence (I14)
  }
  if (skorTotal >= config.skorGrowthReady) {
    return VERDICT.GrowthReady;
  }
  if (skorTotal >= config.skorBersyaratMin) {
    return VERDICT.Bersyarat;
  }
  return VERDICT.RisikoTinggi;
}

// ===========================================================================
// Blok D — prefill mapping (Interview → Strategi)
// ===========================================================================

/**
 * The exact-mapping prefill entries (I8 / §Blok D). A prefilled Strategi field
 * carries `sumber = 'interview'` + interview id/version and stays AM-editable.
 * This is the authoritative mapping table — the Strategi Section B numeric
 * baseline (B-1…B-8) is DELIBERATELY absent: it stays mandatory manual entry
 * with attached exports and must never be prefilled from Interview.
 */
export interface PrefillEntry {
  interviewField: string;
  strategiField: string;
  catatan?: string;
}

export const PREFILL_MAPPING: readonly PrefillEntry[] = [
  { interviewField: 'B2-1', strategiField: 'A-1' },
  { interviewField: 'B1-4', strategiField: 'A-2' },
  { interviewField: 'B2-8', strategiField: 'A-3', catatan: 'margin KOTOR (not net)' },
  { interviewField: 'B3-2', strategiField: 'A-4' },
  { interviewField: 'B3-1', strategiField: 'A-5' },
  { interviewField: 'B2-12', strategiField: 'A-6' },
  { interviewField: 'B2-14', strategiField: 'A-7' },
  { interviewField: 'B1-8', strategiField: 'A-8' },
  { interviewField: 'B6-2', strategiField: 'A-9', catatan: 'verbatim' },
  { interviewField: 'B1-9', strategiField: 'A-10' },
  { interviewField: 'B10-1', strategiField: 'A-10' },
  { interviewField: 'B8-1', strategiField: 'A-11' },
  { interviewField: 'B8-2', strategiField: 'A-11' },
  { interviewField: 'B8-3', strategiField: 'A-11' },
  { interviewField: 'B8-4', strategiField: 'A-11' },
  { interviewField: 'B8-5', strategiField: 'A-11' },
  { interviewField: 'B8-6', strategiField: 'A-11' },
  { interviewField: 'B7-5', strategiField: 'A-12' },
  { interviewField: 'B7-6', strategiField: 'A-13' },
  { interviewField: 'B7-7', strategiField: 'A-13' },
  { interviewField: 'B7-1', strategiField: 'A-14' },
  { interviewField: 'B7-3', strategiField: 'A-15' },
  { interviewField: 'B7-4', strategiField: 'A-16' },
  { interviewField: 'B7-9', strategiField: 'C-7', catatan: 'prasyarat klien' },
  { interviewField: 'B8-1', strategiField: 'E-4', catatan: 'floor price CANDIDATE — suggestion only' },
];

/** Strategi Section B numeric baseline fields that must NEVER be prefilled. */
export const STRATEGI_BASELINE_FORBIDDEN_PREFILL: readonly string[] = [
  'B-1',
  'B-2',
  'B-3',
  'B-4',
  'B-5',
  'B-6',
  'B-7',
  'B-8',
];

/** True if a Strategi field is a Section B numeric baseline (never prefillable). */
export function isStrategiBaselineForbidden(strategiField: string): boolean {
  return STRATEGI_BASELINE_FORBIDDEN_PREFILL.includes(strategiField);
}

// ===========================================================================
// Blok D — verdict-driven Strategi flags (advisory; nothing blocks)
// ===========================================================================

/** Flags a verdict attaches to the Strategi it unlocks. Never blocks creation. */
export const STRATEGI_FLAG = {
  SasaranKonservatif: 'sasaran_konservatif',
  HambatanMendasarTercatat: 'hambatan_mendasar_tercatat',
  RisikoTinggi: 'risiko_tinggi',
} as const;
export type StrategiFlag = (typeof STRATEGI_FLAG)[keyof typeof STRATEGI_FLAG];

/** What a completed Interview hands to the Strategi it unlocks. */
export interface HandoffKeStrategi {
  /** Strategi is always creatable once the Interview is complete. */
  unlocked: true;
  flags: StrategiFlag[];
  /** B7-9 prasyarat copied into Strategi C-7 as week-1 work. */
  copyPrasyaratKeC7: boolean;
  /** tidak_siap / risiko_tinggi require an AM risk-mitigation / no-growth note. */
  wajibCatatanMitigasi: boolean;
}

/**
 * handoffKeStrategi maps a verdict to what the Strategi carries. **No verdict
 * blocks Strategi creation** (the v5 decision): every branch returns
 * `unlocked: true`. `tidak_siap` and `bersyarat` attach conservative flags and
 * copy prasyarat; `tidak_siap` additionally records the deal-breakers and
 * requires an AM mitigation note before the Strategi is submitted.
 */
export function handoffKeStrategi(verdict: Verdict): HandoffKeStrategi {
  switch (verdict) {
    case VERDICT.GrowthReady:
      return { unlocked: true, flags: [], copyPrasyaratKeC7: false, wajibCatatanMitigasi: false };
    case VERDICT.Bersyarat:
      return {
        unlocked: true,
        flags: [STRATEGI_FLAG.SasaranKonservatif],
        copyPrasyaratKeC7: true,
        wajibCatatanMitigasi: false,
      };
    case VERDICT.RisikoTinggi:
      return {
        unlocked: true,
        flags: [STRATEGI_FLAG.RisikoTinggi],
        copyPrasyaratKeC7: false,
        wajibCatatanMitigasi: true,
      };
    case VERDICT.TidakSiap:
      return {
        unlocked: true,
        flags: [STRATEGI_FLAG.SasaranKonservatif, STRATEGI_FLAG.HambatanMendasarTercatat],
        copyPrasyaratKeC7: true,
        wajibCatatanMitigasi: true,
      };
  }
}

// ===========================================================================
// Blok D — buildStrategiPrefill (Interview answers → Strategi Section A)
// ===========================================================================

/**
 * The subset of an `interview_answer` row `buildStrategiPrefill` reads. The
 * domain `Answer` (packages/domain/src/interview.ts) is structurally a superset
 * of this, so it passes straight in — core stays free of the domain/db types.
 * Values are the six-way typed union of `interview_answer`; which one is
 * populated depends on the field's type.
 */
export interface InterviewAnswerLike {
  fieldKey: string;
  nilaiTeks: string | null;
  nilaiAngka: number | null;
  nilaiUang: number | null;
  nilaiBool: boolean | null;
  nilaiEnum: string | null;
  nilaiJsonb: unknown;
}

/**
 * What a handoff can seed into Strategi Section A. Keys are the camelCase
 * `StrategiKonteks` field names (packages/domain/src/strategi.ts); the domain
 * maps them straight to columns. Every value is AM-editable after handoff — this
 * is a starting draft, never a lock.
 *
 * **DELIBERATELY PARTIAL.** Only the `PREFILL_MAPPING` targets whose value is a
 * safe single drop-in live here. The structured / child-row targets are NOT
 * prefilled by v1 and stay the AM's manual work in the form (see
 * DECISIONS 2026-08-12):
 *   - A-12 decisionMaker  — struct list; the B7-5 answer shape is not assertable.
 *   - A-15 / A-16 akses    — the channel×akses×status matrix (child rows).
 *   - C-7 prasyarat        — child rows; the `copyPrasyaratKeC7` copy is deferred.
 *   - E-4 floor price       — Section E, and only a "candidate — suggestion only".
 */
export interface StrategiPrefill {
  namaBrand?: string;
  modelBisnis?: string;
  marginKotorPersen?: number;
  posisiHarga?: string;
  usp?: string[];
  kapasitasStok?: string;
  plafonUnitPerBulan?: number;
  titikKirimKota?: string;
  ekspektasiKlien?: string;
  riwayatAgensi?: string;
  pantanganKlien?: string[];
}

/**
 * Target enum vocabularies, mirrored from the strategi Section A CHECK
 * constraints (20260806065000_m6a_section_a.sql). A prefill carries an enum
 * across ONLY when the Interview value is already a member; an out-of-vocab
 * value is DROPPED, never forwarded, so a handoff can never fail a strategi
 * CHECK on create. Kept small and stable on purpose — the strategi domain stays
 * the enforcing authority; this is a best-effort filter, not a second gate.
 */
const PREFILL_MODEL_BISNIS: readonly string[] = ['produsen', 'brand_owner', 'distributor', 'reseller'];
const PREFILL_POSISI_HARGA: readonly string[] = ['premium', 'mid', 'budget', 'price_fighter'];
const PREFILL_KAPASITAS_STOK: readonly string[] = ['ready_stock', 'produksi_per_order'];

/**
 * buildStrategiPrefill maps a completed Interview's answers onto a Strategi
 * Section A draft, following `PREFILL_MAPPING`. It is pure, best-effort, and
 * never throws: a missing, blank, or wrong-typed answer simply yields no key, so
 * the Strategi is born with that field empty and the AM fills it. The Section B
 * numeric baseline is never touched (`STRATEGI_BASELINE_FORBIDDEN_PREFILL`) —
 * that stays mandatory manual entry with attached exports.
 */
export function buildStrategiPrefill(answers: readonly InterviewAnswerLike[]): StrategiPrefill {
  const byKey = new Map<string, InterviewAnswerLike>();
  for (const a of answers) byKey.set(a.fieldKey, a);

  const text = (code: string): string | undefined => {
    const v = byKey.get(code)?.nilaiTeks;
    return v != null && v.trim() !== '' ? v : undefined;
  };
  const num = (code: string): number | undefined => {
    const v = byKey.get(code)?.nilaiAngka;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const enumIn = (code: string, vocab: readonly string[]): string | undefined => {
    const v = byKey.get(code)?.nilaiEnum;
    return v != null && vocab.includes(v) ? v : undefined;
  };
  // A list answer may arrive as a jsonb array of strings, as a JSON string of
  // that array (postgres.js hands jsonb back as text on the pooler path), or as
  // a single text answer. All three collapse to string[], with blanks dropped.
  const stringsFrom = (a: InterviewAnswerLike | undefined): string[] => {
    if (!a) return [];
    let j = a.nilaiJsonb;
    if (typeof j === 'string') {
      try {
        j = JSON.parse(j);
      } catch {
        j = null;
      }
    }
    if (Array.isArray(j)) {
      return j.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    }
    if (a.nilaiTeks != null && a.nilaiTeks.trim() !== '') return [a.nilaiTeks];
    return [];
  };

  const out: StrategiPrefill = {};

  const namaBrand = text('B2-1'); // A-1
  if (namaBrand !== undefined) out.namaBrand = namaBrand;

  const modelBisnis = enumIn('B1-4', PREFILL_MODEL_BISNIS); // A-2
  if (modelBisnis !== undefined) out.modelBisnis = modelBisnis;

  const margin = num('B2-8'); // A-3 (margin KOTOR, not net)
  if (margin !== undefined && margin >= 0 && margin <= 100) out.marginKotorPersen = margin;

  const posisiHarga = enumIn('B3-2', PREFILL_POSISI_HARGA); // A-4
  if (posisiHarga !== undefined) out.posisiHarga = posisiHarga;

  const usp = stringsFrom(byKey.get('B3-1')); // A-5
  if (usp.length > 0) out.usp = usp;

  const kapasitas = enumIn('B2-12', PREFILL_KAPASITAS_STOK); // A-6
  if (kapasitas !== undefined) out.kapasitasStok = kapasitas;

  const plafon = num('B2-14'); // A-7
  if (plafon !== undefined && plafon >= 0) out.plafonUnitPerBulan = Math.trunc(plafon);

  const titikKirim = text('B1-8'); // A-8
  if (titikKirim !== undefined) out.titikKirimKota = titikKirim;

  const ekspektasi = text('B6-2'); // A-9 (verbatim client definition of success)
  if (ekspektasi !== undefined) out.ekspektasiKlien = ekspektasi;

  const riwayat = text('B1-9') ?? text('B10-1'); // A-10 (primary B1-9, fallback B10-1)
  if (riwayat !== undefined) out.riwayatAgensi = riwayat;

  // A-11 pantangan — the mapping fans B8-1..B8-6 into one list.
  const pantangan: string[] = [];
  for (const code of ['B8-1', 'B8-2', 'B8-3', 'B8-4', 'B8-5', 'B8-6']) {
    pantangan.push(...stringsFrom(byKey.get(code)));
  }
  if (pantangan.length > 0) out.pantanganKlien = pantangan;

  return out;
}
