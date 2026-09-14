/**
 * G1-05 — `parsePdtZipEntries`/`decodePdtAoa` terhadap berkas BINER
 * SUNGGUHAN (`.xlsx` ditulis lewat `XLSX.write`, `.csv` teks mentah — bukan
 * fixture array-of-arrays seperti `packages/core/src/pdt/detect.test.ts`),
 * dibungkus ZIP sungguhan (`yazl`, pola sama `pdt-zip.test.ts`), lewat
 * pipeline SERVER penuh: `bacaDanEkstrakPdtZip` (G1-04) → `parsePdtZipEntries`
 * (G1-05, `XLSX.read` + `detectPdtModule` G1-02).
 *
 * Ini bukti "parse jalan tanpa browser" (DoD backlog G1-05) — G1-02's tes
 * sendiri sudah bilang berkas mentah klien tidak ada di repo, jadi fixture di
 * sini memakai STRING KOLOM LITERAL yang SAMA (disalin dari `detect.test.ts`,
 * sudah diverifikasi ke UAT Fim Motor/Avitaskin) tapi kali ini betul-betul
 * DITULIS ke bytes xlsx/csv dan DIBACA balik lewat `XLSX.read` — bukan
 * dilewatkan sebagai AoA siap-pakai.
 */
import { ZipFile } from 'yazl';
import { describe, expect, it, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { pdt } from '@cdps/core';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from './pdt-zip';
import { decodePdtAoa, parsePdtZipEntries } from './pdt-parse';

const { PDT_MODULES } = pdt;

type Aoa = unknown[][];

function zipkan(entries: { nama: string; isi: Buffer }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const e of entries) zip.addBuffer(e.isi, e.nama, { compress: true });
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

/** Tulis AoA jadi bytes `.xlsx` SUNGGUHAN — mitra tulis dari `decodePdtAoa`. */
function xlsxDariAoa(aoa: Aoa): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Tulis AoA jadi bytes `.csv` — opsional BOM `utf-8-sig` (PRD §6.7: CSV Shopee). */
function csvDariAoa(aoa: Aoa, bom = false): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const teks = XLSX.utils.sheet_to_csv(ws);
  return Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(teks, 'utf8')]);
}

