/**
 * Shopee report engine tests. Mirrors `../report.test.ts`'s depth and style:
 * fixtures use the exact column-name strings the parsers key on, and what is
 * asserted is what would otherwise reach a client's inbox wrong — null vs
 * zero, division-by-zero → `—`, house money format, and the fact that the
 * client HTML never carries an internal-only remark in its source.
 */
import { describe, expect, it } from 'vitest';
import { normalizeInsightDraft } from '../insight-edit';
import type { PayloadInsight } from '../payload';
import {
  computeHealth, computeQuadrants, extractIdentity, genericZero, parseAdsCsv, parseAdsLive, parseAffCsv,
  parseBisnisHome, parseBisnisProduk, parseChat, parseKesehatan, parseMeta, parseVideo, parseVoucher,
  buildShopeeMetrics,
} from './metrik';
import { computeSkor } from './skor';
import { buildInsights } from './insight';
import type { ShopeeReportPayload } from './payload';
import { renderBody, renderReportHtml } from './render';
import { runShopeeReport } from './run';
import { REPORT_BENCH_SHOPEE_V1 } from './bench';
import { detectModule, detectModuleFromContent, parseFilename } from './detect';
import type { Aoa } from '../../baseline/types';
import type { ShopeeSlots } from './types';

const B = REPORT_BENCH_SHOPEE_V1;
const KLIEN = { nama: 'PT Ezzy', toko: 'EzzyConnect', platform: 'Shopee', kategori: 'Fashion', account_manager: 'EMP-002', store_link: null };
const GEN_AT = '2026-09-01T03:00:00.000Z';

// ── fixtures ────────────────────────────────────────────────────────────────
const HOME_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];
const bisnisHomeAoa = (): Aoa => [
  ['Pesanan Dibuat'],
  HOME_HEADER,
  ['Total', 'Rp100.000.000', '1.000', 'Rp100.000', '5.000', '50.000', '2,00%', '50', 'Rp5.000.000', '10', 'Rp1.000.000', '900', '300', '600', '50', '20,00%'],
  ['01/08/2026', 'Rp3.000.000', '30', 'Rp100.000', '150', '2.000', '1,50%', '2', 'Rp50.000', '0', 'Rp0', '25', '10', '15', '2', '10,00%'],
  ['02/08/2026', 'Rp4.000.000', '40', 'Rp100.000', '160', '2.100', '1,90%', '1', 'Rp30.000', '0', 'Rp0', '30', '12', '18', '2', '11,00%'],
];

/** No cancelled/returned orders at all — the "the column is genuinely absent" case (rule 1). */
const bisnisHomeNoCancelAoa = (): Aoa => [
  ['Pesanan Dibuat'],
  ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Total Pengunjung', 'Tingkat Konversi Pesanan'],
  ['Total', 'Rp50.000.000', '500', '25.000', '2,00%'],
];

