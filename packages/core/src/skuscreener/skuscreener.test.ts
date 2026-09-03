/**
 * MEA SKU Screener tests. Fixture sources, per the porting brief:
 *  - PRD §4.1 (Welmer) — CPC Maksimum + market-CPC "lolos filter" check.
 *  - PRD §4.2 (Sneakers Outdoor Trail before/after) — `compareBeforeAfter` verdict.
 *  - PRD §4.3 (Sperantia) — `roasFloorKontribusi` formula check.
 * Everything else is engineered fixtures covering R01-R12 directly, including
 * the one place this port goes beyond the shipped HTML (R04's iterative
 * threshold reduction, `median.test` below).
 */
import { describe, expect, it } from 'vitest';
import {
  parseIndonesianNumber, parseCsv, readPerformaProduk, readAdsCpc,
  medianCtr, medianCr, medianViews,
  routeSku,
  cpcMaksimum, isAntiRule, evaluateMarketCpc, classifySku, LABEL_TAHAN_CPC_RENDAH, LABEL_ANTI_RULE,
  DEFAULT_TARGET_ROAS, validateTargetRoas, MSG_TARGET_ROAS_INVALID,
  roasFloorKontribusi, biayaPlatform,
  skuKey, normalizeProductName, matchSkus, compareBeforeAfter,
  evaluateOptimization, DuaJenisPerubahanError,
  type NamedSheet, type SkuRecord,
} from './index';

// ── R01: parseIndonesianNumber ──────────────────────────────────────────
describe('parseIndonesianNumber (R01)', () => {
  it('treats a single-dot number with 3-digit groups as thousands', () => {
    expect(parseIndonesianNumber('740.900')).toBe(740900);
  });
  it('treats a multi-dot number as thousands', () => {
    expect(parseIndonesianNumber('249.535.512')).toBe(249535512);
  });
  it('treats a single comma as decimal', () => {
    expect(parseIndonesianNumber('3,21')).toBeCloseTo(3.21, 5);
  });
  it('treats dot+comma as thousands+decimal', () => {
    expect(parseIndonesianNumber('1.234,56')).toBeCloseTo(1234.56, 5);
  });
  it.each(['-', '', 'nan', 'None', null, undefined])('returns NaN, never 0, for %p', (v) => {
    expect(Number.isNaN(parseIndonesianNumber(v))).toBe(true);
  });
  it('handles parenthesised negatives', () => {
    expect(parseIndonesianNumber('(1.234)')).toBe(-1234);
  });
  it('strips Rp prefix and % suffix', () => {
    expect(parseIndonesianNumber('Rp 1.500')).toBe(1500);
    expect(parseIndonesianNumber('5,37%')).toBeCloseTo(5.37, 5);
  });
  it('passes numbers through unchanged', () => {
    expect(parseIndonesianNumber(42)).toBe(42);
  });
});

// ── R02/R03/A02/A03: readPerformaProduk ─────────────────────────────────
const HEADER = [
  'Kode Variasi', 'Produk', 'Kode Produk', 'Total Penjualan',
  'Jumlah Produk Dilihat', 'Produk Diklik', 'Persentase Klik',
  'Tingkat Konversi Pesanan', 'Pesanan Dibuat',
];
const sheet = (rows: unknown[][], name = 'Performa Produk'): NamedSheet => ({ name, aoa: [HEADER, ...rows] });

