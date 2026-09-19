import { describe, expect, it } from 'vitest';
import {
  ekstrakBarisFaktaSkuTtOrders,
  ekstrakBarisKreatorShopeeAmsAfiliasi,
  ekstrakBarisKreatorTtTransactionCreator,
  ekstrakBarisShopeeAdsCpc,
  ekstrakBarisShopeeAdsLive,
  ekstrakBarisShopeeAdsSearch,
  ekstrakBarisShopeeAmsProduk,
  ekstrakBarisShopeeLive,
  ekstrakBarisShopDailyShopee,
  ekstrakBarisShopDailyTiktok,
  ekstrakBarisSkuMasterShopeeParentSku,
  ekstrakBarisSkuMasterTtOrders,
  ekstrakBarisKesehatanShopee,
  ekstrakBarisLayananChatShopee,
  ekstrakBarisTtAdsLive,
  ekstrakBarisTtAdsProduct,
  ekstrakBarisTtAffiliateVideo,
  ekstrakBarisTtLive,
  ekstrakBarisTtProductAnalytics,
  ekstrakBarisTtVideo,
} from './fakta';
import { PDT_KOLOM_ALIAS, PDT_MODULES } from './modules';

const HEADER = ['Nama Iklan', 'ID Iklan', 'Status', 'Penonton', 'Tingkat Konversi', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan'];

describe('ekstrakBarisShopeeAdsLive', () => {
  it('memetakan satu baris lengkap ke kampanyeId/tayangan/pesananSku/gmv/biaya/roas', () => {
    const aoa = [
      HEADER,
      ['Live Sore', 'AD-1', 'Aktif', '1000', '5%', '20', '2000000', '150000.50', '13.33'],
    ];
    expect(ekstrakBarisShopeeAdsLive(aoa, 1)).toEqual([
      { kampanyeId: 'AD-1', tayangan: 1000, pesananSku: 20, gmv: 2000000, biaya: 150000.5, roas: 13.33 },
    ]);
  });

  it('konvensi Ads Manager (titik desimal, koma ribuan) — bukan Seller Center', () => {
    const aoa = [HEADER, ['Live Sore', 'AD-1', 'Aktif', '1,000', '5%', '20', '2,000,000', '150000.5', '13.33']];
    const [baris] = ekstrakBarisShopeeAdsLive(aoa, 1);
    expect(baris.tayangan).toBe(1000);
    expect(baris.gmv).toBe(2000000);
    expect(baris.biaya).toBe(150000.5);
  });

  it('baris dengan ID Iklan kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = [
      HEADER,
      ['', '', '', '', '', '', '', '', ''],
      ['Live Sore', 'AD-1', 'Aktif', '1000', '5%', '20', '2000000', '150000', '13.33'],
    ];
    expect(ekstrakBarisShopeeAdsLive(aoa, 1)).toHaveLength(1);
  });

  it('dua baris terpisah tetap terpetakan masing-masing', () => {
    const aoa = [
      HEADER,
      ['Live Sore', 'AD-1', 'Aktif', '1000', '5%', '20', '2000000', '150000', '13.33'],
      ['Live Pagi', 'AD-2', 'Aktif', '500', '2%', '5', '400000', '50000', '8'],
    ];
    const hasil = ekstrakBarisShopeeAdsLive(aoa, 1);
    expect(hasil.map((b) => b.kampanyeId)).toEqual(['AD-1', 'AD-2']);
  });

  it('kolom "Penonton"/"Pesanan"/"Omzet"/"Efektifitas Iklan" hilang ⇒ null (bukan 0) untuk field itu, biaya tetap 0', () => {
    const headerTanpaOpsional = ['ID Iklan', 'Biaya'];
    const aoa = [headerTanpaOpsional, ['AD-1', '150000']];
    expect(ekstrakBarisShopeeAdsLive(aoa, 1)).toEqual([
      { kampanyeId: 'AD-1', tayangan: null, pesananSku: null, gmv: null, biaya: 150000, roas: null },
    ]);
  });
});

const HEADER_TT_ADS_PRODUCT = ['ID Campaign', 'Nama kampanye', 'ID produk', 'ID video', 'Akun TikTok', 'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor', 'Impresi iklan produk', 'Jumlah klik iklan produk'];

describe('ekstrakBarisTtAdsProduct', () => {
  it('memetakan satu baris lengkap ke kampanyeId/biaya/pesananSku/gmv/tayangan/klik, roas DITURUNKAN gmv÷biaya', () => {
    const aoa = [
      HEADER_TT_ADS_PRODUCT,
      ['CAM-1', 'Kampanye A', 'PRD-1', 'VID-1', 'avitaskin_official', '100000', '5', '20000', '400000', '10000', '150'],
    ];
    expect(ekstrakBarisTtAdsProduct(aoa, 1)).toEqual([
      { kampanyeId: 'CAM-1', biaya: 100000, pesananSku: 5, gmv: 400000, roas: 4, tayangan: 10000, klik: 150 },
    ]);
  });

  it('konvensi Ads Manager (titik desimal, koma ribuan)', () => {
    const aoa = [HEADER_TT_ADS_PRODUCT, ['CAM-1', 'Kampanye A', 'PRD-1', 'VID-1', 'akun', '150000.5', '20', '7500', '2,000,000', '1,000', '20']];
    const [baris] = ekstrakBarisTtAdsProduct(aoa, 1);
    expect(baris.biaya).toBe(150000.5);
    expect(baris.gmv).toBe(2000000);
    expect(baris.tayangan).toBe(1000);
  });

  it('baris dengan ID Campaign kosong dilewati', () => {
    const aoa = [
      HEADER_TT_ADS_PRODUCT,
      ['', '', '', '', '', '', '', '', '', '', ''],
      ['CAM-1', 'Kampanye A', 'PRD-1', 'VID-1', 'akun', '100000', '5', '20000', '400000', '10000', '150'],
    ];
    expect(ekstrakBarisTtAdsProduct(aoa, 1)).toHaveLength(1);
  });

  it('gmv/tayangan/klik kosong ⇒ null (tidak bisa diturunkan tanpa gmv, kolom tidak ada)', () => {
    const headerTanpaGmv = ['ID Campaign', 'Biaya', 'Pesanan SKU'];
    const aoa = [headerTanpaGmv, ['CAM-1', '100000', '5']];
    expect(ekstrakBarisTtAdsProduct(aoa, 1)).toEqual([
      { kampanyeId: 'CAM-1', biaya: 100000, pesananSku: 5, gmv: null, roas: null, tayangan: null, klik: null },
    ]);
  });

  it('biaya 0 ⇒ roas null (bukan pembagian oleh nol yang mengarang Infinity)', () => {
    const aoa = [HEADER_TT_ADS_PRODUCT, ['CAM-1', 'Kampanye A', 'PRD-1', 'VID-1', 'akun', '0', '0', '0', '400000', '0', '0']];
    expect(ekstrakBarisTtAdsProduct(aoa, 1)[0].roas).toBeNull();
  });

  it('ID produk/ID video/Akun TikTok/Biaya per pesanan TIDAK diekstrak (nol kolom skema pdt_fact_ads)', () => {
    const aoa = [HEADER_TT_ADS_PRODUCT, ['CAM-1', 'Kampanye A', 'PRD-1', 'VID-1', 'akun', '100000', '5', '20000', '400000', '10000', '150']];
    const [baris] = ekstrakBarisTtAdsProduct(aoa, 1);
    expect(baris).not.toHaveProperty('platformProductId');
    expect(baris).not.toHaveProperty('platformContentId');
    expect(Object.keys(baris).sort()).toEqual(['biaya', 'gmv', 'kampanyeId', 'klik', 'pesananSku', 'roas', 'tayangan']);
  });

  // Diverifikasi 2026-09-16 (`G1-09-2BII-TTADS-SAMPLE` DITUTUP) terhadap sample
  // ekspor asli klien (Avitaskin, "creative data for product campaigns", Juli
  // 2026) — header 26 kolom A–Z persis, `Biaya`/`Pendapatan kotor` adalah
  // STRING desimal-titik TANPA pemisah ribuan (bukan sel numerik Excel), dan
  // `ID produk`/`ID video` bernilai literal `"N/A"` untuk baris "Kartu produk"
  // tanpa video (dilewati fungsi ini karena tidak diekstrak sama sekali).
  it('sample asli Avitaskin Juli 2026 (baris kartu produk, ID produk/ID video = "N/A")', () => {
    const headerAsli = [
      'Nama kampanye', 'ID Campaign', 'ID produk', 'Jenis materi iklan', 'Judul video', 'ID video',
      'Akun TikTok', 'Waktu posting', 'Status', 'Status sekunder penjelajahan', 'Jenis otorisasi',
      'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor', 'Impresi iklan produk',
      'Jumlah klik iklan produk', 'Tingkat klik iklan produk', 'Rasio konversi iklan',
      'Rasio tayang video iklan 2 detik', 'Rasio tayang video iklan 6 detik', 'Rasio tayang video iklan 25%',
      'Rasio tayang video iklan 50%', 'Rasio tayang video iklan 75%', 'Rasio tayang video iklan 100%', 'Mata uang',
    ];
    const baris = [
      'MEA - [ BUNDLING ] Avitaskin Glow & Brightening Series Face Wash, Day Cream dan Night Cream',
      '1868208924571729', '1731432176719595405', 'Kartu produk', '-', 'N/A', '-', '-', 'Menjelajahi',
      'Menjelajahi', 'N/A', '1407834.000', 20, '70391.700', '3980319.527', 105135, 1349, 0.0128, 0.0044,
      '-', '-', '-', '-', '-', '-', 'IDR',
    ];
    const [hasil] = ekstrakBarisTtAdsProduct([headerAsli, baris], 1);
    expect(hasil.kampanyeId).toBe('1868208924571729');
    expect(hasil.biaya).toBe(1407834);
    expect(hasil.pesananSku).toBe(20);
    expect(hasil.gmv).toBe(3980319.527);
    expect(hasil.tayangan).toBe(105135);
    expect(hasil.klik).toBe(1349);
    expect(hasil.roas).toBeCloseTo(2.827264810339855, 9);
  });
});

const HEADER_TT_ADS_LIVE = ['Nama LIVE', 'ID Campaign', 'Nama kampanye', 'Biaya', 'Pesanan SKU', 'ROI (Toko saat ini)', 'Pendapatan kotor', 'Tayangan LIVE'];

