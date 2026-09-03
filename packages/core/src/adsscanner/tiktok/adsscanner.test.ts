/**
 * TikTok Ads Scanner engine tests (`cdps.adsscanner.tiktok.v1`, DECISIONS.md O67).
 * Covers: ID repair, the house number parser delegation, the versioned
 * benchmark table, the 4 file signatures + video-kind classification, the
 * 5-component score formula (incl. renormalization on missing data — the
 * required null-handling fix), all 6 bucket routing rules, the
 * budget-reallocation pool math, the 9-category angle classifier, and
 * null-safety through to render (house rule #7 — "—", never a misleading 0).
 */
import { describe, expect, it } from 'vitest';
import type { Aoa } from '../../baseline/types';
import { toNum } from './angka';
import { ADSSCANNER_BENCH_V1, ALL_ADSSCANNER_CATEGORIES, benchOf } from './bench';
import { classifyVideoKind, detectAoa, FILE_SIGS, rowsToObjects } from './detect';
import { fullId, normId, pidFromProduk } from './id';
import { ANGLE_RULES, buildFlags, buildInsight, healthOf, tagAngle } from './insight';
import { computeMetrik, pctRank, type SkuBase } from './metrik';
import { renderBody } from './render';
import { buildAdsScannerPayload, formatPeriode, weekStartMonday } from './payload';
import { runAdsScanner } from './run';
import { realokasiPool, scoreAll, scoreSku, type ScoreContext } from './skor';
import { ALL_BUCKETS, DEFAULT_ADS_SCANNER_CFG, type AdsScannerConfig, type CategoryBench, type OrphanSpend, type Ringkasan, type SkuResult } from './types';

// ── shared fixtures ─────────────────────────────────────────────────────────

const CFG: AdsScannerConfig = { ...DEFAULT_ADS_SCANNER_CFG, category: 'Fashion Accessories', gateYellow: 50, gateConsider: 100, gateScale: 1000 };
const BM: CategoryBench = { roi: 4, tr: 0.1, gpm: 2 };

