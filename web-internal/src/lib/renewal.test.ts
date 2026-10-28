import { describe, expect, it } from 'vitest';
import {
  JENIS_BAYAR_KOMISI,
  JENIS_CROSS_SELL,
  JENIS_PERPANJANGAN,
  labelJenis,
  QTY_WAJAR_MAKS,
  ringkasanQty,
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

describe('ringkasanQty (feedback Sales 27-10 — nominal diketik di kolom jumlah)', () => {
  const shopeeMall = { standard_price: '6000000.00', pricing_mode: 'flat', unit: 'paket' };

  it('menampilkan harga per unit dan subtotal live untuk jasa flat', () => {
    expect(ringkasanQty(shopeeMall, '2', '')).toEqual({ hargaSatuan: 6000000, subtotal: 12000000, peringatan: null });
  });

  it('jumlah kosong dibaca 1 (sama dengan server)', () => {
    expect(ringkasanQty(shopeeMall, '', '').subtotal).toBe(6000000);
  });

  it('memperingatkan bila jumlah > QTY_WAJAR_MAKS — Rp 12 jt yang diketik sebagai jumlah', () => {
    const r = ringkasanQty(shopeeMall, '12000000', '');
    expect(r.peringatan).toContain('bukan nominal rupiah');
    expect(ringkasanQty(shopeeMall, String(QTY_WAJAR_MAKS), '').peringatan).toBeNull();
  });

  it('memakai harga opsi tenor yang dipilih, dan tidak menebak subtotal untuk mode non-flat', () => {
    const tenor = { ...shopeeMall, durasi_options: [{ durasi_bulan: 1, harga: '6000000' }, { durasi_bulan: 12, harga: '60000000' }] };
    expect(ringkasanQty(tenor, '1', '12').hargaSatuan).toBe(60000000);
    expect(ringkasanQty({ ...shopeeMall, pricing_mode: 'min_floor' }, '5', '').subtotal).toBeNull();
  });
});
