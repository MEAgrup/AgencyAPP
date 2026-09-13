import { describe, expect, it } from 'vitest';
import { evaluatePdtZipPagar, type PdtZipEntryMeta, type PdtZipPaket } from './zip-pagar';

const entri = (over: Partial<PdtZipEntryMeta> & { nama: string }): PdtZipEntryMeta => ({
  ukuranTerkompresi: 100,
  ukuranAsli: 100,
  terenkripsi: false,
  ...over,
});

const paket = (over: Partial<PdtZipPaket>): PdtZipPaket => ({
  ukuranPaketBytes: 1000,
  entries: [],
  ...over,
});

describe('evaluatePdtZipPagar (G1-04)', () => {
  describe('Rule 42 — gerbang paket, diperiksa SEBELUM entri diklasifikasi', () => {
    it('rejects a package over 50MB, entri kosong (tidak diklasifikasi)', () => {
      const hasil = evaluatePdtZipPagar(
        paket({ ukuranPaketBytes: 50 * 1024 * 1024 + 1, entries: [entri({ nama: 'a.xlsx' })] }),
      );
      expect(hasil.ok).toBe(false);
      expect(hasil.alasanTolakPaket).toBe('ukuran_melebihi_50mb');
      expect(hasil.entri).toEqual([]);
    });

    it('accepts exactly 50MB (batas inklusif)', () => {
      const hasil = evaluatePdtZipPagar(paket({ ukuranPaketBytes: 50 * 1024 * 1024, entries: [] }));
      expect(hasil.ok).toBe(true);
    });

    it('rejects more than 40 entries, entri kosong', () => {
      const banyak = Array.from({ length: 41 }, (_, i) => entri({ nama: `f${i}.xlsx` }));
      const hasil = evaluatePdtZipPagar(paket({ entries: banyak }));
      expect(hasil.ok).toBe(false);
      expect(hasil.alasanTolakPaket).toBe('entri_melebihi_40');
      expect(hasil.entri).toEqual([]);
    });

    it('accepts exactly 40 entries (batas inklusif)', () => {
      const empatpuluh = Array.from({ length: 40 }, (_, i) => entri({ nama: `f${i}.xlsx` }));
      const hasil = evaluatePdtZipPagar(paket({ ukuranPaketBytes: 4000, entries: empatpuluh }));
      expect(hasil.ok).toBe(true);
      expect(hasil.entri).toHaveLength(40);
    });

    it('rejects when total decompression ratio exceeds 100:1 (zip bomb)', () => {
      // Paket 100 bytes, satu entri mengaku 10.001 bytes asli ⇒ rasio > 100.
      const hasil = evaluatePdtZipPagar(
        paket({ ukuranPaketBytes: 100, entries: [entri({ nama: 'a.xlsx', ukuranAsli: 10_001 })] }),
      );
      expect(hasil.ok).toBe(false);
      expect(hasil.alasanTolakPaket).toBe('rasio_dekompresi_melebihi_100x');
      expect(hasil.entri).toEqual([]);
    });

    it('accepts exactly ratio 100:1 (batas inklusif)', () => {
      const hasil = evaluatePdtZipPagar(
        paket({ ukuranPaketBytes: 100, entries: [entri({ nama: 'a.xlsx', ukuranAsli: 10_000 })] }),
      );
      expect(hasil.ok).toBe(true);
    });

    it('does not divide by zero for an empty package', () => {
      const hasil = evaluatePdtZipPagar(paket({ ukuranPaketBytes: 0, entries: [] }));
      expect(hasil.ok).toBe(true);
    });
  });

  describe('Rule 41 — per-entri: ditolak (paket TIDAK ikut gagal)', () => {
    it('rejects a nested zip entry (zip_bersarang)', () => {
      const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama: 'nested.zip' })] }));
      expect(hasil.ok).toBe(true);
      expect(hasil.entri[0].keputusan).toEqual({ kode: 'ditolak', alasan: 'zip_bersarang' });
    });

    it('rejects an encrypted entry', () => {
      const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama: 'a.xlsx', terenkripsi: true })] }));
      expect(hasil.entri[0].keputusan).toEqual({ kode: 'ditolak', alasan: 'terenkripsi' });
    });

    it('rejects an unsupported extension', () => {
      const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama: 'a.pdf' })] }));
      expect(hasil.entri[0].keputusan).toEqual({ kode: 'ditolak', alasan: 'ekstensi_tidak_didukung' });
    });

    it('rejects an entry with no extension at all', () => {
      const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama: 'readme' })] }));
      expect(hasil.entri[0].keputusan).toEqual({ kode: 'ditolak', alasan: 'ekstensi_tidak_didukung' });
    });

    describe('zip-slip', () => {
      it.each([
        '../../../etc/passwd.xlsx',
        'a/../../b.xlsx',
        '/etc/passwd.xlsx',
        'C:\\Windows\\system32\\evil.xlsx',
      ])('rejects escaping path %p', (nama) => {
        const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama })] }));
        expect(hasil.entri[0].keputusan).toEqual({ kode: 'ditolak', alasan: 'zip_slip' });
      });

      it.each(['a/b/../c.xlsx', './a.xlsx', 'a/./b.xlsx'])('accepts a path that stays within root %p', (nama) => {
        const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama })] }));
        expect(hasil.entri[0].keputusan).toEqual({ kode: 'diproses' });
      });
    });
  });

  describe('Rule 41 — per-entri: dilewati TANPA peringatan (junk macOS)', () => {
    it.each(['__MACOSX/a.xlsx', '__MACOSX/._a.xlsx', 'folder/__MACOSX/a.xlsx', '.DS_Store', 'folder/.DS_Store', '._a.xlsx', 'folder/._a.xlsx'])(
      'skips %p silently, not "ditolak"',
      (nama) => {
        const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama })] }));
        expect(hasil.entri[0].keputusan).toEqual({ kode: 'dilewati', alasan: 'macos_junk' });
      },
    );

    it('counts junk entries toward the raw 40-entry cap (cheapest pre-read metric)', () => {
      const junk = Array.from({ length: 41 }, (_, i) => entri({ nama: `__MACOSX/._f${i}.xlsx` }));
      const hasil = evaluatePdtZipPagar(paket({ entries: junk }));
      expect(hasil.ok).toBe(false);
      expect(hasil.alasanTolakPaket).toBe('entri_melebihi_40');
    });
  });

  describe('Rule 41 — happy path: diproses', () => {
    it.each(['a.xlsx', 'a.xls', 'a.csv', 'A.XLSX', 'folder/sub/a.csv'])('accepts %p', (nama) => {
      const hasil = evaluatePdtZipPagar(paket({ entries: [entri({ nama })] }));
      expect(hasil.entri[0].keputusan).toEqual({ kode: 'diproses' });
    });
  });

  it('mirrors the PRD §5 worked example: 15 entries, 2 macOS junk, ratio 1.3:1 ⇒ lolos', () => {
    const entries = [
      ...Array.from({ length: 13 }, (_, i) => entri({ nama: `fim_motor.shopee-${i}.xlsx`, ukuranTerkompresi: 50_000, ukuranAsli: 65_000 })),
      entri({ nama: '__MACOSX/._fim_motor.shopee-0.xlsx', ukuranTerkompresi: 1, ukuranAsli: 1 }),
      entri({ nama: '.DS_Store', ukuranTerkompresi: 1, ukuranAsli: 1 }),
    ];
    const totalAsli = entries.reduce((a, e) => a + e.ukuranAsli, 0);
    const ukuranPaketBytes = Math.round(totalAsli / 1.3);
    const hasil = evaluatePdtZipPagar(paket({ ukuranPaketBytes, entries }));
    expect(hasil.ok).toBe(true);
    const dilewati = hasil.entri.filter((e) => e.keputusan.kode === 'dilewati');
    const diproses = hasil.entri.filter((e) => e.keputusan.kode === 'diproses');
    expect(dilewati).toHaveLength(2);
    expect(diproses).toHaveLength(13);
  });
});
