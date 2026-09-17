import { describe, expect, it } from 'vitest';
import { kategoriDariSatuanLabel, formatNilaiSatuan, PDT_SATUAN_KATEGORI } from './satuan';

describe('kategoriDariSatuanLabel', () => {
  it('maps every known label to its category, case/whitespace-insensitively', () => {
    expect(kategoriDariSatuanLabel('Rp')).toBe('rupiah');
    expect(kategoriDariSatuanLabel(' rp ')).toBe('rupiah');
    expect(kategoriDariSatuanLabel('rupiah')).toBe('rupiah');
    expect(kategoriDariSatuanLabel('persen')).toBe('persen');
    expect(kategoriDariSatuanLabel('%')).toBe('persen');
    expect(kategoriDariSatuanLabel('jam')).toBe('jam');
    expect(kategoriDariSatuanLabel('Jam Live')).toBe('jam');
    expect(kategoriDariSatuanLabel('hari')).toBe('hari');
    expect(kategoriDariSatuanLabel('views')).toBe('views');
    expect(kategoriDariSatuanLabel('VV')).toBe('views');
    expect(kategoriDariSatuanLabel('x')).toBe('rasio');
    expect(kategoriDariSatuanLabel('rasio')).toBe('rasio');
    expect(kategoriDariSatuanLabel('kali')).toBe('rasio');
  });

  it('defaults unknown/free-text labels to hitungan — never money for an unrecognized unit', () => {
    expect(kategoriDariSatuanLabel('video')).toBe('hitungan');
    expect(kategoriDariSatuanLabel('sesi')).toBe('hitungan');
    expect(kategoriDariSatuanLabel('SKU')).toBe('hitungan');
    expect(kategoriDariSatuanLabel('sku')).toBe('hitungan'); // real live plan_row row (Store Operation), no catalog match
    expect(kategoriDariSatuanLabel('kasus')).toBe('hitungan');
    expect(kategoriDariSatuanLabel('')).toBe('hitungan'); // plan_row.satuan DEFAULT ''
    expect(kategoriDariSatuanLabel('sesuatu yang belum pernah terlihat')).toBe('hitungan');
  });
});

describe('formatNilaiSatuan', () => {
  it('formats each category through its own branch, not a name/division guess', () => {
    expect(formatNilaiSatuan(15000000, 'rupiah')).toBe('Rp. 15.000.000,00');
    expect(formatNilaiSatuan(1.5, 'persen')).toBe('1,5%'); // the CTOR-as-Rupiah bug this ticket closes
    expect(formatNilaiSatuan(20, 'hitungan')).toBe('20'); // the "20 sesi live dicetak Rp 20,00" bug this ticket closes
    expect(formatNilaiSatuan(36, 'jam')).toBe('36 jam');
    expect(formatNilaiSatuan(7, 'hari')).toBe('7 hari');
    expect(formatNilaiSatuan(12000, 'views')).toBe('12.000 views');
    expect(formatNilaiSatuan(1.2, 'rasio')).toBe('1,2x');
  });

  it('null/undefined/NaN render the house dash, never 0 or an error', () => {
    for (const kategori of PDT_SATUAN_KATEGORI) {
      expect(formatNilaiSatuan(null, kategori)).toBe('—');
      expect(formatNilaiSatuan(undefined, kategori)).toBe('—');
      expect(formatNilaiSatuan(NaN, kategori)).toBe('—');
    }
  });
});
