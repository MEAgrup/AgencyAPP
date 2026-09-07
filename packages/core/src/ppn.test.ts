/**
 * Tes kosakata PPN (D-4). Modul ini nol perhitungan, jadi yang diuji hanya hal
 * yang bisa rusak diam-diam:
 *
 *   1. kosakatanya sama persis dengan yang CHECK `ck_trx_ppn_pilihan` tegakkan
 *      — dua daftar untuk satu kosakata akan berbeda pada perubahan pertama;
 *   2. `null` punya KALIMATNYA SENDIRI dan tidak pernah dirender kosong —
 *      sebuah sel kosong di kolom pajak dibaca sebagai "tidak kena PPN", dan
 *      itu kesimpulan yang berbeda dan mahal;
 *   3. tarifnya masih 11% dan masih SATU tempat — `sales.ts` mengimpornya dari
 *      sini, jadi tes ini juga yang menjaga kalkulator penawaran tidak
 *      diam-diam memakai tarif kedua.
 */
import { describe, expect, it } from 'vitest';
import * as money from './money';
import * as ppn from './ppn';

describe('kosakata', () => {
  it('dua nilai, persis yang ditegakkan CHECK `ck_trx_ppn_pilihan`', () => {
    expect([...ppn.PPN_PILIHAN_SEMUA]).toEqual(['kena', 'tidak_kena']);
  });

  it('menyempitkan hanya string yang sah', () => {
    expect(ppn.isPpnPilihan('kena')).toBe(true);
    expect(ppn.isPpnPilihan('tidak_kena')).toBe(true);
    for (const bad of ['', 'KENA', 'ya', 'true', null, undefined, 0, {}]) {
      expect(ppn.isPpnPilihan(bad)).toBe(false);
    }
  });
});

describe('belum dipilih ≠ tidak kena', () => {
  it('memisahkan ketiadaan pilihan dari pilihan "tidak kena"', () => {
    expect(ppn.belumDipilih(null)).toBe(true);
    expect(ppn.belumDipilih(undefined)).toBe(true);
    expect(ppn.belumDipilih(ppn.PPN_TIDAK_KENA)).toBe(false);
    expect(ppn.belumDipilih(ppn.PPN_KENA)).toBe(false);
  });

  it('merender ketiadaan pilihan sebagai KALIMAT, bukan string kosong', () => {
    // Halaman yang menampilkan '' atau '—' di sini akan terbaca "tidak kena".
    expect(ppn.kalimat(null)).toBe(ppn.PPN_BELUM_DIPILIH_KALIMAT);
    expect(ppn.kalimat(null).length).toBeGreaterThan(3);
    expect(ppn.kalimat(null)).not.toBe(ppn.kalimat(ppn.PPN_TIDAK_KENA));
  });

  it('setiap pilihan punya kalimatnya, dan ketiganya berbeda', () => {
    const semua = [ppn.kalimat(ppn.PPN_KENA), ppn.kalimat(ppn.PPN_TIDAK_KENA), ppn.kalimat(null)];
    expect(new Set(semua).size).toBe(3);
    for (const k of semua) {
      expect(k.trim().length).toBeGreaterThan(3);
    }
  });

  it('penjelasannya menyebut bahwa nilainya BRUTO dan tidak dihitung ulang', () => {
    expect(ppn.PPN_PENJELASAN).toMatch(/BRUTO/);
    expect(ppn.PPN_PENJELASAN).toMatch(/tidak menambah/i);
  });
});

describe('tarif', () => {
  it('masih 11% persen bulat', () => {
    expect(ppn.PPN_TARIF_PEMBILANG).toBe(11n);
    expect(ppn.PPN_TARIF_SKALA).toBe(0);
  });

  it('dipakai `money.percentOf` apa adanya: 1.000.000 -> 110.000', () => {
    // Angka ini adalah cermin `sales.test.ts` ('apply_ppn adds 11% (half-up)'),
    // dan itu disengaja: kalau keduanya berbeda, salah satunya memakai tarif
    // yang bukan tarif ini.
    const base = money.parse('1000000');
    expect(money.decimal(money.percentOf(base, ppn.PPN_TARIF_PEMBILANG, ppn.PPN_TARIF_SKALA)))
      .toBe('110000.00');
  });
});
