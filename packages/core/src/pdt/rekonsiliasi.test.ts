import { describe, expect, it } from 'vitest';
import {
  AMBANG_REKONSILIASI_PERSEN,
  hitungDeltaPersen,
  parseShopeeShopStatsBasisTerisolasi,
  rekonsiliasiGmvPesanan,
  sumShopeeParentSkuGmv,
} from './rekonsiliasi';

/**
 * Fixture SUNGGUHAN — sheet 'Pesanan Siap Dikirim' persis (isi ATAS dan
 * BAWAH, bukan cuma dua baris pertama) dari `fim_motor.shopee-shop-stats.
 * 20260701-20260731.xlsx` (ZIP kedua pemilik "Shopee - Fim Motor.zip",
 * G1-09-SHOPEESHOPSTATS-BASIS-TOTAL). Baris 0 header, baris 1 ringkasan
 * PERIODE PENUH (`Tanggal` = rentang `01-07-2026-31-07-2026`, BUKAN satu
 * tanggal), baris 2 kosong, baris 3 header BERULANG, baris 4+ rincian
 * harian — angka baris 1 dibuktikan Σ PERSIS dari seluruh baris harian di
 * bawahnya (dihitung ulang dari file asli, bukan ditebak).
 */
const FIM_MOTOR_SHOP_STATS_SIAP_DIKIRIM: readonly (readonly unknown[])[] = [
  ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
    'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
    'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini', 'Total Potensi Pembeli',
    'Tingkat Pembelian Berulang'],
  ['01-07-2026-31-07-2026', '1.515.002.476', '12801', '118.350,32', '552545', '361197', '2,32%', '2016',
    '249.181.974', '140', '24.586.464', '11046', '10461', '585', '51417', '11,35%'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
    'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
    'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini', 'Total Potensi Pembeli',
    'Tingkat Pembelian Berulang'],
  ['01-07-2026', '53.089.166', '438', '121.208,14', '16583', '15095', '2,64%', '56', '6.458.732', '8',
    '1.648.328', '393', '347', '46', '1679', '9,41%'],
  ['02-07-2026', '46.000.168', '387', '118.863,48', '16299', '13964', '2,37%', '61', '7.817.510', '8',
    '1.540.952', '359', '314', '45', '1724', '6,69%'],
];

describe('parseShopeeShopStatsBasisTerisolasi — Fim Motor (sheet asli "Pesanan Siap Dikirim")', () => {
  it('membaca baris ringkasan periode (baris tepat sesudah header), bukan baris harian pertama', () => {
    expect(parseShopeeShopStatsBasisTerisolasi(FIM_MOTOR_SHOP_STATS_SIAP_DIKIRIM)).toEqual({
      gmv: 1515002476,
      pesanan: 12801,
    });
  });

  it('null bila sheet kosong (nol baris ringkasan untuk dibaca)', () => {
    expect(parseShopeeShopStatsBasisTerisolasi([FIM_MOTOR_SHOP_STATS_SIAP_DIKIRIM[0]])).toBeNull();
  });

  it('null bila header tidak membawa kolom GMV/pesanan yang dikenal (bukan sheet shopee_shop_stats)', () => {
    const aoa = [
      ['Kode Produk', 'Kode Variasi'],
      ['SKU-A', 'VAR-A1'],
    ];
    expect(parseShopeeShopStatsBasisTerisolasi(aoa)).toBeNull();
  });

  it('null bila aoa kosong total', () => {
    expect(parseShopeeShopStatsBasisTerisolasi([])).toBeNull();
  });
});

describe('hitungDeltaPersen — reproduksi persis "18,2%" UAT Fim Motor', () => {
  it('Dibuat vs Dibayar = 18,2% (bukti pencampuran basis Rule 15)', () => {
    const delta = hitungDeltaPersen(1624937476, 1329227354);
    expect(Math.round(delta * 10) / 10).toBe(18.2);
  });

  it('basis yang SAMA (Dibuat vs Dibuat) = 0%', () => {
    expect(hitungDeltaPersen(1624937476, 1624937476)).toBe(0);
  });

  it('kedua angka 0 ⇒ 0, bukan NaN', () => {
    expect(hitungDeltaPersen(0, 0)).toBe(0);
  });
});

describe('sumShopeeParentSkuGmv', () => {
  const aoa = [
    ['Kode Produk', 'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)'],
    ['SKU-A', 'Rp600.000.000', 'Rp560.000.000'],
    ['SKU-B', 'Rp400.000.000', 'Rp380.000.000'],
  ];

  it('menjumlah kolom basis Dibuat', () => {
    expect(sumShopeeParentSkuGmv(aoa, 'Total Penjualan (Pesanan Dibuat) (IDR)')).toBe(1_000_000_000);
  });

  it('menjumlah kolom basis Siap Dikirim (kolom BERBEDA, bukan yang sama)', () => {
    expect(sumShopeeParentSkuGmv(aoa, 'Penjualan (Pesanan Siap Dikirim) (IDR)')).toBe(940_000_000);
  });

  it('0 bila kolom tidak ditemukan', () => {
    expect(sumShopeeParentSkuGmv(aoa, 'Kolom Tidak Ada')).toBe(0);
  });
});

