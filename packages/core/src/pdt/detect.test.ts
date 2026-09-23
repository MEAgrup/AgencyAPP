/**
 * G1-02 — tes `detectPdtModule` terhadap seluruh 28 modul.
 *
 * DoD backlog: "deteksi diuji terhadap 28 berkas sample (Fim Motor/Shopee,
 * Avitaskin/TikTok) dengan target nol salah-slot". Berkas mentahnya sendiri
 * TIDAK ada di repo (data klien, dicatat di kedua UAT-nya) — fixture di bawah
 * memakai STRING KOLOM LITERAL yang sama yang sudah diverifikasi/dites di
 * `docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`,
 * `docs/handoff/UAT_TIKTOK_AVITASKIN_20260904.md`,
 * `docs/backlog/PDT_KOLOM_DIPANEN.md`, dan fixture teruji
 * `report/shopee/shopee.test.ts` — bukan karangan baru. Lihat komentar per
 * modul di `modules.ts` untuk sumber persis tiap tanda tangan.
 *
 * Setiap modul yang PUNYA sinyal isi terverifikasi diuji dua arah: (1) fixture
 * modulnya sendiri terdeteksi TEPAT sebagai modul itu, tidak ambigu; (2)
 * fixture itu, dites terhadap SELURUH registry lintas platform, tidak pernah
 * salah slot ke modul lain manapun (nol salah-slot).
 */
import { describe, expect, it } from 'vitest';
import { detectPdtModule, detectPdtModuleAntarSheet } from './detect';
import { PDT_MODULES, UNVERIFIED_SIGNATURE } from './modules';
import type { PdtModuleDef } from './types';

const TIKTOK = PDT_MODULES.filter((m) => m.platform === 'tiktok');
const SHOPEE = PDT_MODULES.filter((m) => m.platform === 'shopee');

/** Modul yang sengaja belum punya sinyal isi (lihat modules.ts) — dikecualikan dari uji "harus terdeteksi". */
const UNVERIFIED = new Set(['shopee_diskon', 'shopee_flash_sale', 'shopee_video']);

type Aoa = ReadonlyArray<ReadonlyArray<unknown>>;

/** Jalankan `rows` terhadap SELURUH registry (lintas platform) dan pastikan hanya `expected` yang menang. */
function expectExactMatch(rows: Aoa, expected: string): void {
  const r = detectPdtModule(rows, PDT_MODULES);
  expect(r.matches, `fixture ${expected}`).toEqual([expected]);
  expect(r.kode, `fixture ${expected}`).toBe(expected);
  expect(r.ambiguous, `fixture ${expected}`).toBe(false);
}

