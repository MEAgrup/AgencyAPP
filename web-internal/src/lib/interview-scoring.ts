/**
 * Modul Interview ("Kelola Klien") — the PURE qualification scorer, for the live
 * sidebar (langkah 7 §7 "sidebar skoring live").
 *
 * ## Why this file exists, and the one rule that keeps it honest
 *
 * The Interview spec is emphatic that Blok C is scored by ONE function, called
 * from BOTH the live form preview AND the submit path — "One implementation,
 * never two." The submit path is `packages/core/src/interview.ts`
 * (`hitungKualifikasi`), run server-side by `POST /interview/{id}/score`, which
 * PERSISTS the result and (when `tidak_siap`) notifies SPV. Running that endpoint
 * on every keystroke would spam notifications and write an audit row per letter —
 * so the pinned sidebar cannot use it. It needs the SAME arithmetic with no side
 * effects.
 *
 * `web-internal` is a standalone Next app with no `@cdps/core` workspace
 * dependency (mirroring `money.ts`, `strategi-target.ts`, and the other FE
 * mirrors the shape-parity gate exists to police), so the pure scorer is PORTED
 * here VERBATIM. This is the second option the SESI29 handoff sanctions
 * ("porting pure hitungKualifikasi"), taken because it is the only one that makes
 * the sidebar live.
 *
 * **This file is a mirror of `packages/core/src/interview.ts` and MUST stay in
 * lock-step with it.** The scoring branches, band defaults, deal-breaker
 * precedence, margin resolution and BEP-ROAS formula are copied exactly. If the
 * core scorer changes, this changes with it — `interview-scoring.test.ts` copies
 * the core band-boundary and deal-breaker cases for exactly this reason: a drift
 * between the two is a preview that lies about what submit will record. The live
 * preview is advisory only; the server-side scorer remains the authority for the
 * persisted verdict.
 *
 * Money is IDR integer minor units (1/100 rupiah — `money.ts`). AOV and omzet
 * bands compare in minor units; percentages are plain numbers (35 = 35%).
 */

/** IDR minor units (1/100 rupiah), same as the core `Money`. */
export type Money = bigint;

// ===========================================================================
// Scoring-input enums (canonical codes; BI display lives in interview-fields.ts)
// ===========================================================================

export const SUMBER_ANGKA = {
  KlienHitung: 'klien_hitung',
  DariMarginKotor: 'dari_margin_kotor',
  EstimasiAm: 'estimasi_am',
} as const;
export type SumberAngka = (typeof SUMBER_ANGKA)[keyof typeof SUMBER_ANGKA];

export const MARGIN_BASIS = {
  BersihKlien: 'bersih_klien',
  DiturunkanDariKotor: 'diturunkan_dari_kotor',
  EstimasiAm: 'estimasi_am',
} as const;
export type MarginBersihBasis = (typeof MARGIN_BASIS)[keyof typeof MARGIN_BASIS];

export const MODEL_BISNIS = {
  Produsen: 'produsen',
  BrandOwner: 'brand_owner',
  ImportirLangsung: 'importir_langsung',
  DistributorResmi: 'distributor_resmi',
  Reseller: 'reseller',
  Dropship: 'dropship',
} as const;
export type ModelBisnis = (typeof MODEL_BISNIS)[keyof typeof MODEL_BISNIS];

export const KESANGGUPAN_LONJAKAN = {
  Sanggup: 'sanggup',
  SanggupSebagian: 'sanggup_sebagian',
  BelumSanggup: 'belum_sanggup',
} as const;
export type KesanggupanLonjakan = (typeof KESANGGUPAN_LONJAKAN)[keyof typeof KESANGGUPAN_LONJAKAN];

export const SIKLUS_BELI_ULANG = {
  HabisPakai: 'habis_pakai',
  Menengah: 'menengah',
  SekaliBeli: 'sekali_beli',
} as const;
export type SiklusBeliUlang = (typeof SIKLUS_BELI_ULANG)[keyof typeof SIKLUS_BELI_ULANG];

