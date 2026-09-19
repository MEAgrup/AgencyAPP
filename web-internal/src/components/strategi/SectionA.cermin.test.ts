/**
 * Kelima cermin Interview (A-1/A-5/A-8/A-10/A-12) harus tetap TERLIPAT dalam
 * satu blok, bukan tersebar lagi di antara field yang bisa diedit.
 *
 * KENAPA TES INI ADA. Sebelum 2026-09-19 kelimanya dirender satu per satu di
 * posisi 1/5/8/10/12 dan memotong alur pengisian AM lima kali — pemilik minta
 * disembunyikan ("AM tidak perlu melihat kolom sama berulang kali"). Menyusun
 * ulangnya kembali menjadi lima kartu terpisah tidak akan memerahkan satu pun
 * tes lain: hasilnya tetap render, tetap type-check, tetap build. Jadi
 * posisinya di-assert di sini.
 *
 * Yang dijaga ada tiga, dan yang ketiga yang paling mudah hilang:
 *
 *  1. Kelimanya dirender lewat SATU `<details>`, dari satu `.map`.
 *  2. Katalog dan nilainya memakai daftar yang sama, sehingga hitungan
 *     "belum diisi" tidak bisa lepas sinkron dari yang dirender.
 *  3. Jumlah yang masih kosong tampil di `<summary>` — tanpa itu, melipat
 *     berarti MENYEMBUNYIKAN pekerjaan yang belum selesai, dan itu persis
 *     kesalahan yang tidak boleh ditukar dengan kerapian.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  join(resolve(__dirname, '..', '..'), 'components', 'strategi', 'SectionA.tsx'),
  'utf8',
);

describe('Section A — cermin Interview terlipat dalam satu blok', () => {
  it('kelima kode ada di katalog, sekali masing-masing', () => {
    // Dipotong dari `}[] = [` — bukan dari `const CERMIN_INTERVIEW`, karena
    // deklarasi TIPE-nya memuat union `'A-1' | 'A-5' | …` dan ikut terhitung.
    const mulai = SRC.indexOf('}[] = [', SRC.indexOf('const CERMIN_INTERVIEW'));
    const katalog = SRC.slice(mulai, SRC.indexOf('];', mulai));
    for (const kode of ['A-1', 'A-5', 'A-8', 'A-10', 'A-12']) {
      expect(katalog.match(new RegExp(`kode: '${kode}'`, 'g')) ?? [], kode).toHaveLength(1);
    }
  });

  it('dirender dari satu .map, bukan lima <InterviewMirror> yang ditulis tangan', () => {
    // Satu-satunya pemakaian <InterviewMirror di JSX adalah di dalam .map.
    const dipakai = SRC.match(/<InterviewMirror\b/g) ?? [];
    expect(dipakai, 'ada <InterviewMirror> di luar .map — cerminnya tersebar lagi').toHaveLength(1);
    expect(SRC).toMatch(/cermin\.map\(\(c\) => \(\s*<InterviewMirror/);
  });

  it('terlipat: <details> membungkusnya, dan tertutup by default (tanpa `open`)', () => {
    const i = SRC.indexOf('<details');
    expect(i, 'tidak ada <details> di Section A').toBeGreaterThan(-1);
    expect(SRC.slice(i, SRC.indexOf('</details>'))).toContain('<InterviewMirror');
    // `<details open>` membatalkan seluruh tujuannya.
    expect(SRC).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it('nilai dan katalog memakai daftar yang sama — hitungan tak bisa lepas sinkron', () => {
    expect(SRC).toMatch(/const cermin = CERMIN_INTERVIEW\.map/);
    expect(SRC).toMatch(/const kosongCermin = cermin\.filter/);
  });

  it('jumlah yang belum diisi tampil di <summary>, jadi melipat tidak menyembunyikan sisa pekerjaan', () => {
    const ringkas = SRC.slice(SRC.indexOf('<summary'), SRC.indexOf('</summary>'));
    expect(ringkas).toContain('kosongCermin');
    expect(ringkas).toContain('belum diisi');
  });
});