describe('readPerformaProduk (R02/R03/A02/A03)', () => {
  it('keeps only parent rows (Kode Variasi = "-"), drops variant rows', () => {
    const rows = readPerformaProduk([sheet([
      ['-', 'Produk A', 'SKU-A', '1.000.000', '500', '20', '4,00', '2,00', '10'],
      ['Merah/M', 'Produk A - Merah/M', 'SKU-A', '400.000', '200', '8', '4,00', '2,00', '4'], // variant — dropped
      ['-', 'Produk B', 'SKU-B', '500.000', '300', '10', '3,33', '1,00', '5'],
    ])]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.produk)).toEqual(['Produk A', 'Produk B']);
  });

  it('keeps negative GMV negative — never .abs() (R03)', () => {
    const rows = readPerformaProduk([sheet([
      ['-', 'Produk Rugi', 'SKU-C', '(150.000)', '600', '10', '1,66', '0,00', '0'],
    ])]);
    expect(rows[0].gmv).toBe(-150000);
  });

  it('drops rows with zero/absent views', () => {
    const rows = readPerformaProduk([sheet([
      ['-', 'Tanpa Views', 'SKU-D', '0', '0', '0', '', '', '0'],
      ['-', 'Ada Views', 'SKU-E', '100.000', '50', '5', '5,00', '2,00', '2'],
    ])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].produk).toBe('Ada Views');
  });

  it('A03: missing "Kode Produk" column degrades to empty kode, not an error', () => {
    const headerNoKode = HEADER.filter((h) => h !== 'Kode Produk');
    const rows = readPerformaProduk([{
      name: 'Performa Produk',
      aoa: [headerNoKode, ['-', 'Produk F', '200.000', '100', '10', '10,00', '5,00', '3']],
    }]);
    expect(rows[0].kode).toBe('');
    expect(rows[0].produk).toBe('Produk F');
  });

  it('A02: falls back to the first sheet when no sheet name contains "performa"', () => {
    const rows = readPerformaProduk([sheet([
      ['-', 'Produk G', 'SKU-G', '300.000', '150', '15', '10,00', '3,33', '5'],
    ], 'Sheet1')]);
    expect(rows).toHaveLength(1);
  });

  it('computes AOV = gmv/orders, NaN when orders = 0', () => {
    const rows = readPerformaProduk([sheet([
      ['-', 'Nol Pesanan', 'SKU-H', '0', '80', '4', '5,00', '0,00', '0'],
    ])]);
    expect(Number.isNaN(rows[0].aov)).toBe(true);
  });

  it('throws when the required GMV/orders/views columns are missing', () => {
    expect(() => readPerformaProduk([{ name: 'Performa', aoa: [['Kolom Asing'], ['x']] }])).toThrow();
  });

  it('throws when no SKU has views after filtering', () => {
    expect(() => readPerformaProduk([sheet([['-', 'Kosong', 'SKU-I', '0', '0', '0', '', '', '0']])])).toThrow();
  });
});

// ── A06: readAdsCpc ───────────────────────────────────────────────────────
describe('readAdsCpc (A06)', () => {
  it('finds the header row dynamically (not hardcoded row 7) and sums Biaya/Jumlah Klik', () => {
    const rows: unknown[][] = [
      ['Laporan Iklan Produk'],
      ['Periode: 1-31 Agustus 2026'],
      ['Nama Toko', 'Welmer'],
      ['Produk', 'Biaya', 'Jumlah Klik', 'Tayangan'], // header on row 3 (index 3), not row 7
      ['SKU A', '100.000', '50', '2.000'],
      ['SKU B', '200.000', '100', '4.000'],
    ];
    expect(readAdsCpc(rows)).toBeCloseTo(300000 / 150, 5);
  });

  it('throws when no row in the first 20 has both Biaya and Jumlah Klik', () => {
    expect(() => readAdsCpc([['a', 'b'], ['c', 'd']])).toThrow();
  });

  it('throws when total clicks is zero', () => {
    const rows = [['Biaya', 'Jumlah Klik'], ['100.000', '0']];
    expect(() => readAdsCpc(rows)).toThrow();
  });

  it('round-trips through parseCsv', () => {
    const csv = 'Produk,Biaya,Jumlah Klik\n"SKU, A","1.000",10\n';
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['Produk', 'Biaya', 'Jumlah Klik']);
    expect(rows[1]).toEqual(['SKU, A', '1.000', '10']);
  });
});

// ── R04: median with iterative reduction (beyond the shipped HTML) ───────
describe('median.ts (R04)', () => {
  it('uses the plain Views≥200 median when ≥5 SKUs qualify (no reduction needed)', () => {
    const rows = [200, 250, 300, 400, 500, 900].map((views) => ({ views, ctr: views / 100 }));
    const r = medianCtr(rows);
    expect(r.iterations).toBe(0);
    expect(r.threshold).toBe(200);
    expect(r.sampleSize).toBe(6);
  });

  it('halves the threshold iteratively until ≥5 SKUs qualify', () => {
    // Only 2 SKUs have views ≥ 200; 6 have views ≥ 100; the reduction must
    // land on 100 (200→100), not skip straight to the 50 floor.
    const rows = [
      { views: 900, ctr: 10 }, { views: 250, ctr: 8 },
      { views: 150, ctr: 6 }, { views: 140, ctr: 6 }, { views: 130, ctr: 5 }, { views: 120, ctr: 4 },
    ];
    const r = medianCtr(rows);
    expect(r.threshold).toBe(100);
    expect(r.iterations).toBe(1);
    expect(r.sampleSize).toBe(6);
    expect(r.reachedAbsoluteFloor).toBe(false);
  });

  it('stops reducing at the absolute floor (Views≥50) even if still <5 SKUs', () => {
    const rows = [{ views: 60, ctr: 3 }, { views: 55, ctr: 2 }]; // only 2 SKUs, ever
    const r = medianCtr(rows);
    expect(r.threshold).toBe(50);
    expect(r.reachedAbsoluteFloor).toBe(true);
    expect(r.sampleSize).toBe(2);
  });

  it('clamps the median CTR up to the 2.0% absolute value floor', () => {
    const rows = [{ views: 300, ctr: 0 }, { views: 400, ctr: 0.5 }, { views: 500, ctr: 1 }, { views: 600, ctr: 0.2 }, { views: 700, ctr: 0.1 }];
    const r = medianCtr(rows);
    expect(r.rawMedian).toBeLessThan(2.0);
    expect(r.effectiveMedian).toBe(2.0);
  });

  it('R04/§4.1 Welmer: median CR toko 0.00% is clamped to the 0.5% floor', () => {
    const rows = Array.from({ length: 6 }, () => ({ clicks: 25, cr: 0 }));
    const r = medianCr(rows);
    expect(r.rawMedian).toBe(0);
    expect(r.effectiveMedian).toBe(0.5);
  });

  it('medianViews is a plain median with no threshold/floor', () => {
    expect(medianViews([{ views: 100 }, { views: 300 }, { views: 200 }])).toBe(200);
  });
});