describe('ekstrakBarisTtAdsLive', () => {
  it('memetakan satu baris lengkap ke kampanyeId/biaya/pesananSku/gmv/tayangan, roas DITURUNKAN gmv÷biaya (kolom ROI mentah diabaikan)', () => {
    const aoa = [
      HEADER_TT_ADS_LIVE,
      ['LIVE Kampanye A', 'CAM-2', 'Kampanye Live A', '1000000', '10', '3.16', '3160000', '50000'],
    ];
    expect(ekstrakBarisTtAdsLive(aoa, 1)).toEqual([
      { kampanyeId: 'CAM-2', biaya: 1000000, pesananSku: 10, gmv: 3160000, roas: 3.16, tayangan: 50000 },
    ]);
  });

  it('kolom ROI mentah TIDAK dipakai walau berbeda dari roas turunan', () => {
    // ROI mentah '99' sengaja tidak sama dengan gmv÷biaya (3160000/1000000 = 3.16) — roas harus 3.16, bukan 99.
    const aoa = [HEADER_TT_ADS_LIVE, ['LIVE A', 'CAM-2', 'Kampanye Live A', '1000000', '10', '99', '3160000', '50000']];
    expect(ekstrakBarisTtAdsLive(aoa, 1)[0].roas).toBe(3.16);
  });

  it('baris dengan ID Campaign kosong dilewati', () => {
    const aoa = [
      HEADER_TT_ADS_LIVE,
      ['', '', '', '', '', '', '', ''],
      ['LIVE A', 'CAM-2', 'Kampanye Live A', '1000000', '10', '3.16', '3160000', '50000'],
    ];
    expect(ekstrakBarisTtAdsLive(aoa, 1)).toHaveLength(1);
  });

  it('Nama LIVE TIDAK diekstrak (nol kolom skema pdt_fact_ads)', () => {
    const aoa = [HEADER_TT_ADS_LIVE, ['LIVE A', 'CAM-2', 'Kampanye Live A', '1000000', '10', '3.16', '3160000', '50000']];
    const [baris] = ekstrakBarisTtAdsLive(aoa, 1);
    expect(Object.keys(baris).sort()).toEqual(['biaya', 'gmv', 'kampanyeId', 'pesananSku', 'roas', 'tayangan']);
  });

  it('gmv/tayangan kosong ⇒ null', () => {
    const headerTanpaGmv = ['ID Campaign', 'Biaya', 'Pesanan SKU'];
    const aoa = [headerTanpaGmv, ['CAM-2', '1000000', '10']];
    expect(ekstrakBarisTtAdsLive(aoa, 1)).toEqual([
      { kampanyeId: 'CAM-2', biaya: 1000000, pesananSku: 10, gmv: null, roas: null, tayangan: null },
    ]);
  });

  // Sample asli klien (Avitaskin, "livestream data for live campaigns", Juli
  // 2026, `G1-09-2BII-TTADS-SAMPLE` DITUTUP) mengonfirmasi HEADER (19 kolom
  // A–S, termasuk nama kolom 'ID Campaign' dan 'ROI (Toko saat ini)' — BUKAN
  // 'ROI' polos) tapi NOL baris data (toko ini nol kampanye LIVE aktif
  // periode itu) — jadi hanya deteksi/whitelist yang terverifikasi empiris di
  // sini, bukan format angka baris nyata (lihat docblock fungsi ini).
  it('header sample asli (19 kolom A–S) tanpa baris data ⇒ hasil kosong (bukan error)', () => {
    const headerAsli = [
      'Nama LIVE', 'Waktu peluncuran', 'Status', 'Nama kampanye', 'ID Campaign', 'Biaya', 'Biaya Bersih',
      'Pesanan SKU', 'Pesanan SKU (Toko saat ini)', 'Biaya per pesanan (Toko saat ini)', 'Pendapatan kotor',
      'Penghasilan bruto (Toko saat ini)', 'ROI (Toko saat ini)', 'Tayangan LIVE', 'Biaya per tayangan LIVE',
      'Tayangan LIVE 10 detik', 'Biaya per tayangan LIVE 10 detik', 'Pengikut saat LIVE', 'Mata uang',
    ];
    expect(ekstrakBarisTtAdsLive([headerAsli], 1)).toEqual([]);
  });
});

const HEADER_TT_VIDEO = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];

describe('ekstrakBarisTtVideo', () => {
  it('memetakan satu baris lengkap ke platformContentId/creator/vv/likes/dibagikan/klikProduk/gmv', () => {
    const aoa = [
      HEADER_TT_VIDEO,
      ['KR-1', 'V1', '2026/07/15 10:00', 'Produk A (123)', '10.000', '500', '20', '15', 'Kreator A', 'caption', '1000', '2.000.000'],
    ];
    expect(ekstrakBarisTtVideo(aoa, 1, null)).toEqual([
      {
        platformContentId: 'V1', creatorPlatformId: 'KR-1', creatorHandle: 'Kreator A', isAkunToko: false,
        vv: 10000, likes: 500, dibagikan: 20, klikProduk: 15, gmv: 2000000,
      },
    ]);
  });

  it('konvensi Seller Center (titik ribuan, koma desimal) — bukan Ads Manager', () => {
    const aoa = [HEADER_TT_VIDEO, ['KR-1', 'V1', '2026/07/15', 'Produk A', '1.234', '0', '0', '0', 'Kreator A', 'caption', '10', '1.234.567,89']];
    const [baris] = ekstrakBarisTtVideo(aoa, 1, null);
    expect(baris.vv).toBe(1234);
    expect(baris.gmv).toBe(1234567.89);
  });

  it('isAkunToko true bila ID Kreator ada di akunKontenToko, false bila tidak/belum terikat', () => {
    const aoa = [
      HEADER_TT_VIDEO,
      ['KR-TOKO', 'V1', '', 'Produk A', '0', '0', '0', '0', 'Toko', 'c', '0', '0'],
      ['KR-LAIN', 'V2', '', 'Produk B', '0', '0', '0', '0', 'Afiliasi', 'c', '0', '0'],
    ];
    const hasil = ekstrakBarisTtVideo(aoa, 1, ['KR-TOKO']);
    expect(hasil.find((b) => b.platformContentId === 'V1')!.isAkunToko).toBe(true);
    expect(hasil.find((b) => b.platformContentId === 'V2')!.isAkunToko).toBe(false);
    expect(ekstrakBarisTtVideo(aoa, 1, null).every((b) => !b.isAkunToko)).toBe(true);
  });

  it('baris dengan ID Video kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = [
      HEADER_TT_VIDEO,
      ['KR-1', '', '', '', '0', '0', '0', '0', 'Kreator A', 'c', '0', '0'],
      ['KR-1', 'V1', '', '', '0', '0', '0', '0', 'Kreator A', 'c', '0', '0'],
    ];
    expect(ekstrakBarisTtVideo(aoa, 1, null)).toHaveLength(1);
  });

  it('kolom opsional hilang ⇒ null untuk field itu (bukan 0)', () => {
    const headerMinimal = ['ID Video'];
    const aoa = [headerMinimal, ['V1']];
    expect(ekstrakBarisTtVideo(aoa, 1, null)).toEqual([
      { platformContentId: 'V1', creatorPlatformId: null, creatorHandle: null, isAkunToko: false, vv: null, likes: null, dibagikan: null, klikProduk: null, gmv: null },
    ]);
  });
});

// Header persis kolomDipanen shopee_live (sheet "Daftar Streaming", live_streaming_*.xlsx).
const HEADER_SHOPEE_LIVE = ['Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan (Pesanan Siap Dikirim)(Rp)'];

describe('ekstrakBarisShopeeLive (modul KESEMBILAN, sesi 24)', () => {
  it('memetakan platformContentId dari digit mentah Waktu Mulai (bukan Informasi Streaming), vv/gmv terisi', () => {
    const aoa = [
      HEADER_SHOPEE_LIVE,
      ['jual berbagai body motor', '03-07-2026 15:21', '1.234', '5.000.000'],
    ];
    expect(ekstrakBarisShopeeLive(aoa, 1)).toEqual([
      { platformContentId: '202607031521', waktuPosting: new Date(Date.UTC(2026, 6, 3, 8, 21)), vv: 1234, gmv: 5000000 },
    ]);
  });

  it('judul BERULANG (dua sesi live, Informasi Streaming sama) tetap dua baris terpisah — Waktu Mulai membedakan', () => {
    const aoa = [
      HEADER_SHOPEE_LIVE,
      ['jual berbagai body motor', '03-07-2026 15:21', '100', '0'],
      ['jual berbagai body motor', '04-07-2026 11:11', '200', '0'],
    ];
    const hasil = ekstrakBarisShopeeLive(aoa, 1);
    expect(hasil.map((b) => b.platformContentId)).toEqual(['202607031521', '202607041111']);
  });

  it('konversi WIB→UTC benar untuk waktuPosting (WIB − 7 jam)', () => {
    const aoa = [HEADER_SHOPEE_LIVE, ['Judul', '01-01-2026 00:30', '0', '0']];
    const [baris] = ekstrakBarisShopeeLive(aoa, 1);
    // 01-01-2026 00:30 WIB = 31-12-2025 17:30 UTC (hari sebelumnya, WIB lebih dulu)
    expect(baris.waktuPosting.toISOString()).toBe('2025-12-31T17:30:00.000Z');
  });

  it('konvensi Seller Center (titik ribuan, koma desimal) — bukan Ads Manager', () => {
    const aoa = [HEADER_SHOPEE_LIVE, ['Judul', '03-07-2026 15:21', '1.234', '1.234.567,89']];
    const [baris] = ekstrakBarisShopeeLive(aoa, 1);
    expect(baris.vv).toBe(1234);
    expect(baris.gmv).toBe(1234567.89);
  });

  it('baris ber-"Waktu Mulai" kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = [HEADER_SHOPEE_LIVE, ['Judul', '', '0', '0']];
    expect(ekstrakBarisShopeeLive(aoa, 1)).toHaveLength(0);
  });

  it('"Waktu Mulai" tidak cocok pola DD-MM-YYYY HH:mm dilewati (bukan crash)', () => {
    const aoa = [HEADER_SHOPEE_LIVE, ['Judul', 'bukan tanggal', '0', '0']];
    expect(ekstrakBarisShopeeLive(aoa, 1)).toHaveLength(0);
  });

  it('kolom "Pengunjung"/"Penjualan (...)(Rp)" hilang ⇒ null untuk field itu (bukan 0)', () => {
    const headerMinimal = ['Waktu Mulai'];
    const aoa = [headerMinimal, ['03-07-2026 15:21']];
    const [baris] = ekstrakBarisShopeeLive(aoa, 1);
    expect(baris.vv).toBeNull();
    expect(baris.gmv).toBeNull();
    expect(baris.platformContentId).toBe('202607031521');
  });
});

// Header persis kolomDipanen tt_live (real sample "Live Analysis*.xlsx", "Tiktok - Avitaskin.zip").
const HEADER_TT_LIVE = ['ID Kreator', 'Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR'];