export const PEMBEDA_PRODUK = {
  PembedaJelas: 'pembeda_jelas',
  MiripPasaran: 'mirip_pasaran',
  ProdukUmum: 'produk_umum',
} as const;
export type PembedaProduk = (typeof PEMBEDA_PRODUK)[keyof typeof PEMBEDA_PRODUK];

export const RUANG_HARGA = {
  MasihAdaRuang: 'masih_ada_ruang',
  Terbatas: 'terbatas',
  TidakAda: 'tidak_ada',
} as const;
export type RuangHarga = (typeof RUANG_HARGA)[keyof typeof RUANG_HARGA];

export const PENANGANAN_CHAT = {
  TimKhusus: 'tim_khusus',
  OwnerResponsif: 'owner_responsif',
  SeringLewatSehari: 'sering_lewat_sehari',
} as const;
export type PenangananChat = (typeof PENANGANAN_CHAT)[keyof typeof PENANGANAN_CHAT];

export const KECEPATAN_APPROVAL = {
  SatuOrangJelas: 'satu_orang_jelas',
  OwnerSibuk: 'owner_sibuk',
  BelumJelas: 'belum_jelas',
} as const;
export type KecepatanApproval = (typeof KECEPATAN_APPROVAL)[keyof typeof KECEPATAN_APPROVAL];

export const KESIAPAN_AKSES = {
  Penuh: 'penuh',
  Sebagian: 'sebagian',
  Belum: 'belum',
} as const;
export type KesiapanAkses = (typeof KESIAPAN_AKSES)[keyof typeof KESIAPAN_AKSES];

export const DAYA_TAHAN_BUDGET = {
  Enam: 'ge_6_bulan',
  TigaLima: '3_5_bulan',
  Dua: '2_bulan',
  SatuAtauBelumPasti: 'le_1_bulan_atau_belum_pasti',
} as const;
export type DayaTahanBudget = (typeof DAYA_TAHAN_BUDGET)[keyof typeof DAYA_TAHAN_BUDGET];

// ===========================================================================
// Verdict + data-quality + deal-breaker enums
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

export const HAMBATAN = {
  MarginDiBawahMinimum: 'margin_di_bawah_minimum',
  Dropship: 'dropship',
  RasioTargetTerlaluTinggi: 'rasio_target_terlalu_tinggi',
  DayaTahanBudgetTerlaluPendek: 'daya_tahan_budget_terlalu_pendek',
} as const;
export type HambatanKode = (typeof HAMBATAN)[keyof typeof HAMBATAN];

export interface HambatanMendasar {
  kode: HambatanKode;
  nilai: string;
}

export const FLAG = {
  MarginZonaAbuAbu: 'margin_zona_abu_abu',
  BepDiAtasTargetAdvertiser: 'bep_di_atas_target_advertiser',
} as const;
export type Flag = (typeof FLAG)[keyof typeof FLAG];

// ===========================================================================
// Threshold configuration (I15) — every band boundary is DATA, not a literal
// ===========================================================================

export interface Band<T = number> {
  min: T;
  poin: number;
}

export interface KualifikasiConfig {
  skorGrowthReady: number;
  skorBersyaratMin: number;
  marginHambatanPersen: number;
  marginZonaAbuAbuToleransi: number;
  rasioTargetHambatan: number;
  dayaTahanHambatanBulan: number;
  targetRoasAdvertiser: number;
  marginBands: Band[];
  aovBands: Band<bigint>[];
  skuBands: Band[];
  rasioTargetBands: Band[];
}