// ── R05: routeSku ─────────────────────────────────────────────────────────
describe('routeSku (R05)', () => {
  const medians = { ctr: 5, cr: 2, views: 1000 };
  it('routes SCALE (CTR & CR & Views all above median)', () => {
    expect(routeSku({ ctr: 6, cr: 3, views: 1200 }, medians)).toBe('SCALE');
  });
  it('routes KANDIDAT IKLAN (CTR & CR above median, Views below)', () => {
    expect(routeSku({ ctr: 6, cr: 3, views: 500 }, medians)).toBe('KANDIDAT IKLAN');
  });
  it('routes OPTIMASI GAMBAR/JUDUL (Views above median, CTR below)', () => {
    expect(routeSku({ ctr: 3, cr: 1, views: 1500 }, medians)).toBe('OPTIMASI GAMBAR/JUDUL');
  });
  it('routes OPTIMASI DESKRIPSI/HARGA (CTR above median, CR below, Views below)', () => {
    expect(routeSku({ ctr: 6, cr: 1, views: 500 }, medians)).toBe('OPTIMASI DESKRIPSI/HARGA');
  });
  it('routes PARKIR (everything else)', () => {
    expect(routeSku({ ctr: 1, cr: 1, views: 100 }, medians)).toBe('PARKIR');
  });
  it('treats NaN CTR/CR as below median, never crashes', () => {
    expect(routeSku({ ctr: NaN, cr: NaN, views: 1500 }, medians)).toBe('OPTIMASI GAMBAR/JUDUL');
    expect(routeSku({ ctr: NaN, cr: NaN, views: 100 }, medians)).toBe('PARKIR');
  });
});