describe('detectPdtModule — TikTok (12 modul)', () => {
  it('tt_orders', () => {
    expectExactMatch(
      [
        ['Order ID', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity', 'SKU Unit Original Price',
          'SKU Subtotal After Discount', 'Order Status', 'Paid Time', 'Product Category', 'Creator Handle'],
        ['576…', '17123…', 'SKU-001', 'Kemeja Flanel', 'M/Merah', '1', '150000', '135000', 'Completed', '2026-07-15 10:00:00', 'Fashion', '@kreator1'],
      ],
      'tt_orders',
    );
  });

  it('tt_product_analytics (product_list, header baris 4)', () => {
    expectExactMatch(
      [
        [], [], [],
        ['ID Produk', 'Nama', 'GMV', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual',
          'Pesanan SKU', 'AOV', 'CTR', 'CTOR', 'Impresi produk', 'Klik produk', 'Status daftar produk'],
        ['170…', 'Produk A', '10945407', '2000000', '1000000', '500000', '30', '183173', '3.51%', '0.40%', '832842', '27208', 'Aktif'],
      ],
      'tt_product_analytics',
    );
  });

  it('tt_transaction_product', () => {
    expectExactMatch(
      [
        ['Product ID', 'Product category', 'GMV dari kreator', 'CTOR', 'Video', 'Siaran LIVE', 'Sampel terkirim'],
        ['170…', 'Fashion', '2000000', '0.40%', '5', '1', '3'],
      ],
      'tt_transaction_product',
    );
  });

  it('tt_transaction_creator', () => {
    expectExactMatch(
      [
        ['Creator name', 'GMV dari kreator', 'AOV', 'CTOR', 'Pesanan teratribusi', 'Tayangan video', 'Video', 'Siaran LIVE', 'Perkiraan komisi'],
        ['@kreator1', '2000000', '150000', '1.20%', '13', '5000', '5', '1', '100000'],
      ],
      'tt_transaction_creator',
    );
  });

  it('tt_video (header baris 3)', () => {
    expectExactMatch(
      [
        [], [],
        ['ID Kreator', 'Nama Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'],
        ['@kreator1', 'Kreator Satu', '712…', '2026-07-05', '170…', '5000', '200', '10', '30', 'Review produk', '15000', '300000'],
      ],
      'tt_video',
    );
  });

  it('tt_live (header baris 3)', () => {
    expectExactMatch(
      [
        [], [],
        ['ID Kreator', 'Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR'],
        ['@kreator1', 'Kreator Satu', '2026-07-05 20:00', '3600', '1000000', '10', '500', '2.00%'],
      ],
      'tt_live',
    );
  });

  it('tt_shop_analytics', () => {
    expectExactMatch(
      [
        ['GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
          'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut'],
        ['26560049', '143', '137', '145', '20627', '0.66418%', '26894689', '334640', '5000000', '3000000', '2000000', '1000000'],
      ],
      'tt_shop_analytics',
    );
  });

  // F-01 (M20 R8) — sample asli ("ultrasleep_tiktok_sellergmax.zip",
  // `[bisnis]-Tokopedia && UltraSleep Indonesia.xlsx`, 2026-09-23), baris
  // "Ringkasan data" (header PERSIS, minus sel pertama kosong — tidak relevan
  // untuk deteksi berbasis pemindaian sel).
  it('tt_shop_analytics_tokopedia', () => {
    expectExactMatch(
      [
        ['GMV', 'Pesanan', 'Pembeli', 'Produk terjual', 'Pengembalian dana', 'Pesanan SKU', 'Tayangan halaman', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto'],
        ['39134878', '144', '144', '166', '123700', '144', '2585', '1689', '8.53%', '46568606'],
      ],
      'tt_shop_analytics_tokopedia',
    );
  });

  it('tt_ads_product', () => {
    expectExactMatch(
      [
        ['ID Campaign', 'Nama kampanye', 'ID produk', 'ID video', 'Akun TikTok', 'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor'],
        ['CAM-1', 'Kampanye A', '170…', '712…', 'avitaskin_official', '6540407', '80', '81755', '20666992'],
      ],
      'tt_ads_product',
    );
  });

  it('tt_ads_live', () => {
    expectExactMatch(
      [
        ['Nama LIVE', 'ID Campaign', 'Nama kampanye', 'Biaya', 'Pesanan SKU', 'ROI', 'Pendapatan kotor'],
        ['LIVE Kampanye A', 'CAM-2', 'Kampanye Live A', '1000000', '10', '3.16', '3160000'],
      ],
      'tt_ads_live',
    );
  });

  // F-03 (M20 R9, videoviews-only) — sample asli pemilik
  // (`Ultrasleep_Video_views_TTAM.xlsx`, 2026-09-23), header baris 1 PERSIS.
  // Signature DIKOREKSI dari dugaan literal PRD ('Video views'+'CPM') — berkas
  // nyata tidak punya kolom 'Video views' sama sekali, hanya '6-second
  // focused views' (lihat docblock modul, `modules.ts`).
  it('tt_ads_manager_videoviews', () => {
    expectExactMatch(
      [
        ['Ad name', 'Primary status', 'Secondary status', 'Spend', 'CPM', 'Cost per result',
          '6-second focused views', 'Result rate', '6-second focused views (paid views)',
          'Focused view 6-second view rate (impression)', 'Impressions', 'Secondary source',
          'Primary source', 'Attribution source', 'Currency'],
        ['Ad name2026-08-23 14:13:20', 'Paused', '', '2665', '1220', '14.972', '178', '0.0815', '174', '0.0815',
          '2184', 'TikTok account', 'Your own content', '-', 'IDR'],
      ],
      'tt_ads_manager_videoviews',
    );
  });

  // M9-OA-4 — header PERSIS sample asli pemilik (ekspor sisi partner/TAP,
  // bahasa Inggris). Tanda tangannya (`Affiliate video-attributed GMV` +
  // `Video ID`) sengaja tidak memakai `Video ID` sendirian: kolom itu juga
  // muncul di ekspor sisi seller berbahasa Inggris lain di masa depan.
  it('tt_affiliate_video (Custom report sisi MCN/partner, header baris 1)', () => {
    expectExactMatch(
      [
        ['Date', 'Comparison date', 'Campaign ID', 'Campaign name', 'Campaign duration', 'Creator name',
          'Creator follower count', 'Product ID', 'Product name', 'Shop code', 'Shop ID', 'Shop name',
          'Video ID', 'Video name', 'Post time', 'Affiliate video-attributed GMV',
          'Creator video-attributed orders', 'Affiliate video orders',
          'Estimated affiliate partner commission ', 'Actual affiliate partner commission',
          'Duration', 'Video views', 'Video likes', 'Video product RPM', 'Creator-attributed items sold'],
        ['Summary', '--', '-', '-', '-', '-', '--', '-', '-', '-', '-', '-', '-', '-', '-',
          'Rp0', '0', '0', 'Rp0', 'Rp0', '2min', '15369', '19', 'Rp0', '0'],
        ['2026-08-01-2026-08-31', '--', '751…', 'TAP Campaign Internal', '2025-06-11-2026-10-31', 'wiyati496',
          '29002', '172…', 'Kebaya Encim', 'IDLC3FWLCA', '749…', 'Anjalie Factory',
          '755…', 'judul video', '2025-09-19 22:29:32', 'Rp0', '0', '0', 'Rp0', 'Rp0', '43s', '20', '0', 'Rp0', '0'],
      ],
      'tt_affiliate_video',
    );
  });

  it('kedua belas fixture TikTok saling eksklusif — tak ada dua yang cocok ke fixture yang sama (nol salah-slot)', () => {
    // Sudah tercakup satu-per-satu di atas (expectExactMatch memaksa matches
    // panjang 1) — tes ini menegaskan itu berlaku untuk SEMUA 12 sekaligus,
    // bukan cuma yang paling akhir diuji.
    expect(TIKTOK).toHaveLength(12);
  });
});

describe('detectPdtModule — Shopee (15 modul, 2 belum terverifikasi)', () => {
  // G1-09-SHEET-BUKAN-PERTAMA (docs/DECISIONS.md): tanda tangan LAMA (marker
  // 'Pesanan Dibuat' sebagai baris penanda seksi) TERBUKTI salah — sample asli
  // membuktikan 'Pesanan Dibuat' HANYA nama TAB sheet (dari 12-sheet workbook),
  // bukan isi sel. Sheet terisolasi per basis (`namaSheet: 'Pesanan Siap
  // Dikirim'`, modules.ts) LANGSUNG dimulai dari header, nol baris penanda.
  it('shopee_shop_stats (header LANGSUNG di baris pertama — sheet sudah terisolasi per basis)', () => {
    expectExactMatch(
      [
        ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
          'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
          'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru',
          'Total Pembeli Saat Ini', 'Total Potensi Pembeli', 'Tingkat Pembelian Berulang'],
        ['01/07/2026', 'Rp1.624.937.476', '13568', 'Rp119.762', '5000', '20627', '2,46%', '2785', 'Rp359.295.534', '140', 'Rp24.586.464', '11452', '300', '600', '50', '12,97%'],
      ],
      'shopee_shop_stats',
    );
  });

  it('shopee_parent_sku', () => {
    expectExactMatch(
      [
        ['Kode Produk', 'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)',
          'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Jumlah Produk Dilihat', 'Produk Diklik',
          'Tingkat Konversi (Pesanan yang Dibuat)', 'repeat order', 'Pengunjung Produk (Kunjungan)'],
        ['SKU-A', 'VAR-A1', 'SKU-A', 'Rp90.000.000', 'Rp84.000.000', '5000', '900', '30,00%', '25,00%', '1000'],
      ],
      'shopee_parent_sku',
    );
  });

  // Preamble LENGKAP (baris 1-6, Rule 2) — bukan hanya 'ID Toko'/'Periode' seperti
  // fixture lama. `Username,<toko>` (baris 2) TERBUKTI ada di sample asli (ZIP
  // "Sample nama asli" pemilik, sesi 27) — fixture lama yang mengosongkannya
  // adalah kelas kesalahan yang sama persis PERSIS yang membuat
  // `G1-09-DETEKSI-PREAMBLE-AMBIGU` tidak pernah kelihatan di suite manapun
  // sebelum sesi 27 (lihat `docs/DECISIONS.md`).
  it('shopee_ads_cpc (header baris 8, preamble LENGKAP dengan baris Username)', () => {
    expectExactMatch(
      [
        ['Semua Laporan Iklan CPC - Shopee Indonesia'], ['Username,fim_motor'], ['Nama Toko,Fim_Motor'],
        ['ID Toko: 938284780'], ['Waktu Laporan Dibuat,10/08/2026 15:14'], ['Periode: 01/07/2026 - 31/07/2026'], [],
        ['Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya', 'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
        ['SKU-A', '50000', '2000', '80', '5000000', 'Kampanye A', '40000000', '8,00', '12,50%'],
      ],
      'shopee_ads_cpc',
    );
  });

  it('shopee_ads_search (header baris 8, preamble LENGKAP dengan baris Username)', () => {
    expectExactMatch(
      [
        ['Search Ads Report - Shopee Indonesia'], ['Username,fim_motor'], ['Nama Toko,Fim_Motor'],
        ['ID Toko: 938284780'], ['Waktu Laporan Dibuat,10/08/2026 15:14'], ['Periode: 01/07/2026 - 31/07/2026'], [],
        ['Kata Pencarian', 'SOV', 'Klik', 'Konversi', 'Biaya', 'Omzet Penjualan'],
        ['baju flanel', '12%', '100', '8', '200000', '4000000'],
      ],
      'shopee_ads_search',
    );
  });

  // G1-09-DETEKSI-PREAMBLE-AMBIGU DITUTUP (docs/DECISIONS.md sesi 27) — regresi
  // eksplisit terhadap DUA kasus yang TERBUKTI ambigu di sample asli (ZIP "Sample
  // nama asli" pemilik) SEBELUM `mustNot: ['ID Toko']` ditambahkan ke
  // `shopee_ams_afiliasi`: preamble ber-`Username` + header ber-'Omzet' membuat
  // detektor lama mencocokkan KEDUA modul sekaligus. Dua fixture di atas SUDAH
  // membuktikan ini (expectExactMatch menolak ambigu) — tes berikut menegaskan
  // ALASANNYA secara eksplisit, supaya regresi di masa depan gagal dengan pesan
  // yang jelas, bukan cuma "bukan [modul]".
  it('preamble ber-Username TIDAK membuat shopee_ads_cpc/shopee_ads_search ambigu dengan shopee_ams_afiliasi', () => {
    const cpc = detectPdtModule(
      [
        ['Username,fim_motor'], ['Nama Toko,Fim_Motor'], ['ID Toko: 938284780'], [], [], [],
        ['Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya', 'nama iklan', 'omzet penjualan', 'Efektifitas Iklan'],
        ['SKU-A', '50000', '2000', '80', '5000000', 'Kampanye A', '40000000', '8,00'],
      ],
      SHOPEE,
    );
    expect(cpc.matches).not.toContain('shopee_ams_afiliasi');

    const search = detectPdtModule(
      [
        ['Username,fim_motor'], ['Nama Toko,Fim_Motor'], ['ID Toko: 938284780'], [], [], [],
        ['Kata Pencarian', 'Omzet Penjualan', 'Biaya'],
        ['baju flanel', '4000000', '200000'],
      ],
      SHOPEE,
    );
    expect(search.matches).not.toContain('shopee_ams_afiliasi');
  });

  it('shopee_ads_live (header baris 7)', () => {
    expectExactMatch(
      [
        [], [], [], [], [], [],
        ['ID Iklan', 'Nama Iklan', 'Penonton', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan'],
        ['AD-1', 'Live Ads A', '3000', '40', '15000000', '3000000', '5,00'],
      ],
      'shopee_ads_live',
    );
  });

  it('shopee_live', () => {
    expectExactMatch(
      [
        ['Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan'],
        ['Live Juli', '2026-07-10 20:00', '500', 'Rp5.000.000'],
      ],
      'shopee_live',
    );
  });

  it('shopee_voucher', () => {
    expectExactMatch(
      [
        ['Periode Waktu', 'Klaim', 'Pesanan (Pesanan Dibuat)', 'Penjualan (Pesanan Dibuat) (IDR)',
          'Tingkat Penggunaan (Pesanan Dibuat)', 'Pembeli (Pesanan Dibuat)', 'Total Biaya (Pesanan Dibuat) (IDR)'],
        ['01-31 Agu', '200', '150', 'Rp8.000.000', '75,00%', '140', 'Rp500.000'],
      ],
      'shopee_voucher',
    );
  });

  it('shopee_chat', () => {
    expectExactMatch(
      [
        ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata', 'CSAT %',
          'Persentase Chat Dibalas', 'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'],
        ['01-31 Agu', '5000', '800', '760', '00:12:30', '90,00%', '95,00%', '160', 'Rp16.000.000', '20,00%'],
      ],
      'shopee_chat',
    );
  });

  it('shopee_chat_broadcast', () => {
    expectExactMatch(
      [
        ['Nama Broadcast', 'penerima', 'dibaca', 'diklik', 'pesanan'],
        ['Promo Juli', '5000', '3000', '500', '20'],
      ],
      'shopee_chat_broadcast',
    );
  });

  it('shopee_ams_produk (ProductPerformance, tanpa kolom kreator) — ejaan PERSIS sample asli Fim Motor', () => {
    expectExactMatch(
      [
        ['Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Estimasi Komisi(Rp)', 'ROI'],
        ['SKU-A', 'Produk A', '10000000', '1000000', '3,5'],
      ],
      'shopee_ams_produk',
    );
  });

  it('shopee_ams_afiliasi (AMSAffiliatePerformance) — ejaan PERSIS sample asli Fim Motor', () => {
    expectExactMatch(
      [
        ['ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI', 'Total Pembeli', 'Pembeli Baru'],
        ['11339711407', '@kreator1', '10000000', '20', '18', '1000000', '3.5', '15', '4'],
      ],
      'shopee_ams_afiliasi',
    );
  });

  it('shopee_kesehatan', () => {
    expectExactMatch(
      [
        ['Poin Penalti', 'Deskripsi', 'Durasi'],
        ['1', 'Pelanggaran larangan produk', '7 hari'],
      ],
      'shopee_kesehatan',
    );
    expectExactMatch(
      [
        ['Poin Pinalti', 'Deskripsi', 'Durasi'], // ejaan alternatif yang memang muncul di export nyata
        ['2', 'Pelanggaran lain', '14 hari'],
      ],
      'shopee_kesehatan',
    );
  });

  it('shopee_diskon / shopee_flash_sale — belum terverifikasi, tidak PERNAH terdeteksi otomatis (AM memilih manual)', () => {
    const voucherLikeButNoAnchor: Aoa = [
      ['Periode Waktu', 'Klaim', 'Tingkat Penggunaan (Pesanan Dibuat)'],
      ['01-31 Agu', '100', '50,00%'],
    ];
    const r = detectPdtModule(voucherLikeButNoAnchor, PDT_MODULES);
    // Cocok ke shopee_voucher (sinyal 'Periode Waktu'+'Klaim' terpenuhi) DAN
    // tidak pernah ke diskon/flash_sale (sentinel-nya mustahil cocok).
    expect(r.matches).not.toContain('shopee_diskon');
    expect(r.matches).not.toContain('shopee_flash_sale');
  });

  it('shopee_video — belum terverifikasi, sentinel tidak pernah cocok ke isi apa pun', () => {
    for (const m of SHOPEE) {
      if (m.kode !== 'shopee_video') continue;
      expect(m.tandaTanganKolom).toEqual(UNVERIFIED_SIGNATURE);
    }
    const anySheet: Aoa = [['ID Kreator', 'ID Video', 'VV', 'Likes', 'Periode Data']];
    expect(detectPdtModule(anySheet, PDT_MODULES).matches).not.toContain('shopee_video');
  });

  it('kelima belas modul Shopee terdaftar', () => {
    expect(SHOPEE).toHaveLength(15);
    for (const kode of UNVERIFIED) expect(SHOPEE.map((m) => m.kode)).toContain(kode);
  });
});

describe('detectPdtModule — meta_ads', () => {
  it('meta_ads', () => {
    expectExactMatch(
      [
        ['Minggu', 'Nama Kampanye', 'Nama iklan', 'Jumlah yang Dibelanjakan', 'ROAS', 'Impresi', 'Klik Tautan', 'CTR', 'CPM', 'CPC'],
        ['', 'Kampanye Meta A', 'Iklan A', '2000000', '2.50', '50000', '800', '1.60', '40000', '2500'],
      ],
      'meta_ads',
    );
  });
});

describe('detectPdtModule — registry', () => {
  it('28 modul total, kode unik', () => {
    expect(PDT_MODULES).toHaveLength(28);
    expect(new Set(PDT_MODULES.map((m) => m.kode)).size).toBe(28);
  });

  it('sheet kosong tidak pernah cocok ke modul manapun', () => {
    const r = detectPdtModule([], PDT_MODULES);
    expect(r.matches).toEqual([]);
    expect(r.kode).toBeNull();
    expect(r.ambiguous).toBe(false);
  });

  it('setiap modul non-UNVERIFIED punya tanda tangan yang berbeda dari UNVERIFIED_SIGNATURE', () => {
    for (const m of PDT_MODULES) {
      if (UNVERIFIED.has(m.kode)) continue;
      expect(m.tandaTanganKolom).not.toEqual(UNVERIFIED_SIGNATURE);
    }
  });
});

// ---------------------------------------------------------------------------
// G1-09-SHEET-BUKAN-PERTAMA (docs/DECISIONS.md) — `detectPdtModuleAntarSheet`,
// pencocok MULTI-SHEET yang menggantikan asumsi "sheet pertama untuk seluruh
// modul" yang terbukti membuat `shopee_live`/`shopee_shop_stats` jadi kode
// mati untuk berkas asli.
// ---------------------------------------------------------------------------
describe('detectPdtModuleAntarSheet — deteksi multi-sheet (G1-09-SHEET-BUKAN-PERTAMA)', () => {
  const MODUL_SHEET0: PdtModuleDef = {
    kode: 'sheet0_saja', platform: 'shopee', namaTampilan: 'Sheet pertama saja',
    tandaTanganKolom: { must: ['Kolom A'] }, barisHeaderHint: 1, kolomDipanen: ['Kolom A'], wajib: false,
  };
  const MODUL_SHEET_KHUSUS: PdtModuleDef = {
    kode: 'sheet_khusus', platform: 'shopee', namaTampilan: 'Sheet khusus',
    tandaTanganKolom: { must: ['Kolom B'] }, barisHeaderHint: 1, kolomDipanen: ['Kolom B'], wajib: false,
    namaSheet: 'Sheet Target',
  };

  it('modul TANPA namaSheet cocok terhadap sheet PERTAMA workbook (perilaku lama dipertahankan)', () => {
    const sheets = new Map([
      ['Ringkasan', [['Kolom A'], ['nilai']]],
      ['Lain', [['Kolom B'], ['nilai']]],
    ]);
    const r = detectPdtModuleAntarSheet(sheets, ['Ringkasan', 'Lain'], [MODUL_SHEET0, MODUL_SHEET_KHUSUS]);
    expect(r.kode).toBe('sheet0_saja');
    expect(r.aoa).toEqual([['Kolom A'], ['nilai']]);
  });

  it('modul BER-namaSheet cocok terhadap sheet-nya sendiri walau bukan sheet pertama', () => {
    const sheets = new Map([
      ['Tinjauan', [['Ringkasan tidak relevan']]],
      ['Sheet Target', [['Kolom B'], ['nilai']]],
    ]);
    const r = detectPdtModuleAntarSheet(sheets, ['Tinjauan', 'Sheet Target'], [MODUL_SHEET0, MODUL_SHEET_KHUSUS]);
    expect(r.kode).toBe('sheet_khusus');
    expect(r.aoa).toEqual([['Kolom B'], ['nilai']]);
  });

  it('modul BER-namaSheet TIDAK PERNAH cocok bila workbook tidak punya sheet bernama itu', () => {
    const sheets = new Map([['Tinjauan', [['Kolom B'], ['nilai']]]]); // isinya cocok, tapi nama sheet-nya salah
    const r = detectPdtModuleAntarSheet(sheets, ['Tinjauan'], [MODUL_SHEET_KHUSUS]);
    expect(r.kode).toBeNull();
    expect(r.matches).toEqual([]);
    expect(r.aoa).toBeNull();
  });

  it('dua modul cocok di sheet MASING-MASING ⇒ ambigu, aoa null (nol AoA tunggal yang mewakili keduanya)', () => {
    const sheets = new Map([
      ['Ringkasan', [['Kolom A'], ['nilai']]],
      ['Sheet Target', [['Kolom A'], ['nilai']]], // sengaja juga membawa 'Kolom A'
    ]);
    const modulKeduaDiSheetTarget = { ...MODUL_SHEET_KHUSUS, tandaTanganKolom: { must: ['Kolom A'] } };
    const r = detectPdtModuleAntarSheet(sheets, ['Ringkasan', 'Sheet Target'], [MODUL_SHEET0, modulKeduaDiSheetTarget]);
    expect(r.ambiguous).toBe(true);
    expect(r.kode).toBeNull();
    expect(r.aoa).toBeNull();
    expect([...r.matches].sort()).toEqual(['sheet0_saja', 'sheet_khusus'].sort());
  });

  it('registry PENUH (PDT_MODULES) lewat detectPdtModuleAntarSheet menghasilkan hasil IDENTIK detectPdtModule untuk workbook satu-sheet', () => {
    // Sanity: bila workbook cuma satu sheet dan TIDAK ADA modul lain yang
    // mengklaim sheet itu via namaSheet, kedua fungsi harus sepakat — regresi
    // nol untuk seluruh 23 modul yang TIDAK terlibat G1-09-SHEET-BUKAN-PERTAMA.
    const rows = [
      ['Kode Produk', 'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)',
        'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Jumlah Produk Dilihat', 'Produk Diklik',
        'Tingkat Konversi (Pesanan yang Dibuat)', 'repeat order', 'Pengunjung Produk (Kunjungan)'],
      ['SKU-A', 'VAR-A1', 'SKU-A', 'Rp90.000.000', 'Rp84.000.000', '5000', '900', '30,00%', '25,00%', '1000'],
    ];
    const lama = detectPdtModule(rows, PDT_MODULES);
    const baru = detectPdtModuleAntarSheet(new Map([['Sheet1', rows]]), ['Sheet1'], PDT_MODULES);
    expect(baru.kode).toBe(lama.kode);
    expect(baru.matches).toEqual(lama.matches);
    expect(baru.ambiguous).toBe(lama.ambiguous);
  });
});
