import { describe, expect, it } from 'vitest';
import { evaluasiAcosShopee, evaluasiKreatorAktifShopee, evaluasiRoasShopee, tentukanVerdict, type PdtVerdictBenchmarkShopee } from './verdict';

const BENCH: PdtVerdictBenchmarkShopee = { roasGood: 4, acosGood: 0.25 };

describe('evaluasiRoasShopee', () => {
  it('ROAS di bawah roas_good ⇒ menyala, target = roas_good', () => {
    const hasil = evaluasiRoasShopee(6_000_000, 3_000_000, BENCH); // 2x
    expect(hasil).toEqual({
      kodeAksi: 'SHP-ROAS', menyala: true, nilaiSekarang: 2, satuanSekarang: 'rasio',
      targetNilai: 4, satuanTarget: 'rasio', arah: 'naik',
    });
  });

  it('ROAS >= roas_good ⇒ tidak menyala', () => {
    const hasil = evaluasiRoasShopee(20_000_000, 4_000_000, BENCH); // 5x
    expect(hasil?.menyala).toBe(false);
    expect(hasil?.nilaiSekarang).toBe(5);
  });

  it('Σbiaya = 0 ⇒ null (Rule 7 — pembagian nol tidak pernah dihitung)', () => {
    expect(evaluasiRoasShopee(1_000_000, 0, BENCH)).toBeNull();
  });
});

describe('evaluasiAcosShopee', () => {
  it('ACoS di atas acos_good ⇒ menyala, target = acos_good', () => {
    const hasil = evaluasiAcosShopee(1_500_000, 3_000_000, BENCH); // 0.5
    expect(hasil).toEqual({
      kodeAksi: 'SHP-ACOS', menyala: true, nilaiSekarang: 0.5, satuanSekarang: 'persen',
      targetNilai: 0.25, satuanTarget: 'persen', arah: 'turun',
    });
  });

  it('ACoS <= acos_good ⇒ tidak menyala', () => {
    const hasil = evaluasiAcosShopee(500_000, 5_000_000, BENCH); // 0.1
    expect(hasil?.menyala).toBe(false);
  });

  it('Σgmv = 0 ⇒ null', () => {
    expect(evaluasiAcosShopee(500_000, 0, BENCH)).toBeNull();
  });
});

describe('evaluasiKreatorAktifShopee', () => {
  it('nol kreator aktif ⇒ menyala, target = 1 (keluar dari nol)', () => {
    expect(evaluasiKreatorAktifShopee(0)).toEqual({
      kodeAksi: 'SHP-KREATOR-AKTIF', menyala: true, nilaiSekarang: 0, satuanSekarang: 'hitungan',
      targetNilai: 1, satuanTarget: 'hitungan', arah: 'naik',
    });
  });

  it('minimal satu kreator aktif ⇒ tidak menyala', () => {
    expect(evaluasiKreatorAktifShopee(1).menyala).toBe(false);
    expect(evaluasiKreatorAktifShopee(7).menyala).toBe(false);
  });
});

describe('tentukanVerdict', () => {
  it('planRef null ⇒ tidak_dikerjakan, apa pun realisasinya', () => {
    expect(tentukanVerdict(null, 10, 4, 'naik')).toBe('tidak_dikerjakan');
    expect(tentukanVerdict(null, 0, 4, 'naik')).toBe('tidak_dikerjakan');
  });

  it('planRef ada, arah naik, realisasi >= target ⇒ tercapai', () => {
    expect(tentukanVerdict('PLAN-1', 4, 4, 'naik')).toBe('tercapai');
    expect(tentukanVerdict('PLAN-1', 5, 4, 'naik')).toBe('tercapai');
  });

  it('planRef ada, arah naik, realisasi < target ⇒ gagal', () => {
    expect(tentukanVerdict('PLAN-1', 3, 4, 'naik')).toBe('gagal');
  });

  it('planRef ada, arah turun, realisasi <= target ⇒ tercapai', () => {
    expect(tentukanVerdict('PLAN-1', 0.25, 0.25, 'turun')).toBe('tercapai');
    expect(tentukanVerdict('PLAN-1', 0.1, 0.25, 'turun')).toBe('tercapai');
  });

  it('planRef ada, arah turun, realisasi > target ⇒ gagal', () => {
    expect(tentukanVerdict('PLAN-1', 0.4, 0.25, 'turun')).toBe('gagal');
  });
});