// ── R06: cpc.ts, incl. PRD §4.1 Welmer fixture ───────────────────────────
describe('cpcMaksimum / market CPC / anti-rule (R06)', () => {
  it('PRD §4.1 Welmer — Sneakers Corduroy Slip On: CPC Max ≈ Rp1.097, above CPC pasar 691 (lolos filter)', () => {
    const cpcMax = cpcMaksimum({ aov: 313333, crPercent: 1.25, faktorCrIklan: 1.0, targetRoas: 3.57 });
    expect(cpcMax).toBeCloseTo(1097, 0);
    const market = evaluateMarketCpc(cpcMax, 691);
    expect(market.verdict).toBe('ok');
    expect(market.ratio).toBeGreaterThan(1);
  });

  it('returns NaN with no AOV, no organic CR, or target ROAS ≤ 0', () => {
    expect(Number.isNaN(cpcMaksimum({ aov: NaN, crPercent: 2, faktorCrIklan: 1, targetRoas: 4 }))).toBe(true);
    expect(Number.isNaN(cpcMaksimum({ aov: 100000, crPercent: NaN, faktorCrIklan: 1, targetRoas: 4 }))).toBe(true);
    expect(Number.isNaN(cpcMaksimum({ aov: 100000, crPercent: 2, faktorCrIklan: 1, targetRoas: 0 }))).toBe(true);
  });

  it('anti-rule: Views ≥ 2000 AND CR < 0.5% fires', () => {
    expect(isAntiRule(2000, 0.4)).toBe(true);
    expect(isAntiRule(1999, 0.4)).toBe(false); // below views threshold
    expect(isAntiRule(2500, 0.5)).toBe(false); // CR not below 0.5
  });

  it('market CPC override: CPC Max < CPC pasar ⇒ tahan verdict', () => {
    expect(evaluateMarketCpc(500, 700).verdict).toBe('tahan');
    expect(evaluateMarketCpc(800, 700).verdict).toBe('ok');
    expect(evaluateMarketCpc(800, null).verdict).toBe('tanpa-pembanding');
  });

  describe('classifySku — layering anti-rule/TAHAN over the base route', () => {
    const medians = { ctr: 5, cr: 2, views: 1000 };
    it('leaves a normal SCALE route alone when CPC max clears the market CPC', () => {
      const r = classifySku(
        { ctr: 6, cr: 3, views: 1200, aov: 200000 },
        medians,
        { faktorCrIklan: 1, targetRoas: 4, cpcPasar: 100 },
      );
      expect(r.baseRoute).toBe('SCALE');
      expect(r.label).toBe('SCALE');
    });

    it('overrides SCALE/KANDIDAT IKLAN to TAHAN when CPC max < CPC pasar', () => {
      const r = classifySku(
        { ctr: 6, cr: 3, views: 1200, aov: 1000 }, // tiny AOV ⇒ tiny CPC max
        medians,
        { faktorCrIklan: 1, targetRoas: 4, cpcPasar: 100000 },
      );
      expect(r.baseRoute).toBe('SCALE');
      expect(r.label).toBe(LABEL_TAHAN_CPC_RENDAH);
      expect(r.isTahanCpcRendah).toBe(true);
    });

    it('does NOT apply TAHAN to OPTIMASI routes (mirrors the shipped tool)', () => {
      const r = classifySku(
        { ctr: 3, cr: 1, views: 1500, aov: 1000 },
        medians,
        { faktorCrIklan: 1, targetRoas: 4, cpcPasar: 100000 },
      );
      expect(r.baseRoute).toBe('OPTIMASI GAMBAR/JUDUL');
      expect(r.label).toBe('OPTIMASI GAMBAR/JUDUL');
    });

    it('anti-rule beats everything, including a route that would otherwise be TAHAN', () => {
      const r = classifySku(
        { ctr: 6, cr: 0.4, views: 2500, aov: 1000 }, // CR<0.5 & Views≥2000 ⇒ anti-rule
        medians,
        { faktorCrIklan: 1, targetRoas: 4, cpcPasar: 100000 },
      );
      expect(r.isAntiRule).toBe(true);
      expect(r.label).toBe(LABEL_ANTI_RULE);
      expect(r.isTahanCpcRendah).toBe(false);
    });
  });
});

// ── Target ROAS (roas.ts) ─────────────────────────────────────────────────
describe('roas.ts', () => {
  it('DEFAULT_TARGET_ROAS mirrors the shipped tool (4), not the PRD default (3.57) — DECISIONS.md O66', () => {
    expect(DEFAULT_TARGET_ROAS).toBe(4);
  });

  it('rejects ROAS ≤ 0 with the house default BI message', () => {
    expect(validateTargetRoas(0)).toEqual({ ok: false, message: MSG_TARGET_ROAS_INVALID });
    expect(validateTargetRoas(-1)).toEqual({ ok: false, message: MSG_TARGET_ROAS_INVALID });
    expect(validateTargetRoas(NaN)).toEqual({ ok: false, message: MSG_TARGET_ROAS_INVALID });
  });

  it('accepts a positive ROAS', () => {
    expect(validateTargetRoas(4)).toEqual({ ok: true, value: 4 });
  });

  it('PRD §4.3 Sperantia — ROAS Floor Kontribusi ≈ 3.57 (margin 40%, platform 12%, AOV Rp80.000)', () => {
    const platform = biayaPlatform({ hargaJual: 80000, adminPct: 12, komisiPct: 0, biayaProgramLainPct: 0 });
    expect(platform).toBeCloseTo(9600, 5);
    const margin = 0.4 * 80000; // 32.000
    const floor = roasFloorKontribusi(80000, margin, platform);
    expect(floor).toBeCloseTo(3.57, 2);
    // "ROAS aktual 0.92 < Floor 3.57" — the PRD's own critical-warning premise.
    expect(0.92).toBeLessThan(floor);
  });
});

