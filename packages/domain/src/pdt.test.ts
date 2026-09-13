/**
 * PDT (Pusat Data Toko) — predikat izin (G1-01).
 *
 * Murni, tanpa DB: ketiga predikat di sini adalah fungsi permission murni
 * (sama seperti `showcase.canKelolaIzinPitch`, yang lingkupnya disalin).
 * Baris di-namespace `ZPDT-`.
 */
import { describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { canKelolaBenchmark, canKirimLaporan, canUploadBatch } from './pdt';

const OWNER = 'ZPDT-AM';
const am = (id = OWNER) => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZPDT-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = () => ({ employeeId: 'ZPDT-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZPDT-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const sales = () => ({ employeeId: 'ZPDT-SALES', role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
/** Director yang kebetulan terpetakan ke divisi lain — haknya dari peran berlapis. */
const directorDiSales = () => ({ employeeId: 'ZPDT-DS', role: permission.makeRole({ division: 'Sales', level: 'staff', director: true }) });

describe('canUploadBatch — AM pemilik klien, atau lead/Director Account', () => {
  it('AM pemilik klien boleh mengunggah batch kliennya', () => {
    expect(canUploadBatch(am(OWNER), OWNER)).toBe(true);
  });

  it('AM lain TIDAK boleh mengunggah batch klien yang bukan miliknya', () => {
    expect(canUploadBatch(am('ZPDT-LAIN'), OWNER)).toBe(false);
  });

  it('lead Account boleh, Director (di mana pun terpetakan) membawa lead', () => {
    expect(canUploadBatch(accountLead(), OWNER)).toBe(true);
    expect(canUploadBatch(director(), OWNER)).toBe(true);
    expect(canUploadBatch(directorDiSales(), OWNER)).toBe(true);
  });

  it('OD murni (bukan Director) TIDAK boleh mengunggah batch klien orang lain', () => {
    expect(canUploadBatch(od(), OWNER)).toBe(false);
  });

  it('divisi Sales TIDAK boleh mengunggah batch PDT', () => {
    expect(canUploadBatch(sales(), OWNER)).toBe(false);
  });

  it('klien tanpa AM (ownerAm null) TIDAK bisa diunggah siapa pun kecuali lead/Director', () => {
    expect(canUploadBatch(am(OWNER), null)).toBe(false);
    expect(canUploadBatch(accountLead(), null)).toBe(true);
  });
});

describe('canKelolaBenchmark — Director SAJA (bukan OD murni)', () => {
  it('Director boleh mengelola kalibrasi', () => {
    expect(canKelolaBenchmark(director())).toBe(true);
  });

  it('OD murni, lead Account, dan AM biasa TIDAK boleh', () => {
    expect(canKelolaBenchmark(od())).toBe(false);
    expect(canKelolaBenchmark(accountLead())).toBe(false);
    expect(canKelolaBenchmark(am())).toBe(false);
  });
});

describe('canKirimLaporan — lingkup sama seperti canUploadBatch', () => {
  it('AM pemilik klien boleh mengirim laporan kliennya', () => {
    expect(canKirimLaporan(am(OWNER), OWNER)).toBe(true);
  });

  it('AM lain TIDAK boleh mengirim laporan klien yang bukan miliknya', () => {
    expect(canKirimLaporan(am('ZPDT-LAIN'), OWNER)).toBe(false);
  });

  it('lead Account dan Director boleh', () => {
    expect(canKirimLaporan(accountLead(), OWNER)).toBe(true);
    expect(canKirimLaporan(director(), OWNER)).toBe(true);
  });
});
