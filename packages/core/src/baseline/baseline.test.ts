/**
 * RAB-02 — baseline engine tests. Fixtures model the real export shape (date-range
 * meta row, a "Semua"/"Semua" filter row, the header row, a "Total nilai" summary
 * row, daily rows) with the tool's exact column-name strings. They stand in for
 * real exports (which the owner holds) and exercise the header heuristic, `n()`,
 * the fix-#2 required-column hard-fail, div-by-zero, the null-meter guard, and
 * recompute determinism (house rule #4).
 */
import { describe, expect, it } from 'vitest';
import {
  BENCH_V1,
  BaselineError,
  DASH,
  detect,
  meter,
  mul,
  n,
  periodeOf,
  readSheet,
  rp,
  runBaseline,
  toko,
  video,
  type Aoa,
  type RunSlots,
  type Sheet,
} from './index';

// ── fixture builders ────────────────────────────────────────────────────────
const META = 'Ringkasan Toko 2026-08-01 ~ 2026-08-31';
/** [meta row] + [filter row] + [header] + data rows — the shape readSheet expects. */
const sheetAoa = (header: unknown[], rows: unknown[][], meta = META): Aoa => [[meta], ['Semua', 'Semua', 'Semua'], header, ...rows];

const parse = (aoa: Aoa, fname: string): Sheet => {
  const d = readSheet(aoa, fname);
  if (!d) throw new Error('header not read');
  d.periode = periodeOf(d.meta);
  return d;
};

// Analitik Toko — TikTok. Index-aligned header + Total/Perubahan/daily rows.
const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Pendapatan bruto', 'Tayangan halaman', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV LIVE penjual', 'GMV tidak langsung dari LIVE penjual',
  'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopTtRows = (over: Partial<Record<string, string>> = {}): unknown[][] => {
  const tot = [
    'Total nilai penjualan', over.gmv ?? 'Rp100.000.000', 'Rp10.000.000', '50.000', over.refund ?? 'Rp5.000.000',
    '1.000', '2,00%', 'Rp100.000', '900', '1.200', 'Rp95.000.000', '80.000', '500.000', '20.000',
    'Rp8.000.000', 'Rp0', 'Rp0', 'Rp15.000.000', over.vidToko ?? 'Rp12.000.000',
  ];
  const chg = ['Perubahan (%)', '5,00%', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  const daily = (t: string, g: string, o: string): unknown[] => {
    const r = new Array(19).fill('');
    r[0] = t; r[1] = g; r[5] = o;
    return r;
  };
  return [tot, chg, daily('01/08/2026', 'Rp3.000.000', '30'), daily('02/08/2026', 'Rp4.000.000', '40'), daily('03/08/2026', 'Rp0', '0')];
};
const shopTt = (over?: Partial<Record<string, string>>) => parse(sheetAoa(SHOP_TT_HEADER, shopTtRows(over)), 'toko.xlsx');

// Video — one own-account creator so it detects as vid_toko under the fallback.
const VIDEO_HEADER = ['Informasi Video', 'Nama Kreator', 'ID Video', 'Waktu', 'GMV dari video (Rp)', 'GPM (Rp)', 'VV', 'Likes', 'CTOR (pesanan SKU)'];
const videoRows: unknown[][] = [
  ['Promo Agustus #promo', 'Toko Resmi', 'v1', '2026/08/05 10:00', 'Rp2.000.000', 'Rp150.000', '20.000', '500', '1,20%'],
  ['Unboxing produk', 'Toko Resmi', 'v2', '2026/08/12 09:00', 'Rp0', 'Rp0', '5.000', '100', '0'],
  ['Review jujur #honest', 'Toko Resmi', 'v3', '2026/08/20 11:00', 'Rp1.500.000', 'Rp120.000', '15.000', '300', '0,90%'],
];
const vidToko = () => parse(sheetAoa(VIDEO_HEADER, videoRows), 'video.xlsx');