describe('ekstrakBarisTtLive (modul KESEPULUH, G1-09-2BII-TTLIVE DITUTUP via sample asli)', () => {
  it('memetakan platformContentId dari idKreator + digit mentah Waktu Live (bukan hanya salah satu), field lain terisi', () => {
    const aoa = [
      HEADER_TT_LIVE,
      ['6916141288326202370', 'bidanku.afita', '2026/07/31/ 19:06', '2h 53min', '556308', '2', '7048', '1.14%'],
    ];
    expect(ekstrakBarisTtLive(aoa, 1, null)).toEqual([
      {
        platformContentId: '6916141288326202370-202607311906',
        creatorPlatformId: '6916141288326202370', creatorHandle: 'bidanku.afita', isAkunToko: false,
        vv: 7048, gmv: 556308, durasiDetik: 2 * 3600 + 53 * 60,
      },
    ]);
  });

  it('dua kreator BERBEDA live di menit yang SAMA tetap dua baris terpisah (idKreator bagian identitas, bukan waktu saja)', () => {
    const aoa = [
      HEADER_TT_LIVE,
      ['KR-1', 'Toko', '2026/07/31/ 19:06', '0h 5min', '0', '0', '0', '0%'],
      ['KR-2', 'Afiliasi', '2026/07/31/ 19:06', '0h 5min', '0', '0', '0', '0%'],
    ];
    const hasil = ekstrakBarisTtLive(aoa, 1, null);
    expect(hasil.map((b) => b.platformContentId)).toEqual(['KR-1-202607311906', 'KR-2-202607311906']);
  });

  it('isAkunToko true bila ID Kreator ada di akunKontenToko, false bila tidak/belum terikat', () => {
    const aoa = [
      HEADER_TT_LIVE,
      ['KR-TOKO', 'Toko', '2026/07/01/ 10:00', '0h 5min', '0', '0', '0', '0%'],
      ['KR-LAIN', 'Afiliasi', '2026/07/01/ 10:00', '0h 5min', '0', '0', '0', '0%'],
    ];
    const hasil = ekstrakBarisTtLive(aoa, 1, ['KR-TOKO']);
    expect(hasil.find((b) => b.creatorPlatformId === 'KR-TOKO')!.isAkunToko).toBe(true);
    expect(hasil.find((b) => b.creatorPlatformId === 'KR-LAIN')!.isAkunToko).toBe(false);
    expect(ekstrakBarisTtLive(aoa, 1, null).every((b) => !b.isAkunToko)).toBe(true);
  });

  it('konvensi Seller Center (titik ribuan, koma desimal) — bukan Ads Manager', () => {
    const aoa = [HEADER_TT_LIVE, ['KR-1', 'Toko', '2026/07/01/ 10:00', '0h 5min', '1.234.567,89', '0', '1.234', '0%']];
    const [baris] = ekstrakBarisTtLive(aoa, 1, null);
    expect(baris.vv).toBe(1234);
    expect(baris.gmv).toBe(1234567.89);
  });

  it('baris ber-"ID Kreator" kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = [HEADER_TT_LIVE, ['', 'Toko', '2026/07/01/ 10:00', '0h 5min', '0', '0', '0', '0%']];
    expect(ekstrakBarisTtLive(aoa, 1, null)).toHaveLength(0);
  });

  it('"Waktu Live" kosong ATAU tidak cocok pola dilewati (bukan crash)', () => {
    const aoa = [
      HEADER_TT_LIVE,
      ['KR-1', 'Toko', '', '0h 5min', '0', '0', '0', '0%'],
      ['KR-1', 'Toko', 'bukan tanggal', '0h 5min', '0', '0', '0', '0%'],
    ];
    expect(ekstrakBarisTtLive(aoa, 1, null)).toHaveLength(0);
  });

  it('kolom "Kreator"/"Durasi"/"GMV dari LIVE (Rp)"/"Penonton" hilang ⇒ null untuk field itu (bukan 0)', () => {
    const headerMinimal = ['ID Kreator', 'Waktu Live'];
    const aoa = [headerMinimal, ['KR-1', '2026/07/01/ 10:00']];
    expect(ekstrakBarisTtLive(aoa, 1, null)).toEqual([
      {
        platformContentId: 'KR-1-202607011000', creatorPlatformId: 'KR-1', creatorHandle: null, isAkunToko: false,
        vv: null, gmv: null, durasiDetik: null,
      },
    ]);
  });
});

// Urutan kolom PERSIS sample asli pemilik (Anjalie Factory, 2026-08-01..31) —
// termasuk `Estimated affiliate partner commission ` yang BERAKHIR SPASI.
const HEADER_TT_AFFILIATE = [
  'Date', 'Comparison date', 'Campaign ID', 'Campaign name', 'Campaign duration', 'Creator name',
  'Creator follower count', 'Product ID', 'Product name', 'Shop code', 'Shop ID', 'Shop name',
  'Video ID', 'Video name', 'Post time', 'Affiliate video-attributed GMV',
  'Creator video-attributed orders', 'Affiliate video orders',
  'Estimated affiliate partner commission ', 'Actual affiliate partner commission',
  'Duration', 'Video views', 'Video likes', 'Video product RPM', 'Creator-attributed items sold',
];

/** Satu baris sample dengan nilai yang boleh ditimpa lewat `ubah` (indeks kolom → nilai). */
function barisAff(ubah: Record<number, string>): string[] {
  const b = [
    '2026-08-01-2026-08-31', '--', '7514571237240309505', 'TAP Campaign Internal', '2025-06-11-2026-10-31',
    'wiyati496', '29002', '1729692880686844585', 'Kebaya Encim', 'IDLC3FWLCA', '7494656817002875561',
    'Anjalie Factory', '7551822826588736775', 'judul video', '2025-09-19 22:29:32', 'Rp0',
    '0', '0', 'Rp0', 'Rp0', '43s', '20', '0', 'Rp0', '0',
  ];
  for (const [i, v] of Object.entries(ubah)) b[Number(i)] = v;
  return b;
}

const BARIS_SUMMARY = [
  'Summary', '--', '-', '-', '-', '-', '--', '-', '-', '-', '-', '-', '-', '-', '-',
  'Rp0', '0', '0', 'Rp0', 'Rp0', '2min', '15369', '19', 'Rp0', '0',
];

describe('ekstrakBarisTtAffiliateVideo (M9-OA-4 — sumber Attributed GMV KOL)', () => {
  it('memetakan Video ID/Creator name/Shop ID/views/likes/GMV/Duration dari baris data', () => {
    expect(ekstrakBarisTtAffiliateVideo([HEADER_TT_AFFILIATE, barisAff({ 15: 'Rp1.250.000', 22: '7' })], 1)).toEqual([
      {
        platformContentId: '7551822826588736775',
        creatorHandle: 'wiyati496',
        shopId: '7494656817002875561',
        vv: 20,
        likes: 7,
        gmv: 1250000,
        durasiDetik: 43,
      },
    ]);
  });

  it('baris "Summary" TikTok DILEWATI — dikenali dari kolom Date yang bukan rentang, bukan dari Video ID kosong', () => {
    const hasil = ekstrakBarisTtAffiliateVideo([HEADER_TT_AFFILIATE, BARIS_SUMMARY, barisAff({})], 1);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].platformContentId).toBe('7551822826588736775');
    // Bukti bahwa filter "Video ID kosong" saja TIDAK cukup: Summary mengisinya '-'.
    expect(BARIS_SUMMARY[12]).toBe('-');
  });

  it('baris ganda untuk satu Video ID dikerucutkan jadi SATU — TIDAK dijumlah', () => {
    const hasil = ekstrakBarisTtAffiliateVideo(
      [HEADER_TT_AFFILIATE, barisAff({ 22: '20' }), barisAff({ 4: '2025-06-11-2026-12-31', 6: '28912', 21: '15' })],
      1,
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].vv).toBe(20); // BUKAN 35
  });

  it('pemilihan deterministik: GMV terbesar menang, lalu views, lalu follower — bebas urutan baris', () => {
    const kecil = barisAff({ 15: 'Rp100.000', 21: '99' });
    const besar = barisAff({ 15: 'Rp900.000', 21: '1' });
    const majuMundur = ekstrakBarisTtAffiliateVideo([HEADER_TT_AFFILIATE, kecil, besar], 1);
    const mundurMaju = ekstrakBarisTtAffiliateVideo([HEADER_TT_AFFILIATE, besar, kecil], 1);
    expect(majuMundur[0].gmv).toBe(900000);
    expect(mundurMaju[0].gmv).toBe(900000);
    // Nilai diambil dari SATU baris yang sama, bukan max per kolom.
    expect(majuMundur[0].vv).toBe(1);
    expect(mundurMaju[0].vv).toBe(1);
  });

  it('GMV seri ⇒ views yang memutus; views seri ⇒ follower count', () => {
    const [aVv] = ekstrakBarisTtAffiliateVideo(
      [HEADER_TT_AFFILIATE, barisAff({ 21: '5', 22: '1' }), barisAff({ 21: '9', 22: '2' })],
      1,
    );
    expect(aVv.vv).toBe(9);
    expect(aVv.likes).toBe(2);
    const [aFollower] = ekstrakBarisTtAffiliateVideo(
      [HEADER_TT_AFFILIATE, barisAff({ 6: '100', 22: '1' }), barisAff({ 6: '200', 22: '2' })],
      1,
    );
    expect(aFollower.likes).toBe(2);
  });

  it('dua video berbeda tetap dua baris, urutan kemunculan pertama dipertahankan', () => {
    const hasil = ekstrakBarisTtAffiliateVideo(
      [HEADER_TT_AFFILIATE, barisAff({ 12: 'VID-B' }), barisAff({ 12: 'VID-A' }), barisAff({ 12: 'VID-B' })],
      1,
    );
    expect(hasil.map((b) => b.platformContentId)).toEqual(['VID-B', 'VID-A']);
  });

  it('Duration "43s"/"2min"/"1min 30s"/"1h 2min 3s" → detik; bentuk tak dikenal → null', () => {
    const detik = (d: string): number | null =>
      ekstrakBarisTtAffiliateVideo([HEADER_TT_AFFILIATE, barisAff({ 20: d })], 1)[0].durasiDetik;
    expect(detik('43s')).toBe(43);
    expect(detik('2min')).toBe(120);
    expect(detik('1min 30s')).toBe(90);
    expect(detik('1h 2min 3s')).toBe(3723);
    expect(detik('')).toBeNull();
    expect(detik('sebentar')).toBeNull();
  });

  it('kolom opsional hilang ⇒ null untuk field itu (bukan 0); Date/Video ID tetap wajib', () => {
    const headerMinimal = ['Date', 'Video ID'];
    expect(ekstrakBarisTtAffiliateVideo([headerMinimal, ['2026-08-01-2026-08-31', 'VID-1']], 1)).toEqual([
      { platformContentId: 'VID-1', creatorHandle: null, shopId: null, vv: null, likes: null, gmv: null, durasiDetik: null },
    ]);
  });

  it('nol kolom Date ⇒ nol baris (baris data tidak dapat dibedakan dari Summary)', () => {
    expect(ekstrakBarisTtAffiliateVideo([['Video ID'], ['VID-1']], 1)).toEqual([]);
  });

  it('baris ber-Video ID kosong dilewati walau Date-nya rentang yang sah', () => {
    expect(ekstrakBarisTtAffiliateVideo([HEADER_TT_AFFILIATE, barisAff({ 12: '' })], 1)).toEqual([]);
  });
});

