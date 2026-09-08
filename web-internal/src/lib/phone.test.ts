import { describe, expect, it } from 'vitest';
import { toWaNumber, waLink, waSapaan, WA_SAPAAN_DEFAULT } from './phone';

describe('toWaNumber (Feedback Sales #1)', () => {
  it('menormalkan keempat bentuk yang benar-benar diketik tim Sales', () => {
    // Bentuk yang ada di katalog lead hari ini, plus bentuk contoh dari feedback.
    expect(toWaNumber('082121333386')).toBe('6282121333386');
    expect(toWaNumber('+62 821 2133 3386')).toBe('6282121333386');
    expect(toWaNumber('62-821-2133-3386')).toBe('6282121333386');
    expect(toWaNumber('82121333386')).toBe('6282121333386');
  });

  it('membuang pemisah apa pun, bukan hanya spasi dan tanda hubung', () => {
    expect(toWaNumber('(0821) 2133-3386')).toBe('6282121333386');
    expect(toWaNumber('0821.2133.3386')).toBe('6282121333386');
    expect(toWaNumber(' 0821 2133 3386 ')).toBe('6282121333386');
  });

  it('membuang NOL DI DEPAN yang berlebih, bukan cuma satu', () => {
    // Impor CSV pernah menghasilkan bentuk ini.
    expect(toWaNumber('00821 2133 3386')).toBe('6282121333386');
  });

  it('null untuk nomor yang tidak masuk akal — supaya tombolnya tidak dirender', () => {
    // Ini yang paling penting: yang salah harus jadi NULL, bukan nomor tebakan.
    // Tautan WhatsApp ke nomor yang salah lebih buruk daripada tanpa tombol,
    // karena sales mengira pesannya sudah sampai ke lead yang benar.
    expect(toWaNumber('')).toBeNull();
    expect(toWaNumber(null)).toBeNull();
    expect(toWaNumber(undefined)).toBeNull();
    expect(toWaNumber('-')).toBeNull();
    expect(toWaNumber('belum ada')).toBeNull();
    expect(toWaNumber('0')).toBeNull();
    expect(toWaNumber('62')).toBeNull();
    expect(toWaNumber('0812')).toBeNull();                    // terlalu pendek
    expect(toWaNumber('0812121212121212121')).toBeNull();     // di luar E.164
  });

  it('tidak mengubah nomor yang sudah 62… jadi 6262…', () => {
    expect(toWaNumber('6282121333386')).toBe('6282121333386');
    expect(toWaNumber(toWaNumber('082121333386'))).toBe('6282121333386');
  });
});

describe('waLink', () => {
  it('menghasilkan bentuk yang diminta tim Sales', () => {
    expect(waLink('082121333386', 'halo')).toBe(
      'https://api.whatsapp.com/send?phone=6282121333386&text=halo',
    );
  });

  it('memakai sapaan bawaan bila teksnya tidak disebut', () => {
    expect(waLink('082121333386')).toBe(
      `https://api.whatsapp.com/send?phone=6282121333386&text=${WA_SAPAAN_DEFAULT}`,
    );
  });

  it('meng-encode teks — spasi, ampersand dan baris baru tidak boleh memecah URL', () => {
    const link = waLink('082121333386', 'Halo Toko A & B, cek promo?');
    expect(link).toContain('text=Halo%20Toko%20A%20%26%20B%2C%20cek%20promo%3F');
    // `&` di dalam teks tidak boleh terbaca sebagai parameter query baru.
    expect(link?.split('&').length).toBe(2);
  });

  it('null kalau nomornya tidak sah — pemanggil merender nomor apa adanya', () => {
    expect(waLink('-')).toBeNull();
    expect(waLink('')).toBeNull();
    expect(waLink(null)).toBeNull();
  });
});

describe('waSapaan', () => {
  it('menyebut nama lead bila diketahui, dan tidak menempelkan spasi bila tidak', () => {
    expect(waSapaan('Toko Maju')).toBe('Halo Toko Maju');
    expect(waSapaan('  Toko Maju  ')).toBe('Halo Toko Maju');
    expect(waSapaan('')).toBe('Halo');
    expect(waSapaan(null)).toBe('Halo');
    expect(waSapaan(undefined)).toBe('Halo');
  });
});
