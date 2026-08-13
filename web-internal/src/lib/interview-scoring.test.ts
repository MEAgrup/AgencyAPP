import { describe, expect, it } from 'vitest';
import {
  DAYA_TAHAN_BUDGET,
  HAMBATAN,
  KECEPATAN_APPROVAL,
  KESANGGUPAN_LONJAKAN,
  KESIAPAN_AKSES,
  KUALITAS_DATA,
  MARGIN_BASIS,
  MODEL_BISNIS,
  PEMBEDA_PRODUK,
  PENANGANAN_CHAT,
  RUANG_HARGA,
  SIKLUS_BELI_ULANG,
  SUMBER_ANGKA,
  VERDICT,
  hitungBepRoas,
  hitungKualifikasi,
  hitungVerdict,
  resolveMargin,
  type KualifikasiInput,
} from './interview-scoring';

/**
 * These cases are copied from `packages/core/src/interview.test.ts` on purpose:
 * this file is a PORT of the core scorer, and the only thing that keeps the port
 * honest is asserting the SAME band boundaries and deal-breakers the core asserts.
 * If a case here diverges from core, the live sidebar has drifted from submit.
 */
function perfect(): KualifikasiInput {
  return {
    marginBersih: 35,
    marginBersihSumber: SUMBER_ANGKA.KlienHitung,
    marginKotor: 45,
    aov: 15_000_000n, // Rp150.000
    ruangHarga: RUANG_HARGA.MasihAdaRuang,
    modelBisnis: MODEL_BISNIS.Produsen,
    kesanggupanLonjakan: KESANGGUPAN_LONJAKAN.Sanggup,
    siklusBeliUlang: SIKLUS_BELI_ULANG.HabisPakai,
    pembedaProduk: PEMBEDA_PRODUK.PembedaJelas,
    skuSiap: 30,
    penangananChat: PENANGANAN_CHAT.TimKhusus,
    kecepatanApproval: KECEPATAN_APPROVAL.SatuOrangJelas,
    kesiapanAkses: KESIAPAN_AKSES.Penuh,
    omzet: 100_000_000n,
    targetOmzet: 200_000_000n,
    dayaTahanBudget: DAYA_TAHAN_BUDGET.Enam,
  };
}

describe('perfect client → growth_ready at 100', () => {
  it('scores 100 across the five blocks with no deal-breaker', () => {
    const r = hitungKualifikasi(perfect());
    expect(r.skorPerBlok).toEqual({ A: 30, B: 20, C: 20, D: 15, E: 15 });
    expect(r.skorTotal).toBe(100);
    expect(r.hambatanMendasar).toEqual([]);
    expect(r.verdict).toBe(VERDICT.GrowthReady);
    expect(r.kualitasData).toBe(KUALITAS_DATA.Terverifikasi);
  });
});

describe('C-A2 margin bersih band boundaries (15/20/25/35)', () => {
  const cases: Array<[number, number]> = [
    [35, 12],
    [34, 9],
    [25, 9],
    [24, 6],
    [20, 6],
    [19, 3],
    [15, 3],
  ];
  for (const [margin, poin] of cases) {
    it(`margin ${margin}% → block A margin points ${poin}`, () => {
      const r = hitungKualifikasi({ ...perfect(), marginBersih: margin });
      expect(r.skorPerBlok.A).toBe(poin + 18);
      expect(r.hambatanMendasar).toEqual([]);
    });
  }
});

describe('AOV bands (minor units) 50k/80k/150k', () => {
  const cases: Array<[bigint, number]> = [
    [15_000_000n, 8],
    [8_000_000n, 6],
    [5_000_000n, 4],
    [4_999_999n, 2],
  ];
  for (const [aov, poin] of cases) {
    it(`aov ${aov} minor → AOV points ${poin}`, () => {
      const r = hitungKualifikasi({ ...perfect(), aov });
      expect(r.skorPerBlok.A).toBe(12 + poin + 10);
    });
  }
});

describe('SKU bands 3/10/30', () => {
  const cases: Array<[number, number]> = [
    [30, 5],
    [29, 4],
    [10, 4],
    [9, 2],
    [3, 2],
    [2, 1],
  ];
  for (const [sku, poin] of cases) {
    it(`sku ${sku} → C-C3 points ${poin}`, () => {
      const r = hitungKualifikasi({ ...perfect(), skuSiap: sku });
      expect(r.skorPerBlok.C).toBe(8 + 7 + poin);
    });
  }
});

describe('deal-breakers force tidak_siap regardless of score', () => {
  it('dropship → deal-breaker + tidak_siap', () => {
    const r = hitungKualifikasi({ ...perfect(), modelBisnis: MODEL_BISNIS.Dropship });
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.Dropship);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('margin < 15% → deal-breaker', () => {
    const r = hitungKualifikasi({ ...perfect(), marginBersih: 14 });
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.MarginDiBawahMinimum);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('daya tahan <=1 bulan → deal-breaker', () => {
    const r = hitungKualifikasi({ ...perfect(), dayaTahanBudget: DAYA_TAHAN_BUDGET.SatuAtauBelumPasti });
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.DayaTahanBudgetTerlaluPendek);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('rasio target > 5x → deal-breaker', () => {
    const r = hitungKualifikasi({ ...perfect(), targetOmzet: 600_000_000n }); // 6x
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.RasioTargetTerlaluTinggi);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
});

describe('verdict bands', () => {
  it('>=75 growth_ready, >=55 bersyarat, else risiko_tinggi', () => {
    expect(hitungVerdict(75, [])).toBe(VERDICT.GrowthReady);
    expect(hitungVerdict(74, [])).toBe(VERDICT.Bersyarat);
    expect(hitungVerdict(55, [])).toBe(VERDICT.Bersyarat);
    expect(hitungVerdict(54, [])).toBe(VERDICT.RisikoTinggi);
  });
});

describe('resolveMargin basis order + BEP ROAS', () => {
  it('client-stated net wins', () => {
    const m = resolveMargin({ ...perfect(), marginBersih: 30, marginBersihSumber: SUMBER_ANGKA.KlienHitung });
    expect(m.basis).toBe(MARGIN_BASIS.BersihKlien);
    expect(m.marginBersih).toBe(30);
  });
  it('derives net from gross when net is absent', () => {
    const m = resolveMargin({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 40,
      komisiPlatformPersen: 10,
      ongkirPersen: 5,
    });
    expect(m.basis).toBe(MARGIN_BASIS.DiturunkanDariKotor);
    expect(m.marginBersih).toBe(25);
    expect(m.derivasiInput).not.toBeNull();
  });
  it('BEP ROAS = 100 / margin, div-by-zero → null', () => {
    expect(hitungBepRoas(20, 7.5).roas).toBe(5);
    expect(hitungBepRoas(0, 7.5).roas).toBeNull();
  });
});