const HEADER_PARENT_SKU = [
  'Kode Produk', 'Kode Variasi', 'SKU Induk', 'Total Penjualan (Pesanan Dibuat) (IDR)',
  'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Jumlah Produk Dilihat', 'Produk Diklik',
  'Tingkat Konversi (Pesanan yang Dibuat)', 'repeat order', 'Pengunjung Produk (Kunjungan)',
];

describe('ekstrakBarisSkuMasterShopeeParentSku', () => {
  it('memetakan Kode Produk/Kode Variasi/SKU Induk — nama_produk/kategori/harga SELALU null (tidak ada di whitelist modul ini)', () => {
    const aoa = [HEADER_PARENT_SKU, ['P1', 'V1', 'SKU1', '100000', '100000', '10', '5', '5%', '10%', '20']];
    expect(ekstrakBarisSkuMasterShopeeParentSku(aoa, 1)).toEqual([
      {
        platformProductId: 'P1', platformVariationId: 'V1', sellerSku: 'SKU1',
        namaProduk: null, namaVariasi: null, kategoriPlatform: null, hargaSatuanTerakhir: null,
      },
    ]);
  });

  it('Kode Variasi kosong ⇒ platformVariationId string kosong (bukan null — DEFAULT skema)', () => {
    const aoa = [HEADER_PARENT_SKU, ['P1', '', 'SKU1', '0', '0', '0', '0', '0%', '0%', '0']];
    expect(ekstrakBarisSkuMasterShopeeParentSku(aoa, 1)[0].platformVariationId).toBe('');
  });

  it('baris ber-Kode Produk kosong dilewati', () => {
    const aoa = [HEADER_PARENT_SKU, ['', 'V1', 'SKU1', '0', '0', '0', '0', '0%', '0%', '0']];
    expect(ekstrakBarisSkuMasterShopeeParentSku(aoa, 1)).toHaveLength(0);
  });

  it('SKU sama muncul dua kali (dua baris) ⇒ dedup jadi SATU baris, nilai TERAKHIR menang', () => {
    const aoa = [
      HEADER_PARENT_SKU,
      ['P1', 'V1', 'SKU-LAMA', '100', '100', '1', '1', '1%', '1%', '1'],
      ['P1', 'V1', 'SKU-BARU', '200', '200', '2', '2', '2%', '2%', '2'],
    ];
    const hasil = ekstrakBarisSkuMasterShopeeParentSku(aoa, 1);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].sellerSku).toBe('SKU-BARU');
  });
});

const HEADER_TT_ORDERS = [
  'Order ID', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity',
  'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Order Status', 'Paid Time',
  'Product Category', 'Creator Handle',
];

describe('ekstrakBarisSkuMasterTtOrders', () => {
  it('memetakan SKU ID/Seller SKU/Product Name/Variation/Product Category/harga — platformVariationId SELALU string kosong (nol id level-produk-induk terverifikasi)', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'Kaos Polos', 'Merah / L', '2', '50.000', '95.000', 'Completed', '01/07/2026', 'Fashion Pria', 'KR-1'],
    ];
    expect(ekstrakBarisSkuMasterTtOrders(aoa, 1)).toEqual([
      {
        platformProductId: 'SKU-1', platformVariationId: '', sellerSku: 'SLR-1',
        namaProduk: 'Kaos Polos', namaVariasi: 'Merah / L', kategoriPlatform: 'Fashion Pria',
        hargaSatuanTerakhir: 50000,
      },
    ]);
  });

  it('konvensi Seller Center (titik ribuan, koma desimal) untuk harga', () => {
    const aoa = [HEADER_TT_ORDERS, ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '1.234.567,89', '0', 'Completed', '01/07/2026', 'Kat', 'KR-1']];
    expect(ekstrakBarisSkuMasterTtOrders(aoa, 1)[0].hargaSatuanTerakhir).toBe(1234567.89);
  });

  it('baris ber-SKU ID kosong dilewati', () => {
    const aoa = [HEADER_TT_ORDERS, ['O1', '', 'SLR-1', 'X', 'Y', '1', '0', '0', 'Completed', '01/07/2026', 'Kat', 'KR-1']];
    expect(ekstrakBarisSkuMasterTtOrders(aoa, 1)).toHaveLength(0);
  });

  it('SKU yang sama di banyak baris pesanan ⇒ dedup jadi SATU baris master, nilai TERAKHIR menang', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'Nama Lama', 'Y', '1', '40.000', '0', 'Completed', '01/07/2026', 'Kat', 'KR-1'],
      ['O2', 'SKU-1', 'SLR-1', 'Nama Baru', 'Y', '1', '45.000', '0', 'Completed', '02/07/2026', 'Kat', 'KR-1'],
    ];
    const hasil = ekstrakBarisSkuMasterTtOrders(aoa, 1);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].namaProduk).toBe('Nama Baru');
    expect(hasil[0].hargaSatuanTerakhir).toBe(45000);
  });

  it('kolom opsional hilang ⇒ null untuk field itu', () => {
    const headerMinimal = ['SKU ID'];
    const aoa = [headerMinimal, ['SKU-1']];
    expect(ekstrakBarisSkuMasterTtOrders(aoa, 1)).toEqual([
      {
        platformProductId: 'SKU-1', platformVariationId: '', sellerSku: null,
        namaProduk: null, namaVariasi: null, kategoriPlatform: null, hargaSatuanTerakhir: null,
      },
    ]);
  });
});

describe('ekstrakBarisFaktaSkuTtOrders (PDT-TIKET-TT-ORDERS-FAKTA-DIBAYAR)', () => {
  it('menjumlah gmv (SKU Subtotal After Discount) dan pesananSku (Quantity) lintas baris untuk SKU yang sama', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '2', '50.000', '95.000', 'Completed', '01/07/2026', 'Kat', ''],
      ['O2', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '50.000', '48.000', 'Completed', '02/07/2026', 'Kat', ''],
    ];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)).toEqual([
      { platformProductId: 'SKU-1', gmv: 143000, pesananSku: 3, gmvDariKreator: 0 },
    ]);
  });

  it('SKU berbeda ⇒ baris terpisah', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '10.000', 'Completed', '01/07/2026', 'Kat', ''],
      ['O2', 'SKU-2', 'SLR-2', 'X', 'Y', '2', '20.000', '40.000', 'Completed', '01/07/2026', 'Kat', ''],
    ];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)).toEqual([
      { platformProductId: 'SKU-1', gmv: 10000, pesananSku: 1, gmvDariKreator: 0 },
      { platformProductId: 'SKU-2', gmv: 40000, pesananSku: 2, gmvDariKreator: 0 },
    ]);
  });

  it('basis dibayar: baris Order Status selain Completed dilewati SELURUHNYA — tidak menyumbang 0', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '10.000', 'Completed', '01/07/2026', 'Kat', ''],
      ['O2', 'SKU-1', 'SLR-1', 'X', 'Y', '5', '10.000', '50.000', 'Cancelled', '01/07/2026', 'Kat', ''],
      ['O3', 'SKU-1', 'SLR-1', 'X', 'Y', '9', '10.000', '90.000', 'Unpaid', '01/07/2026', 'Kat', ''],
    ];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)).toEqual([
      { platformProductId: 'SKU-1', gmv: 10000, pesananSku: 1, gmvDariKreator: 0 },
    ]);
  });

  it('status dibaca case-insensitive + trim', () => {
    const aoa = [HEADER_TT_ORDERS, ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '10.000', ' completed ', '01/07/2026', 'Kat', '']];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)).toEqual([
      { platformProductId: 'SKU-1', gmv: 10000, pesananSku: 1, gmvDariKreator: 0 },
    ]);
  });

  it('gmvDariKreator = Σ gmv HANYA baris ber-Creator Handle terisi, bukan cacah baris', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '30.000', 'Completed', '01/07/2026', 'Kat', 'KR-1'],
      ['O2', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '20.000', 'Completed', '01/07/2026', 'Kat', ''],
    ];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)).toEqual([
      { platformProductId: 'SKU-1', gmv: 50000, pesananSku: 2, gmvDariKreator: 30000 },
    ]);
  });

  it('baris ber-SKU ID kosong dilewati', () => {
    const aoa = [HEADER_TT_ORDERS, ['O1', '', 'SLR-1', 'X', 'Y', '1', '10.000', '10.000', 'Completed', '01/07/2026', 'Kat', '']];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)).toHaveLength(0);
  });

  it('satu baris gagal parse (NaN) meracuni agregat SKU itu — TERLIHAT, bukan diam-diam jadi 0 (Rule 12)', () => {
    const aoa = [
      HEADER_TT_ORDERS,
      ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '10.000', 'Completed', '01/07/2026', 'Kat', ''],
      ['O2', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', 'tidak terbatas', 'Completed', '02/07/2026', 'Kat', ''],
    ];
    const hasil = ekstrakBarisFaktaSkuTtOrders(aoa, 1);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].gmv).toBeNaN();
  });

  it('konvensi Seller Center (titik ribuan, koma desimal)', () => {
    const aoa = [HEADER_TT_ORDERS, ['O1', 'SKU-1', 'SLR-1', 'X', 'Y', '1', '10.000', '1.234.567,89', 'Completed', '01/07/2026', 'Kat', '']];
    expect(ekstrakBarisFaktaSkuTtOrders(aoa, 1)[0].gmv).toBe(1234567.89);
  });
});

const HEADER_TT_TRANSACTION_CREATOR = ['Creator name', 'GMV dari kreator', 'AOV', 'CTOR', 'Pesanan teratribusi', 'Tayangan video', 'Video', 'Siaran LIVE', 'Perkiraan komisi'];

