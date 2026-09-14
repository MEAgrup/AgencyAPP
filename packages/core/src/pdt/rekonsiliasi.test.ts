import { describe, expect, it } from 'vitest';
import {
  AMBANG_REKONSILIASI_PERSEN,
  hitungDeltaPersen,
  parseShopeeShopStatsPerBasis,
  rekonsiliasiGmvPesanan,
  sumShopeeParentSkuGmv,
} from './rekonsiliasi';

/**
 * Fixture Fim Motor SUNGGUHAN (`docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md`
 * §baris 121-128): tiga basis `shopee_shop_stats` real, GMV dan jumlah
 * pesanan PERSIS seperti yang UAT laporkan.
 */
const FIM_MOTOR_SHOP_STATS: readonly (readonly unknown[])[] = [
  ['Pesanan Dibuat'],
  ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan'],
  ['Total', 'Rp1.624.937.476', '13568'],
  [],
  ['Pesanan Siap Dikirim'],
  ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan'],
  ['Total', 'Rp1.515.002.476', '12801'],
  [],
  ['Pesanan Dibayar'],
  ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan'],
  ['Total', 'Rp1.329.227.354', '11071'],
  [],
  // Sheet LAIN di workbook yang sama juga memuat frasa "pesanan dibayar" di
  // nama seksinya (temuan SHP-1 asli) — harus TIDAK tertangkap sebagai
  // section shop-level kedua.
  ['(pesanan dibayar)Asal Penjualan'],
  ['Sumber', 'Persentase'],
  ['Iklan', '40%'],
];

describe('parseShopeeShopStatsPerBasis — Fim Motor (angka nyata UAT)', () => {
  it('membaca ketiga basis persis angka UAT', () => {
    expect(parseShopeeShopStatsPerBasis(FIM_MOTOR_SHOP_STATS)).toEqual({
      dibuat: { gmv: 1624937476, pesanan: 13568 },
      siap_dikirim: { gmv: 1515002476, pesanan: 12801 },
      dibayar: { gmv: 1329227354, pesanan: 11071 },
    });
  });

  it('tidak salah tertangkap oleh sheet "(pesanan dibayar)Asal Penjualan" — hanya SATU section per basis', () => {
    const hasil = parseShopeeShopStatsPerBasis(FIM_MOTOR_SHOP_STATS);
    expect(hasil.dibayar).toEqual({ gmv: 1329227354, pesanan: 11071 });
  });

  it('basis yang section-nya tidak ada di berkas ⇒ absen dari map (bukan 0)', () => {
    const aoa = [
      ['Pesanan Dibuat'],
      ['Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan'],
      ['Total', 'Rp100.000', '5'],
    ];
    const hasil = parseShopeeShopStatsPerBasis(aoa);
    expect(hasil.dibuat).toEqual({ gmv: 100000, pesanan: 5 });
    expect(hasil.siap_dikirim).toBeUndefined();
    expect(hasil.dibayar).toBeUndefined();
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
