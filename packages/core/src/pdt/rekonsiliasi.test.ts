import { describe, expect, it } from 'vitest';
import {
  AMBANG_REKONSILIASI_PERSEN,
  hitungDeltaPersen,
  parseShopeeShopStatsBasisTerisolasi,
  parseTiktokShopAnalytics,
  rekonsiliasiGmvPesanan,
  sumShopeeParentSkuGmv,
  sumTiktokProductAnalyticsGmv,
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

/**
 * Fixture SUNGGUHAN — `Shop Analytics_Key metrics_20260810.xlsx` dari sample
 * asli "Tiktok - Avitaskin.zip" (G1-07-TIKTOK-REKONSILIASI). Baris 0 preamble
 * `'Tanggal analisis: ...'`, baris 1 `'Ringkasan data'`, baris 2 header (28
 * kolom asli, disingkat ke yang relevan tes ini), baris 3 `'Total nilai'` —
 * angka SAMA PERSIS dengan file asli (GMV 26.560.049, Pesanan SKU 145).
 */
const AVITASKIN_SHOP_ANALYTICS: readonly (readonly unknown[])[] = [
  ['Tanggal analisis: 01/07/2026–31/07/2026'],
  ['Ringkasan data'],
  ['', 'GMV', 'Pesanan', 'Pembeli', 'Produk terjual', 'Pengembalian dana', 'Pesanan SKU', 'Pendapatan bruto', 'Tayangan halaman', 'Pengunjung'],
  ['Total nilai', '26560049', '143', '137', '147', '334640', '145', '28175046', '27238', '20627'],
  ['Perubahan persentase', '1.41%', '0.00%', '3.79%', '-0.68%', '62.08%', '-2.03%', '-2.02%', '7.10%', '5.86%'],
];

describe('parseTiktokShopAnalytics — Avitaskin (Shop Analytics_Key metrics, sample asli)', () => {
  it('membaca ringkasan periode (baris tepat sesudah header), bukan baris "Perubahan persentase"', () => {
    expect(parseTiktokShopAnalytics(AVITASKIN_SHOP_ANALYTICS, 3)).toEqual({ gmv: 26560049, pesanan: 145 });
  });

  it('null bila header tidak membawa kolom GMV/Pesanan SKU yang dikenal (bukan sheet tt_shop_analytics)', () => {
    const aoa = [
      ['ID Produk', 'Nama'],
      ['P1', 'Produk A'],
    ];
    expect(parseTiktokShopAnalytics(aoa, 1)).toBeNull();
  });

  it('null bila baris ringkasan tidak ada (header di baris terakhir aoa)', () => {
    expect(parseTiktokShopAnalytics([AVITASKIN_SHOP_ANALYTICS[2]], 1)).toBeNull();
  });
});

describe('sumTiktokProductAnalyticsGmv — header BERULANG per kelompok kategori (bentuk asli product_list_20260701.xlsx)', () => {
  // Bentuk asli: kolom 'GMV'/'Pesanan SKU' MUNCUL LEBIH DARI SEKALI di baris header (grand
  // total kelompok 'Semua' DI DEPAN, breakdown per kategori LIVE/video/afiliasi MENYUSUL
  // dengan label kolom yang SAMA) — findIndex kecocokan PERTAMA harus mengambil kolom di
  // bawah 'Semua', bukan breakdown. Dua baris data ANGKA ASLI dari sample (Avitaskin
  // "[ BUNDLING ] ... Face Wash, Day Cream dan Night Cream" / "... 1 Paket Isi 5").
  const HEADER_BERULANG = ['Nama', 'ID Produk', 'GMV', 'Pesanan SKU', 'GMV dari LIVE penjual', 'GMV', 'Pesanan SKU'];

  it('menjumlah kolom GMV/Pesanan SKU PERTAMA (grand total "Semua"), mengabaikan breakdown yang berlabel sama', () => {
    const aoa = [
      HEADER_BERULANG,
      ['[ BUNDLING ] Avitaskin Glow & Brightening Series Face Wash, Day Cream dan Night Cream', 'P1', '10945407', '57', '0', '999999999', '999'],
      ['[ BUNDLING ] Avitaskin Beauty Care Glow & Brightening Series 1 Paket Isi 5', 'P2', '8769094', '27', '0', '999999999', '999'],
    ];
    expect(sumTiktokProductAnalyticsGmv(aoa, 1)).toEqual({ gmv: 10945407 + 8769094, pesanan: 57 + 27 });
  });

  it('0/0 bila kolom GMV/Pesanan SKU tidak ditemukan', () => {
    expect(sumTiktokProductAnalyticsGmv([['Kolom Lain'], ['isi']], 1)).toEqual({ gmv: 0, pesanan: 0 });
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

  // G1-07-SHOPEE-DOBEL-HITUNG (docs/DECISIONS.md 2026-09-18): bentuk asli
  // parentskudetail.xlsx HIERARKIS — satu baris "parent" per produk
  // (Kode Variasi = '-', total produk) diikuti baris varian di bawahnya
  // (Kode Variasi terisi, kontribusi varian itu sendiri). Angka di bawah
  // REPRODUKSI PERSIS sample asli Fim Motor (satu produk dua varian dari
  // `parentskudetail.20260701_20260731.xlsx`, dibulatkan agar ringkas):
  // produk Rp600jt/Rp560jt SAJA, terurai jadi varian A Rp350jt/Rp330jt +
  // varian B Rp250jt/Rp230jt (350+250=600, 330+230=560 — varian menjumlah
  // PERSIS ke baris parent-nya, persis pola hierarkis file asli).
  describe('baris hierarkis (parent + varian) — G1-07-SHOPEE-DOBEL-HITUNG', () => {
    const aoaHierarkis = [
      ['Kode Produk', 'Kode Variasi', 'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)'],
      ['SKU-A', '-', 'Rp600.000.000', 'Rp560.000.000'], // parent: total produk
      ['SKU-A', 'VAR-A1', 'Rp350.000.000', 'Rp330.000.000'], // varian 1
      ['SKU-A', 'VAR-A2', 'Rp250.000.000', 'Rp230.000.000'], // varian 2
      ['SKU-B', '-', 'Rp400.000.000', 'Rp380.000.000'], // parent tanpa varian tercantum terpisah
    ];

    it('menjumlah HANYA baris parent (Kode Variasi = "-"), mengabaikan baris varian di bawahnya', () => {
      expect(sumShopeeParentSkuGmv(aoaHierarkis, 'Total Penjualan (Pesanan Dibuat) (IDR)')).toBe(600_000_000 + 400_000_000);
      expect(sumShopeeParentSkuGmv(aoaHierarkis, 'Penjualan (Pesanan Siap Dikirim) (IDR)')).toBe(560_000_000 + 380_000_000);
    });

    it('TANPA kolom Kode Variasi ⇒ jatuh ke perilaku lama (jumlah semua baris)', () => {
      const tanpaKolomVariasi = aoaHierarkis.map((row) => [row[0], row[2], row[3]]);
      expect(sumShopeeParentSkuGmv(tanpaKolomVariasi, 'Total Penjualan (Pesanan Dibuat) (IDR)')).toBe(
        600_000_000 + 350_000_000 + 250_000_000 + 400_000_000,
      );
    });
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