describe('ekstrakBarisKreatorTtTransactionCreator', () => {
  it('memetakan Creator name/GMV/AOV/CTOR/Pesanan teratribusi/Video/Siaran LIVE — Tayangan video/Perkiraan komisi TIDAK dipetakan (konsumen lain, bukan kolom di sini)', () => {
    const aoa = [
      HEADER_TT_TRANSACTION_CREATOR,
      ['Kreator A', '2.000.000', '150.000', '5%', '10', '5000', '3', '2', '100.000'],
    ];
    expect(ekstrakBarisKreatorTtTransactionCreator(aoa, 1)).toEqual([
      {
        creatorHandle: 'Kreator A', gmv: 2000000, pesananTeratribusi: 10, aov: 150000,
        ctor: 0.05, jumlahLive: 2, jumlahVideo: 3,
      },
    ]);
  });

  it('konvensi Seller Center (titik ribuan, koma desimal)', () => {
    const aoa = [HEADER_TT_TRANSACTION_CREATOR, ['Kreator A', '1.234.567,89', '0', '0', '0', '0', '0', '0', '0']];
    expect(ekstrakBarisKreatorTtTransactionCreator(aoa, 1)[0].gmv).toBe(1234567.89);
  });

  it('baris ber-Creator name kosong dilewati (kunci NOT NULL pdt_fact_creator_period)', () => {
    const aoa = [HEADER_TT_TRANSACTION_CREATOR, ['', '0', '0', '0', '0', '0', '0', '0', '0']];
    expect(ekstrakBarisKreatorTtTransactionCreator(aoa, 1)).toHaveLength(0);
  });

  it('dua kreator terpisah tetap terpetakan masing-masing', () => {
    const aoa = [
      HEADER_TT_TRANSACTION_CREATOR,
      ['Kreator A', '1000000', '0', '0', '0', '0', '0', '0', '0'],
      ['Kreator B', '500000', '0', '0', '0', '0', '0', '0', '0'],
    ];
    expect(ekstrakBarisKreatorTtTransactionCreator(aoa, 1).map((b) => b.creatorHandle)).toEqual(['Kreator A', 'Kreator B']);
  });

  it('kolom opsional hilang ⇒ null untuk field itu', () => {
    const headerMinimal = ['Creator name'];
    const aoa = [headerMinimal, ['Kreator A']];
    expect(ekstrakBarisKreatorTtTransactionCreator(aoa, 1)).toEqual([
      { creatorHandle: 'Kreator A', gmv: null, pesananTeratribusi: null, aov: null, ctor: null, jumlahLive: null, jumlahVideo: null },
    ]);
  });
});

const HEADER_SHOPEE_AMS_AFILIASI = ['ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'];

describe('ekstrakBarisKreatorShopeeAmsAfiliasi', () => {
  it('memetakan Username/Omzet/Pesanan — ID Affiliates/Produk Terjual/Komisi/ROI TIDAK dipetakan (nol kolom/konsumen lain di pdt_fact_creator_period)', () => {
    const aoa = [
      HEADER_SHOPEE_AMS_AFILIASI,
      ['AFF-1', 'kreator_a', '2000000', '15', '10', '100000', '5'],
    ];
    expect(ekstrakBarisKreatorShopeeAmsAfiliasi(aoa, 1)).toEqual([
      { creatorHandle: 'kreator_a', gmv: 2000000, pesananTeratribusi: 10 },
    ]);
  });

  it('konvensi Ads Manager (titik desimal, koma ribuan) — bukan Seller Center', () => {
    const aoa = [HEADER_SHOPEE_AMS_AFILIASI, ['AFF-1', 'kreator_a', '2,000,000.5', '0', '10', '0', '0']];
    expect(ekstrakBarisKreatorShopeeAmsAfiliasi(aoa, 1)[0].gmv).toBe(2000000.5);
  });

  it('baris ber-Username kosong dilewati (kunci NOT NULL pdt_fact_creator_period)', () => {
    const aoa = [HEADER_SHOPEE_AMS_AFILIASI, ['AFF-1', '', '0', '0', '0', '0', '0']];
    expect(ekstrakBarisKreatorShopeeAmsAfiliasi(aoa, 1)).toHaveLength(0);
  });

  it('dua kreator terpisah tetap terpetakan masing-masing', () => {
    const aoa = [
      HEADER_SHOPEE_AMS_AFILIASI,
      ['AFF-1', 'kreator_a', '1000000', '0', '0', '0', '0'],
      ['AFF-2', 'kreator_b', '500000', '0', '0', '0', '0'],
    ];
    expect(ekstrakBarisKreatorShopeeAmsAfiliasi(aoa, 1).map((b) => b.creatorHandle)).toEqual(['kreator_a', 'kreator_b']);
  });

  it('kolom opsional hilang ⇒ null untuk field itu', () => {
    const headerMinimal = ['Username Affiliate'];
    const aoa = [headerMinimal, ['kreator_a']];
    expect(ekstrakBarisKreatorShopeeAmsAfiliasi(aoa, 1)).toEqual([
      { creatorHandle: 'kreator_a', gmv: null, pesananTeratribusi: null },
    ]);
  });
});

// Header persis kolomDipanen shopee_ams_produk (PDT_KOLOM_DIPANEN.md §2.10, dikoreksi sesi 20).
const HEADER_SHOPEE_AMS_PRODUK = ['Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'];

describe('ekstrakBarisShopeeAmsProduk (modul KEDELAPAN, sesi 23)', () => {
  it('memetakan Kode Item/Omzet/Produk Terjual/Pesanan — Nama Item/Estimasi Komisi/ROI TIDAK dipetakan (nol kolom di pdt_fact_sku_period)', () => {
    const aoa = [
      HEADER_SHOPEE_AMS_PRODUK,
      ['22571212550', 'Cover Body Vario 125', '54587884', '120', '95', '2729394', '7.5'],
    ];
    expect(ekstrakBarisShopeeAmsProduk(aoa, 1)).toEqual([
      { platformProductId: '22571212550', gmv: 54587884, produkTerjual: 120, pesanan: 95 },
    ]);
  });

  it('konvensi Ads Manager (titik desimal, koma ribuan) — bukan Seller Center', () => {
    const aoa = [HEADER_SHOPEE_AMS_PRODUK, ['PRD-1', 'Produk A', '2,000,000.5', '0', '0', '0', '0']];
    expect(ekstrakBarisShopeeAmsProduk(aoa, 1)[0].gmv).toBe(2000000.5);
  });

  it('baris ber-"Kode Item" kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = [HEADER_SHOPEE_AMS_PRODUK, ['', 'Produk A', '0', '0', '0', '0', '0']];
    expect(ekstrakBarisShopeeAmsProduk(aoa, 1)).toHaveLength(0);
  });

  it('dua produk terpisah tetap terpetakan masing-masing', () => {
    const aoa = [
      HEADER_SHOPEE_AMS_PRODUK,
      ['PRD-1', 'Produk A', '1000000', '0', '0', '0', '0'],
      ['PRD-2', 'Produk B', '500000', '0', '0', '0', '0'],
    ];
    expect(ekstrakBarisShopeeAmsProduk(aoa, 1).map((b) => b.platformProductId)).toEqual(['PRD-1', 'PRD-2']);
  });

  it('kolom opsional hilang ⇒ null untuk field itu', () => {
    const headerMinimal = ['Kode Item'];
    const aoa = [headerMinimal, ['PRD-1']];
    expect(ekstrakBarisShopeeAmsProduk(aoa, 1)).toEqual([
      { platformProductId: 'PRD-1', gmv: null, produkTerjual: null, pesanan: null },
    ]);
  });
});

// Kolom persis Fim Motor asli (`Data+Keseluruhan+Iklan+Shopee-01_07_2026-31_07_2026.csv`,
// baris header 8) — subset yang dipanen; kolom lain di berkas asli (Status, Jenis Iklan, dst.)
// sengaja tidak semuanya diulang di sini. `Kode Produk` DIBACA sejak sesi 23 (platformProductId,
// G1-09-2BII-ADS-CPC-SKU) — beda dari sesi-sesi sebelumnya yang membuktikan kolom itu diabaikan.
const HEADER_SHOPEE_ADS_CPC = ['nama iklan', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'omzet penjualan', 'Biaya', 'Efektifitas Iklan'];

describe('ekstrakBarisShopeeAdsCpc', () => {
  it('memetakan satu baris lengkap ke kampanyeId/platformProductId/tayangan/klik/pesananSku/gmv/biaya/roas', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_CPC,
      ['Tameng Depan Besar Kecil Vario Techno 125', '19484539752', '447740', '21428', '616', '105473414', '10628677', '9.92'],
    ];
    expect(ekstrakBarisShopeeAdsCpc(aoa, 1)).toEqual([
      {
        kampanyeId: 'Tameng Depan Besar Kecil Vario Techno 125', platformProductId: '19484539752',
        tayangan: 447740, klik: 21428, pesananSku: 616, gmv: 105473414, biaya: 10628677, roas: 9.92,
      },
    ]);
  });

  it('baris "Shop GMV Max" (sample Fim Motor asli) Kode Produk="-" ⇒ platformProductId null (iklan TOKO, bukan produk)', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_CPC,
      ['Shop GMV Max', '-', '608677', '29556', '1377', '146650117', '10500000', '13.97'],
    ];
    const hasil = ekstrakBarisShopeeAdsCpc(aoa, 1);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].kampanyeId).toBe('Shop GMV Max');
    expect(hasil[0].platformProductId).toBeNull();
  });

  it('konvensi Ads Manager (titik desimal, koma ribuan) — bukan Seller Center', () => {
    const aoa = [HEADER_SHOPEE_ADS_CPC, ['Iklan A', 'PRD-1', '1,000', '100', '20', '2,000,000', '150000.5', '13.33']];
    const [baris] = ekstrakBarisShopeeAdsCpc(aoa, 1);
    expect(baris.tayangan).toBe(1000);
    expect(baris.gmv).toBe(2000000);
    expect(baris.biaya).toBe(150000.5);
  });

  it('baris ber-"nama iklan" kosong dilewati (bukan baris data sungguhan, cermin parseAdsCsv legacy)', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_CPC,
      ['', 'PRD-1', '0', '0', '0', '0', '0', '0'],
      ['Iklan A', 'PRD-1', '1000', '100', '20', '2000000', '150000', '13.33'],
    ];
    expect(ekstrakBarisShopeeAdsCpc(aoa, 1)).toHaveLength(1);
  });

  it('dua iklan untuk PRODUK yang SAMA (Kode Produk identik) tetap dua baris terpisah — kampanyeId membedakan, platformProductId SAMA di keduanya', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_CPC,
      ['Iklan Manual', 'PRD-1', '1000', '100', '20', '2000000', '150000', '13.33'],
      ['Iklan Otomatis', 'PRD-1', '500', '50', '5', '400000', '50000', '8'],
    ];
    const hasil = ekstrakBarisShopeeAdsCpc(aoa, 1);
    expect(hasil.map((b) => b.kampanyeId)).toEqual(['Iklan Manual', 'Iklan Otomatis']);
    expect(hasil.map((b) => b.platformProductId)).toEqual(['PRD-1', 'PRD-1']);
  });

  it('kolom "Kode Produk" hilang ⇒ platformProductId null (bukan crash)', () => {
    const headerTanpaKodeProduk = ['nama iklan', 'Biaya'];
    const aoa = [headerTanpaKodeProduk, ['Iklan A', '150000']];
    const [baris] = ekstrakBarisShopeeAdsCpc(aoa, 1);
    expect(baris.platformProductId).toBeNull();
  });

  it('kolom "Dilihat"/"Jumlah Klik"/"Konversi"/"omzet penjualan"/"Efektifitas Iklan" hilang ⇒ null untuk field itu, biaya tetap 0', () => {
    const headerTanpaOpsional = ['nama iklan', 'Biaya'];
    const aoa = [headerTanpaOpsional, ['Iklan A', '150000']];
    expect(ekstrakBarisShopeeAdsCpc(aoa, 1)).toEqual([
      {
        kampanyeId: 'Iklan A', platformProductId: null,
        tayangan: null, klik: null, pesananSku: null, gmv: null, biaya: 150000, roas: null,
      },
    ]);
  });
});

