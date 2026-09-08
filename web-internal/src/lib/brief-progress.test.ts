/**
 * Tes progres "n dari N" (B-3, dan fondasi render untuk B-1a).
 *
 * Yang diuji di sini bukan formatnya, melainkan CABANG-nya: sebuah Brief
 * "12 video" dengan 3 Aset yang ketiganya selesai tetap `[In Progress]`
 * selamanya karena `allExist = created >= quantity_target`. Kalau `lengkap`
 * salah menghitung, halamannya berhenti mengatakan kenapa statusnya tidak
 * bergerak — dan kekosongan itulah keluhannya (Account #3 & #4), bukan
 * angkanya.
 */
import { describe, expect, it } from 'vitest';
import { hitungProgres, labelProgres, pesanRollupTertahan } from './brief-progress';

describe('hitungProgres', () => {
  it('kasus keluhan aslinya: 3 dari 12 ⇒ BELUM lengkap, sisa 9', () => {
    expect(hitungProgres(3, 12)).toEqual({ created: 3, target: 12, lengkap: false, sisa: 9 });
  });

  it('lengkap tepat di batas, dan tetap lengkap kalau melewatinya', () => {
    // Batas diturunkan dari aturan roll-up yang sebenarnya (`created >= target`),
    // lalu KEDUA sisinya di-expect — bukan hanya sisi yang lolos.
    const target = 12;
    for (const created of [target - 1, target, target + 1]) {
      const harusLengkap = created >= target;
      expect(hitungProgres(created, target).lengkap, `created=${created}`).toBe(harusLengkap);
    }
  });

  it('nol dibuat: lengkap=false, sisa=target penuh', () => {
    expect(hitungProgres(0, 5)).toEqual({ created: 0, target: 5, lengkap: false, sisa: 0 + 5 });
  });

  it('target tak diketahui (0 / negatif / NaN) TIDAK menandai Brief tertahan selamanya', () => {
    for (const target of [0, -3, Number.NaN]) {
      const p = hitungProgres(4, target);
      expect(p.lengkap, `target=${target}`).toBe(true);
      expect(p.target).toBe(0);
      expect(p.sisa).toBe(0);
    }
  });

  it('angka kotor dari wire dinormalkan, tidak diteruskan apa adanya', () => {
    expect(hitungProgres(Number.NaN, 12).created).toBe(0);
    expect(hitungProgres(-2, 12).created).toBe(0);
    expect(hitungProgres(2.7, 12.9)).toEqual({ created: 2, target: 12, lengkap: false, sisa: 10 });
  });
});

describe('labelProgres', () => {
  it('menyebut penyebutnya, karena "3 dibuat" tidak memberi tahu apa pun', () => {
    expect(labelProgres(hitungProgres(3, 12))).toBe('3 dari 12 dibuat');
    expect(labelProgres(hitungProgres(3, 12), 'creator')).toBe('3 dari 12 creator');
  });

  it('tidak mengarang penyebut saat target tak diketahui', () => {
    expect(labelProgres(hitungProgres(3, 0))).toBe('3 dibuat');
  });
});

describe('pesanRollupTertahan', () => {
  it('null saat lengkap — supaya tidak ada kotak peringatan kosong', () => {
    expect(pesanRollupTertahan(hitungProgres(12, 12))).toBeNull();
    expect(pesanRollupTertahan(hitungProgres(3, 0))).toBeNull();
  });

  it('menyebut sisa dan konsekuensinya, bukan hanya "belum lengkap"', () => {
    const pesan = pesanRollupTertahan(hitungProgres(3, 12), 'Aset');
    expect(pesan).toContain('9 lagi');
    expect(pesan).toContain('12 Aset');
    // Kalimat konsekuensinya yang membuat orang berhenti menunggu status berubah.
    expect(pesan).toMatch(/tidak menggerakkan statusnya/);
  });
});