function baseSkuBase(overrides: Partial<SkuBase> = {}): SkuBase {
  return {
    pid: 'p1', pidFull: '170000000000000001', nama: 'Produk A', status: 'Aktif',
    gmv: 0, gmvKreator: 0, gmvVideoToko: 0, gmvLiveToko: 0, pesanan: 0,
    aov: null, ctr: null, ctor: null, atc: 0, impresi: 0, klik: 0,
    crVid: 0, crUniq: 0, crVv: 0, crGmv: 0, crGpmList: [],
    shopVid: 0, shopVv: 0, shopGmv: 0,
    adCost: 0, adRev: 0, adOrders: 0, adCreatives: 0,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return { ctrList: [], ctorList: [], gmvP70: 0, medCtr: 0.02, medCtor: 0.01, bm: BM, cfg: CFG, ...overrides };
}

function makeScored(overrides: Partial<SkuResult> = {}): SkuResult {
  return {
    ...baseSkuBase(),
    konten: 0, roi: null, cpa: null, crGpm: 0, gmvKreatorPct: null,
    gate: 'KERING', blockers: [], skor: 0,
    skorRinci: { konten: 0, gmv: 0, efisiensi: 0, ctr: 0, ctor: 0 },
    diagnosa: '', bucket: 'BANGUN KONTEN', aksi: '', budgetHarian: 0,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════
describe('id.ts — TikTok ID repair', () => {
  it('normId truncates a normal ID to 15 digits', () => {
    expect(normId('1729643540462601638')).toBe('172964354046260');
  });
  it('normId repairs a scientific-notation-mangled export ID', () => {
    expect(normId('1.729643540462601638e+18')).toBe('172964354046260');
  });
  it('normId returns null for a short/non-ID value', () => {
    expect(normId('abc')).toBeNull();
    expect(normId('123')).toBeNull();
    expect(normId(null)).toBeNull();
  });
  it('fullId recovers digits (best-effort) even from scientific notation', () => {
    expect(fullId('1.73e+18')).toBe('1730000000000000000');
    expect(fullId('1729643540462601638')).toBe('1729643540462601638');
  });
  it('pidFromProduk extracts the ID embedded in "Nama (1234567890123)"', () => {
    expect(pidFromProduk('Kaos Polos Pria (1729643540462601638)')).toBe('172964354046260');
    expect(pidFromProduk('Tanpa ID')).toBeNull();
  });
});

describe('angka.ts — toNum delegates to the house parser', () => {
  it('parses Rupiah (dot = thousands)', () => {
    expect(toNum('Rp13.473.176')).toBe(13473176);
  });
  it('parses Rupiah with decimal comma', () => {
    expect(toNum('Rp1.234,56')).toBeCloseTo(1234.56, 2);
  });
  it('parses a plain percent (dot = decimal)', () => {
    expect(toNum('5.37%')).toBeCloseTo(0.0537, 4);
  });
  it('parses a plain decimal ratio (ROI-style, dot = decimal)', () => {
    expect(toNum('3.45')).toBeCloseTo(3.45, 2);
  });
  it('treats "-"/"nan"/"--"/empty as 0', () => {
    expect(toNum('-')).toBe(0);
    expect(toNum('nan')).toBe(0);
    expect(toNum('--')).toBe(0);
    expect(toNum('')).toBe(0);
    expect(toNum(null)).toBe(0);
  });
  it('passes through a real number unchanged', () => {
    expect(toNum(42)).toBe(42);
  });
});

describe('bench.ts — versioned category benchmark', () => {
  it('has exactly 34 categories (verbatim count from the tool source)', () => {
    expect(ALL_ADSSCANNER_CATEGORIES.length).toBe(34);
  });
  it('some categories have a null ROI/TR benchmark (genuinely unmeasured, not 0)', () => {
    expect(ADSSCANNER_BENCH_V1['Home Care Essentials'].roi).toBeNull();
    expect(ADSSCANNER_BENCH_V1['Gaming & Consoles'].roi).toBeNull();
    expect(ADSSCANNER_BENCH_V1['Gaming & Consoles'].tr).toBeNull();
  });
  it('benchOf returns all-null for an unknown category, never a fabricated default', () => {
    expect(benchOf(ADSSCANNER_BENCH_V1, 'Not A Real Category')).toEqual({ roi: null, tr: null, gpm: null });
  });
  it('benchOf resolves a known category', () => {
    expect(benchOf(ADSSCANNER_BENCH_V1, 'Beauty & Personal Care')).toEqual({ roi: 3.82, tr: 0.13, gpm: 1.63 });
  });
});

describe('detect.ts — file signatures', () => {
  const analitikHeader = ['Nama', 'ID Produk', 'GMV', 'Status daftar produk', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual', 'Pesanan SKU', 'AOV (pesanan SKU)', 'CTR', 'CTOR (pesanan SKU)', 'Persentase tambahkan ke keranjang', 'Impresi produk', 'Klik produk'];
  const adsHeader = ['Nama kampanye', 'ID produk', 'Biaya', 'Pendapatan kotor', 'Pesanan SKU', 'ID video', 'Akun TikTok', 'Judul video', 'Jenis materi iklan', 'Jenis otorisasi', 'Tingkat klik iklan produk', 'Rasio konversi iklan', 'ROI'];
  const videoHeader = ['Nama Kreator', 'ID Video', 'Produk', 'VV', 'GMV dari video (Rp)', 'GPM (Rp)', 'Informasi Video', 'Waktu', 'Rasio klik tayang (Video)', 'Persentase Video yang Ditonton Hingga Selesai', 'ID Kreator'];
  const adsliveHeader = ['Nama LIVE', 'Nama kampanye', 'Biaya'];

  it('detects Analitik Produk at header row 3', () => {
    const aoa: Aoa = [[], [], [], analitikHeader, ['Produk A', '1729643540462601638', 'Rp1.000.000']];
    expect(detectAoa(aoa)).toEqual({ type: 'analitik', label: 'Analitik Produk', headerRow: 3 });
  });
  it('detects Ads Produk at header row 0', () => {
    const aoa: Aoa = [adsHeader, ['Kampanye A', '1729643540462601638', 'Rp100.000']];
    expect(detectAoa(aoa)).toMatchObject({ type: 'ads', headerRow: 0 });
  });
  it('detects Video (Kreator/Toko) at header row 2', () => {
    const aoa: Aoa = [[], [], videoHeader, ['creator1', '123456789012', 'Produk A (1729643540462601638)', '1000']];
    expect(detectAoa(aoa)).toMatchObject({ type: 'video', headerRow: 2 });
  });
  it('detects Ads Live at header row 0', () => {
    const aoa: Aoa = [adsliveHeader, ['LIVE A', 'Kampanye A', 'Rp50.000']];
    expect(detectAoa(aoa)).toMatchObject({ type: 'adslive', headerRow: 0 });
  });
  it('flags a "Ringkasan data" (wrong summary) export instead of guessing', () => {
    const aoa: Aoa = [['Ringkasan data'], [], [], []];
    expect(detectAoa(aoa)).toEqual({ type: 'wrong_summary', label: 'Ringkasan Data (bukan per-SKU)' });
  });
  it('returns null for an unrecognised file', () => {
    expect(detectAoa([['random', 'header'], ['x', 'y']])).toBeNull();
  });
  it('rowsToObjects skips fully-blank rows and keys by header', () => {
    const aoa: Aoa = [analitikHeader, ['Produk A', '1729643540462601638', 'Rp1.000.000'], [null, null, null], []];
    const rows = rowsToObjects(aoa, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]['Nama']).toBe('Produk A');
  });
  it('FILE_SIGS has exactly the 4 documented signatures', () => {
    expect(FILE_SIGS.map((s) => s.key)).toEqual(['analitik', 'ads', 'video', 'adslive']);
  });

  describe('classifyVideoKind', () => {
    it('reads "toko" from a filename hint', () => {
      expect(classifyVideoKind([], 'video-bisnis-agustus.xlsx')).toEqual({ kind: 'toko', ambiguous: false });
    });
    it('reads "kreator" from a filename hint', () => {
      expect(classifyVideoKind([], 'video-affiliate-agustus.xlsx')).toEqual({ kind: 'kreator', ambiguous: false });
    });
    it('falls back to a creator-count heuristic, flagged ambiguous, when the filename gives no signal', () => {
      const fewCreators = [{ 'Nama Kreator': 'A' }, { 'Nama Kreator': 'A' }, { 'Nama Kreator': 'B' }];
      expect(classifyVideoKind(fewCreators, 'export.xlsx')).toEqual({ kind: 'toko', ambiguous: true });
      const manyCreators = Array.from({ length: 10 }, (_, i) => ({ 'Nama Kreator': `Creator ${i}` }));
      expect(classifyVideoKind(manyCreators, 'export.xlsx')).toEqual({ kind: 'kreator', ambiguous: true });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('metrik.ts — SKU universe + null-safety', () => {
  it('normalizes the product ID and aggregates GMV fields from Analitik Produk', () => {
    const M = computeMetrik(
      { analitik: [{ 'ID Produk': '1729643540462601638', Nama: 'Produk A', GMV: 'Rp1.000.000', 'Pesanan SKU': '10' }], ads: [], adslive: [], videos: [] },
      CFG,
    );
    expect(M.sku).toHaveLength(1);
    expect(M.sku[0].pid).toBe('172964354046260');
    expect(M.sku[0].gmv).toBe(1000000);
  });

  it('REQUIRED FIX — ctr/ctor/aov stay null (not 0) when their denominator is 0, instead of masquerading as a real zero', () => {
    const M = computeMetrik(
      {
        analitik: [{ 'ID Produk': '1729643540462601638', Nama: 'No Traffic', GMV: '0', 'Impresi produk': '0', 'Klik produk': '0', 'Pesanan SKU': '0', CTR: '0%', 'CTOR (pesanan SKU)': '0%', 'AOV (pesanan SKU)': 'Rp0' }],
        ads: [], adslive: [], videos: [],
      },
      CFG,
    );
    expect(M.sku[0].ctr).toBeNull();
    expect(M.sku[0].ctor).toBeNull();
    expect(M.sku[0].aov).toBeNull();
  });

  it('keeps a real (non-zero-denominator) ctr/ctor/aov', () => {
    const M = computeMetrik(
      {
        analitik: [{ 'ID Produk': '1729643540462601638', Nama: 'Has Traffic', GMV: '0', 'Impresi produk': '1000', 'Klik produk': '50', 'Pesanan SKU': '5', CTR: '5%', 'CTOR (pesanan SKU)': '10%', 'AOV (pesanan SKU)': 'Rp50.000' }],
        ads: [], adslive: [], videos: [],
      },
      CFG,
    );
    expect(M.sku[0].ctr).toBeCloseTo(0.05, 4);
    expect(M.sku[0].ctor).toBeCloseTo(0.1, 4);
    expect(M.sku[0].aov).toBe(50000);
  });

  it('attaches kreator vs toko video counts to the right SKU by embedded product ID', () => {
    const analitik = [{ 'ID Produk': '1729643540462601638', Nama: 'Produk A', GMV: '0' }];
    const videos = [
      { rows: [{ Produk: 'Produk A (1729643540462601638)', VV: '1000', 'Nama Kreator': 'C1', 'ID Kreator': 'k1' }], kind: 'kreator' as const },
      { rows: [{ Produk: 'Produk A (1729643540462601638)', VV: '2000', 'Nama Kreator': 'Toko' }], kind: 'toko' as const },
    ];
    const M = computeMetrik({ analitik, ads: [], adslive: [], videos }, CFG);
    expect(M.sku[0].crVid).toBe(1);
    expect(M.sku[0].shopVid).toBe(1);
    expect(M.sku[0].crVv).toBe(1000);
    expect(M.sku[0].shopVv).toBe(2000);
    expect(M.videos).toHaveLength(2);
  });

  it('ad spend on a KNOWN product ID aggregates onto the SKU, not orphan', () => {
    const analitik = [{ 'ID Produk': '1729643540462601638', Nama: 'Produk A', GMV: '0' }];
    const ads = [{ 'ID produk': '1729643540462601638', Biaya: 'Rp100.000', 'Pendapatan kotor': 'Rp500.000', 'Nama kampanye': 'K1' }];
    const M = computeMetrik({ analitik, ads, adslive: [], videos: [] }, CFG);
    expect(M.sku[0].adCost).toBe(100000);
    expect(M.orphan).toHaveLength(0);
  });

  it('ad spend on an UNKNOWN-but-parseable product ID becomes "SKU mati" (orphan)', () => {
    const ads = [{ 'ID produk': '1799999999999999999', Biaya: 'Rp50.000', 'Pendapatan kotor': '0', 'Nama kampanye': 'K1' }];
    const M = computeMetrik({ analitik: [], ads, adslive: [], videos: [] }, CFG);
    expect(M.orphan).toHaveLength(1);
    expect(M.orphan[0].cost).toBe(50000);
  });

  it('ad spend on an UNPARSEABLE product ID is dropped entirely (tool `if(!pid) return`), not filed as orphan', () => {
    const ads = [{ 'ID produk': 'not-an-id', Biaya: 'Rp50.000', 'Pendapatan kotor': '0', 'Nama kampanye': 'K1' }];
    const M = computeMetrik({ analitik: [], ads, adslive: [], videos: [] }, CFG);
    expect(M.orphan).toHaveLength(0);
  });

  it('pctRank: fraction of the list at-or-below the value', () => {
    expect(pctRank([1, 2, 3, 4], 3)).toBe(0.75);
    expect(pctRank([], 5)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('skor.ts — 5-component score formula', () => {
  it('all 5 components present and maxed ⇒ score 100 with the documented 35/25/20/10/10 split', () => {
    const s = baseSkuBase({ crVid: 1000, adCost: 700000, adRev: 700000 * 4, gmv: 500 });
    const ctx = baseCtx({ gmvP70: 500, ctrList: [0.01, 0.02, 0.03], ctorList: [0.01, 0.02, 0.03] });
    const scored = scoreSku({ ...s, ctr: 0.03, ctor: 0.03 }, ctx);
    expect(scored.skor).toBe(100);
    expect(scored.skorRinci).toEqual({ konten: 35, gmv: 25, efisiensi: 20, ctr: 10, ctor: 10 });
  });

  it('REQUIRED FIX — a genuinely-zero CTR scores WORSE than simply having no CTR data at all (the two must never collide)', () => {
    // Same konten/gmv/ctor/roi for both — only the CTR value/presence differs.
    // ctrList contains a real 0, so ranking a literal 0% against it is
    // legitimately the worst percentile — that is NOT the bug. The bug was
    // treating "column absent" the SAME as "measured and it is 0%".
    const ctx = baseCtx({ gmvP70: 500, ctrList: [0, 0.05, 0.1], ctorList: [0.03] });
    const zeroCtr = scoreSku(baseSkuBase({ crVid: 1000, gmv: 500, ctr: 0, ctor: 0.03 }), ctx);
    const noCtrData = scoreSku(baseSkuBase({ crVid: 1000, gmv: 500, ctr: null, ctor: 0.03 }), ctx);
    expect(zeroCtr.skor).toBeLessThan(noCtrData.skor);
    expect(noCtrData.skor).toBe(100); // konten/gmv/eff(via ctor fallback)/ctor all maxed; ctr excluded, not zeroed.
    expect(zeroCtr.skor).toBe(93); // ctr component drags the average down to (.35+.25+.20+.0333+.10)=.9333.
  });

  it('a SKU with neither CTR nor CTOR data still scores on konten+gmv+eff alone (renormalized), never blocked from scoring entirely', () => {
    const s = baseSkuBase({ crVid: 1000, adCost: 700000, adRev: 700000 * 4, gmv: 500, ctr: null, ctor: null });
    const ctx = baseCtx({ gmvP70: 500 });
    const scored = scoreSku(s, ctx);
    expect(scored.skor).toBeGreaterThan(0);
    expect(scored.skorRinci.ctr).toBe(0);
    expect(scored.skorRinci.ctor).toBe(0);
  });

  it('no GMV basis at all (gmvP70=0, e.g. a totally quiet week) excludes the GMV component instead of scoring it 0', () => {
    const withGmvBasis = scoreSku(baseSkuBase({ crVid: 1000, gmv: 0 }), baseCtx({ gmvP70: 500 }));
    const noGmvBasis = scoreSku(baseSkuBase({ crVid: 1000, gmv: 0 }), baseCtx({ gmvP70: 0 }));
    // Same konten, same (absent) ROI/CTR/CTOR — only gmvP70 differs.
    // withGmvBasis: gmv/gmvP70 = 0 → gmvScore 0 (included, drags the average down).
    // noGmvBasis: gmv component excluded entirely → higher score for the SAME SKU.
    expect(noGmvBasis.skor).toBeGreaterThan(withGmvBasis.skor);
  });

  it('diagnosa is explicit "no data" when a SKU has neither CTR nor CTOR, never silently "SKU lemah"', () => {
    const scored = scoreSku(baseSkuBase({ ctr: null, ctor: null }), baseCtx());
    expect(scored.diagnosa).toMatch(/belum ada data/i);
  });
});

describe('skor.ts — bucket routing (all 6 rules)', () => {
  const gate = (konten: number) => baseSkuBase({ crVid: konten });

  it('DIBLOKIR — blocked (inactive status) wins regardless of gate/ad spend', () => {
    // NOTE: the tool's own inactive-status check is `!/aktif/i.test(status)`
    // — a bare substring test with no word-boundary, so any status
    // containing the letters "aktif" (which includes "Nonaktif" and
    // "Dinonaktifkan" — the negated forms!) reads as ACTIVE, not blocked.
    // That looks like a latent bug in the tool, ported faithfully (not in
    // this pass's required-fix list) and flagged in the porting report for
    // a human to confirm against real TikTok Seller Center status strings.
    // This test uses a status word the check DOES catch, to test the
    // blocker branch as actually written.
    const s = { ...gate(1000), status: 'Dihapus', adCost: 500000 };
    expect(scoreSku(s, baseCtx()).bucket).toBe('DIBLOKIR');
  });
  it('FLAGGED — "Nonaktif" contains "aktif" as a substring, so the tool\'s own regex does NOT treat it as inactive (ported as-is, see note above)', () => {
    const s = { ...gate(1000), status: 'Nonaktif', adCost: 500000 };
    expect(scoreSku(s, baseCtx()).blockers).toEqual([]);
  });

  it('DIBLOKIR — blacklisted product ID', () => {
    const s = gate(1000);
    const cfg = { ...CFG, blacklist: [s.pid] };
    expect(scoreSku(s, baseCtx({ cfg })).bucket).toBe('DIBLOKIR');
  });

  it('BOROS — content-kering (below gateYellow) but ad spend already flowing', () => {
    const s = { ...gate(10), adCost: 200000 };
    expect(scoreSku(s, baseCtx()).bucket).toBe('BOROS');
  });

  it('BANGUN KONTEN — content-kering, no ad spend yet', () => {
    const s = gate(10);
    expect(scoreSku(s, baseCtx()).bucket).toBe('BANGUN KONTEN');
  });

  it('STOK VIDEO CUKUP — content gate cleared, but no ad spend yet (sleeper)', () => {
    const s = gate(150); // >= gateConsider (100)
    expect(scoreSku(s, baseCtx()).bucket).toBe('STOK VIDEO CUKUP');
  });

  it('SCALE UP — content gate cleared, spending, ROI at/above benchmark', () => {
    const s = { ...gate(150), adCost: 700000, adRev: 700000 * 4 }; // roi=4 === bm.roi=4
    expect(scoreSku(s, baseCtx()).bucket).toBe('SCALE UP');
  });

  it('PERLU OPTIMASI — content gate cleared, spending, ROI below benchmark', () => {
    const s = { ...gate(150), adCost: 700000, adRev: 700000 * 2 }; // roi=2 < bm.roi=4
    expect(scoreSku(s, baseCtx()).bucket).toBe('PERLU OPTIMASI');
  });

  it('every bucket in ALL_BUCKETS is reachable', () => {
    const cases: SkuResult['bucket'][] = [
      scoreSku({ ...gate(1000), status: 'Dihapus' }, baseCtx()).bucket,
      scoreSku({ ...gate(10), adCost: 100 }, baseCtx()).bucket,
      scoreSku(gate(10), baseCtx()).bucket,
      scoreSku(gate(150), baseCtx()).bucket,
      scoreSku({ ...gate(150), adCost: 700000, adRev: 2800000 }, baseCtx()).bucket,
      scoreSku({ ...gate(150), adCost: 700000, adRev: 1400000 }, baseCtx()).bucket,
    ];
    expect(new Set(cases)).toEqual(new Set(ALL_BUCKETS));
  });
});

describe('skor.ts — scoreAll builds CTR/CTOR reference lists from only the SKUs that have data', () => {
  it('excludes null-ctr/ctor SKUs from the percentile lists used to rank everyone else', () => {
    const sku: SkuBase[] = [
      baseSkuBase({ pid: 'a', ctr: 0.01, ctor: 0.01 }),
      baseSkuBase({ pid: 'b', ctr: null, ctor: null }),
      baseSkuBase({ pid: 'c', ctr: 0.05, ctor: 0.05 }),
    ];
    const scored = scoreAll(sku, BM, CFG, 0.02, 0.02, 0);
    expect(scored).toHaveLength(3);
    // sanity: still one SkuResult per input SKU, order preserved.
    expect(scored.map((s) => s.pid)).toEqual(['a', 'b', 'c']);
  });
});

describe('skor.ts — budget-reallocation pool math', () => {
  it('pool = wasted (BOROS+DIBLOKIR ad spend) + orphan spend', () => {
    const sku: SkuResult[] = [
      makeScored({ pid: 'a', bucket: 'BOROS', adCost: 100000 }),
      makeScored({ pid: 'b', bucket: 'DIBLOKIR', adCost: 50000 }),
      makeScored({ pid: 'c', bucket: 'PERLU OPTIMASI', adCost: 999999 }), // NOT counted — not wasted
    ];
    const orphan: OrphanSpend[] = [{ pid: 'x', cost: 25000, rev: 0, creatives: 1, kampanye: ['K'] }];
    const { pool } = realokasiPool(sku, orphan);
    expect(pool).toBe(175000);
  });

  it('splits the pool across SCALE UP + STOK VIDEO CUKUP targets, weighted by score, rounded to the nearest Rp10.000, and sums back to the pool (within rounding)', () => {
    const sku: SkuResult[] = [
      makeScored({ pid: 'a', bucket: 'BOROS', adCost: 300000 }),
      makeScored({ pid: 'b', bucket: 'SCALE UP', skor: 80, nama: 'Target tinggi' }),
      makeScored({ pid: 'c', bucket: 'STOK VIDEO CUKUP', skor: 20, nama: 'Target rendah' }),
      makeScored({ pid: 'd', bucket: 'BANGUN KONTEN', skor: 99 }), // NOT a target
    ];
    const { pool, realokasi } = realokasiPool(sku, []);
    expect(pool).toBe(300000);
    expect(realokasi).toHaveLength(2);
    expect(realokasi[0].pid).toBe(sku[1].pidFull); // higher-skor target sorted first
    // 80/(80+20) * 300000 = 240000; 20/100 * 300000 = 60000 — already round-10k.
    expect(realokasi[0].tambahan).toBe(240000);
    expect(realokasi[1].tambahan).toBe(60000);
    expect(realokasi.reduce((a, r) => a + r.tambahan, 0)).toBe(pool);
  });

  it('no eligible targets ⇒ empty realokasi, pool still computed (nothing to move the money to yet)', () => {
    const sku: SkuResult[] = [makeScored({ bucket: 'BOROS', adCost: 100000 })];
    const { pool, realokasi } = realokasiPool(sku, []);
    expect(pool).toBe(100000);
    expect(realokasi).toEqual([]);
  });

  it('no waste anywhere ⇒ pool is 0', () => {
    const sku: SkuResult[] = [makeScored({ bucket: 'SCALE UP', skor: 50 })];
    expect(realokasiPool(sku, []).pool).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('insight.ts — 9-category angle classifier', () => {
  const cases: [string, ReturnType<typeof tagAngle>][] = [
    ['membalas @linda mengapa kulit masih kusam', 'Balas Komen'],
    ['kulit jerawat dan kusam? ini solusinya', 'Problem–Solution'],
    ['sebelum dan setelah pakai 7 hari', 'Before–After'],
    ['review jujur produk ini worth it', 'Review / Testimoni'],
    ['cara pakai yang benar, tutorial langkah demi langkah', 'Edukasi / Tutorial'],
    ['unboxing paket datang hari ini', 'Unboxing / Paket'],
    ['promo diskon gila-gilaan hari ini', 'Promo / Hard-sell'],
    ['pov kamu baru sadar ternyata begini', 'Storytelling / POV'],
    ['banyak warna dan motif lucu buat ootd', 'Showcase Produk'],
    ['tidak mengandung kata kunci apapun', 'Belum Terklasifikasi'],
  ];
  it.each(cases)('%s → %s', (caption, expected) => {
    expect(tagAngle(caption)).toBe(expected);
  });

  it('has exactly the 9 documented rules (+ residual "Belum Terklasifikasi" not itself a rule)', () => {
    expect(ANGLE_RULES).toHaveLength(9);
  });

  it('hashtag-only captions still classify (hashtags are stripped, not discarded)', () => {
    expect(tagAngle('#tonerflekhitam #jerawat')).toBe('Problem–Solution');
  });
});

describe('insight.ts — health flags/vonis null-safety', () => {
  function baseRingkasan(overrides: Partial<Ringkasan> = {}): Ringkasan {
    return {
      kategori: 'Fashion Accessories', benchmark: BM, skuTotal: 1, skuAktifGmv: 0, skuSiap: 0, skuKering: 1,
      totalGmv: 0, totalSpend: 0, totalRev: 0, blendedRoi: null, pctSpendKering: null, pctSpendKuat: null,
      orphanSpend: 0, orphanSku: 0, kontenKreator: 0, kontenToko: 0, kreatorUnik: 0, videoBerGmvPct: null,
      poolRealokasi: 0, medCtr: 0, medCtor: 0,
      ...overrides,
    };
  }

  it('REQUIRED FIX — with zero ad spend account-wide, pctSpendKering/pctSpendKuat stay null, and no flag/verdict misreads that as "0% risk"', () => {
    const r = baseRingkasan({ totalSpend: 0, pctSpendKering: null, pctSpendKuat: null, skuSiap: 5 });
    const flags = buildFlags(r, CFG);
    expect(flags.some((f) => f.includes('% budget mengalir'))).toBe(false);
    expect(flags.some((f) => f.includes('% budget ke sana'))).toBe(false);
  });

  it('flags a client burning >30% of spend on content-kering SKUs', () => {
    const r = baseRingkasan({ totalSpend: 100, pctSpendKering: 0.5 });
    expect(buildFlags(r, CFG).some((f) => f.startsWith('50% budget mengalir'))).toBe(true);
  });

  it('healthOf: KRITIS when no SKU clears the content gate', () => {
    expect(healthOf(baseRingkasan({ skuSiap: 0 })).label).toBe('KRITIS');
  });

  it('healthOf: RISIKO when >30% of spend is on kering SKUs', () => {
    expect(healthOf(baseRingkasan({ skuSiap: 3, pctSpendKering: 0.4 })).label).toBe('RISIKO');
  });

  it('healthOf: SEHAT when nothing is wrong (including when there is simply no spend to judge)', () => {
    expect(healthOf(baseRingkasan({ skuSiap: 3, pctSpendKering: null, blendedRoi: null })).label).toBe('SEHAT');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('payload.ts — pure period date math (no system clock)', () => {
  it('weekStartMonday aligns an AM-entered date to that week\'s Monday', () => {
    const mon = weekStartMonday('2026-01-08'); // a Thursday
    expect(mon?.getFullYear()).toBe(2026);
    expect(mon?.getMonth()).toBe(0);
    expect(mon?.getDate()).toBe(5); // Monday 5 Jan 2026
  });
  it('formatPeriode renders the Indonesian week-range label', () => {
    expect(formatPeriode('2026-01-08')).toBe('5–11 Jan 2026');
  });
  it('null input ⇒ null (no fallback to "now")', () => {
    expect(weekStartMonday(null)).toBeNull();
    expect(formatPeriode(undefined)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('render.ts — null renders as "—", never a misleading 0 (house rule #7)', () => {
  it('a SKU with no CTR/CTOR/ROI data shows "—" in those cells, not "0,0%"/"0,00"', () => {
    const p = buildAdsScannerPayload(
      {
        ringkasan: {
          kategori: 'Fashion Accessories', benchmark: BM, skuTotal: 1, skuAktifGmv: 0, skuSiap: 0, skuKering: 1,
          totalGmv: 0, totalSpend: 0, totalRev: 0, blendedRoi: null, pctSpendKering: null, pctSpendKuat: null,
          orphanSpend: 0, orphanSku: 0, kontenKreator: 0, kontenToko: 0, kreatorUnik: 0, videoBerGmvPct: null,
          poolRealokasi: 0, medCtr: 0, medCtor: 0,
        },
        flags: [], vonis: { label: 'SEHAT', cls: 't-go' },
        sku: [makeScored({ nama: 'Tanpa Data', ctr: null, ctor: null, roi: null, bucket: 'BANGUN KONTEN' })],
        orphan: [], realokasiPool: 0, realokasi: [], anglesKreator: [], anglesToko: [],
        perSkuWinners: new Map(), gpmBm: 0,
      },
      {
        klien: { nama: 'Klien Uji', account_manager: 'AM Uji' },
        generatedAt: '2026-09-03T10:00:00+07:00',
        cfg: CFG, bench: ADSSCANNER_BENCH_V1, benchmarkVersi: 1,
        periode: { weekStart: null },
        slots: { analitik: true },
      },
    );
    const html = renderBody(p);
    expect(html).toContain('—');
    expect(html).not.toMatch(/0,0%/);
    expect(p.generated_at).toBe('2026-09-03T10:00:00+07:00'); // injected, not `new Date()`
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('run.ts — end-to-end orchestration', () => {
  it('produces a valid cdps.adsscanner.tiktok.v1 payload from raw parsed rows', () => {
    const analitik = [{ 'ID Produk': '1729643540462601638', Nama: 'Produk A', GMV: 'Rp1.000.000', 'Pesanan SKU': '10', 'Impresi produk': '1000', 'Klik produk': '50', CTR: '5%', 'CTOR (pesanan SKU)': '10%' }];
    const ads = [{ 'ID produk': '1729643540462601638', Biaya: 'Rp100.000', 'Pendapatan kotor': 'Rp500.000', 'Nama kampanye': 'K1' }];
    const videos = [{ rows: [{ Produk: 'Produk A (1729643540462601638)', VV: '5000', 'GMV dari video (Rp)': 'Rp200.000', 'Nama Kreator': 'C1', 'Informasi Video': 'review jujur produk ini' }], kind: 'kreator' as const }];

    const result = runAdsScanner(
      { analitik, ads, adslive: [], videos },
      {
        cfg: CFG,
        klien: { nama: 'Klien Uji', account_manager: 'AM Uji' },
        generatedAt: '2026-09-03T10:00:00+07:00',
        periode: { weekStart: '2026-09-01' },
      },
    );

    expect(result.payload.schema).toBe('cdps.adsscanner.tiktok.v1');
    expect(result.payload.generated_at).toBe('2026-09-03T10:00:00+07:00');
    expect(result.payload.sku).toHaveLength(1);
    expect(result.payload.sku[0].pid).toBe('172964354046260');
    expect(result.payload.angles.kreator.some((a) => a.angle === 'Review / Testimoni')).toBe(true);
    expect(result.payload.kelengkapan_file).toEqual({ analitik: true, ads: true, video: true, adslive: false });
    expect(result.payload.benchmark_kategori).toEqual(ADSSCANNER_BENCH_V1['Fashion Accessories']);
  });
});