// ---------------------------------------------------------------------------
// Fixture — 23 berkas, satu per fixture terverifikasi `detect.test.ts` (9
// TikTok + 13 Shopee, termasuk 2 varian ejaan `shopee_kesehatan` + 1 meta_ads
// = 22 modul berbeda). Disalin literal, bukan dikarang ulang.
// ---------------------------------------------------------------------------
const FIXTURES: { nama: string; kode: string; aoa: Aoa; csv?: boolean; bom?: boolean }[] = [
  {
    nama: 'f01_tiktok_orders.xlsx',
    kode: 'tt_orders',
    aoa: [
      ['Order ID', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity', 'SKU Unit Original Price',
        'SKU Subtotal After Discount', 'Order Status', 'Paid Time', 'Product Category', 'Creator Handle'],
      ['576…', '17123…', 'SKU-001', 'Kemeja Flanel', 'M/Merah', '1', '150000', '135000', 'Completed', '2026-07-15 10:00:00', 'Fashion', '@kreator1'],
    ],
  },
  {
    nama: 'f02_product_list.xlsx',
    kode: 'tt_product_analytics',
    aoa: [
      [], [], [],
      ['ID Produk', 'Nama', 'GMV', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual',
        'Pesanan SKU', 'AOV', 'CTR', 'CTOR', 'Impresi produk', 'Klik produk', 'Status daftar produk'],
      ['170…', 'Produk A', '10945407', '2000000', '1000000', '500000', '30', '183173', '3.51%', '0.40%', '832842', '27208', 'Aktif'],
    ],
  },
  {
    nama: 'f03_transaction_product.xlsx',
    kode: 'tt_transaction_product',
    aoa: [
      ['Product ID', 'Product category', 'GMV dari kreator', 'CTOR', 'Video', 'Siaran LIVE', 'Sampel terkirim'],
      ['170…', 'Fashion', '2000000', '0.40%', '5', '1', '3'],
    ],
  },
  {
    nama: 'f04_transaction_creator.xlsx',
    kode: 'tt_transaction_creator',
    aoa: [
      ['Creator name', 'GMV dari kreator', 'AOV', 'CTOR', 'Pesanan teratribusi', 'Tayangan video', 'Video', 'Siaran LIVE', 'Perkiraan komisi'],
      ['@kreator1', '2000000', '150000', '1.20%', '13', '5000', '5', '1', '100000'],
    ],
  },
  {
    nama: 'f05_video_overview.xlsx',
    kode: 'tt_video',
    aoa: [
      [], [],
      ['ID Kreator', 'Nama Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'],
      ['@kreator1', 'Kreator Satu', '712…', '2026-07-05', '170…', '5000', '200', '10', '30', 'Review produk', '15000', '300000'],
    ],
  },
  {
    nama: 'f06_live_analysis.xlsx',
    kode: 'tt_live',
    aoa: [
      [], [],
      ['ID Kreator', 'Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR'],
      ['@kreator1', 'Kreator Satu', '2026-07-05 20:00', '3600', '1000000', '10', '500', '2.00%'],
    ],
  },
  {
    nama: 'f07_shop_analytics.xlsx',
    kode: 'tt_shop_analytics',
    aoa: [
      ['GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
        'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut'],
      ['26560049', '143', '137', '145', '20627', '0.66418%', '26894689', '334640', '5000000', '3000000', '2000000', '1000000'],
    ],
  },
  {
    nama: 'f08_ads_product.xlsx',
    kode: 'tt_ads_product',
    aoa: [
      ['ID Campaign', 'Nama kampanye', 'ID produk', 'ID video', 'Akun TikTok', 'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor'],
      ['CAM-1', 'Kampanye A', '170…', '712…', 'avitaskin_official', '6540407', '80', '81755', '20666992'],
    ],
  },
  {
    nama: 'f09_ads_live.xlsx',
    kode: 'tt_ads_live',
    aoa: [
      ['Nama LIVE', 'ID Campaign', 'Nama kampanye', 'Biaya', 'Pesanan SKU', 'ROI', 'Pendapatan kotor'],
      ['LIVE Kampanye A', 'CAM-2', 'Kampanye Live A', '1000000', '10', '3.16', '3160000'],
    ],
  },
  {
    nama: 'f10_shop_stats.xlsx',
    kode: 'shopee_shop_stats',
    aoa: [
      ['Pesanan Dibuat'],
      ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
        'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
        'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru',
        'Total Pembeli Saat Ini', 'Total Potensi Pembeli', 'Tingkat Pembelian Berulang'],
      ['Total', 'Rp1.624.937.476', '13568', 'Rp119.762', '5000', '20627', '2,46%', '2785', 'Rp359.295.534', '140', 'Rp24.586.464', '11452', '300', '600', '50', '12,97%'],
    ],
  },
  {
    nama: 'f11_parent_sku.xlsx',
    kode: 'shopee_parent_sku',
    aoa: [
      ['Kode Produk', 'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)',
        'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Jumlah Produk Dilihat', 'Produk Diklik',
        'Tingkat Konversi (Pesanan yang Dibuat)', 'repeat order', 'Pengunjung Produk (Kunjungan)'],
      ['SKU-A', 'VAR-A1', 'SKU-A', 'Rp90.000.000', 'Rp84.000.000', '5000', '900', '30,00%', '25,00%', '1000'],
    ],
  },
  {
    nama: 'f12_ads_cpc.csv',
    kode: 'shopee_ads_cpc',
    csv: true,
    bom: true, // PRD §6.7: CSV Shopee = utf-8-sig
    aoa: [
      ['ID Toko: 938284780'], ['Periode: 01/07/2026 - 31/07/2026'], [], [], [], [], [],
      ['Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya', 'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
      ['SKU-A', '50000', '2000', '80', '5000000', 'Kampanye A', '40000000', '8,00', '12,50%'],
    ],
  },
  {
    nama: 'f13_ads_search.csv',
    kode: 'shopee_ads_search',
    csv: true,
    bom: true,
    aoa: [
      [], [], [], [], [], [], [],
      ['Kata Pencarian', 'SOV', 'Klik', 'Konversi', 'Biaya'],
      ['baju flanel', '12%', '100', '8', '200000'],
    ],
  },
  {
    nama: 'f14_ads_live.csv',
    kode: 'shopee_ads_live',
    csv: true,
    bom: true,
    aoa: [
      [], [], [], [], [], [],
      ['ID Iklan', 'Nama Iklan', 'Penonton', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan'],
      ['AD-1', 'Live Ads A', '3000', '40', '15000000', '3000000', '5,00'],
    ],
  },
  {
    nama: 'f15_shopee_live.xlsx',
    kode: 'shopee_live',
    aoa: [
      ['Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan'],
      ['Live Juli', '2026-07-10 20:00', '500', 'Rp5.000.000'],
    ],
  },
  {
    nama: 'f16_voucher.xlsx',
    kode: 'shopee_voucher',
    aoa: [
      ['Periode Waktu', 'Klaim', 'Pesanan (Pesanan Dibuat)', 'Penjualan (Pesanan Dibuat) (IDR)',
        'Tingkat Penggunaan (Pesanan Dibuat)', 'Pembeli (Pesanan Dibuat)', 'Total Biaya (Pesanan Dibuat) (IDR)'],
      ['01-31 Agu', '200', '150', 'Rp8.000.000', '75,00%', '140', 'Rp500.000'],
    ],
  },
  {
    nama: 'f17_chat.xlsx',
    kode: 'shopee_chat',
    aoa: [
      ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata', 'CSAT %',
        'Persentase Chat Dibalas', 'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'],
      ['01-31 Agu', '5000', '800', '760', '00:12:30', '90,00%', '95,00%', '160', 'Rp16.000.000', '20,00%'],
    ],
  },
  {
    nama: 'f18_chat_broadcast.xlsx',
    kode: 'shopee_chat_broadcast',
    aoa: [
      ['Nama Broadcast', 'penerima', 'dibaca', 'diklik', 'pesanan'],
      ['Promo Juli', '5000', '3000', '500', '20'],
    ],
  },
  {
    nama: 'f19_ams_produk.csv',
    kode: 'shopee_ams_produk',
    csv: true,
    aoa: [
      ['Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Estimasi Komisi(Rp)', 'ROI'],
      ['SKU-A', 'Produk A', '10000000', '1000000', '3,5'],
    ],
  },
  {
    nama: 'f20_ams_afiliasi.csv',
    kode: 'shopee_ams_afiliasi',
    csv: true,
    aoa: [
      ['ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI', 'Total Pembeli', 'Pembeli Baru'],
      ['11339711407', '@kreator1', '10000000', '20', '18', '1000000', '3.5', '15', '4'],
    ],
  },
  {
    nama: 'f21_kesehatan.xlsx',
    kode: 'shopee_kesehatan',
    aoa: [
      ['Poin Penalti', 'Deskripsi', 'Durasi'],
      ['1', 'Pelanggaran larangan produk', '7 hari'],
    ],
  },
  {
    nama: 'f22_kesehatan_ejaan_lain.xlsx',
    kode: 'shopee_kesehatan',
    aoa: [
      ['Poin Pinalti', 'Deskripsi', 'Durasi'], // ejaan alternatif yang memang muncul di export nyata
      ['2', 'Pelanggaran lain', '14 hari'],
    ],
  },
  {
    nama: 'f23_meta_ads.csv',
    kode: 'meta_ads',
    csv: true,
    aoa: [
      ['Minggu', 'Nama Kampanye', 'Nama iklan', 'Jumlah yang Dibelanjakan', 'ROAS', 'Impresi', 'Klik Tautan', 'CTR', 'CPM', 'CPC'],
      ['', 'Kampanye Meta A', 'Iklan A', '2000000', '2.50', '50000', '800', '1.60', '40000', '2500'],
    ],
  },
];

