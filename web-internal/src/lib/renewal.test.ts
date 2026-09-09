import { describe, expect, it } from 'vitest';
import {
  JENIS_BAYAR_KOMISI,
  JENIS_CROSS_SELL,
  JENIS_PERPANJANGAN,
  labelJenis,
} from './renewal';

describe('labelJenis (FS-4)', () => {
  it('melabeli ketiga jenis dengan benar', () => {
    expect(labelJenis(JENIS_PERPANJANGAN)).toBe('Perpanjangan');
    expect(labelJenis(JENIS_CROSS_SELL)).toBe('Cross Sell');
    expect(labelJenis(JENIS_BAYAR_KOMISI)).toBe('Bayar Komisi');
  });

  it('TIDAK melabeli jenis ketiga sebagai "Cross Sell" — kelas cacat yang diganti', () => {
    // Bentuk sebelumnya adalah ternary biner:
    //   jenis === PERPANJANGAN ? 'Perpanjangan' : 'Cross Sell'
    // yang akan menyebut setiap jenis baru "Cross Sell": salah, diam, dan
    // hanya terlihat oleh orang yang tahu jenis itu ada.
    expect(labelJenis(JENIS_BAYAR_KOMISI)).not.toBe('Cross Sell');
  });

  it('mengembalikan nilai mentah untuk jenis tak dikenal, bukan menebak', () => {
    expect(labelJenis('jenis_masa_depan')).toBe('jenis_masa_depan');
  });
});