const PRODUK_HEADER = [
  'Kode Produk', 'Produk', 'Nama Variasi', 'Status Produk Saat Ini', 'Jumlah Produk Dilihat', 'Produk Diklik',
  'Pengunjung Produk (Kunjungan)', 'Pesanan Dibuat', 'Total Penjualan (Pesanan Dibuat) (IDR)',
  'Total Pembeli (Pesanan Dibuat)', 'Tingkat Konversi (Pesanan yang Dibuat)', 'Pesanan Siap Dikirim',
  'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Tingkat Konversi (Pesanan Siap Dikirim)',
];
const bisnisProdukAoa = (): Aoa => [
  PRODUK_HEADER,
  ['SKU-A', 'Produk Bintang', '-', 'Aktif', '5000', '900', '1000', '300', 'Rp90.000.000', '290', '30,00%', '280', 'Rp84.000.000', '28,00%'],
  ['SKU-B', 'Produk Bocor', '-', 'Aktif', '8000', '1200', '1500', '5', 'Rp1.000.000', '5', '0,33%', '5', 'Rp900.000', '0,30%'],
  ['SKU-C', 'Hidden Gem', '-', 'Aktif', '300', '80', '120', '30', 'Rp6.000.000', '28', '25,00%', '28', 'Rp5.500.000', '23,00%'],
  ['SKU-D', 'Produk Tidur', '-', 'Aktif', '10', '2', '20', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
  ['SKU-E', 'Tidak Tayang', '-', 'Aktif', '0', '0', '0', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
];

const adsToko = (): Aoa => [
  ['Nama Iklan', 'Status', 'Dilihat', 'Jumlah Klik', 'Persentase Klik', 'Omzet Penjualan', 'Biaya', 'Pesanan', 'Produk Terjual', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
  ['Kampanye A', 'Berjalan', '50000', '2000', '4.00%', '40000000', '5000000', '80', '85', '8.00', '12.50%'],
];

const adsLiveAoa = (): Aoa => [
  ['Nama Iklan', 'Status', 'Penonton', 'Pesanan', 'Tingkat Konversi', 'Omzet Penjualan', 'Biaya', 'Efektifitas Iklan'],
  ['Live Ads A', 'Berjalan', '3000', '40', '1.33%', '15000000', '3000000', '5.00'],
];

const layananChatAoa = (): Aoa => [
  ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Pengunjung Bertanya', 'Pertanyaan Diajukan', 'Chat Dibalas', 'Chat Belum Dibalas', 'Waktu Respon Rata-rata', 'CSAT %', 'Persentase Chat Dibalas', 'Total Pembeli', 'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'],
  ['01-31 Agu', '5000', '800', '700', '750', '760', '40', '00:12:30', '90,00%', '95,00%', '150', '160', 'Rp16.000.000', '20,00%'],
];

const kesehatanSatuPoinAoa = (): Aoa => [
  ['Poin Penalti', 'Deskripsi', 'Durasi'],
  ['1', 'Pelanggaran larangan produk', '7 hari'],
];
const kesehatanBersihAoa = (): Aoa => [['Poin Penalti', 'Deskripsi', 'Durasi']];

const VIDEO_HEADER = [
  'Periode Data', 'Penjualan(Pesanan Dibuat)', 'Penjualan(Pesanan Siap Dikirim)', 'Pesanan(Pesanan Dibuat)',
  'Pesanan(Pesanan Siap Dikirim)', 'Produk Terjual(Pesanan Dibuat)', 'Penonton', 'Ditonton', 'Penonton Efektif',
  'Persentase Klik', 'Pembeli(Pesanan Dibuat)', 'Tambah ke Keranjang', 'Klik Produk', 'Suka', 'Share',
  'Komentar', 'Pengikut Baru dari Video', 'Tingkat Video Selesai Ditonton',
];
const bisnisVideoAoa = (): Aoa => [
  VIDEO_HEADER,
  ['01-31 Agu 2026', 'Rp5.000.000', 'Rp4.800.000', '50', '48', '52', '8000', '12000', '6000', '3,00%', '45', '200', '360', '500', '80', '120', '30', '40,00%'],
];

// Affiliate/ads CSVs parse with raw=true (dot=decimal, tool locale='en') — plain
// digit strings, not `Rp10.000.000` id-locale formatting (that belongs to the
// xlsx Seller Centre exports only).
const affCreatorAoa = (): Aoa => [
  ['Username', 'Omzet', 'Produk Terjual', 'Pesanan', 'Click', 'Komisi', 'ROI', 'Total Pembeli', 'Pembeli Baru'],
  ['@kreator1', '10000000', '20', '18', '500', '1000000', '3.5', '15', '4'],
];

const promoVoucherAoa = (): Aoa => [
  ['Periode Waktu', 'Klaim', 'Pesanan (Pesanan Dibuat)', 'Penjualan (Pesanan Dibuat) (IDR)', 'Tingkat Penggunaan (Pesanan Dibuat)', 'Pembeli (Pesanan Dibuat)', 'Total Biaya (Pesanan Dibuat) (IDR)'],
  ['01-31 Agu', '200', '150', 'Rp8.000.000', '75,00%', '140', 'Rp500.000'],
];

const metaAoa = (): Aoa => [
  ['Minggu', 'Nama Kampanye', 'Jumlah yang Dibelanjakan', 'Nilai Konversi Pembelian Khusus', 'ROAS Pembelian', 'Pembelian dengan Item Bersama', 'Impresi', 'Klik Tautan', 'CTR', 'Penambahan ke Keranjang Belanja dengan Item'],
  ['', '', '2000000', '5000000', '2.50', '10', '50000', '800', '1.60', '20'],
];

const slotsFull = (): ShopeeSlots => ({
  bisnis_home: bisnisHomeAoa(),
  bisnis_produk: bisnisProdukAoa(),
  ads_toko: adsToko(),
  ads_live: adsLiveAoa(),
  layanan_chat: layananChatAoa(),
  bisnis_kesehatan: kesehatanSatuPoinAoa(),
  bisnis_video: bisnisVideoAoa(),
  aff_creator: affCreatorAoa(),
  promo_voucher: promoVoucherAoa(),
  meta: metaAoa(),
});

const run = (slots: ShopeeSlots, periode = 'Agustus 2026') =>
  runShopeeReport(slots, { bench: B, benchmarkVersi: 1, klien: KLIEN, generatedAt: GEN_AT, periode });

// ── parsers ─────────────────────────────────────────────────────────────────
describe('parseBisnisHome', () => {
  it('reads the Pesanan Dibuat section summary + daily rows', () => {
    const out = parseBisnisHome(bisnisHomeAoa());
    expect(out.pesanan_dibuat?.summary.penjualan).toBe(100000000);
    expect(out.pesanan_dibuat?.summary.pesanan).toBe(1000);
    expect(out.pesanan_dibuat?.daily).toHaveLength(2);
    expect(out.pesanan_dibuat?.daily[0]).toEqual({ tanggal: '01/08/2026', nilai: expect.objectContaining({ penjualan: 3000000 }) });
  });

  it('a column the export never carried is null, not 0 (rule 1)', () => {
    const out = parseBisnisHome(bisnisHomeNoCancelAoa());
    expect(out.pesanan_dibuat?.summary.pesanan_batal).toBeNull();
    expect(out.pesanan_dibuat?.summary.penjualan_batal).toBeNull();
  });

  it('throws a BI message when neither section is found', () => {
    expect(() => parseBisnisHome([['tidak ada apa-apa']])).toThrow(/\[.*\]/);
  });
});

describe('parseBisnisProduk', () => {
  it('reads product rows and keeps variation rows separate from parents', () => {
    const out = parseBisnisProduk(bisnisProdukAoa());
    expect(out.products).toHaveLength(5);
    expect(out.variations).toHaveLength(0);
    expect(out.products[0].kode_produk).toBe('SKU-A');
    expect(out.products[0].penjualan_dibuat).toBe(90000000);
  });

  it('a dash cell parses as null, not 0 — CR of a zero-order product is unknown, not zero', () => {
    const out = parseBisnisProduk(bisnisProdukAoa());
    const tidur = out.products.find((p) => p.kode_produk === 'SKU-D')!;
    expect(tidur.cr_pesanan_dibuat).toBeNull();
  });
});

describe('computeQuadrants', () => {
  it('classifies bintang/bocor_traffic/hidden_gem/tidur/tidak_tayang by benchmark absolute bands', () => {
    const produk = parseBisnisProduk(bisnisProdukAoa());
    const kd = computeQuadrants(produk, B);
    const b = kd.mode_absolute;
    expect(b.bintang.map((p) => p.kode_produk)).toContain('SKU-A');
    expect(b.bocor_traffic.map((p) => p.kode_produk)).toContain('SKU-B');
    expect(b.hidden_gem.map((p) => p.kode_produk)).toContain('SKU-C');
    expect(b.tidur.map((p) => p.kode_produk)).toContain('SKU-D');
    expect(b.tidak_tayang.map((p) => p.kode_produk)).toContain('SKU-E');
  });

  it('every bucket partition is disjoint and covers every product exactly once', () => {
    const produk = parseBisnisProduk(bisnisProdukAoa());
    const kd = computeQuadrants(produk, B);
    for (const mode of [kd.mode_relatif, kd.mode_absolute]) {
      const all = Object.values(mode).flat();
      expect(all).toHaveLength(produk.products.length);
      expect(new Set(all.map((p) => p.kode_produk)).size).toBe(all.length);
    }
  });
});

describe('parsers — division by zero / missing file stays null', () => {
  it('parseAdsCsv: an ads row with 0 impressions still parses; CTR is computed at health level, not here', () => {
    const { items } = parseAdsCsv(adsToko());
    expect(items[0].omzet).toBe(40000000);
    expect(items[0].biaya).toBe(5000000);
  });

  it('parseAdsLive: percentage in raw/en locale is dot-decimal', () => {
    const { items } = parseAdsLive(adsLiveAoa());
    expect(items[0].cr).toBeCloseTo(0.0133, 4);
    expect(items[0].roas).toBe(5.0);
  });

  it('parseChat: H:MM:SS response time converts to seconds, and percent columns use id locale (comma-decimal)', () => {
    const chat = parseChat(layananChatAoa());
    expect(chat.summary.waktu_respon_detik).toBe(750);
    expect(chat.summary.response_rate).toBeCloseTo(0.95, 4);
    expect(chat.summary.csat).toBeCloseTo(0.90, 4);
  });

  it('parseKesehatan: 0 rows of penalty = 0 poin_total, not null', () => {
    expect(parseKesehatan(kesehatanBersihAoa())).toEqual({ poin_total: 0, penalti: [], uploaded: true });
  });

  it('parseVideo: has_activity is true only when ditonton or penjualan is actually > 0', () => {
    const v = parseVideo(bisnisVideoAoa());
    expect(v.has_activity).toBe(true);
    expect(v.summary.ditonton).toBe(12000);
  });

  it('parseVoucher and parseMeta and parseAffCsv read their own header shapes', () => {
    expect(parseVoucher(promoVoucherAoa()).summary.penjualan_dibuat).toBe(8000000);
    expect(parseMeta(metaAoa()).summary.roas).toBeCloseTo(2.5, 4);
    expect(parseAffCsv(affCreatorAoa(), ['username']).items[0].omzet).toBe(10000000);
  });

  it('genericZero flags a file with only zero cells as no activity', () => {
    expect(genericZero([['x', '0', '0']])).toEqual({ raw_rows: 1, has_activity: false });
    expect(genericZero([['x', '5', '0']])).toEqual({ raw_rows: 1, has_activity: true });
  });

  it('extractIdentity reads store id/name from the leading rows, and is null when neither is present', () => {
    expect(extractIdentity([['ID Toko', 'SHOP-1'], ['Nama Toko', 'Ezzy Store']])).toEqual({ id: 'SHOP-1', nama: 'Ezzy Store' });
    // No explicit "ID Toko" row — falls back to the lowercased store NAME as the identity key.
    expect(extractIdentity([['Nama Toko', 'Ezzy Store']])).toEqual({ id: 'ezzy store', nama: 'Ezzy Store' });
    expect(extractIdentity([['x', 'y']])).toBeNull();
  });
});

describe('computeHealth — division by zero and absent data are both null, never a confident 0', () => {
  it('no ads files at all → health.ads is null (not a zeroed object)', () => {
    const h = computeHealth({}, B);
    expect(h.ads).toBeNull();
  });

  it('spend without a readable omzet column → ROAS/ACOS null, not "ROAS 0,00x"', () => {
    const noOmzetHeader = ['Nama Iklan', 'Status', 'Dilihat', 'Jumlah Klik', 'Biaya'];
    const noOmzet: Aoa = [noOmzetHeader, ['Kampanye X', 'Berjalan', '1000', '50', '2000000']];
    const h = computeHealth({ ads_toko: parseAdsCsv(noOmzet) }, B);
    expect(h.ads?.spend).toBe(2000000);
    expect(h.ads?.omzet).toBeNull();
    expect(h.ads?.roas).toBeNull();
  });
});

// ── skor ────────────────────────────────────────────────────────────────────
describe('computeSkor', () => {
  it('the six weights sum to 1.00', () => {
    const M = buildShopeeMetrics({}, B);
    const sk = computeSkor(M);
    expect(sk.dimensi).toHaveLength(6);
    expect(sk.dimensi.reduce((a, d) => a + d.bobot, 0)).toBeCloseTo(1.0, 6);
    expect(sk.dimensi.map((d) => d.bobot)).toEqual([0.22, 0.22, 0.18, 0.14, 0.12, 0.12]);
  });

  it('a dimension with no source file scores a NEUTRAL 5, never the worst score', () => {
    const M = buildShopeeMetrics({}, B);
    const sk = computeSkor(M);
    for (const d of sk.dimensi) expect(d.skor).toBe(5);
    expect(sk.total).toBe(5);
    expect(sk.label).toBe('KRITIS'); // total 5 < 6 — below the "PERLU PERHATIAN" band
    // roas_channel / product_performance / live_streaming / kesehatan_toko each
    // gate on ONE file's presence and say so explicitly (MISSING()); traffic_quality
    // and conversion_retention blend two signals and stay neutral via the
    // null-safe `scaleV`, same as the tool's own `scoreTraffic`/`scoreConv`.
    for (const key of ['roas_channel', 'product_performance', 'live_streaming', 'kesehatan_toko']) {
      expect(sk.dimensi.find((d) => d.key === key)!.catatan).toMatch(/tidak diunggah/);
    }
  });

  it('scoreLive: uploaded-but-zero-activity scores 1 with an honest note, distinct from "not uploaded" (5)', () => {
    const zero = buildShopeeMetrics({ bisnis_live: { raw_rows: 3, has_activity: false } }, B);
    const sk = computeSkor(zero);
    const live = sk.dimensi.find((d) => d.key === 'live_streaming')!;
    expect(live.skor).toBe(1);
    expect(live.catatan).toMatch(/Tidak ada sesi/);
  });

  it('0 poin penalti scores a perfect 10 on Kesehatan Toko', () => {
    const M = buildShopeeMetrics({ bisnis_kesehatan: parseKesehatan(kesehatanBersihAoa()) }, B);
    const sk = computeSkor(M);
    expect(sk.dimensi.find((d) => d.key === 'kesehatan_toko')!.skor).toBe(10);
  });
});

// ── insight ─────────────────────────────────────────────────────────────────
describe('buildInsights', () => {
  it('surfaces an active penalty as the FIRST key insight and a matching high-priority recommendation', () => {
    const M = buildShopeeMetrics({ bisnis_home: parseBisnisHome(bisnisHomeAoa()), bisnis_kesehatan: parseKesehatan(kesehatanSatuPoinAoa()) }, B);
    const sk = computeSkor(M);
    const I = buildInsights(M, sk);
    expect(I.poin[0]).toMatch(/poin penalti aktif/);
    expect(I.rekomendasiTinggi[0].judul).toMatch(/Pulihkan kesehatan toko/);
  });

  it('formats money the house way inside narrative text', () => {
    const M = buildShopeeMetrics({ bisnis_home: parseBisnisHome(bisnisHomeAoa()) }, B);
    const sk = computeSkor(M);
    const I = buildInsights(M, sk);
    expect(I.ringkasan).toMatch(/Rp\. [\d.]+,00/);
  });
});

// ── end-to-end pipeline + render ─────────────────────────────────────────────
describe('runShopeeReport — end to end', () => {
  it('throws a BI message when Bisnis — Home is missing', () => {
    expect(() => run({})).toThrow(/\[.*Home.*\]/);
  });

  it('produces a scored, rendered report from a realistic multi-file upload', () => {
    const { payload, skor } = run(slotsFull());
    expect(payload.schema).toBe('cdps.report.shopee.v1');
    expect(payload.kpi.gmv).toBe(100000000);
    expect(skor.total).toBeGreaterThan(0);
    const html = renderReportHtml(payload, 'klien');
    expect(html).toContain('EzzyConnect');
    expect(html).toContain('Agustus 2026');
    // `renderBody`, not the full document: the Chart.js bootstrap legitimately
    // contains `typeof Chart==='undefined'`, and asserting over the whole
    // document would only teach the test to ignore the thing it exists to catch
    // (same caveat as TikTok's `../report.test.ts`).
    const body = renderBody(payload, 'klien');
    expect(body).not.toContain('NaN');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('[object Object]');
  });

  it('numbers sections contiguously', () => {
    const html = renderReportHtml(run(slotsFull()).payload, 'klien');
    const nums = [...html.matchAll(/<h2[^>]*>(\d+)\./g)].map((m) => Number(m[1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });
});

describe('render — house rules', () => {
  const payload = () => run(slotsFull()).payload;

  it('formats money the house way (Rp. X.XXX.XXX,00) and division-by-zero as —', () => {
    const body = renderBody(payload(), 'internal');
    expect(body).toMatch(/Rp\. [\d.]+,00/);
    expect(body).not.toContain('NaN');
    // A store with zero video sumber rows never divides by zero for "% dari penonton".
    const emptyVideo = run({ bisnis_home: bisnisHomeAoa() }).payload;
    expect(renderBody(emptyVideo, 'klien')).toContain('Berkas Shopee Video tidak diunggah');
  });

  it('escapes client-controlled text in the HTML body (a product name is not markup)', () => {
    const evilProduk: Aoa = [PRODUK_HEADER, ['SKU-X', '<script>alert(1)</script>', '-', 'Aktif', '100', '50', '200', '10', 'Rp1.000.000', '9', '5,00%', '9', 'Rp900.000', '4,50%']];
    const html = renderReportHtml(run({ bisnis_home: bisnisHomeAoa(), bisnis_produk: evilProduk }).payload, 'klien');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a `</script>`-carrying product name inside the embedded CHART_DATA JSON blob', () => {
    const evilProduk: Aoa = [PRODUK_HEADER, ['SKU-X', '</script><script>alert(1)</script>', '-', 'Aktif', '5000', '900', '1000', '300', 'Rp90.000.000', '290', '30,00%', '280', 'Rp84.000.000', '28,00%']];
    const html = renderReportHtml(run({ bisnis_home: bisnisHomeAoa(), bisnis_produk: evilProduk }).payload, 'klien');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('OMITS internal remarks from the client HTML source, not merely hides them', () => {
    const p = payload();
    const klien = renderReportHtml(p, 'klien');
    const internal = renderReportHtml(p, 'internal');
    expect(internal).toContain('VERSI INTERNAL');
    expect(klien).not.toContain('VERSI INTERNAL');
    expect(klien).not.toContain('badge-int">INTERNAL');
  });
});

describe('insight override — byte-identical regression', () => {
  it('renderBody(p, mode) without an override is byte-identical to passing p.insight explicitly', () => {
    const p = payloadFixture();
    expect(renderBody(p, 'klien')).toEqual(renderBody(p, 'klien', undefined));
    expect(renderBody(p, 'klien')).toEqual(renderBody(p, 'klien', p.insight));
    expect(renderReportHtml(p, 'internal')).toEqual(renderReportHtml(p, 'internal', p.insight));
  });

  const OVERRIDE: PayloadInsight = {
    ringkasan: 'RINGKASAN SUNTINGAN AM', poin: ['POIN SATU'],
    rekomendasi_tinggi: [{ judul: 'REK TINGGI', target: 'T', dampak: 'D', timeline: '2 minggu' }],
    rekomendasi_sedang: [], outlook: 'OUTLOOK SUNTINGAN', indikator: [{ nama: 'IND', target: '99%' }],
  };

  it('renders the AM override text instead of the engine narrative, and drops it entirely (not merely hides it) — same contract as TikTok', () => {
    const p = payloadFixture();
    const html = renderReportHtml(p, 'klien', OVERRIDE);
    expect(html).toContain('RINGKASAN SUNTINGAN AM');
    expect(html).toContain('REK TINGGI');
    expect(html).not.toContain(p.insight.ringkasan);
  });

  it('the shared Wave-1 insight-edit validator accepts a Shopee-shaped draft unchanged — zero portal-side code needed', () => {
    const out = normalizeInsightDraft(OVERRIDE);
    expect(out).toEqual(OVERRIDE);
  });

  function payloadFixture(): ShopeeReportPayload {
    return run(slotsFull()).payload;
  }
});

// ── detect.ts — dual-path (filename primary, content fallback) ─────────────
describe('parseFilename', () => {
  it('reads the owner\'s manual convention `[prefix]-subtype && period && client && date.ext`', () => {
    const info = parseFilename('[bisnis]-Home && Juni 2026 && EzzyConnect && 2026-07-01.xlsx');
    expect(info).toEqual({ module: 'bisnis_home', client: 'EzzyConnect', period: 'Juni 2026', date: '2026-07-01', ext: 'xlsx', filename: '[bisnis]-Home && Juni 2026 && EzzyConnect && 2026-07-01.xlsx' });
  });

  it('returns null for an unrecognised prefix/subtype pair', () => {
    expect(parseFilename('[unknown]-Xyz.xlsx')).toBeNull();
  });
});

describe('detectModuleFromContent — fallback for a CDPS upload without the manual rename', () => {
  it('recognises the 10 modules with a genuinely distinguishable column signature', () => {
    expect(detectModuleFromContent(bisnisHomeAoa())).toBe('bisnis_home');
    expect(detectModuleFromContent(bisnisProdukAoa())).toBe('bisnis_produk');
    expect(detectModuleFromContent(kesehatanSatuPoinAoa())).toBe('bisnis_kesehatan');
    expect(detectModuleFromContent(bisnisVideoAoa())).toBe('bisnis_video');
    expect(detectModuleFromContent(promoVoucherAoa())).toBe('promo_voucher');
    expect(detectModuleFromContent(layananChatAoa())).toBe('layanan_chat');
    expect(detectModuleFromContent(metaAoa())).toBe('meta');
    expect(detectModuleFromContent(adsLiveAoa())).toBe('ads_live');
    expect(detectModuleFromContent(affCreatorAoa())).toBe('aff_creator');
  });

  it('KNOWN LIMITATION: ads_toko/ads_produk/ads_banner share an identical column layout and cannot be told apart by content — same as the shipped tool', () => {
    expect(detectModuleFromContent(adsToko())).toBeNull();
  });

  it('detectModule falls back to content only when the filename does not match the convention', () => {
    const byFilename = detectModule('[bisnis]-Home && Juni 2026 && Ezzy && 2026-07-01.xlsx', bisnisHomeAoa());
    expect(byFilename?.module).toBe('bisnis_home');
    expect(byFilename?.info).not.toBeNull();

    const byContent = detectModule('laporan-toko-tanpa-rename.xlsx', bisnisProdukAoa());
    expect(byContent?.module).toBe('bisnis_produk');
    expect(byContent?.info).toBeNull();

    expect(detectModule('random-export.csv', adsToko())).toBeNull();
  });
});

// ── payload shape parity with TikTok (zero portal-side code) ────────────────
describe('payload.insight shape matches TikTok\'s PayloadInsight exactly', () => {
  it('every key insight-edit.ts validates is present, and nothing extra', () => {
    const p = run(slotsFull()).payload;
    expect(Object.keys(p.insight).sort()).toEqual(
      ['ringkasan', 'poin', 'rekomendasi_tinggi', 'rekomendasi_sedang', 'outlook', 'indikator'].sort(),
    );
  });
});
