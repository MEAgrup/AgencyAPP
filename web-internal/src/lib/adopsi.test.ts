/**
 * Adopsi Sistem (pemilik 2026-09-10, Bagian 1) — bagian `lib/adopsi.ts` yang
 * murni: gerbang layar dan label bulan.
 */
import { describe, expect, it } from 'vitest';
import { canViewAdopsi, labelBulan } from './adopsi';

describe('canViewAdopsi (cermin adopsi.canViewAdopsi)', () => {
  it('OD atau Director saja', () => {
    expect(canViewAdopsi({ od: true })).toBe(true);
    expect(canViewAdopsi({ director: true })).toBe(true);
    expect(canViewAdopsi({})).toBe(false);
    expect(canViewAdopsi(null)).toBe(false);
  });
});

describe('labelBulan', () => {
  it('"YYYYMM" -> nama bulan Indonesia', () => {
    expect(labelBulan('202608')).toBe('Agustus 2026');
    expect(labelBulan('202601')).toBe('Januari 2026');
    expect(labelBulan('202612')).toBe('Desember 2026');
  });

  it('bulan di luar 1..12 dikembalikan apa adanya, bukan dibuat-buat', () => {
    // Data rusak harus terlihat rusak. "Bulan 0 2026" atau `undefined 2026`
    // terbaca seperti bug aplikasi; "202600" terbaca seperti data yang salah,
    // dan yang kedua yang benar.
    expect(labelBulan('202600')).toBe('202600');
    expect(labelBulan('202613')).toBe('202613');
    expect(labelBulan('bukan-periode')).toBe('bukan-periode');
  });
});
