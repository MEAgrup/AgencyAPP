import { describe, expect, it } from 'vitest';
import { hitungKolomDipanenBaru, temukanBarisHeader } from './header';

describe('temukanBarisHeader (Rule 7 — dicari, bukan diasumsikan)', () => {
  it('hint yang sudah benar tetap dipakai', () => {
    const aoa = [['Kode Produk', 'GMV dari kreator', 'CTOR'], ['P1', '1000', '0.1']];
    expect(temukanBarisHeader(aoa, ['Kode Produk', 'GMV dari kreator'], 1)).toBe(1);
  });

  it('CSV iklan Shopee: header meleset satu baris dari hint — baris sungguhan menang', () => {
    const aoa = [
      ['ID Toko: 938284780'],
      ['Username: toko-a'],
      ['ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Biaya'], // baris header sungguhan, di baris 3
      ['938284780', '01/07/2026 - 31/07/2026', 'P1', '100', '5000'],
    ];
    // hint PRD/PDT_MODULES untuk shopee_ads_cpc = 8 (jauh meleset dari sample kecil ini)
    expect(temukanBarisHeader(aoa, ['ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Biaya'], 8)).toBe(3);
  });

  it('baris penanda seksi SEBELUM header sungguhan tidak menang (skornya nol)', () => {
    const aoa = [
      ['Pesanan Dibuat'], // penanda seksi — bukan header, nol nama kolom kanonik
      ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan'],
      ['01/07/2026', '1000000', '10'],
    ];
    expect(temukanBarisHeader(aoa, ['Total Penjualan (IDR)', 'Total Pesanan'], 2)).toBe(2);
  });

  it('dua baris seri skornya — yang PALING DEKAT ke hint menang', () => {
    const aoa = [
      ['Kode Produk', 'GMV'], // baris 1, skor 2, jarak dari hint(3) = 2
      ['x', 'y'],
      ['Kode Produk', 'GMV'], // baris 3, skor 2, jarak dari hint(3) = 0 — menang
    ];
    expect(temukanBarisHeader(aoa, ['Kode Produk', 'GMV'], 3)).toBe(3);
  });

  it('tak satu pun baris punya nama kolom dikenal ⇒ kembali ke hint apa adanya', () => {
    const aoa = [['a', 'b'], ['c', 'd']];
    expect(temukanBarisHeader(aoa, ['Kode Produk'], 2)).toBe(2);
  });

  it('aoa kosong ⇒ hint apa adanya (tidak melempar)', () => {
    expect(temukanBarisHeader([], ['Kode Produk'], 5)).toBe(5);
  });

  it('kolomDikenal kosong ⇒ hint apa adanya (tidak ada dasar pencarian)', () => {
    const aoa = [['a', 'b']];
    expect(temukanBarisHeader(aoa, [], 1)).toBe(1);
  });
});

describe('hitungKolomDipanenBaru (Rule 8)', () => {
  it('menghitung kolom whitelist yang ditemukan (exact)', () => {
    const header = ['Kode Produk', 'GMV dari kreator', 'CTOR'];
    const hasil = hitungKolomDipanenBaru(header, ['Kode Produk', 'GMV dari kreator', 'Kolom Hantu']);
    expect(hasil.jumlahDipanen).toBe(2);
  });

  it('kolom whitelist yang ditemukan LEWAT ALIAS tetap dihitung', () => {
    const header = ['GMV LIVE penjual']; // alias lama untuk 'GMV dari LIVE akun tertaut'
    const hasil = hitungKolomDipanenBaru(header, ['GMV dari LIVE akun tertaut'], {
      'GMV dari LIVE akun tertaut': ['GMV LIVE penjual'],
    });
    expect(hasil.jumlahDipanen).toBe(1);
    expect(hasil.kolomBaru).toEqual([]); // alias dikenal — bukan kolom baru
  });

  it('kolomBaru: nama SAJA, bukan nilai — sel di luar whitelist/alias', () => {
    const header = ['Kode Produk', 'Kolom Rahasia Baru', ''];
    const hasil = hitungKolomDipanenBaru(header, ['Kode Produk']);
    expect(hasil.kolomBaru).toEqual(['Kolom Rahasia Baru']); // sel kosong dibuang
  });

  it('kolomBaru dedup dan mempertahankan urutan kemunculan', () => {
    const header = ['X', 'X', 'Y'];
    const hasil = hitungKolomDipanenBaru(header, []);
    expect(hasil.kolomBaru).toEqual(['X', 'Y']);
  });

  it('header kosong ⇒ jumlahDipanen 0, kolomBaru kosong', () => {
    const hasil = hitungKolomDipanenBaru([], ['Kode Produk']);
    expect(hasil).toEqual({ jumlahDipanen: 0, kolomBaru: [] });
  });
});
