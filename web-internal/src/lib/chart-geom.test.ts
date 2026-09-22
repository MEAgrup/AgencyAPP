import { describe, expect, it } from 'vitest';
import {
  angkaRingkas,
  batasAtasBulat,
  jalurGaris,
  labelHari,
  potonganDonat,
  skalaLinear,
  tickSumbu,
  warnaSeri,
  WARNA_SERI,
} from './chart-geom';

describe('skalaLinear', () => {
  it('memetakan ujung domain ke ujung rentang', () => {
    const s = skalaLinear(0, 100, 0, 200);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });

  it('menerima rentang terbalik (sumbu Y layar: nilai besar = y kecil)', () => {
    const s = skalaLinear(0, 10, 300, 0);
    expect(s(0)).toBe(300);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(150);
  });

  it('domain nol-lebar ⇒ TENGAH rentang, bukan tepi (garis datar tidak boleh terbaca sebagai nol)', () => {
    const s = skalaLinear(7, 7, 300, 0);
    expect(s(7)).toBe(150);
  });
});

describe('batasAtasBulat', () => {
  it.each([
    [8_437_219, 10_000_000],
    [1_000_000, 1_000_000],
    [1_200_000, 2_000_000],
    [2_100_000, 2_500_000],
    [2_600_000, 5_000_000],
    [5_100_000, 10_000_000],
    [37, 50],
    [0.8, 1],
  ])('batasAtasBulat(%s) = %s', (masuk, keluar) => {
    expect(batasAtasBulat(masuk)).toBe(keluar);
  });

  it('nol/negatif/non-finite ⇒ 1 (sumbu tetap punya tinggi, tidak dibagi nol)', () => {
    expect(batasAtasBulat(0)).toBe(1);
    expect(batasAtasBulat(-5)).toBe(1);
    expect(batasAtasBulat(NaN)).toBe(1);
  });
});

describe('tickSumbu', () => {
  it('membagi rata dari 0 sampai batas bulat, kedua ujung inklusif', () => {
    expect(tickSumbu(8_437_219, 4)).toEqual([0, 2_500_000, 5_000_000, 7_500_000, 10_000_000]);
  });

  it('tick terakhir SELALU ≥ maks (tidak ada data yang keluar kanvas)', () => {
    for (const maks of [1, 37, 999, 1_234_567, 8_437_219]) {
      const t = tickSumbu(maks, 4);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(maks);
    }
  });
});

describe('jalurGaris', () => {
  const sx = (v: number): number => v * 10;
  const sy = (v: number): number => 100 - v;

  it('satu sub-path untuk deret utuh', () => {
    const d = jalurGaris([{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }], sx, sy);
    expect(d).toBe('M0.00,90.00 L10.00,80.00 L20.00,70.00');
  });

  // Inti Rule 12 di sisi visual: garis yang menyambung dua sisi lubang
  // menggambar hari tanpa data seolah trennya mulus di antaranya.
  it('null MEMUTUS garis — sub-path baru, bukan garis lurus melompati lubang', () => {
    const d = jalurGaris([{ x: 0, y: 10 }, { x: 1, y: null }, { x: 2, y: 30 }], sx, sy);
    expect(d).toBe('M0.00,90.00 M20.00,70.00');
    expect(d).not.toContain('L20.00,70.00');
  });

  it('titik terisi yang terkepung lubang tetap punya koordinatnya sendiri', () => {
    const d = jalurGaris([{ x: 0, y: null }, { x: 1, y: 50 }, { x: 2, y: null }], sx, sy);
    expect(d).toBe('M10.00,50.00');
  });

  it('seluruhnya null ⇒ path kosong (komponen menggambar keadaan kosong)', () => {
    expect(jalurGaris([{ x: 0, y: null }, { x: 1, y: null }], sx, sy)).toBe('');
  });

  it('y = 0 adalah nilai SUNGGUHAN, bukan lubang', () => {
    const d = jalurGaris([{ x: 0, y: 0 }, { x: 1, y: 10 }], sx, sy);
    expect(d).toBe('M0.00,100.00 L10.00,90.00');
  });
});