// ── R09-R11: Module B compare ─────────────────────────────────────────────
describe('compare.ts — Module B (R09-R11)', () => {
  it('R09: Kode Produk is the primary match key', () => {
    expect(skuKey('SKU-1', 'Any Name')).toBe('SKU-1');
  });
  it('R09: falls back to normalized name when Kode Produk is empty', () => {
    expect(skuKey('', 'Sneakers Outdoor - Trail!!')).toBe(normalizeProductName('Sneakers Outdoor - Trail!!'));
    expect(normalizeProductName('Sneakers Outdoor - Trail!!')).toBe('sneakersoutdoortrail');
  });

  it('matchSkus pairs by key and silently skips unmatched SKUs', () => {
    const before = [{ kode: 'A', produk: 'Alpha' }, { kode: 'B', produk: 'Beta' }];
    const after = [{ kode: 'A', produk: 'Alpha' }, { kode: 'C', produk: 'Gamma' }];
    const pairs = matchSkus(before, after);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].key).toBe('A');
  });

  it('PRD §4.2 — Sneakers Outdoor Trail image change: CTR +34.4% ⇒ MEMBAIK', () => {
    const before = { views: 3120, clicks: 58, ctr: 1.86, cr: 0, orders: 0, gmv: 0 };
    const after = { views: 3844, clicks: 96, ctr: 2.5, cr: 0, orders: 0, gmv: 0 };
    const r = compareBeforeAfter(before, after, 20);
    expect(r.deltaCtrPct).toBeCloseTo(34.4, 1);
    expect(r.deltaViewsPct).toBeCloseTo(23.2, 1);
    expect(r.verdict).toBe('MEMBAIK');
  });

  it('R10: below min-clicks-after ⇒ BELUM CUKUP DATA regardless of deltas', () => {
    const before = { views: 100, clicks: 50, ctr: 2, cr: 1, orders: 1, gmv: 10000 };
    const after = { views: 200, clicks: 10, ctr: 10, cr: 5, orders: 5, gmv: 100000 };
    expect(compareBeforeAfter(before, after, 20).verdict).toBe('BELUM CUKUP DATA');
  });

  it('R11: -10%..+20% ⇒ TIDAK BERUBAH; ≤-10% ⇒ MEMBURUK', () => {
    const flat = compareBeforeAfter(
      { views: 100, clicks: 100, ctr: 5, cr: 2, orders: 1, gmv: 1 },
      { views: 100, clicks: 100, ctr: 5.5, cr: 2, orders: 1, gmv: 1 },
      20,
    );
    expect(flat.verdict).toBe('TIDAK BERUBAH');
    const worse = compareBeforeAfter(
      { views: 100, clicks: 100, ctr: 5, cr: 2, orders: 1, gmv: 1 },
      { views: 100, clicks: 100, ctr: 4, cr: 2, orders: 1, gmv: 1 },
      20,
    );
    expect(worse.verdict).toBe('MEMBURUK');
  });
});

// ── R12: Optimization Tracker (Module D) ─────────────────────────────────
describe('compare.ts — evaluateOptimization (R12, Module D)', () => {
  it('maps CTR-affecting change types to CTR', () => {
    const r = evaluateOptimization(
      'Gambar utama',
      { views: 100, clicks: 50, ctr: 2, cr: 5, orders: 1 },
      { views: 150, clicks: 60, ctr: 3, cr: 4, orders: 1 }, // CR dropped, but CTR is what's evaluated
    );
    expect(r.metricEvaluated).toBe('CTR');
    expect(r.deltaMetricPct).toBeCloseTo(50, 1);
    expect(r.verdict).toBe('BERHASIL');
  });

  it('maps CR-affecting change types to CR, ignoring a CTR move entirely', () => {
    const r = evaluateOptimization(
      'Harga',
      { views: 100, clicks: 50, ctr: 10, cr: 2, orders: 1 },
      { views: 100, clicks: 50, ctr: 2, cr: 2.1, orders: 1 }, // CTR crashed, CR barely moved
    );
    expect(r.metricEvaluated).toBe('CR');
    expect(r.verdict).toBe('TIDAK BERUBAH');
  });

  it('rejects a record declaring two change types at once', () => {
    expect(() =>
      evaluateOptimization(['Gambar utama', 'Harga'], { views: 1, clicks: 1, ctr: 1, cr: 1, orders: 0 }, null),
    ).toThrow(DuaJenisPerubahanError);
  });

  it('BELUM CUKUP DATA before the after-data is filled in (or below min clicks)', () => {
    const r = evaluateOptimization('Deskripsi', { views: 1, clicks: 1, ctr: 1, cr: 1, orders: 0 }, null);
    expect(r.verdict).toBe('BELUM CUKUP DATA');
    expect(Number.isNaN(r.deltaMetricPct)).toBe(true);
  });
});
