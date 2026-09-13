import { describe, expect, it } from 'vitest';
import { hitungRetensiSampai } from './retensi';

describe('hitungRetensiSampai (Rule 45 — retensi awal saat batch dibuat)', () => {
  it("basis 'default' ⇒ +120 hari dari dariTanggal", () => {
    const hasil = hitungRetensiSampai('default', new Date('2026-07-15T03:00:00Z'));
    expect(hasil).toEqual({ sampai: '2026-11-12', alasan: 'default' });
  });

  it("basis 'ditolak' ⇒ +30 hari, bukan +120", () => {
    const hasil = hitungRetensiSampai('ditolak', new Date('2026-07-15T03:00:00Z'));
    expect(hasil).toEqual({ sampai: '2026-08-14', alasan: 'ditolak' });
  });

  it('lintas pergantian tahun/kabisat dihitung benar (bukan aritmetika string)', () => {
    const hasil = hitungRetensiSampai('default', new Date('2027-11-01T00:00:00Z'));
    expect(hasil.sampai).toBe('2028-02-29'); // 2028 kabisat — +120 hari dari 1 Nov 2027 jatuh 29 Feb
  });

  it('waktu di dalam dariTanggal diabaikan — hanya tanggal kalender UTC yang dipakai', () => {
    const pagi = hitungRetensiSampai('default', new Date('2026-01-01T00:00:01Z'));
    const malam = hitungRetensiSampai('default', new Date('2026-01-01T23:59:59Z'));
    expect(pagi).toEqual(malam);
  });
});
