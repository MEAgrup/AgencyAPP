import { describe, expect, it } from 'vitest';
import {
  ekstrakBarisKreatorTtTransactionCreator,
  ekstrakBarisShopeeAdsLive,
  ekstrakBarisSkuMasterShopeeParentSku,
  ekstrakBarisSkuMasterTtOrders,
  ekstrakBarisTtVideo,
} from './fakta';

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
