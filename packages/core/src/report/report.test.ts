/**
 * Report engine tests. Fixtures model the real export shape (date-range meta row,
 * a "Semua" filter row, the header row, a "Total nilai" summary row, daily rows)
 * with the exports' exact column-name strings.
 *
 * What is asserted here is what would otherwise reach a client's inbox wrong:
 * the weekly/monthly pro-rating, absent-column-is-not-zero, div-by-zero → `—`,
 * the run-rate that `clients.total_sales` is written in, and the fact that the
 * client HTML does not carry MEA's internal remarks in its source.
 */
import { describe, expect, it } from 'vitest';
import { periodeOf, readSheet, type Aoa, type Sheet } from '../baseline';
import {
  chartData, detectTtam, gmvRunRateBulanan, hariAntara, prorateBench, renderBody, rentangOf,
  renderReportHtml, REPORT_BENCH_V1, resolveRentang, runReport, scale,
  INSIGHT_MAX, INSIGHT_MAX_POIN, InsightDraftError, normalizeInsightDraft,
  MSG_ADA_MARKUP, MSG_POIN_KOSONG, MSG_REK_TAK_LENGKAP, MSG_RINGKASAN_WAJIB,
  type PayloadInsight, type ReportSlots,
} from './index';

// ── fixtures ────────────────────────────────────────────────────────────────
const META_BULAN = 'Ringkasan Toko 2026-08-01 ~ 2026-08-31';
const META_MINGGU = 'Ringkasan Toko 2026-08-04 ~ 2026-08-10';

const sheetAoa = (header: unknown[], rows: unknown[][], meta: string): Aoa =>
  [[meta], ['Semua', 'Semua', 'Semua'], header, ...rows];

const parse = (aoa: Aoa, fname: string): Sheet => {
  const d = readSheet(aoa, fname);
  if (!d) throw new Error('header tidak terbaca');
  d.periode = periodeOf(d.meta);
  return d;
};

const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopTt = (meta = META_BULAN): Sheet => parse(sheetAoa(SHOP_TT_HEADER, [
  ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%',
    'Rp100.000', '900', '1.200', '500.000', '20.000', 'Rp8.000.000', 'Rp15.000.000', 'Rp12.000.000'],
  ['Perubahan persentase', '5,00%', '', '-3,00%', '', '2,00%', '', '', '', '', '', '', '', '', ''],
  ['01/08/2026', 'Rp3.000.000', '', '', '', '30', '', '', '', '', '', '', '', '', ''],
  ['02/08/2026', 'Rp4.000.000', '', '', '', '40', '', '', '', '', '', '', '', '', ''],
], meta), 'toko.xlsx');

