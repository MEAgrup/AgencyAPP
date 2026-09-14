import { describe, expect, it } from 'vitest';
import { ekstrakBarisShopeeAdsLive } from './fakta';

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
