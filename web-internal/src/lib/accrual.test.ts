/**
 * Tes lapisan data Pengakuan Pendapatan (D-3).
 *
 * Yang diuji hanya hal yang bisa rusak diam-diam di sisi FE — aritmetika
 * uangnya milik server, dan angkanya datang sudah terformat:
 *
 *   1. **`geserBulan` menyeberang tahun.** Pemilih bulan dan penyaring "bulan
 *      yang boleh dikoreksi" dua-duanya dibangun darinya, jadi off-by-one di
 *      Januari akan menawarkan bulan yang salah untuk ditutup.
 *   2. **Tidak ada label yang mengembalikan string kosong.** Sebuah sel kosong
 *      di kolom `sumber` akan membuat "angka beku" dan "masih bisa berubah"
 *      terlihat sama, dan itu justru pertanyaan yang halaman ini ada untuk
 *      menjawabnya.
 *   3. **Kalimat `sumber` menyebut KONSEKUENSINYA**, bukan hanya namanya:
 *      "dihitung" tidak memberi tahu pembacanya bahwa angkanya masih bergerak.
 */
import { describe, expect, it } from 'vitest';
import {
  bulanIni,
  geserBulan,
  labelPengakuan,
  labelSumber,
  PENGAKUAN_LABELS,
  SUMBER_LABELS,
} from './accrual';

describe('geserBulan', () => {
  it('menggeser ke belakang dan ke depan di dalam satu tahun', () => {
    expect(geserBulan('2026-09', -1)).toBe('2026-08');
    expect(geserBulan('2026-09', -8)).toBe('2026-01');
    expect(geserBulan('2026-09', 1)).toBe('2026-10');
  });

  it('menyeberang tahun ke belakang — Januari mundur satu adalah Desember tahun lalu', () => {
    expect(geserBulan('2026-01', -1)).toBe('2025-12');
    expect(geserBulan('2026-01', -13)).toBe('2024-12');
  });

  it('menyeberang tahun ke depan', () => {
    expect(geserBulan('2026-12', 1)).toBe('2027-01');
    expect(geserBulan('2026-12', 13)).toBe('2028-01');
  });

  it('nol adalah identitas', () => {
    expect(geserBulan('2026-09', 0)).toBe('2026-09');
  });

  it('selalu dua digit bulan — `2026-9` akan mengurut salah dan gagal validasi server', () => {
    for (let n = 0; n < 24; n++) {
      expect(geserBulan('2026-01', n)).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    }
  });

  it('dua belas geseran berurutan menghasilkan dua belas bulan yang BERBEDA', () => {
    // Inilah yang dipakai pemilih bulan; satu duplikat berarti satu bulan
    // hilang dari daftar tanpa ada yang menyebutnya.
    const kini = '2026-09';
    const daftar = Array.from({ length: 12 }, (_, i) => geserBulan(kini, -i));
    expect(new Set(daftar).size).toBe(12);
    // …dan terurut menurun, jadi filter `b < bulan` di form koreksi benar.
    expect(daftar).toEqual([...daftar].sort().reverse());
  });
});

describe('bulanIni', () => {
  it('berbentuk YYYY-MM', () => {
    expect(bulanIni()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe('label', () => {
  it('setiap nilai `pengakuan` punya labelnya, dan ketiganya berbeda', () => {
    const semua = ['per_periode', 'saat_selesai', 'bulan_berikutnya'].map(labelPengakuan);
    expect(new Set(semua).size).toBe(3);
    for (const l of semua) {
      expect(l.trim().length).toBeGreaterThan(3);
    }
    expect(Object.keys(PENGAKUAN_LABELS).sort())
      .toEqual(['bulan_berikutnya', 'per_periode', 'saat_selesai']);
  });

  it('nilai `pengakuan` yang tak dikenal dirender apa adanya, bukan string kosong', () => {
    // Kolom yang kosong akan terbaca "tidak ada pengakuan", padahal yang benar
    // adalah "ada nilai yang halaman ini belum tahu namanya".
    expect(labelPengakuan('bulanan')).toBe('bulanan');
  });

  it('kalimat `sumber` menyebut KONSEKUENSINYA, bukan hanya namanya', () => {
    expect(labelSumber('beku')).toMatch(/ditutup/i);
    expect(labelSumber('dihitung')).toMatch(/berubah/i);
    expect(labelSumber('beku')).not.toBe(labelSumber('dihitung'));
    expect(Object.keys(SUMBER_LABELS).sort()).toEqual(['beku', 'dihitung']);
  });

  it('`sumber` yang tak dikenal dirender apa adanya', () => {
    expect(labelSumber('entah')).toBe('entah');
  });
});