/** Same store file WITHOUT the optional mix columns — the "column got renamed" case. */
const SHOP_TT_MINIMAL_HEADER = ['', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi'];
const shopTtMinimal = (): Sheet => parse(sheetAoa(SHOP_TT_MINIMAL_HEADER, [
  ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%'],
], META_BULAN), 'toko-minimal.xlsx');

const LIVE_HEADER = ['Waktu Live', 'Kreator', 'Durasi', 'GMV dari LIVE (Rp)', 'Penonton', 'Klik Produk', 'Produk dilihat'];
const liveToko = (): Sheet => parse(sheetAoa(LIVE_HEADER, [
  ['2026/08/03 19:30', 'Host A', '2h 30min', 'Rp6.000.000', '1.200', '400', '5.000'],
  ['2026/08/04 20:00', 'Host A', '2h 0min', 'Rp0', '300', '50', '900'],
  ['2026/08/10 19:00', 'Host B', '3h 0min', 'Rp9.000.000', '2.000', '700', '8.000'],
], META_BULAN), 'live.xlsx');

const PROD_HEADER = ['Nama', 'ID Produk', 'GMV', 'Klik produk', 'Impresi produk', 'CTOR (pesanan SKU)', 'Pesanan SKU', 'Produk terjual'];
const prodTt = (): Sheet => parse(sheetAoa(PROD_HEADER, [
  ['Produk Bintang', 'P1', 'Rp40.000.000', '900', '20.000', '3,00%', '27', '30'],
  ['Produk Bocor', 'P2', 'Rp5.000.000', '800', '30.000', '0,20%', '2', '3'],
  ['Hidden Gem', 'P3', 'Rp8.000.000', '60', '1.000', '4,00%', '2', '4'],
  ['Produk Tidur', 'P4', 'Rp0', '3', '100', '0', '0', '0'],
  ['Belum Tayang', 'P5', 'Rp0', '0', '0', '0', '0', '0'],
], META_BULAN), 'produk.xlsx');

const ADS_PROD_HEADER = ['Nama kampanye', 'Jenis materi iklan', 'Judul video', 'Akun TikTok', 'Biaya', 'Pendapatan kotor', 'Pesanan SKU', 'Impresi iklan produk', 'Jumlah klik iklan produk'];
const adsProd = (): Sheet => parse(sheetAoa(ADS_PROD_HEADER, [
  ['Kampanye A', 'Video', 'Video jualan', '@toko', '1000000', '9000000', '90', '500000', '20000'],
  ['Kampanye A', 'Video', 'Video gagal', '@toko', '500000', '0', '0', '200000', '3000'],
], META_BULAN), 'ads.xlsx');

const AFF_HEADER = ['Creator name', 'GMV dari kreator', 'Video', 'Siaran LIVE', 'Sampel terkirim', 'Pesanan teratribusi', 'Pengembalian dana', 'Perkiraan komisi'];
const affKr = (): Sheet => parse(sheetAoa(AFF_HEADER, [
  ['Kreator Produktif', 'Rp20.000.000', '5', '2', '1', '150', 'Rp1.000.000', 'Rp2.000.000'],
  ['Kreator Nempel', 'Rp0', '4', '0', '1', '0', 'Rp0', 'Rp0'],
  ['Kreator Pasif', 'Rp0', '0', '0', '0', '0', 'Rp0', 'Rp0'],
  ['Toko Resmi', 'Rp30.000.000', '10', '5', '0', '200', 'Rp0', 'Rp0'],
], META_BULAN), 'aff.xlsx');

const KLIEN = { nama: 'PT Alpha', toko: 'Alpha Store', platform: 'TikTok Shop', kategori: 'Fashion', account_manager: 'EMP-001', store_link: null };
const GEN_AT = '2026-09-01T03:00:00.000Z';

const run = (slots: ReportSlots, tipe: 'mingguan' | 'bulanan' = 'bulanan') =>
  runReport(slots, { periodeTipe: tipe, klien: KLIEN, generatedAt: GEN_AT, benchmarkVersi: 1, akunSendiri: ['Toko Resmi'] });

// ── periode ─────────────────────────────────────────────────────────────────
describe('rentang periode', () => {
  it('reads an ISO range and counts days INCLUSIVELY', () => {
    expect(rentangOf(META_BULAN)).toEqual({ mulai: '2026-08-01', akhir: '2026-08-31', hari: 31 });
    expect(rentangOf(META_MINGGU)).toEqual({ mulai: '2026-08-04', akhir: '2026-08-10', hari: 7 });
    expect(hariAntara('2026-08-04', '2026-08-04')).toBe(1);
  });

  it('reads a dd/mm/yyyy range', () => {
    expect(rentangOf('Laporan 01/08/2026 - 31/08/2026')).toEqual({ mulai: '2026-08-01', akhir: '2026-08-31', hari: 31 });
  });

  it('returns null for an unreadable meta row, and the run falls back to the nominal length', () => {
    expect(rentangOf('Ringkasan Toko')).toBeNull();
    const s = shopTt('Ringkasan Toko');
    const r = resolveRentang({ shop_tt: s }, 'mingguan');
    expect(r.dariBerkas).toBe(false);
    expect(r.rentang.hari).toBe(7);
    // …and the payload SAYS it was a fallback, so nobody mistakes it for a real range.
    expect(run({ shop_tt: s }, 'mingguan').payload.periode.rentang_dari_berkas).toBe(false);
  });

  it('prefers the STORE export range over any other file', () => {
    const r = resolveRentang({ shop_tt: shopTt(META_MINGGU), prod_tt: prodTt() }, 'mingguan');
    expect(r.rentang).toEqual({ mulai: '2026-08-04', akhir: '2026-08-10', hari: 7 });
  });
});

// ── pro-rating (keputusan 2) ────────────────────────────────────────────────
describe('pro-rate benchmark mingguan', () => {
  it('scales VOLUME thresholds by the period length and leaves RATES alone', () => {
    const b = prorateBench(REPORT_BENCH_V1, 7);
    expect(b.sesi_live.good).toBeCloseTo(20 * 7 / 30, 6);
    expect(b.quad_klik.good).toBeCloseTo(150 * 7 / 30, 6);
    // rate-based thresholds are period-independent — pro-rating one would move the goalposts
    expect(b.roi_gmvmax).toEqual(REPORT_BENCH_V1.roi_gmvmax);
    expect(b.gmv_per_jam_live).toEqual(REPORT_BENCH_V1.gmv_per_jam_live);
    expect(b.cvr_toko).toEqual(REPORT_BENCH_V1.cvr_toko);
    expect(b.pct_video_sales).toEqual(REPORT_BENCH_V1.pct_video_sales);
    expect(b.quad_cvr).toEqual(REPORT_BENCH_V1.quad_cvr);
  });

  it('is the identity at 30 days and never divides by zero', () => {
    expect(prorateBench(REPORT_BENCH_V1, 30)).toEqual(REPORT_BENCH_V1);
    expect(prorateBench(REPORT_BENCH_V1, 0).sesi_live.good).toBeCloseTo(20 / 30, 6);
  });

  it('records BOTH the scaled and the base benchmark in the payload (recompute, aturan #4)', () => {
    const p = run({ shop_tt: shopTt(META_MINGGU) }, 'mingguan').payload;
    expect(p.benchmark_dipakai.sesi_live.good).toBeCloseTo(20 * 7 / 30, 6);
    expect(p.benchmark_dasar_bulanan.sesi_live.good).toBe(20);
    expect(p.benchmark_versi).toBe(1);
  });

  it('scores the SAME store better on a weekly report than an unscaled weekly would', () => {
    const slots = { shop_tt: shopTt(META_MINGGU), live_toko: liveToko() };
    const mingguan = run(slots, 'mingguan');
    // 3 sessions is poor against 20/month but fine against ~4.7/week
    const dimM = mingguan.skor.dimensi.find((d) => d.key === 'live');
    const bulanan = runReport({ shop_tt: shopTt(META_BULAN), live_toko: liveToko() },
      { periodeTipe: 'bulanan', klien: KLIEN, generatedAt: GEN_AT });
    const dimB = bulanan.skor.dimensi.find((d) => d.key === 'live');
    expect(dimM!.skor).toBeGreaterThan(dimB!.skor);
  });
});

// ── run-rate for clients.total_sales (keputusan 3) ──────────────────────────
describe('gmvRunRateBulanan', () => {
  it('passes a monthly report through untouched', () => {
    expect(gmvRunRateBulanan(100_000_000, 'bulanan', 31)).toBe(100_000_000);
  });

  it('scales a weekly report to a 30-day run-rate so the column keeps ONE unit', () => {
    expect(gmvRunRateBulanan(25_000_000, 'mingguan', 7)).toBeCloseTo(25_000_000 * 30 / 7, 6);
    // a 5-day partial week is not treated as a full one
    expect(gmvRunRateBulanan(25_000_000, 'mingguan', 5)).toBeCloseTo(25_000_000 * 6, 6);
  });

  it('never divides by zero', () => {
    expect(gmvRunRateBulanan(1_000_000, 'mingguan', 0)).toBe(30_000_000);
  });
});

// ── absent column ≠ zero ────────────────────────────────────────────────────
describe('kolom absen bukan nol', () => {
  it('renders `—` for a channel the export did not carry, not "Rp0"', () => {
    const p = run({ shop_tt: shopTtMinimal() }).payload;
    const live = p.kanal.items.find((x) => x.key === 'live');
    expect(live!.nilai).toBeNull();
    expect(live!.persen).toBeNull();
    const html = renderReportHtml(p, 'klien');
    expect(html).toContain('—');
  });

  it('keeps a present-but-empty cell at 0 (that is n()\'s job, not this rule)', () => {
    const p = run({ shop_tt: shopTt(), live_toko: liveToko() }).payload;
    expect(p.live!.tanpa_penjualan.sesi).toBe(1);
  });
});

// ── sections ────────────────────────────────────────────────────────────────
describe('runReport', () => {
  it('requires the store export', () => {
    expect(() => run({})).toThrow(/\[berkas Analitik Toko TikTok wajib ada/);
  });

  it('reports GMV net by default and keeps gross alongside it', () => {
    const p = run({ shop_tt: shopTt() }).payload;
    expect(p.kpi.gmv_kotor).toBe(100_000_000);
    expect(p.kpi.gmv).toBe(95_000_000); // net = GMV − pengembalian dana
    expect(p.periode.definisi_gmv).toBe('net');
  });

  it('takes MoM change straight from the export, never recomputed', () => {
    const p = run({ shop_tt: shopTt() }).payload;
    expect(p.kpi.perubahan.gmv).toBeCloseTo(0.05, 6);
    expect(p.kpi.perubahan.pengunjung).toBeCloseTo(-0.03, 6);
  });

  it('splits GMV by channel against GROSS gmv so shares cannot exceed 100%', () => {
    const p = run({ shop_tt: shopTt() }).payload;
    const total = p.kanal.items.reduce((a, x) => a + (x.persen ?? 0), 0);
    expect(total).toBeLessThanOrEqual(1.0000001);
    expect(p.kanal.items.find((x) => x.key === 'live')!.nilai).toBe(18_000_000);
  });

  it('aggregates LIVE per day of week and counts dead broadcast hours', () => {
    const p = run({ shop_tt: shopTt(), live_toko: liveToko() }).payload;
    expect(p.live!.sesi).toBe(3);
    expect(p.live!.jam).toBeCloseTo(7.5, 6);
    expect(p.live!.tanpa_penjualan.jam).toBeCloseTo(2, 6);
    expect(p.live!.per_hari.map((d) => d.label)).toEqual(['Senin', 'Selasa']);
  });

  it('flags ad creatives that spent and produced nothing', () => {
    const p = run({ shop_tt: shopTt(), ads_prod: adsProd() }).payload;
    expect(p.iklan!.total.biaya).toBe(1_500_000);
    expect(p.iklan!.total.roi).toBeCloseTo(6, 2);
    expect(p.iklan!.budget_terbakar.materi).toBe(1);
    expect(p.iklan!.budget_terbakar.belanja).toBe(500_000);
  });

  it('places products in the four quadrants and parks untested SKUs separately', () => {
    const p = run({ shop_tt: shopTt(), prod_tt: prodTt() }).payload;
    const b = p.produk!.benchmark;
    expect(b.bintang.produk.map((x) => x.nama)).toContain('Produk Bintang');
    expect(b.bocor_traffic.produk.map((x) => x.nama)).toContain('Produk Bocor');
    expect(b.hidden_gem.produk.map((x) => x.nama)).toContain('Hidden Gem');
    expect(b.tidur.jumlah).toBe(1); // 3 klik < ambang uji
    expect(b.tidak_tayang.jumlah).toBe(1); // 0 klik
  });

  it('excludes the shop\'s own account from the creator pool', () => {
    const p = run({ shop_tt: shopTt(), aff_kr: affKr() }).payload;
    expect(p.afiliasi!.akun_sendiri_dikecualikan).toEqual(['Toko Resmi']);
    expect(p.afiliasi!.kreator_total).toBe(3);
    expect(p.afiliasi!.kreator_produktif).toBe(1);
    expect(p.afiliasi!.posting_tanpa_hasil).toBe(1);
    expect(p.afiliasi!.pasif).toBe(1);
  });

  it('is deterministic — the same slots recompute the same payload (aturan #4)', () => {
    const slots = { shop_tt: shopTt(), live_toko: liveToko(), prod_tt: prodTt() };
    expect(JSON.stringify(run(slots).payload)).toBe(JSON.stringify(run(slots).payload));
  });
});

// ── skor ────────────────────────────────────────────────────────────────────
describe('skor', () => {
  it('weights the six dimensions to exactly 1.00', () => {
    const sk = run({ shop_tt: shopTt() }).skor;
    expect(sk.dimensi.reduce((a, d) => a + d.bobot, 0)).toBeCloseTo(1, 10);
  });

  it('scores a missing file NEUTRAL and says so, instead of punishing it', () => {
    const sk = run({ shop_tt: shopTt() }).skor;
    const live = sk.dimensi.find((d) => d.key === 'live');
    expect(live!.skor).toBe(5);
    expect(live!.catatan).toMatch(/tidak diunggah/);
  });

  it('scale() clamps and treats null as neutral', () => {
    expect(scale(null, 0, 10)).toBe(5);
    expect(scale(-5, 0, 10)).toBe(0);
    expect(scale(50, 0, 10)).toBe(10);
  });
});

// ── TTAM ────────────────────────────────────────────────────────────────────
describe('detectTtam', () => {
  const ttam = (extra: string[], rows: unknown[][]): Sheet =>
    parse(sheetAoa(['Ad group name', 'Primary status', 'Spend', 'Impressions', 'Reach', 'Clicks (destination)', ...extra], rows, 'Ads 2026-08-01 ~ 2026-08-31'), 'ttam.xlsx');

  it('recognises each of the four Ads Manager exports', () => {
    expect(detectTtam(ttam(['New consideration size'], [['AG1', 'Active', '1000', '10', '5', '2', '100']]))).toBe('ttam_consideration');
    expect(detectTtam(ttam(['Paid follows'], [['AG1', 'Active', '1000', '10', '5', '2', '7']]))).toBe('ttam_follows');
    expect(detectTtam(ttam(['Checkouts initiated (Shop)'], [['AG1', 'Active', '1000', '10', '5', '2', '3']]))).toBe('ttam_showcase');
    expect(detectTtam(ttam(['Video views', 'CPM'], [['AG1', 'Active', '1000', '10', '5', '2', '9', '20']]))).toBe('ttam_videoviews');
  });

  it('does NOT mistake a Seller Center export for an Ads Manager one', () => {
    expect(detectTtam(shopTt())).toBeNull();
    expect(detectTtam(prodTt())).toBeNull();
  });

  it('drops the export\'s own "Total of N results" row instead of double-counting it', () => {
    const s = ttam(['Paid follows'], [
      ['AG1', 'Active', '1000', '10', '5', '2', '7'],
      ['Total of 1 results', '', '1000', '10', '5', '2', '7'],
    ]);
    const p = runReport({ shop_tt: shopTt(), ttam_follows: s },
      { periodeTipe: 'bulanan', klien: KLIEN, generatedAt: GEN_AT }).payload;
    expect(p.ads_manager!.follows!.ad_group).toBe(1);
    expect(p.ads_manager!.follows!.belanja).toBe(1000);
  });

  it('keeps Ads Manager spend OUT of the GMV Max ROI', () => {
    const s = ttam(['Video views', 'CPM'], [['AG1', 'Active', '5000000', '1000000', '500000', '2000', '400000', '5']]);
    const p = runReport({ shop_tt: shopTt(), ads_prod: adsProd(), ttam_videoviews: s },
      { periodeTipe: 'bulanan', klien: KLIEN, generatedAt: GEN_AT }).payload;
    expect(p.iklan!.total.biaya).toBe(1_500_000); // unchanged by the 5jt awareness spend
    expect(p.ads_manager!.total_belanja).toBe(5_000_000);
  });
});

// ── render ──────────────────────────────────────────────────────────────────
describe('render', () => {
  const full = () => run({ shop_tt: shopTt(), live_toko: liveToko(), prod_tt: prodTt(), ads_prod: adsProd(), aff_kr: affKr() }).payload;

  it('OMITS internal remarks from the client HTML source, not merely hides them', () => {
    const p = full();
    const klien = renderReportHtml(p, 'klien');
    const internal = renderReportHtml(p, 'internal');
    expect(internal).toContain('Budget Terbakar');
    expect(internal).toContain('Posting Tanpa Hasil');
    expect(internal).toContain('VERSI INTERNAL');
    // the whole point: a forwarded client file cannot be View-Sourced for these
    expect(klien).not.toContain('Budget Terbakar');
    expect(klien).not.toContain('Posting Tanpa Hasil');
    expect(klien).not.toContain('badge-int">INTERNAL');
    expect(klien).not.toContain('Kreator Nempel'); // the "posting tanpa hasil" names
    expect(klien).not.toContain('Retensi Tayangan LIVE');
  });

  it('numbers sections contiguously when optional sections are absent', () => {
    const p = run({ shop_tt: shopTt() }).payload; // no Tokopedia, no Ads Manager
    const html = renderReportHtml(p, 'klien');
    const nums = [...html.matchAll(/<h2[^>]*>(\d+)\./g)].map((m) => Number(m[1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it('labels a weekly report as weekly', () => {
    const p = run({ shop_tt: shopTt(META_MINGGU) }, 'mingguan').payload;
    expect(renderReportHtml(p, 'klien')).toContain('Weekly Report');
    expect(renderReportHtml(full(), 'klien')).toContain('Monthly Report');
  });

  it('escapes client-controlled text (a product name is not markup)', () => {
    const evil = parse(sheetAoa(PROD_HEADER, [
      ['<script>alert(1)</script>', 'P9', 'Rp40.000.000', '900', '20.000', '3,00%', '27', '30'],
    ], META_BULAN), 'p.xlsx');
    const html = renderReportHtml(run({ shop_tt: shopTt(), prod_tt: evil }).payload, 'klien');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('formats money the house way and never prints a bare NaN', () => {
    // renderBody, not the document: the Chart.js bootstrap legitimately contains
    // `typeof Chart==='undefined'`, and asserting over it would only teach the
    // test to ignore the thing it exists to catch.
    const body = renderBody(full(), 'internal');
    expect(body).toMatch(/Rp\. [\d.]+,00/);
    expect(body).not.toContain('NaN');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('[object Object]');
  });
});

// ── insight yang disunting AM ───────────────────────────────────────────────
const fullPayload = () => run({
  shop_tt: shopTt(), live_toko: liveToko(), prod_tt: prodTt(), ads_prod: adsProd(), aff_kr: affKr(),
}).payload;

describe('insight override di renderer', () => {
  const OVERRIDE: PayloadInsight = {
    ringkasan: 'RINGKASAN SUNTINGAN AM',
    poin: ['POIN SUNTINGAN SATU', 'POIN SUNTINGAN DUA'],
    rekomendasi_tinggi: [
      { judul: 'REK TINGGI SUNTINGAN', target: 'T', dampak: 'D', timeline: '2 minggu' },
    ],
    rekomendasi_sedang: [],
    outlook: 'OUTLOOK SUNTINGAN AM',
    indikator: [{ nama: 'IND SUNTINGAN', target: '99%' }],
  };

  it('renders the override text instead of the engine narrative', () => {
    const p = fullPayload();
    const html = renderReportHtml(p, 'klien', OVERRIDE);
    expect(html).toContain('RINGKASAN SUNTINGAN AM');
    expect(html).toContain('POIN SUNTINGAN SATU');
    expect(html).toContain('REK TINGGI SUNTINGAN');
    expect(html).toContain('OUTLOOK SUNTINGAN AM');
    expect(html).toContain('IND SUNTINGAN');
    // and the engine's own sentences are GONE, not merely pushed down the page
    expect(html).not.toContain(p.insight.ringkasan);
    expect(html).not.toContain(p.insight.outlook);
  });

  it('is byte-identical to today’s output when no override is passed', () => {
    const p = fullPayload();
    // The regression that matters: adding the parameter must not shift one byte
    // for the thousands of reports that will never be edited.
    expect(renderBody(p, 'klien')).toEqual(renderBody(p, 'klien', undefined));
    expect(renderBody(p, 'klien')).toEqual(renderBody(p, 'klien', p.insight));
    expect(renderReportHtml(p, 'internal')).toEqual(renderReportHtml(p, 'internal', p.insight));
  });

  it('escapes override text — an AM pasting markup cannot inject it', () => {
    const html = renderBody(fullPayload(), 'klien', { ...OVERRIDE, ringkasan: '<img src=x onerror=1>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('keeps the client mode free of internal blocks even with an override', () => {
    const html = renderReportHtml(fullPayload(), 'klien', OVERRIDE);
    expect(html).not.toContain('INTERNAL');
    expect(html).not.toContain('badge-int">INTERNAL');
  });
});

describe('normalizeInsightDraft', () => {
  const ok = {
    ringkasan: '  Ringkasan yang wajar  ',
    poin: ['  poin satu  ', '', '   ', 'poin dua'],
    rekomendasi_tinggi: [{ judul: 'J', target: 'T', dampak: 'D', timeline: '1 minggu' }],
    rekomendasi_sedang: [{ judul: '', target: '', dampak: '', timeline: '' }],
    outlook: 'Outlook wajar',
    indikator: [{ nama: 'N', target: 'X' }, { nama: '', target: '' }],
  };

  it('trims, drops blank list rows, and preserves author order', () => {
    const out = normalizeInsightDraft(ok);
    expect(out.ringkasan).toBe('Ringkasan yang wajar');
    expect(out.poin).toEqual(['poin satu', 'poin dua']);
    expect(out.rekomendasi_sedang).toEqual([]);
    expect(out.indikator).toEqual([{ nama: 'N', target: 'X' }]);
  });

  it('refuses blank required prose rather than falling back to the engine text', () => {
    expect(() => normalizeInsightDraft({ ...ok, ringkasan: '   ' }))
      .toThrow(MSG_RINGKASAN_WAJIB);
    expect(() => normalizeInsightDraft({ ...ok, outlook: '' }))
      .toThrow('[outlook periode berikutnya wajib diisi]');
    expect(() => normalizeInsightDraft({ ...ok, poin: ['', '  '] })).toThrow(MSG_POIN_KOSONG);
  });

  it('refuses a partly filled recommendation card', () => {
    expect(() => normalizeInsightDraft({
      ...ok, rekomendasi_tinggi: [{ judul: 'J', target: '', dampak: 'D', timeline: '1 minggu' }],
    })).toThrow(MSG_REK_TAK_LENGKAP);
  });

  it('refuses markup in any field', () => {
    expect(() => normalizeInsightDraft({ ...ok, ringkasan: 'naik <b>20%</b>' }))
      .toThrow(MSG_ADA_MARKUP);
    expect(() => normalizeInsightDraft({ ...ok, poin: ['a > b'] })).toThrow(MSG_ADA_MARKUP);
  });

  it('enforces length and list ceilings, naming the field', () => {
    expect(() => normalizeInsightDraft({ ...ok, ringkasan: 'x'.repeat(INSIGHT_MAX.ringkasan + 1) }))
      .toThrow(`[teks ringkasan eksekutif melebihi ${INSIGHT_MAX.ringkasan} karakter]`);
    expect(() => normalizeInsightDraft({
      ...ok, poin: Array.from({ length: INSIGHT_MAX_POIN + 1 }, (_, i) => `p${i}`),
    })).toThrow(`[maksimal ${INSIGHT_MAX_POIN} poin key insight]`);
  });

  it('throws InsightDraftError so the API can map it to 400', () => {
    expect(() => normalizeInsightDraft({})).toThrow(InsightDraftError);
  });

  it('accepts an engine-produced insight unchanged (round-trip)', () => {
    // The engine's own narrative must survive its own gate — otherwise revisi 0
    // could not be stored, and "kembalikan ke insight mesin" would be impossible.
    const engine = fullPayload().insight;
    expect(normalizeInsightDraft(engine)).toEqual(engine);
  });
});

// ── polish tampilan (§1.8) ─────────────────────────────────────────────────
describe('paritas visual dokumen laporan', () => {
  it('loads FontAwesome and gives every section heading an icon', () => {
    const html = renderReportHtml(fullPayload(), 'klien');
    expect(html).toContain('font-awesome/6.5.1');
    // Every NUMBERED section, not just the first: an icon set with holes reads
    // as a rendering bug rather than a design. The score block's own <h2> is
    // deliberately excluded — it sits above the numbering, is already carried by
    // the gauge beside it, and a chip there would compete with it.
    const withIcon = [...html.matchAll(/<span class="sec-ico"><i class="fa-solid ([\w-]+)"><\/i><\/span>(\d+)\./g)];
    const numbered = [...html.matchAll(/<h2[^>]*>[\s\S]{0,120}?(\d+)\.\s/g)];
    expect(withIcon.length).toBe(numbered.length);
    expect(withIcon.map((m) => Number(m[2]))).toEqual(withIcon.map((_, i) => i + 1));
    expect(new Set(withIcon.map((m) => m[1])).size).toBeGreaterThan(5);
  });

  it('draws the two quadrant bubble charts, with the SAME thresholds the routing used', () => {
    const p = fullPayload();
    const html = renderReportHtml(p, 'klien');
    expect(html).toContain('id="c_quad_rel"');
    expect(html).toContain('id="c_quad_bench"');
    const d = chartData(p) as { quadRel: { klikTinggi: number; cvrTinggi: number } | null };
    expect(d.quadRel).not.toBeNull();
    // A chart drawn against different cut-offs than the table beside it would be
    // worse than no chart, so this is asserted rather than eyeballed.
    expect(d.quadRel?.klikTinggi).toBe(p.produk?.ambang.relatif.klik_tinggi);
    expect(d.quadRel?.cvrTinggi).toBeCloseTo((p.produk?.ambang.relatif.cvr_tinggi ?? 0) * 100, 6);
  });

  it('leaves a zero-click product off the log axis, and says so in the count', () => {
    const p = fullPayload();
    const d = chartData(p) as { quadRel: { sets: { data: { x: number }[] }[] } };
    const semua = d.quadRel.sets.flatMap((s) => s.data);
    // The fixture has 5 products; "Belum Tayang" has 0 clicks and cannot be
    // plotted on a logarithmic axis, so the chart must carry 4 — not 5 with one
    // silently dropped by Chart.js.
    expect(semua.length).toBe(4);
    expect(semua.every((pt) => pt.x > 0)).toBe(true);
  });

  it('renders the score as a CSS ring, so it survives the PDF rasteriser', () => {
    const html = renderReportHtml(fullPayload(), 'klien');
    expect(html).toContain('class="gauge"');
    expect(html).toContain('conic-gradient');
    // No canvas for the score: an unfinished chart animation rasterises blank,
    // and the number a client looks at first would be missing from their file.
    expect(html).not.toContain('id="c_skor"');
  });

  it('offers a PDF download in the document but keeps it out of the PDF and the print', () => {
    const html = renderReportHtml(fullPayload(), 'klien');
    expect(html).toContain('id="btnPdf"');
    expect(html).toContain('html2pdf');
    expect(html).toContain('class="no-print');
    expect(html).toContain('@media print{.no-print{display:none!important}}');
    // The button lives OUTSIDE #reportBody — html2pdf renders that element, so a
    // button inside it would appear in the PDF of itself.
    const body = html.indexOf('id="reportBody"');
    expect(html.indexOf('id="btnPdf"')).toBeLessThan(body);
  });

  it('escapes CHART_DATA for script context — a product name cannot close the tag', () => {
    // The real vector: CHART_DATA carries PRODUCT NAMES from the client's own
    // catalogue, and JSON.stringify does not escape `<`.
    const evil = parse(sheetAoa(PROD_HEADER, [
      ['</script><script>alert(1)</script>', 'P9', 'Rp40.000.000', '900', '20.000', '3,00%', '27', '30'],
    ], META_BULAN), 'p.xlsx');
    const html = renderReportHtml(run({ shop_tt: shopTt(), prod_tt: evil }).payload, 'klien');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c');
    // and the data still round-trips: escaped, not dropped.
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('names the PDF after the store, and marks an internal one as internal', () => {
    const p = fullPayload();
    expect(renderReportHtml(p, 'klien')).toContain('REPORT_PDF_NAME');
    expect(renderReportHtml(p, 'internal')).toContain('-INTERNAL');
    // A client's copy must never carry the internal marker.
    expect(renderReportHtml(p, 'klien')).not.toContain('-INTERNAL');
  });
});