describe('potonganDonat', () => {
  it('fraksi setiap potongan = bagiannya dari total, dan totalnya 1', () => {
    const p = potonganDonat([50, 30, 20], 100, 100, 80, 50);
    expect(p).toHaveLength(3);
    expect(p.map((x) => x.fraksi)).toEqual([0.5, 0.3, 0.2]);
    expect(p.reduce((a, x) => a + x.fraksi, 0)).toBeCloseTo(1, 10);
  });

  it('nilai ≤ 0 dan non-finite dilewati, tidak menggeser fraksi yang lain', () => {
    const p = potonganDonat([50, 0, -10, NaN, 50], 100, 100, 80, 50);
    expect(p).toHaveLength(2);
    expect(p.map((x) => x.fraksi)).toEqual([0.5, 0.5]);
  });

  it('total nol ⇒ array kosong (bukan cincin hampa yang terlihat seperti data)', () => {
    expect(potonganDonat([], 100, 100, 80, 50)).toEqual([]);
    expect(potonganDonat([0, 0], 100, 100, 80, 50)).toEqual([]);
  });

  it('satu nilai ⇒ satu potongan yang tetap tergambar (bukan path kosong 360°)', () => {
    const p = potonganDonat([42], 100, 100, 80, 50);
    expect(p).toHaveLength(1);
    expect(p[0].fraksi).toBe(1);
    expect(p[0].d).toMatch(/^M[\d.,-]+ A80,80 /);
  });

  it('label potongan mendarat di radius TENGAH cincin', () => {
    const [p] = potonganDonat([1], 100, 100, 80, 50);
    const jarak = Math.hypot(p.labelX - 100, p.labelY - 100);
    expect(jarak).toBeCloseTo(65, 6); // (80+50)/2
  });
});

describe('angkaRingkas', () => {
  it.each([
    [0, '0'],
    [850, '850'],
    [850_000, '850 rb'],
    [1_200_000, '1,2 jt'],
    [1_000_000, '1 jt'],
    [2_400_000_000, '2,4 M'],
    [3_000_000_000_000, '3 T'],
    [-1_500_000, '-1,5 jt'],
  ])('angkaRingkas(%s) = %s', (masuk, keluar) => {
    expect(angkaRingkas(masuk)).toBe(keluar);
  });

  it('tidak menempelkan desimal nol yang cuma bising', () => {
    expect(angkaRingkas(2_000_000)).toBe('2 jt');
    expect(angkaRingkas(2_000_000)).not.toContain(',0');
  });

  it('non-finite ⇒ em dash (aturan rumah #7), bukan NaN di sumbu', () => {
    expect(angkaRingkas(NaN)).toBe('—');
    expect(angkaRingkas(Infinity)).toBe('—');
  });
});

describe('labelHari', () => {
  it('mengambil nomor hari tanpa nol di depan', () => {
    expect(labelHari('2026-08-07')).toBe('7');
    expect(labelHari('2026-08-31')).toBe('31');
  });

  it('string yang bukan tanggal dikembalikan apa adanya (tidak mengarang)', () => {
    expect(labelHari('bukan-tanggal')).toBe('bukan-tanggal');
  });
});

describe('warnaSeri', () => {
  it('stabil per indeks — kanal yang sama berwarna sama di setiap laporan', () => {
    expect(warnaSeri(0)).toBe(WARNA_SERI[0]);
    expect(warnaSeri(2)).toBe(WARNA_SERI[2]);
  });

  it('memutar untuk seri yang lebih panjang dari palet, termasuk indeks negatif', () => {
    expect(warnaSeri(WARNA_SERI.length)).toBe(WARNA_SERI[0]);
    expect(warnaSeri(-1)).toBe(WARNA_SERI[WARNA_SERI.length - 1]);
  });
});