describe('parsePdtZipEntries / decodePdtAoa (G1-05) — dekode + deteksi lewat pipeline server penuh', () => {
  const direktoriUntukDibersihkan: string[] = [];
  afterEach(async () => {
    while (direktoriUntukDibersihkan.length) {
      await bersihkanDirektoriSementaraPdt(direktoriUntukDibersihkan.pop() as string);
    }
  });

  it('23 berkas (9 TikTok + 13 Shopee + 1 meta_ads, campuran .xlsx/.csv, satu ber-BOM utf-8-sig) — semua terdekode & tepat satu modul per berkas, nol salah-slot, nol gagal', async () => {
    const entries = FIXTURES.map((f) => ({
      nama: f.nama,
      isi: f.csv ? csvDariAoa(f.aoa, f.bom) : xlsxDariAoa(f.aoa),
    }));
    const paket = await zipkan(entries);

    const zipHasil = await bacaDanEkstrakPdtZip(paket);
    if (zipHasil.direktoriSementara) direktoriUntukDibersihkan.push(zipHasil.direktoriSementara);
    expect(zipHasil.pagar.ok).toBe(true);
    expect(zipHasil.gagalEkstrak).toEqual([]);
    expect(zipHasil.diekstrak).toHaveLength(FIXTURES.length);

    const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
    expect(parseHasil.gagal, JSON.stringify(parseHasil.gagal)).toEqual([]);
    expect(parseHasil.berkas).toHaveLength(FIXTURES.length);
    expect(parseHasil.durasiMs).toBeGreaterThanOrEqual(0);
    expect(parseHasil.durasiMs).toBeLessThan(45_000); // target G1-05

    for (const f of FIXTURES) {
      const hasil = parseHasil.berkas.find((b) => b.nama === f.nama);
      expect(hasil, `${f.nama} tidak ditemukan di hasil parse`).toBeDefined();
      expect(hasil?.ambiguous, `${f.nama} (${f.kode})`).toBe(false);
      expect(hasil?.modul, `${f.nama} (${f.kode})`).toBe(f.kode);
      expect(hasil?.aoa.length, `${f.nama} AoA kosong`).toBeGreaterThan(0);
    }
  });

  it('kegagalan dekode SATU entri (berkas rusak) tidak menjatuhkan batch — entri lain tetap diproses', async () => {
    const baik = xlsxDariAoa(FIXTURES[0].aoa);
    // Awalan `PK\x03\x04` memaksa XLSX.read MENGENALI ini sebagai upaya ZIP (bukan
    // teks polos — yang tanpa awalan ini malah diterima diam-diam sebagai CSV
    // satu-kolom oleh XLSX.read, tidak melempar apa pun) lalu gagal saat direktori
    // pusatnya ternyata bukan ZIP yang sah — berkas benar-benar rusak, bukan cuma "aneh".
    const rusak = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('bukan direktori pusat zip yang sah'.repeat(5))]);
    const paket = await zipkan([
      { nama: 'baik.xlsx', isi: baik },
      { nama: 'rusak.xlsx', isi: rusak },
    ]);

    const zipHasil = await bacaDanEkstrakPdtZip(paket);
    if (zipHasil.direktoriSementara) direktoriUntukDibersihkan.push(zipHasil.direktoriSementara);
    expect(zipHasil.diekstrak).toHaveLength(2);

    const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
    expect(parseHasil.berkas.map((b) => b.nama)).toEqual(['baik.xlsx']);
    expect(parseHasil.berkas[0].modul).toBe(FIXTURES[0].kode);
    expect(parseHasil.gagal).toHaveLength(1);
    expect(parseHasil.gagal[0].nama).toBe('rusak.xlsx');
    expect(parseHasil.gagal[0].pesan.length).toBeGreaterThan(0);
  });

  it('target performa G1-05: batch 13 berkas, volume nyata (≈1.500 baris SKU + ≈2.000 baris konten), < 45 detik', async () => {
    const header = FIXTURES.find((f) => f.kode === 'shopee_parent_sku')!.aoa[0];
    const skuFiles = Array.from({ length: 7 }, (_, i) => {
      const rows: Aoa = [header];
      for (let r = 0; r < 215; r++) {
        rows.push([`SKU-${i}-${r}`, `VAR-${i}-${r}`, `SKU-${i}-${r}`, `Rp${(90000 + r * 137) * 1000}`, `Rp${(84000 + r * 91) * 1000}`, String(5000 + r), String(900 + r), '30,00%', '25,00%', String(1000 + r)]);
      }
      return { nama: `sku_${i}.xlsx`, isi: xlsxDariAoa(rows) };
    }); // 7 * 215 ≈ 1.500 baris SKU

    const kontenHeader = ['ID Kreator', 'Nama Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
    const kontenFiles = Array.from({ length: 6 }, (_, i) => {
      const rows: Aoa = [[], [], kontenHeader];
      for (let r = 0; r < 334; r++) {
        rows.push([`@kreator${i}`, `Kreator ${i}`, `712${i}${r}`, '2026-07-05', `170${i}${r}`, String(5000 + r * 3), String(200 + r), String(10 + r), String(30 + r), 'Review produk', String(15000 + r), String((300000 + r * 77) )]);
      }
      return { nama: `konten_${i}.xlsx`, isi: xlsxDariAoa(rows) };
    }); // 6 * 334 ≈ 2.000 baris konten

    const semua = [...skuFiles, ...kontenFiles];
    expect(semua).toHaveLength(13);
    const paket = await zipkan(semua);

    const zipHasil = await bacaDanEkstrakPdtZip(paket);
    if (zipHasil.direktoriSementara) direktoriUntukDibersihkan.push(zipHasil.direktoriSementara);
    expect(zipHasil.pagar.ok).toBe(true);
    expect(zipHasil.diekstrak).toHaveLength(13);

    const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
    expect(parseHasil.gagal).toEqual([]);
    expect(parseHasil.berkas).toHaveLength(13);
    const totalBaris = parseHasil.berkas.reduce((n, b) => n + b.aoa.length, 0);
    expect(totalBaris).toBeGreaterThan(3_000); // ≈1.500 SKU + ≈2.000 konten (+ header/blank rows)
    console.log(`G1-05 batch 13 berkas / ${totalBaris} baris: ${parseHasil.durasiMs}ms`);
    expect(parseHasil.durasiMs).toBeLessThan(45_000);
  });
});

describe('decodePdtAoa', () => {
  it('berkas rusak (klaim ZIP tapi direktori pusatnya tidak sah) ⇒ error bernama, bukan hasil kosong diam-diam (Rule 10)', () => {
    const rusak = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('bukan direktori pusat zip yang sah'.repeat(3))]);
    expect(() => decodePdtAoa(rusak)).toThrow();
  });

  it('sheet pertama dibaca sebagai array-of-arrays, sel kosong jadi string kosong (defval, bukan undefined)', () => {
    const bytes = xlsxDariAoa([
      ['A', 'B'],
      ['1', null as unknown as string],
    ]);
    const aoa = decodePdtAoa(bytes);
    expect(aoa[0]).toEqual(['A', 'B']);
    expect(aoa[1][0]).toBe('1');
    expect(aoa[1][1]).toBe('');
  });
});