/** Mirrors `DEFAULT_KUALIFIKASI_CONFIG` / seed of `kualifikasi_config` v1. */
export const DEFAULT_KUALIFIKASI_CONFIG: KualifikasiConfig = {
  skorGrowthReady: 75,
  skorBersyaratMin: 55,
  marginHambatanPersen: 15,
  marginZonaAbuAbuToleransi: 3,
  rasioTargetHambatan: 5,
  dayaTahanHambatanBulan: 1,
  targetRoasAdvertiser: 7.5,
  marginBands: [
    { min: 35, poin: 12 },
    { min: 25, poin: 9 },
    { min: 20, poin: 6 },
    { min: 15, poin: 3 },
  ],
  aovBands: [
    { min: 15_000_000n, poin: 8 },
    { min: 8_000_000n, poin: 6 },
    { min: 5_000_000n, poin: 4 },
    { min: 0n, poin: 2 },
  ],
  skuBands: [
    { min: 30, poin: 5 },
    { min: 10, poin: 4 },
    { min: 3, poin: 2 },
    { min: 0, poin: 1 },
  ],
  rasioTargetBands: [
    { min: 2, poin: 7 },
    { min: 3, poin: 5 },
    { min: 5, poin: 2 },
  ],
};

// ===========================================================================
// Scoring inputs
// ===========================================================================

export interface KualifikasiInput {
  marginBersih?: number | null;
  marginBersihSumber?: SumberAngka | null;
  marginBersihDasarEstimasi?: string | null;
  marginKotor?: number | null;
  komisiPlatformPersen?: number | null;
  ongkirPersen?: number | null;
  ongkirPerPesanan?: Money | null;
  aov: Money;
  aovSumber?: SumberAngka;
  ruangHarga: RuangHarga;
  modelBisnis: ModelBisnis;
  kesanggupanLonjakan: KesanggupanLonjakan;
  siklusBeliUlang: SiklusBeliUlang;
  pembedaProduk: PembedaProduk;
  skuSiap: number;
  skuSiapSumber?: SumberAngka;
  penangananChat: PenangananChat;
  kecepatanApproval: KecepatanApproval;
  kesiapanAkses: KesiapanAkses;
  omzet: Money;
  omzetSumber?: SumberAngka;
  targetOmzet: Money;
  targetOmzetSumber?: SumberAngka;
  dayaTahanBudget: DayaTahanBudget;
  resetEkspektasiTertulis?: {
    targetBaru: Money;
    disetujuiOleh: string;
    disetujuiPada: string;
  } | null;
  defaultKomisiPlatformPersen?: number | null;
  defaultOngkirPersen?: number | null;
}

// ===========================================================================
// Margin-basis resolution (I21 / C-A2)
// ===========================================================================

export interface MarginResolusi {
  marginBersih: number;
  basis: MarginBersihBasis;
  marginKotor: number | null;
  derivasiInput: Record<string, unknown> | null;
}