// Header persis sample asli Fim Motor (Search-Ads-Overall-Data-*.csv, header baris 8) — subset
// yang relevan untuk fungsi ini; 'Urutan'/'Status'/'SOV'/dst. sengaja tidak semuanya diulang.
const HEADER_SHOPEE_ADS_SEARCH = [
  'Nama Iklan', 'Kata Pencarian', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Omzet Penjualan', 'Biaya', 'Efektifitas Iklan',
];

describe('ekstrakBarisShopeeAdsSearch', () => {
  it('memetakan satu baris lengkap ke kampanyeId KOMPOSIT (nama iklan :: kata pencarian)/tayangan/klik/pesananSku/gmv/biaya/roas', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_SEARCH,
      ['Iklan toko by MEA', 'Semua', '3', '20677', '330', '32480316', '6200000', '5.24'],
    ];
    expect(ekstrakBarisShopeeAdsSearch(aoa, 1)).toEqual([
      {
        kampanyeId: 'Iklan toko by MEA :: Semua',
        tayangan: 3, klik: 20677, pesananSku: 330, gmv: 32480316, biaya: 6200000, roas: 5.24,
      },
    ]);
  });

  it('dua keyword untuk IKLAN yang SAMA (Nama Iklan identik) tetap dua baris terpisah — komposit membedakan, bukan nama iklan saja', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_SEARCH,
      ['Iklan Search A', 'sepatu wanita', '1000', '100', '20', '2000000', '150000', '13.33'],
      ['Iklan Search A', 'sepatu pria', '500', '50', '5', '400000', '50000', '8'],
    ];
    const hasil = ekstrakBarisShopeeAdsSearch(aoa, 1);
    expect(hasil.map((b) => b.kampanyeId)).toEqual(['Iklan Search A :: sepatu wanita', 'Iklan Search A :: sepatu pria']);
  });

  it('konvensi Ads Manager (titik desimal, koma ribuan) — bukan Seller Center', () => {
    const aoa = [HEADER_SHOPEE_ADS_SEARCH, ['Iklan A', 'Semua', '1,000', '100', '20', '2,000,000', '150000.5', '13.33']];
    const [baris] = ekstrakBarisShopeeAdsSearch(aoa, 1);
    expect(baris.tayangan).toBe(1000);
    expect(baris.gmv).toBe(2000000);
    expect(baris.biaya).toBe(150000.5);
  });

  it('baris ber-"Nama Iklan" kosong dilewati (bukan baris data sungguhan, sama pola shopee_ads_cpc)', () => {
    const aoa = [
      HEADER_SHOPEE_ADS_SEARCH,
      ['', 'Semua', '0', '0', '0', '0', '0', '0'],
      ['Iklan A', 'Semua', '1000', '100', '20', '2000000', '150000', '13.33'],
    ];
    expect(ekstrakBarisShopeeAdsSearch(aoa, 1)).toHaveLength(1);
  });

  it('kolom "Kata Pencarian" hilang ⇒ komposit berkurang jadi "nama iklan :: " (string kosong di sisi kanan)', () => {
    const headerTanpaKataPencarian = ['Nama Iklan', 'Biaya'];
    const aoa = [headerTanpaKataPencarian, ['Iklan A', '150000']];
    const [baris] = ekstrakBarisShopeeAdsSearch(aoa, 1);
    expect(baris.kampanyeId).toBe('Iklan A :: ');
  });

  it('kolom "Dilihat"/"Jumlah Klik"/"Konversi"/"Omzet Penjualan"/"Efektifitas Iklan" hilang ⇒ null untuk field itu, biaya tetap 0', () => {
    const headerTanpaOpsional = ['Nama Iklan', 'Kata Pencarian', 'Biaya'];
    const aoa = [headerTanpaOpsional, ['Iklan A', 'Semua', '150000']];
    expect(ekstrakBarisShopeeAdsSearch(aoa, 1)).toEqual([
      {
        kampanyeId: 'Iklan A :: Semua',
        tayangan: null, klik: null, pesananSku: null, gmv: null, biaya: 150000, roas: null,
      },
    ]);
  });
});

const HEADER_SHOP_DAILY_TIKTOK = [
  'Tanggal', 'GMV', 'Pesanan', 'Pembeli', 'Produk terjual', 'Pengembalian dana', 'Pesanan SKU',
  'Pendapatan bruto', 'Tayangan halaman', 'Pengunjung', 'Persentase konversi', 'Impresi produk',
  'Impresi produk unik', 'Klik produk', 'Klik unik', 'AOV',
];

/** Bentuk sheet asli `Shop Analytics_Key metrics_*.xlsx`: preamble + "Ringkasan data" (dipakai G1-07) + "Data harian" (baru, sesi 34). */
function shopAnalyticsAoa(dailyRows: readonly unknown[][]): unknown[][] {
  return [
    ['Tanggal analisis: 01/07/2026–31/07/2026'],
    ['Ringkasan data'],
    ['', 'GMV', 'Pesanan', 'Pembeli', 'Produk terjual', 'Pengembalian dana', 'Pesanan SKU'],
    ['Total nilai', '26560049', '145', '137', '147', '334640', '145'],
    [],
    [],
    ['Data harian'],
    HEADER_SHOP_DAILY_TIKTOK,
    ...dailyRows,
  ];
}

describe('ekstrakBarisShopDailyTiktok (sesi 34 — celah pdt_fact_shop_daily ditemukan+ditutup untuk TikTok)', () => {
  it('memetakan satu baris harian lengkap (angka sample asli Avitaskin, 01/07/2026)', () => {
    const aoa = shopAnalyticsAoa([
      ['01/07/2026', '1364124', '5', '5', '5', '-', '5', '1374706', '1278', '1020', '0.004901960784313725', '23805', '14615', '1349', '1074', '272825'],
    ]);
    const [baris] = ekstrakBarisShopDailyTiktok(aoa);
    expect(baris.tanggal).toBe('2026-07-01');
    expect(baris.gmv).toBe(1364124);
    expect(baris.pesanan).toBe(5);
    expect(baris.produkTerjual).toBe(5);
    expect(baris.pengunjung).toBe(1020);
    expect(baris.produkDiklik).toBe(1349);
    expect(baris.cr).toBe(0.004901960784313725);
    expect(baris.pembeli).toBe(5);
    expect(Number.isNaN(baris.refund)).toBe(true);
  });

  it('"Pengembalian dana" berupa "-" (bukan sel kosong) ⇒ refund NaN, bukan 0 (G1-03 — "-" bukan konvensi nol)', () => {
    const aoa = shopAnalyticsAoa([
      ['02/07/2026', '100', '1', '1', '1', '-', '1', '100', '10', '10', '0.1', '10', '10', '1', '1', '100'],
    ]);
    expect(Number.isNaN(ekstrakBarisShopDailyTiktok(aoa)[0].refund)).toBe(true);
  });

  it('"Pengembalian dana" berisi angka sungguhan ⇒ terparse apa adanya, TIDAK di-net-kan ke gmv (dua kolom terpisah)', () => {
    const aoa = shopAnalyticsAoa([
      ['06/07/2026', '1064790', '7', '7', '7', '159400', '7', '1150811', '1103', '785', '0.0089', '39161', '22795', '1114', '786', '152113'],
    ]);
    const [baris] = ekstrakBarisShopDailyTiktok(aoa);
    expect(baris.gmv).toBe(1064790);
    expect(baris.refund).toBe(159400);
  });

  it('tanpa marker "Data harian" ⇒ array kosong (mis. berkas hanya membawa Ringkasan)', () => {
    const aoa = [
      ['Tanggal analisis: 01/07/2026–31/07/2026'],
      ['Ringkasan data'],
      ['', 'GMV', 'Pesanan'],
      ['Total nilai', '100', '1'],
    ];
    expect(ekstrakBarisShopDailyTiktok(aoa)).toEqual([]);
  });

  it('baris kosong penutup section (Tanggal kosong) dilewati, bukan error', () => {
    const aoa = shopAnalyticsAoa([
      ['01/07/2026', '100', '1', '1', '1', '-', '1', '100', '10', '10', '0.1', '10', '10', '1', '1', '100'],
      [],
    ]);
    expect(ekstrakBarisShopDailyTiktok(aoa)).toHaveLength(1);
  });

  it('kolom opsional hilang (mis. berkas tanpa "Pembeli") ⇒ null untuk field itu, gmv/pesanan tetap wajib', () => {
    const aoa = [
      ['Data harian'],
      ['Tanggal', 'GMV', 'Pesanan'],
      ['01/07/2026', '100', '1'],
    ];
    expect(ekstrakBarisShopDailyTiktok(aoa)).toEqual([
      { tanggal: '2026-07-01', gmv: 100, pesanan: 1, produkTerjual: null, pengunjung: null, produkDiklik: null, cr: null, pembeli: null, refund: null },
    ]);
  });

  it('tanggal tak terbaca dilewati (baris ganjil, bukan error)', () => {
    const aoa = [
      ['Data harian'],
      HEADER_SHOP_DAILY_TIKTOK,
      ['bukan-tanggal', '100', '1', '1', '1', '-', '1', '100', '10', '10', '0.1', '10', '10', '1', '1', '100'],
    ];
    expect(ekstrakBarisShopDailyTiktok(aoa)).toEqual([]);
  });
});