describe('rekonsiliasiGmvPesanan (Rule 13-14)', () => {
  const modulOk: readonly { kode: string; parseStatusOk: boolean }[] = [
    { kode: 'shopee_shop_stats', parseStatusOk: true },
    { kode: 'shopee_parent_sku', parseStatusOk: true },
  ];

  it('selisih ≤ 0,5% ⇒ verified (basis SAMA, per-SKU Σ dekat shop-level)', () => {
    const hasil = rekonsiliasiGmvPesanan({
      perSkuGmv: 999_500_000,
      shopLevelGmv: 1_000_000_000,
      perSkuPesanan: 998,
      shopLevelPesanan: 1000,
      modulTerlibat: modulOk,
    });
    expect(hasil.status).toBe('verified');
  });

  it('mencampur basis (Dibuat vs Dibayar, angka Fim Motor persis) ⇒ ditolak, delta 18,2%', () => {
    const hasil = rekonsiliasiGmvPesanan({
      perSkuGmv: 1624937476, // salah kaprah: dianggap "GMV" dari basis Dibuat
      shopLevelGmv: 1329227354, // shop-level basis Dibayar — basis BERBEDA
      perSkuPesanan: 13568,
      shopLevelPesanan: 11071,
      modulTerlibat: modulOk,
    });
    expect(hasil.status).toBe('ditolak');
    if (hasil.status === 'ditolak') {
      // deltaPct = MAX(delta GMV 18,2% ; delta pesanan 18,4%) — dua metrik
      // beda proporsi karena batal/retur menyusutkan pesanan lebih tajam
      // daripada GMV; hitungDeltaPersen(GMV) sendiri diverifikasi = 18,2%
      // persis di describe block di atas.
      expect(Math.round(hasil.deltaPct * 10) / 10).toBe(18.4);
      expect(hasil.pesan).toContain('GMV');
      expect(hasil.pesan).toContain('18.40%');
    }
  });

  it('modul ber-parse_status gagal disebut LEBIH DULU di modulPenyebab', () => {
    const hasil = rekonsiliasiGmvPesanan({
      perSkuGmv: 500_000_000,
      shopLevelGmv: 1_000_000_000,
      perSkuPesanan: 500,
      shopLevelPesanan: 1000,
      modulTerlibat: [
        { kode: 'shopee_shop_stats', parseStatusOk: true },
        { kode: 'shopee_parent_sku', parseStatusOk: false },
      ],
    });
    expect(hasil.status).toBe('ditolak');
    if (hasil.status === 'ditolak') {
      expect(hasil.modulPenyebab[0]).toBe('shopee_parent_sku');
    }
  });

  it('tepat di ambang (0,5%) ⇒ verified — bukan > ambang', () => {
    const hasil = rekonsiliasiGmvPesanan({
      perSkuGmv: 995_000_000,
      shopLevelGmv: 1_000_000_000, // delta persis 0.5%
      perSkuPesanan: 1000,
      shopLevelPesanan: 1000,
      modulTerlibat: modulOk,
    });
    expect(hasil.status).toBe('verified');
  });

  describe('pesanan opsional (G1-09 sub-langkah 2b — G1-07-PERSKU-PESANAN, nol kolom jumlah-pesanan per-SKU terverifikasi)', () => {
    it('kedua sisi pesanan diberikan tapi bukan sebagai `undefined` eksplisit ⇒ perilaku identik pola lama (tetap dibandingkan)', () => {
      const hasil = rekonsiliasiGmvPesanan({
        perSkuGmv: 500_000_000, shopLevelGmv: 1_000_000_000, // GMV jelas jauh > ambang
        perSkuPesanan: 999, shopLevelPesanan: 1000, // pesanan dekat, TIDAK melebihi ambang sendirian
        modulTerlibat: modulOk,
      });
      expect(hasil.status).toBe('ditolak');
      if (hasil.status === 'ditolak') expect(hasil.pesan).toContain('GMV');
    });

    it('perSkuPesanan/shopLevelPesanan tidak diberikan ⇒ verdict HANYA dari GMV, deltaPesananPct null (bukan 0)', () => {
      const hasil = rekonsiliasiGmvPesanan({
        perSkuGmv: 999_500_000, shopLevelGmv: 1_000_000_000, // GMV dalam ambang
        modulTerlibat: modulOk,
      });
      expect(hasil).toEqual({ status: 'verified', deltaGmvPct: expect.any(Number), deltaPesananPct: null });
    });

    it('GMV di luar ambang, pesanan tidak diberikan ⇒ tetap ditolak murni dari GMV (pesanan tidak menyembunyikan kegagalan GMV)', () => {
      const hasil = rekonsiliasiGmvPesanan({
        perSkuGmv: 500_000_000, shopLevelGmv: 1_000_000_000,
        modulTerlibat: modulOk,
      });
      expect(hasil.status).toBe('ditolak');
      if (hasil.status === 'ditolak') expect(hasil.pesan).toContain('GMV');
    });

    it('hanya SATU sisi pesanan diberikan (sisi lain undefined) ⇒ tetap diperlakukan sebagai "tidak diketahui" (bukan dibandingkan dengan 0)', () => {
      const hasil = rekonsiliasiGmvPesanan({
        perSkuGmv: 999_500_000, shopLevelGmv: 1_000_000_000, perSkuPesanan: 1000,
        modulTerlibat: modulOk,
      });
      expect(hasil).toEqual({ status: 'verified', deltaGmvPct: expect.any(Number), deltaPesananPct: null });
    });
  });
});

describe('AMBANG_REKONSILIASI_PERSEN', () => {
  it('adalah 0,5 (Rule 14/PDT-16)', () => {
    expect(AMBANG_REKONSILIASI_PERSEN).toBe(0.5);
  });
});
