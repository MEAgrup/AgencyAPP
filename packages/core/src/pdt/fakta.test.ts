import { describe, expect, it } from 'vitest';
import { ekstrakBarisShopeeAdsLive, ekstrakBarisTtVideo } from './fakta';

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