// ── n(v, raw) — the parser that must not change ─────────────────────────────
describe('n(v, raw)', () => {
  it('Seller Center: dot = thousands, comma = decimal, % → /100', () => {
    expect(n('Rp10.945.407')).toBe(10945407);
    expect(n('5,37%')).toBeCloseTo(0.0537, 10);
    expect(n('50.000')).toBe(50000);
    expect(n('1.234,56')).toBeCloseTo(1234.56, 10);
  });
  it('Ads Manager raw: dot = decimal, comma = thousands', () => {
    expect(n('335164.77', true)).toBeCloseTo(335164.77, 10);
    expect(n('1,234.56', true)).toBeCloseTo(1234.56, 10);
    expect(n(335164.77, true)).toBeCloseTo(335164.77, 10);
  });
  it('empty / dash / N/A → 0 (a present-but-empty VALUE is 0)', () => {
    expect(n('')).toBe(0);
    expect(n('-')).toBe(0);
    expect(n('—')).toBe(0);
    expect(n('N/A')).toBe(0);
    expect(n(null)).toBe(0);
  });
});

// ── header heuristic ────────────────────────────────────────────────────────
describe('readSheet header heuristic', () => {
  it('finds the header row past the date-range + "Semua" filter rows', () => {
    const d = shopTt();
    expect(d.headerRow).toBe(2);
    expect(d.cols).toContain('GMV');
    expect(d.cols).toContain('Pengunjung');
    expect(d.periode).toBe('Agu 2026'); // 2026-08 → Agu
  });
  it('returns null when no header-like row exists', () => {
    expect(readSheet([['1'], ['2']], 'x.xlsx')).toBeNull();
  });
});

// ── detect (12 signatures + fix #3) ─────────────────────────────────────────
describe('detect', () => {
  it('classifies Analitik Toko TikTok', () => {
    expect(detect(shopTt())).toEqual({ type: 'shop_tt', ambiguous: false });
  });
  it('video own-vs-affiliate: no CDPS data → falls back but flags ambiguous', () => {
    const r = detect(vidToko());
    expect(r.type).toBe('vid_toko'); // 1 unique creator ≤ 2
    expect(r.ambiguous).toBe(true); // must be confirmed by AM (fix #3)
  });
  it('video own-vs-affiliate: CDPS linked accounts decide it deterministically', () => {
    expect(detect(vidToko(), { linkedAccounts: ['Toko Resmi'] })).toEqual({ type: 'vid_toko', ambiguous: false });
    expect(detect(vidToko(), { linkedAccounts: ['Akun Lain'] })).toEqual({ type: 'vid_aff', ambiguous: false });
  });
});

// ── fix #2: missing required column → hard fail, not 0 ───────────────────────
describe('fix #2 — required column absent fails loudly', () => {
  it('toko() throws a BI [...] error naming the missing column', () => {
    const noRefund = SHOP_TT_HEADER.filter((c) => c !== 'Pengembalian dana');
    // rebuild rows without the refund column (index-aligned to the shorter header)
    const rows = shopTtRows().map((r) => (r as unknown[]).filter((_, j) => SHOP_TT_HEADER[j] !== 'Pengembalian dana'));
    const d = parse(sheetAoa(noRefund, rows), 'toko.xlsx');
    expect(() => toko(d)).toThrow(BaselineError);
    expect(() => toko(d)).toThrow(/Pengembalian dana/);
  });
  it('an absent OPTIONAL mix column → null (not a fabricated 0)', () => {
    const noVidToko = SHOP_TT_HEADER.filter((c) => c !== 'GMV dari video akun tertaut');
    const rows = shopTtRows().map((r) => (r as unknown[]).filter((_, j) => SHOP_TT_HEADER[j] !== 'GMV dari video akun tertaut'));
    const d = parse(sheetAoa(noVidToko, rows), 'toko.xlsx');
    const m = toko(d);
    expect(m.vidToko).toBeNull(); // renamed/absent column is unknown, not Rp0
    expect(m.other).toBeNull(); // and the residual can't be computed
  });
});