export function resolveMargin(input: KualifikasiInput): MarginResolusi {
  const kotor = input.marginKotor ?? null;

  if (input.marginBersihSumber === SUMBER_ANGKA.KlienHitung && input.marginBersih != null) {
    return { marginBersih: input.marginBersih, basis: MARGIN_BASIS.BersihKlien, marginKotor: kotor, derivasiInput: null };
  }

  const canDerive = (input.marginBersih == null || input.marginBersihSumber == null) && kotor != null;

  if (!canDerive && input.marginBersihSumber === SUMBER_ANGKA.EstimasiAm && input.marginBersih != null) {
    return { marginBersih: input.marginBersih, basis: MARGIN_BASIS.EstimasiAm, marginKotor: kotor, derivasiInput: null };
  }

  if (canDerive && kotor != null) {
    const komisi = input.komisiPlatformPersen ?? input.defaultKomisiPlatformPersen ?? 0;
    const komisiSumber = input.komisiPlatformPersen != null ? SUMBER_ANGKA.KlienHitung : 'config';
    let ongkirPersen = input.ongkirPersen ?? null;
    let ongkirSumber: string;
    if (ongkirPersen != null) {
      ongkirSumber = SUMBER_ANGKA.KlienHitung;
    } else if (input.ongkirPerPesanan != null && input.aov > 0n) {
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

  if (input.marginBersihSumber === SUMBER_ANGKA.EstimasiAm && input.marginBersih != null) {
    return { marginBersih: input.marginBersih, basis: MARGIN_BASIS.EstimasiAm, marginKotor: kotor, derivasiInput: null };
  }

  throw new Error('interview: margin bersih tidak dapat diselesaikan — B2-7 kosong tanpa B2-8 atau estimasi');
}

// ===========================================================================
// BEP ROAS (I16) — computed, never typed
// ===========================================================================

export interface BepRoasHasil {
  roas: number | null;
  bandLabel: string;
  diAtasTargetAdvertiser: boolean;
}

export function hitungBepRoas(marginBersihPersen: number, targetRoasAdvertiser: number): BepRoasHasil {
  if (!(marginBersihPersen > 0)) {
    return { roas: null, bandLabel: '—', diAtasTargetAdvertiser: false };
  }
  const roas = Math.round((100 / marginBersihPersen) * 10) / 10;
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
  [MODEL_BISNIS.Dropship]: null,
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

function scoreRasioTarget(rasio: number, bands: Band[]): number | null {
  for (const b of bands) {
    if (rasio <= b.min) return b.poin;
  }
  return null;
}

function scoreDayaTahan(d: DayaTahanBudget): number | null {
  switch (d) {
    case DAYA_TAHAN_BUDGET.Enam:
      return 8;
    case DAYA_TAHAN_BUDGET.TigaLima:
      return 5;
    case DAYA_TAHAN_BUDGET.Dua:
      return 2;
    case DAYA_TAHAN_BUDGET.SatuAtauBelumPasti:
      return null;
  }
}

/**
 * hitungKualifikasi — the pure scorer, verbatim from `packages/core`. Deal-breakers
 * are collected but do NOT zero the block scores; `hitungVerdict` applies
 * deal-breaker precedence.
 */
export function hitungKualifikasi(
  input: KualifikasiInput,
  config: KualifikasiConfig = DEFAULT_KUALIFIKASI_CONFIG,
): HasilKualifikasi {
  const hambatan: HambatanMendasar[] = [];
  const flags: Flag[] = [];

  const margin = resolveMargin(input);
  const marginDerivedOrEstimated = margin.basis !== MARGIN_BASIS.BersihKlien;

  let poinMargin: number;
  if (margin.marginBersih < config.marginHambatanPersen) {
    poinMargin = 0;
    hambatan.push({ kode: HAMBATAN.MarginDiBawahMinimum, nilai: `${margin.marginBersih}%` });
  } else {
    poinMargin = scoreDescending(margin.marginBersih, config.marginBands, 0);
  }
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

  const bep = hitungBepRoas(margin.marginBersih, config.targetRoasAdvertiser);
  if (bep.diAtasTargetAdvertiser) {
    flags.push(FLAG.BepDiAtasTargetAdvertiser);
  }

  const poinB1 = POIN_C_B1[input.modelBisnis];
  if (poinB1 === null) {
    hambatan.push({ kode: HAMBATAN.Dropship, nilai: input.modelBisnis });
  }
  const poinB2 = POIN_C_B2[input.kesanggupanLonjakan];
  const blokB = (poinB1 ?? 0) + poinB2;

  const poinC1 = POIN_C_C1[input.siklusBeliUlang];
  const poinC2 = POIN_C_C2[input.pembedaProduk];
  const poinC3 = scoreDescending(input.skuSiap, config.skuBands, 1);
  const blokC = poinC1 + poinC2 + poinC3;

  const blokD = POIN_C_D1[input.penangananChat] + POIN_C_D2[input.kecepatanApproval] + POIN_C_D3[input.kesiapanAkses];

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

  const sumberAngkaPerField: Record<string, SumberAngka | 'config'> = {};
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

/**
 * hitungVerdict — deal-breaker precedence is the FIRST branch, absolute. Verbatim
 * from `packages/core`.
 */
export function hitungVerdict(
  skorTotal: number,
  hambatan: readonly HambatanMendasar[],
  config: KualifikasiConfig = DEFAULT_KUALIFIKASI_CONFIG,
): Verdict {
  if (hambatan.length > 0) {
    return VERDICT.TidakSiap;
  }
  if (skorTotal >= config.skorGrowthReady) {
    return VERDICT.GrowthReady;
  }
  if (skorTotal >= config.skorBersyaratMin) {
    return VERDICT.Bersyarat;
  }
  return VERDICT.RisikoTinggi;
}