const HEADER_SHOP_DAILY_SHOPEE = [
  'Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
  'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
  'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];

/** Bentuk sheet basis asli `fim_motor.shopee-shop-stats.*.xlsx` (mis. 'Pesanan Siap Dikirim'): header + ringkasan periode penuh + baris kosong + header berulang + baris harian. */
function shopStatsBasisAoa(dailyRows: readonly unknown[][]): unknown[][] {
  return [
    HEADER_SHOP_DAILY_SHOPEE,
    ['01-07-2026-31-07-2026', '1515002476', '12801', '118350,32', '552545', '361197', '2,32%', '2016', '249181974', '140', '24586464', '11046', '10461', '585', '51417', '11,35%'],
    [],
    HEADER_SHOP_DAILY_SHOPEE,
    ...dailyRows,
  ];
}

describe('ekstrakBarisShopDailyShopee (sesi 34 lanjutan — G1-09-2BII-SHOPDAILY-SHOPEE ditutup)', () => {
  it('memetakan satu baris harian lengkap (angka sample asli Fim Motor, 01-07-2026)', () => {
    const aoa = shopStatsBasisAoa([
      ['01-07-2026', '53089166', '438', '121208,14', '16583', '15095', '2,64%', '56', '6458732', '8', '1648328', '393', '347', '46', '1679', '9,41%'],
    ]);
    const [baris] = ekstrakBarisShopDailyShopee(aoa);
    expect(baris.tanggal).toBe('2026-07-01');
    expect(baris.gmv).toBe(53089166);
    expect(baris.pesanan).toBe(438);
    expect(baris.produkDiklik).toBe(16583);
    expect(baris.pengunjung).toBe(15095);
    expect(baris.cr).toBeCloseTo(0.0264, 5);
    expect(baris.pembeli).toBe(393);
    expect(baris.pembeliBaru).toBe(347);
    expect(baris.refund).toBe(1648328);
    expect(baris.pesananDibatalkan).toBe(56);
  });

  it('tanpa header harian berulang (hanya ringkasan) ⇒ array kosong', () => {
    const aoa = [
      HEADER_SHOP_DAILY_SHOPEE,
      ['01-07-2026-31-07-2026', '100', '1', '100', '10', '10', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%'],
    ];
    expect(ekstrakBarisShopDailyShopee(aoa)).toEqual([]);
  });

  it('baris kosong penutup section (Tanggal kosong) dilewati, bukan error', () => {
    const aoa = shopStatsBasisAoa([
      ['01-07-2026', '100', '1', '100', '10', '10', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%'],
      [],
    ]);
    expect(ekstrakBarisShopDailyShopee(aoa)).toHaveLength(1);
  });

  it('kolom opsional hilang (mis. berkas tanpa "Pembeli") ⇒ null untuk field itu, gmv/pesanan tetap wajib', () => {
    const aoa = [
      ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan'],
      ['01-07-2026-31-07-2026', '100', '1'],
      [],
      ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan'],
      ['01-07-2026', '100', '1'],
    ];
    expect(ekstrakBarisShopDailyShopee(aoa)).toEqual([
      { tanggal: '2026-07-01', gmv: 100, pesanan: 1, produkDiklik: null, pengunjung: null, cr: null, pembeli: null, pembeliBaru: null, refund: null, pesananDibatalkan: null },
    ]);
  });

  it('tanggal tak terbaca dilewati (baris ganjil, bukan error)', () => {
    const aoa = shopStatsBasisAoa([
      ['bukan-tanggal', '100', '1', '100', '10', '10', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%'],
    ]);
    expect(ekstrakBarisShopDailyShopee(aoa)).toEqual([]);
  });

  it('format tanggal SLASH (preamble Shopee lain, DD/MM/YYYY) TIDAK cocok — kolom Tanggal di sini wajib STRIP', () => {
    const aoa = shopStatsBasisAoa([
      ['01/07/2026', '100', '1', '100', '10', '10', '10%', '0', '0', '0', '0', '1', '1', '0', '1', '0%'],
    ]);
    expect(ekstrakBarisShopDailyShopee(aoa)).toEqual([]);
  });
});

// Header di baris 4 (Rule 7 "product_list baris 4", modules.ts barisHeaderHint) — tiga baris
// preamble di atasnya diabaikan sepenuhnya oleh fungsi (pemanggil yang sudah resolve barisHeader).
const HEADER_TT_PRODUCT_ANALYTICS = [
  'Nama', 'ID Produk', 'GMV', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual',
  'Pesanan SKU', 'Impresi produk', 'Klik produk', 'CTR', 'CTOR',
  // Kolom BERULANG dari kelompok kategori breakdown (mis. 'LIVE penjual') — label sama persis
  // 'GMV'/'Pesanan SKU', TIDAK boleh terpilih (bukan grup 'Semua').
  'GMV', 'Pesanan SKU',
];
const ttProductAnalyticsAoa = (rows: readonly (readonly unknown[])[]): (readonly unknown[])[] => [
  ['Tanggal analisis: 2026-07-01 - 2026-07-31'], ['Ringkasan data'], [], HEADER_TT_PRODUCT_ANALYTICS, ...rows,
];

describe('ekstrakBarisTtProductAnalytics (G2-01-KUADRAN-SKU langkah 1)', () => {
  it('memetakan satu baris lengkap — kolom PERTAMA (grup "Semua") yang terpilih, bukan duplikat grup breakdown', () => {
    const aoa = ttProductAnalyticsAoa([
      ['Produk A', 'PRD-1', '1000000', '200000', '300000', '400000', '50', '10000', '500', '0.05', '0.1', '999999', '999'],
    ]);
    expect(ekstrakBarisTtProductAnalytics(aoa, 4)).toEqual([
      {
        platformProductId: 'PRD-1', namaProduk: 'Produk A', gmv: 1000000, gmvDariKreator: 200000, gmvVideoPenjual: 300000,
        gmvLivePenjual: 400000, pesananSku: 50, impresi: 10000, klik: 500, ctr: 0.05, ctor: 0.1,
      },
    ]);
  });

  it('baris ber-"ID Produk" kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = ttProductAnalyticsAoa([
      ['Produk A', '', '1000000', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    ]);
    expect(ekstrakBarisTtProductAnalytics(aoa, 4)).toHaveLength(0);
  });

  it('dua produk terpisah tetap terpetakan masing-masing', () => {
    const aoa = ttProductAnalyticsAoa([
      ['Produk A', 'PRD-1', '1000000', '0', '0', '0', '10', '0', '0', '0', '0', '0', '0'],
      ['Produk B', 'PRD-2', '500000', '0', '0', '0', '5', '0', '0', '0', '0', '0', '0'],
    ]);
    expect(ekstrakBarisTtProductAnalytics(aoa, 4).map((b) => b.platformProductId)).toEqual(['PRD-1', 'PRD-2']);
  });

  it('kolom opsional hilang ⇒ null untuk field itu ("Produk terjual" TIDAK ada di whitelist modul ini, TIDAK pernah dibaca)', () => {
    const headerMinimal = ['ID Produk'];
    const aoa = [['preamble'], ['preamble2'], headerMinimal, ['PRD-1']];
    expect(ekstrakBarisTtProductAnalytics(aoa, 3)).toEqual([
      {
        platformProductId: 'PRD-1', namaProduk: null, gmv: null, gmvDariKreator: null, gmvVideoPenjual: null,
        gmvLivePenjual: null, pesananSku: null, impresi: null, klik: null, ctr: null, ctor: null,
      },
    ]);
  });

  it('konvensi Seller Center (bukan Ads Manager) — titik ribuan/koma desimal TIDAK diasumsikan', () => {
    const aoa = ttProductAnalyticsAoa([
      ['Produk A', 'PRD-1', '1000000.5', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    ]);
    expect(ekstrakBarisTtProductAnalytics(aoa, 4)[0].gmv).toBe(1000000.5);
  });

  // G2-01-KUADRAN-SKU lanjutan (bagian laporan "produk") — 'Nama' DIPETAKAN
  // sejak sesi ini, disalin LANGSUNG (bukan lookup, TAMPILAN UI SAJA Rule 20).
  it('"Nama" dipetakan ke namaProduk, sel kosong ⇒ null (bukan string kosong)', () => {
    const aoa = ttProductAnalyticsAoa([
      ['  Kaos Polos Hitam  ', 'PRD-1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
      ['', 'PRD-2', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    ]);
    const hasil = ekstrakBarisTtProductAnalytics(aoa, 4);
    expect(hasil[0].namaProduk).toBe('Kaos Polos Hitam'); // trimmed
    expect(hasil[1].namaProduk).toBeNull();
  });
});

const HEADER_SHOPEE_KESEHATAN = ['Poin Penalti', 'Deskripsi', 'Durasi'];

describe('ekstrakBarisKesehatanShopee (G2-01-SHOPEE-KESEHATAN-WRITER)', () => {
  it('memetakan satu baris penalti lengkap', () => {
    const aoa = [
      HEADER_SHOPEE_KESEHATAN,
      ['2', 'Kualitas produk buruk', '30 hari'],
    ];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([
      { poin: 2, deskripsi: 'Kualitas produk buruk', durasi: '30 hari' },
    ]);
  });

  it('beberapa baris penalti dijumlahkan pemanggil (fungsi ini hanya mengembalikan daftar apa adanya)', () => {
    const aoa = [
      HEADER_SHOPEE_KESEHATAN,
      ['1', 'Pelanggaran A', '7 hari'],
      ['2', 'Pelanggaran B', '30 hari'],
    ];
    const hasil = ekstrakBarisKesehatanShopee(aoa, 1);
    expect(hasil).toHaveLength(2);
    expect(hasil.reduce((s, x) => s + x.poin, 0)).toBe(3);
  });

  it('sheet TANPA baris data (toko bersih) ⇒ array kosong, BUKAN error', () => {
    const aoa = [HEADER_SHOPEE_KESEHATAN];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([]);
  });

  it('baris ber-"Poin Penalti" DAN "Deskripsi" kosong dilewati (baris kosong sungguhan)', () => {
    const aoa = [HEADER_SHOPEE_KESEHATAN, ['', '', '']];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([]);
  });

  it('"Poin Penalti" = 0 TAPI Deskripsi terisi TETAP baris sah (0 bukan "kosong")', () => {
    const aoa = [HEADER_SHOPEE_KESEHATAN, ['0', 'Peringatan tanpa poin', '-']];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([
      { poin: 0, deskripsi: 'Peringatan tanpa poin', durasi: '-' },
    ]);
  });

  it('kolom "Durasi" hilang ⇒ string kosong untuk field itu, bukan error', () => {
    const aoa = [['Poin Penalti', 'Deskripsi'], ['2', 'Pelanggaran']];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([
      { poin: 2, deskripsi: 'Pelanggaran', durasi: '' },
    ]);
  });
});

const HEADER_SHOPEE_CHAT = [
  'Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata', 'CSAT %',
  'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)',
];

describe('ekstrakBarisLayananChatShopee (G3-02a)', () => {
  it('memetakan satu baris ringkasan lengkap, angka format Seller Center', () => {
    const aoa = [
      HEADER_SHOPEE_CHAT,
      ['01/08/2026 - 31/08/2026', '1.234', '200', '180', '95', '4,8', '50', '15.000.000', '25,5'],
    ];
    expect(ekstrakBarisLayananChatShopee(aoa, 1)).toEqual([
      {
        pengunjung: 1234,
        chatMasuk: 200,
        chatDibalas: 180,
        waktuResponDetik: 95,
        csatPersen: 4.8,
        totalPesanan: 50,
        penjualan: 15000000,
        tingkatKonversiChatDibalas: 25.5,
      },
    ]);
  });

  it('sheet TANPA baris data ⇒ array kosong, BUKAN error', () => {
    const aoa = [HEADER_SHOPEE_CHAT];
    expect(ekstrakBarisLayananChatShopee(aoa, 1)).toEqual([]);
  });

  it('baris ber-"Periode Waktu" kosong dilewati (bukan baris data sungguhan)', () => {
    const aoa = [HEADER_SHOPEE_CHAT, ['', '', '', '', '', '', '', '', '']];
    expect(ekstrakBarisLayananChatShopee(aoa, 1)).toEqual([]);
  });

  it('kolom hilang ⇒ null untuk field itu, bukan error (mis. sample tanpa CSAT)', () => {
    const aoa = [
      ['Periode Waktu', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata'],
      ['Agu 2026', '100', '90', '120'],
    ];
    const hasil = ekstrakBarisLayananChatShopee(aoa, 1);
    expect(hasil).toEqual([
      {
        pengunjung: null,
        chatMasuk: 100,
        chatDibalas: 90,
        waktuResponDetik: 120,
        csatPersen: null,
        totalPesanan: null,
        penjualan: null,
        tingkatKonversiChatDibalas: null,
      },
    ]);
  });

  it('"Tingkat Konversi (Chat Dibalas)" disimpan apa adanya, TIDAK dipakai sebagai response rate', () => {
    // Response rate sungguhan (chatDibalas/chatMasuk = 180/200 = 90%) berbeda dari
    // "Tingkat Konversi (Chat Dibalas)" (25,5% di sample) — dua kolom semantiknya beda,
    // pemanggil (pdt-prefill.ts) TIDAK boleh membaca kolom ini sebagai response rate.
    const aoa = [
      HEADER_SHOPEE_CHAT,
      ['Agu 2026', '1.000', '200', '180', '95', '4,8', '50', '15.000.000', '25,5'],
    ];
    const hasil = ekstrakBarisLayananChatShopee(aoa, 1)[0];
    const chatDibalas = hasil.chatDibalas ?? NaN;
    const chatMasuk = hasil.chatMasuk ?? NaN;
    expect(chatDibalas).toBe(180);
    expect(chatMasuk).toBe(200);
    expect(hasil.tingkatKonversiChatDibalas).toBe(25.5);
    expect(hasil.tingkatKonversiChatDibalas).not.toBe((chatDibalas / chatMasuk) * 100);
  });
});

// ===========================================================================
// Sesi 43 — header PERSIS dari berkas nyata pemilik (tiga ZIP: "Sample shopee 5
// client", "Sample tiktok 5 client", "Sample nama asli"). Fixture di atas
// memakai ejaan WHITELIST; blok ini memakai ejaan BERKAS. Keduanya wajib lulus:
// itulah arti alias Rule 9 "dua ejaan hidup berdampingan", dan itu pula yang
// memisahkan alias yang benar-benar bekerja dari alias yang hanya menghijaukan
// `parse_status` tanpa membuat kolomnya terbaca.
// ===========================================================================
describe('ejaan kolom berkas nyata (sesi 43) — alias Rule 9 terbaca EKSTRAKTOR, bukan cuma validasi', () => {
  it('shopee_ads_live: "Omzet Penjualan" (6/6 ekspor nyata) DAN "Omzet" (alias) sama-sama terbaca', () => {
    // Header PERSIS baris 7 `[ads]-Live && SP && …csv` (kelima klien identik,
    // dan sama dengan `Data-Semua-Iklan-Live-*.csv` Fim Motor).
    const headerNyata = [
      'Urutan', 'Nama Iklan', 'ID Iklan', 'Status', 'Tujuan', 'Tanggal Mulai', 'Tanggal Selesai',
      'Waktu Mulai Harian', 'Waktu Berakhir Harian', 'Modal', 'Penonton', 'Pesanan',
      'Tingkat konversi', 'Omzet Penjualan', 'Biaya', 'Efektifitas Iklan',
    ];
    const baris = ['1', 'Live Sore', 'AD-1', 'Berjalan', 'Live GMV Max Auto', '01/07/2026', '-',
      '00:00', '23:59', '500000', '1000', '20', '2%', '2000000', '150000', '13.33'];
    const [nyata] = ekstrakBarisShopeeAdsLive([headerNyata, baris], 1);
    expect(nyata.gmv).toBe(2000000);
    expect(nyata.biaya).toBe(150000);

    // Ejaan lama lewat alias — nilai yang SAMA, bukan null.
    const headerLama = headerNyata.map((c) => (c === 'Omzet Penjualan' ? 'Omzet' : c));
    expect(ekstrakBarisShopeeAdsLive([headerLama, baris], 1)[0].gmv).toBe(2000000);
  });

  it('tt_product_analytics: "CTOR (pesanan SKU)" (6/6 ekspor nyata) DAN "CTOR" (alias) sama-sama terbaca', () => {
    // Sub-himpunan header `[bisnis]-Analitik produk`/`product_list_20260701.xlsx`
    // dengan ejaan bersufiks yang sebenarnya. `CTR` polos memang kolom terpisah.
    const headerNyata = ['Nama', 'ID Produk', 'Status daftar produk', 'GMV', 'GMV dari LIVE penjual',
      'GMV dari video penjual', 'GMV dari kreator', 'Pesanan SKU', 'AOV (pesanan SKU)',
      'Impresi produk', 'Klik produk', 'CTR', 'CTOR (pesanan SKU)'];
    const baris = ['Produk A', '170123', 'Aktif', '10945407', '500000', '1000000', '2000000',
      '30', '183173', '832842', '27208', '3.51%', '0.40%'];
    const [nyata] = ekstrakBarisTtProductAnalytics([headerNyata, baris], 1);
    // `parsePdtAngka` mengubah persen jadi PECAHAN (0,40% -> 0.004) — konvensi yang
    // sudah dipakai seluruh modul, bukan sesuatu yang berubah di tiket ini.
    expect(nyata.ctor).toBe(0.004);
    expect(nyata.ctr).toBe(0.0351);
    expect(nyata.gmv).toBe(10945407);

    const headerLama = headerNyata.map((c) => (c === 'CTOR (pesanan SKU)' ? 'CTOR' : c));
    expect(ekstrakBarisTtProductAnalytics([headerLama, baris], 1)[0].ctor).toBe(0.004);
  });

  it('shopee_kesehatan: "Poin Pinalti"/"Pinalti Berjalan" (5/5 ekspor nyata) terbaca lewat alias', () => {
    // Header PERSIS `[bisnis]-Kesehatan && …xlsx` — TIGA kolom, dan tidak satu pun
    // memakai ejaan whitelist ('Poin Penalti'/'Deskripsi').
    const aoa = [
      ['Poin Pinalti', 'Pinalti Berjalan', 'Durasi'],
      ['2', 'Tingginya tingkat pesanan tidak terselesaikan', '14 hari'],
    ];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([
      { poin: 2, deskripsi: 'Tingginya tingkat pesanan tidak terselesaikan', durasi: '14 hari' },
    ]);
  });

  it('shopee_kesehatan: ejaan whitelist lama tetap terbaca (alias append-only, bukan pengganti)', () => {
    const aoa = [['Poin Penalti', 'Deskripsi', 'Durasi'], ['1', 'Pelanggaran larangan produk', '7 hari']];
    expect(ekstrakBarisKesehatanShopee(aoa, 1)).toEqual([
      { poin: 1, deskripsi: 'Pelanggaran larangan produk', durasi: '7 hari' },
    ]);
  });

  it('tt_live: alias "Nama panggilan" akhirnya terbaca ekstraktor (laten sejak seed alias pertama)', () => {
    // Alias ini sudah ada di `PDT_KOLOM_ALIAS` sejak G1-02, tapi sebelum sesi 43
    // `ekstrakBarisTtLive` memakai exact-match sendiri — jadi berkas ber-'Nama
    // panggilan' LULUS validasi lalu menulis `creator_handle` NULL. Gagal senyap.
    const headerAlias = ['ID Kreator', 'Nama panggilan', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Penonton'];
    const baris = ['6916141288326202370', 'bidanku.afita', '2026/07/31/ 19:06', '2h 53min', '556308', '7048'];
    const [hasil] = ekstrakBarisTtLive([headerAlias, baris], 1, null);
    expect(hasil.creatorHandle).toBe('bidanku.afita');
  });
});

describe('invarian alias (sesi 43) — setiap modul ber-alias WAJIB punya ekstraktor sadar-alias', () => {
  it('tidak ada modul ber-alias yang ekstraktornya masih exact-match sendiri', () => {
    // Menjaga kelas bug lapis-kedua supaya tidak lahir lagi: alias yang hanya
    // dibaca `validasiKolomWajib` menaikkan `parse_status` ke 'ok' TANPA membuat
    // kolomnya terbaca. Daftar di bawah adalah satu-satunya pengecualian yang
    // SAH — modul yang kolom ber-aliasnya memang tidak pernah dibaca ekstraktor
    // mana pun (jadi tidak ada yang bisa gagal senyap). Menambah alias untuk
    // modul di luar daftar ini WAJIB disertai `pencariKolom` di ekstraktornya.
    const DILAYANI_PENCARI_KOLOM = new Set(['shopee_ads_live', 'tt_live', 'tt_product_analytics', 'shopee_kesehatan']);
    const TANPA_KONSUMEN_EKSTRAKTOR = new Set([
      'tt_shop_analytics', // alias 'GMV LIVE penjual'/'GMV tidak langsung dari LIVE penjual' — ekstrakBarisShopDailyTiktok tidak membaca kolom itu
      'shopee_parent_sku', // alias 'Total Penjualan'/'Tingkat Konversi Pesanan'/'repeat order' — ekstrakBarisSkuMasterShopeeParentSku hanya membaca kolom identitas
      'meta_ads', // nol writer fakta (wajib:false, audit kolom saja)
    ]);
    const modulBerAlias = new Set(PDT_KOLOM_ALIAS.map((a) => a.modulKode));
    for (const kode of modulBerAlias) {
      expect(
        DILAYANI_PENCARI_KOLOM.has(kode) || TANPA_KONSUMEN_EKSTRAKTOR.has(kode),
        `modul '${kode}' punya alias tapi tidak terdaftar di salah satu himpunan — ` +
          'tambahkan `pencariKolom` di ekstraktornya, atau catat di sini kenapa ia tidak punya konsumen',
      ).toBe(true);
    }
  });

  it('setiap alias menunjuk kolom kanonik yang BENAR-BENAR ada di kolomDipanen modulnya', () => {
    // Alias yang kolom kanoniknya salah ketik tidak pernah bisa dipakai — ia
    // lolos review karena bentuknya benar, lalu diam selamanya.
    for (const a of PDT_KOLOM_ALIAS) {
      const modul = PDT_MODULES.find((m) => m.kode === a.modulKode);
      expect(modul, `alias menunjuk modul tak dikenal: ${a.modulKode}`).toBeDefined();
      expect(
        modul!.kolomDipanen,
        `alias '${a.alias}' menunjuk kolom kanonik '${a.kolomKanonik}' yang tidak ada di kolomDipanen ${a.modulKode}`,
      ).toContain(a.kolomKanonik);
    }
  });
});