// ── fix #1: div-by-zero → null → meter not rendered ─────────────────────────
describe('fix #1 — div-by-zero and the null meter guard', () => {
  it('gmv=0 → refundRate null → rp(null) = —, meter renders nothing', () => {
    const m = toko(shopTt({ gmv: 'Rp0' }));
    expect(m.refundRate).toBeNull();
    expect(rp(m.refundRate)).toBe(DASH);
    // mul(null,100) stays null (NOT 0) → meter returns '' (no green "0% ok" bar)
    expect(meter('Refund rate', mul(m.refundRate, 100), BENCH_V1.refund, (v) => `${v}%`, true)).toBe('');
  });
  it('a real refundRate DOES render a meter', () => {
    const m = toko(shopTt());
    expect(m.refundRate).toBeCloseTo(0.05, 10);
    expect(meter('Refund rate', mul(m.refundRate, 100), BENCH_V1.refund, (v) => `${v}%`, true)).not.toBe('');
  });
});

// ── full run + payload + determinism (house rule #4) ────────────────────────
describe('runBaseline → payload', () => {
  const slots = (): RunSlots => ({ shop_tt: shopTt(), vid_toko: vidToko() });
  const opts = {
    bench: BENCH_V1,
    benchmarkVersi: 1,
    net: true,
    klien: { nama: 'Alpha', toko: 'Toko Alpha', akun_tiktok: '@alpha', kategori: 'Fashion', umur_toko_bulan: 12, account_manager: 'AM1' },
    generatedAt: '2026-08-18T00:00:00.000Z',
  };
  const hist = [
    { key: '2026-02', label: 'Feb 2026', gmv: '80.000.000', order: '800', flag: 'normal' as const },
    { key: '2026-03', label: 'Mar 2026', gmv: '85.000.000', order: '850', flag: 'normal' as const },
    { key: '2026-04', label: 'Apr 2026', gmv: '90.000.000', order: '900', flag: 'normal' as const },
    { key: '2026-05', label: 'Mei 2026', gmv: '95.000.000', order: '950', flag: 'normal' as const },
    { key: '2026-06', label: 'Jun 2026', gmv: '100.000.000', order: '1.000', flag: 'normal' as const },
    { key: '2026-07', label: 'Jul 2026', gmv: '105.000.000', order: '1.050', flag: 'normal' as const },
  ];

  it('emits the cdps.baseline.tiktok.v1 payload with a computed kondisi_toko', () => {
    const { payload, sc } = runBaseline(slots(), hist, opts);
    expect(payload.schema).toBe('cdps.baseline.tiktok.v1');
    expect(typeof sc.total).toBe('number');
    expect(['mesin_jalan', 'mesin_sebagian', 'fondasi_perlu_dibenahi', 'mesin_belum_terbangun']).toContain(payload.skor.kondisi_toko);
    expect(payload.benchmark_versi).toBe(1);
    // median_6m is MONTHLY (Rp/bulan) — resolusi §5.2. Median of 80..105jt = 92.5jt.
    expect(payload.gmv_baseline.median_6m).toBe(92500000);
    expect(payload.gmv_baseline.cakupan_riwayat).toBe('cukup');
  });

  it('same benchmark + same input → IDENTICAL score (recompute, house rule #4)', () => {
    const a = runBaseline(slots(), hist, opts);
    const b = runBaseline(slots(), hist, opts);
    expect(b.payload).toEqual(a.payload);
    expect(b.sc.total).toBe(a.sc.total);
  });

  it('kondisi_toko vocabulary is disjoint from the Blok C verdict enum (handoff §2.3)', () => {
    const { payload } = runBaseline(slots(), hist, opts);
    const blokC = ['growth_ready', 'bersyarat', 'risiko_tinggi', 'tidak_siap'];
    expect(blokC).not.toContain(payload.skor.kondisi_toko);
  });

  it('gmv_mix is attribution WITHIN the platform (RAB-12), not a per-channel baseline', () => {
    const { payload } = runBaseline(slots(), hist, opts);
    expect(payload.gmv_mix).not.toBeNull();
    expect(payload.gmv_mix?.video_toko).toBe(12000000);
  });
});

// ── video metric sanity ─────────────────────────────────────────────────────
describe('video metric', () => {
  it('computes sell-through rate and gpm median over selling videos only', () => {
    const m = video(vidToko(), 'Agu 2026');
    expect(m.total).toBe(3);
    expect(m.withSales).toBe(2);
    expect(m.rate).toBeCloseTo(2 / 3, 10);
    expect(m.gpmMed).toBe(135000); // median(150000,120000)
  });
});
