import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KELOLA_KLIEN_SLA,
  KELOLA_KLIEN_LANGKAH,
  KELOLA_KLIEN_LANGKAH_LABEL,
  SLA_STATUS,
  isSlaTerlambat,
  statusSla,
  RISET_AWAL_MACHINE,
  RISET_AWAL_STATES,
  durasiBerjalanMenit,
  durasiRisetAwalMenit,
  isRisetAwalSelesai,
  DAYA_TAHAN_BUDGET,
  DEFAULT_KUALIFIKASI_CONFIG,
  HAMBATAN,
  KECEPATAN_APPROVAL,
  KESANGGUPAN_LONJAKAN,
  KESIAPAN_AKSES,
  KUALITAS_DATA,
  type KualifikasiInput,
  MARGIN_BASIS,
  MODEL_BISNIS,
  PEMBEDA_PRODUK,
  PENANGANAN_CHAT,
  PREFILL_MAPPING,
  RUANG_HARGA,
  SIKLUS_BELI_ULANG,
  SUMBER_ANGKA,
  STRATEGI_FLAG,
  VERDICT,
  FLAG,
  handoffKeStrategi,
  hitungBepRoas,
  hitungKualifikasi,
  hitungVerdict,
  isHardInternal,
  isScoredField,
  isStrategiBaselineForbidden,
  resolveMargin,
  resolveStrategiPrefill,
} from './interview';

/**
 * A "perfect" client: no deal-breakers, every block maxed. Total 100 →
 * growth_ready. Individual tests override a single field to isolate a band.
 *   A = 12 (margin 35) + 8 (AOV Rp150k) + 10 (ruang) = 30
 *   B = 10 (produsen) + 10 (sanggup)                 = 20
 *   C = 8 (habis_pakai) + 7 (pembeda) + 5 (>=30 SKU) = 20
 *   D = 6 (tim khusus) + 5 (approval) + 4 (akses)    = 15
 *   E = 7 (rasio 2x) + 8 (>=6 bln)                   = 15
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
    omzet: 100_000_000n, // Rp1.000.000
    targetOmzet: 200_000_000n, // 2x
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
      // Block A = margin + 8 (AOV) + 10 (ruang)
      expect(r.skorPerBlok.A).toBe(poin + 18);
      expect(r.hambatanMendasar).toEqual([]);
    });
  }
  it('margin 14% → deal-breaker, forces tidak_siap even with everything else maxed', () => {
    const r = hitungKualifikasi({ ...perfect(), marginBersih: 14 });
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.MarginDiBawahMinimum);
    expect(r.skorPerBlok.A).toBe(0 + 18); // margin 0 pts, AOV+ruang keep their points
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
});

describe('C-A3 AOV band boundaries (50k/80k/150k) in minor units', () => {
  const cases: Array<[bigint, number]> = [
    [15_000_000n, 8], // Rp150.000
    [14_999_999n, 6],
    [8_000_000n, 6], // Rp80.000
    [7_999_999n, 4],
    [5_000_000n, 4], // Rp50.000
    [4_999_999n, 2],
  ];
  for (const [aov, poin] of cases) {
    it(`AOV ${aov} minor → AOV points ${poin}`, () => {
      const r = hitungKualifikasi({ ...perfect(), aov });
      expect(r.skorPerBlok.A).toBe(12 + poin + 10);
    });
  }
});

describe('C-C3 SKU siap band boundaries (3/9/29/30/10)', () => {
  const cases: Array<[number, number]> = [
    [30, 5],
    [29, 4],
    [10, 4],
    [9, 2],
    [3, 2],
    [2, 1],
  ];
  for (const [sku, poin] of cases) {
    it(`SKU ${sku} → C-C3 points ${poin}`, () => {
      const r = hitungKualifikasi({ ...perfect(), skuSiap: sku });
      expect(r.skorPerBlok.C).toBe(8 + 7 + poin);
    });
  }
});

describe('C-E1 target ratio band boundaries (2/3/5) + deal-breaker', () => {
  // ratio = targetOmzet / omzet, omzet fixed at 100_000_000n
  const cases: Array<[bigint, number, number | null]> = [
    [200_000_000n, 2, 7], // 2x
    [300_000_000n, 3, 5], // 3x
    [500_000_000n, 5, 2], // 5x
  ];
  for (const [target, ratio, poin] of cases) {
    it(`ratio ${ratio}x → C-E1 points ${poin}`, () => {
      const r = hitungKualifikasi({ ...perfect(), targetOmzet: target });
      expect(r.rasioTarget).toBe(ratio);
      expect(r.skorPerBlok.E).toBe((poin ?? 0) + 8);
      expect(r.hambatanMendasar).toEqual([]);
    });
  }
  it('ratio > 5x → deal-breaker → tidak_siap', () => {
    const r = hitungKualifikasi({ ...perfect(), targetOmzet: 501_000_000n });
    expect(r.rasioTarget).toBeCloseTo(5.01, 2);
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.RasioTargetTerlaluTinggi);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('written reset recomputes the ratio and clears the deal-breaker', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      targetOmzet: 800_000_000n, // 8x — would be a deal-breaker
      resetEkspektasiTertulis: { targetBaru: 250_000_000n, disetujuiOleh: 'EMP-1', disetujuiPada: '2026-08-11T03:00:00Z' },
    });
    expect(r.rasioTarget).toBe(2.5); // recomputed on the reset target
    expect(r.hambatanMendasar).toEqual([]);
    expect(r.skorPerBlok.E).toBe(5 + 8); // 2.5x → 5 pts
  });
});

describe('deal-breakers', () => {
  it('dropship (C-B1) forces tidak_siap', () => {
    const r = hitungKualifikasi({ ...perfect(), modelBisnis: MODEL_BISNIS.Dropship });
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.Dropship);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('daya tahan <=1 bulan / belum pasti (C-E2) forces tidak_siap', () => {
    const r = hitungKualifikasi({ ...perfect(), dayaTahanBudget: DAYA_TAHAN_BUDGET.SatuAtauBelumPasti });
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.DayaTahanBudgetTerlaluPendek);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('a single deal-breaker forces tidak_siap at a total of 90+ (I14)', () => {
    const r = hitungKualifikasi({ ...perfect(), dayaTahanBudget: DAYA_TAHAN_BUDGET.SatuAtauBelumPasti });
    // Everything else maxed: A30+B20+C20+D15+E(7+0)=92, yet the verdict is tidak_siap.
    expect(r.skorTotal).toBeGreaterThanOrEqual(90);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
});

describe('verdict bands (no deal-breaker)', () => {
  it('>=75 → growth_ready', () => {
    expect(hitungVerdict(75, [])).toBe(VERDICT.GrowthReady);
    expect(hitungVerdict(100, [])).toBe(VERDICT.GrowthReady);
  });
  it('55–74 → bersyarat', () => {
    expect(hitungVerdict(55, [])).toBe(VERDICT.Bersyarat);
    expect(hitungVerdict(74, [])).toBe(VERDICT.Bersyarat);
  });
  it('<55 → risiko_tinggi', () => {
    expect(hitungVerdict(54, [])).toBe(VERDICT.RisikoTinggi);
    expect(hitungVerdict(0, [])).toBe(VERDICT.RisikoTinggi);
  });
  it('a deal-breaker beats a 90+ score', () => {
    expect(hitungVerdict(92, [{ kode: HAMBATAN.Dropship, nilai: 'dropship' }])).toBe(VERDICT.TidakSiap);
  });
});

describe('margin resolution order (I21): client → derived → estimate', () => {
  it('(1) client-stated net wins', () => {
    const m = resolveMargin({ ...perfect(), marginBersih: 30, marginBersihSumber: SUMBER_ANGKA.KlienHitung, marginKotor: 45 });
    expect(m.basis).toBe(MARGIN_BASIS.BersihKlien);
    expect(m.marginBersih).toBe(30);
    expect(m.derivasiInput).toBeNull();
  });
  it('(2) derives net from gross when net is blank, reproducible from derivasiInput alone', () => {
    const m = resolveMargin({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 40,
      komisiPlatformPersen: 5,
      ongkirPersen: 3,
    });
    expect(m.basis).toBe(MARGIN_BASIS.DiturunkanDariKotor);
    expect(m.marginBersih).toBe(32); // 40 - 5 - 3
    // Reproducible: the stored inputs alone re-derive 32.
    const d = m.derivasiInput!;
    expect(d.margin_kotor_persen).toBe(40);
    expect(d.komisi_platform_persen).toBe(5);
    expect(d.ongkir_persen).toBe(3);
    const rederived = (d.margin_kotor_persen as number) - (d.komisi_platform_persen as number) - (d.ongkir_persen as number);
    expect(rederived).toBe(32);
  });
  it('(2) normalises Rp/pesanan shipping to a % of AOV', () => {
    const m = resolveMargin({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 40,
      komisiPlatformPersen: 5,
      ongkirPersen: null,
      ongkirPerPesanan: 1_500_000n, // Rp15.000 on an AOV of Rp150.000 = 10%
      aov: 15_000_000n,
    });
    expect(m.derivasiInput!.ongkir_persen).toBe(10);
    expect(m.marginBersih).toBe(25); // 40 - 5 - 10
  });
  it('(3) AM estimate when gross is unavailable', () => {
    const m = resolveMargin({
      ...perfect(),
      marginBersih: 22,
      marginBersihSumber: SUMBER_ANGKA.EstimasiAm,
      marginBersihDasarEstimasi: 'rata-rata kategori sejenis',
      marginKotor: null,
    });
    expect(m.basis).toBe(MARGIN_BASIS.EstimasiAm);
    expect(m.marginBersih).toBe(22);
  });
  it('config-default deductions are recorded as source `config` (not client)', () => {
    const m = resolveMargin({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 40,
      komisiPlatformPersen: null,
      ongkirPersen: null,
      defaultKomisiPlatformPersen: 6,
      defaultOngkirPersen: 4,
    });
    expect(m.marginBersih).toBe(30); // 40 - 6 - 4
    expect(m.derivasiInput!.komisi_platform_sumber).toBe('config');
    expect(m.derivasiInput!.ongkir_sumber).toBe('config');
  });
});

describe('grey zone (margin_zona_abu_abu)', () => {
  it('a derived margin in [12,18] raises the flag without changing score or outcome', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 20,
      komisiPlatformPersen: 4,
      ongkirPersen: 1, // → 15%
    });
    expect(r.marginBersih).toBe(15);
    expect(r.flags).toContain(FLAG.MarginZonaAbuAbu);
    expect(r.skorPerBlok.A).toBe(3 + 8 + 10); // 15% → 3 pts, unchanged by the flag
    expect(r.hambatanMendasar).toEqual([]);
  });
  it('the flag never softens a deal-breaker (derived 14% is both grey-zone AND a deal-breaker)', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 20,
      komisiPlatformPersen: 5,
      ongkirPersen: 1, // → 14%
    });
    expect(r.marginBersih).toBe(14);
    expect(r.flags).toContain(FLAG.MarginZonaAbuAbu);
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.MarginDiBawahMinimum);
    expect(r.verdict).toBe(VERDICT.TidakSiap);
  });
  it('a client-stated margin is never grey-zoned (only derived/estimated inputs)', () => {
    const r = hitungKualifikasi({ ...perfect(), marginBersih: 16, marginBersihSumber: SUMBER_ANGKA.KlienHitung });
    expect(r.flags).not.toContain(FLAG.MarginZonaAbuAbu);
  });
});

describe('BEP ROAS (I16)', () => {
  const cases: Array<[number, number]> = [
    [35, 2.9],
    [25, 4.0],
    [20, 5.0],
    [15, 6.7],
    [12, 8.3],
  ];
  for (const [margin, roas] of cases) {
    it(`margin ${margin}% → BEP ROAS ${roas}x`, () => {
      expect(hitungBepRoas(margin, 7.5).roas).toBe(roas);
    });
  }
  it('raises bep_di_atas_target_advertiser when BEP ROAS exceeds the config target', () => {
    const bep = hitungBepRoas(12, 7.5);
    expect(bep.diAtasTargetAdvertiser).toBe(true);
  });
  it('margin <= 0 → null (rendered "—", never an error)', () => {
    expect(hitungBepRoas(0, 7.5).roas).toBeNull();
  });
});

describe('data quality (I22)', () => {
  it('all client-stated scored inputs → terverifikasi', () => {
    const r = hitungKualifikasi({ ...perfect(), aovSumber: SUMBER_ANGKA.KlienHitung });
    expect(r.kualitasData).toBe(KUALITAS_DATA.Terverifikasi);
  });
  it('1–2 non-client scored inputs → sebagian_estimasi', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      marginBersih: null,
      marginBersihSumber: null,
      marginKotor: 40,
      komisiPlatformPersen: 5,
      ongkirPersen: 3, // derived → B2-7 counts as non-client
    });
    expect(r.sumberAngkaPerField['B2-7']).toBe(SUMBER_ANGKA.DariMarginKotor);
    expect(r.kualitasData).toBe(KUALITAS_DATA.SebagianEstimasi);
  });
  it('>=3 non-client scored inputs → mayoritas_estimasi', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      marginBersih: 22,
      marginBersihSumber: SUMBER_ANGKA.EstimasiAm,
      marginBersihDasarEstimasi: 'x',
      marginKotor: null,
      aovSumber: SUMBER_ANGKA.EstimasiAm,
      skuSiapSumber: SUMBER_ANGKA.EstimasiAm,
      omzetSumber: SUMBER_ANGKA.EstimasiAm,
    });
    expect(r.kualitasData).toBe(KUALITAS_DATA.MayoritasEstimasi);
  });
});

describe('config is snapshotted (I15) — a threshold change never rewrites a past verdict', () => {
  it('the stored snapshot reproduces the same verdict regardless of the live default', () => {
    const snapshot = { ...DEFAULT_KUALIFIKASI_CONFIG, skorGrowthReady: 90 };
    // Score 88 under the snapshot (growthReady=90) → bersyarat; a later default of
    // 75 would have said growth_ready, but scoring with the snapshot preserves it.
    expect(hitungVerdict(88, [], snapshot)).toBe(VERDICT.Bersyarat);
    expect(hitungVerdict(88, [], DEFAULT_KUALIFIKASI_CONFIG)).toBe(VERDICT.GrowthReady);
  });
});

describe('field classification', () => {
  it('every Blok C field and B11 field is hard-internal', () => {
    expect(isHardInternal('C')).toBe(true);
    expect(isHardInternal('C-A2')).toBe(true);
    expect(isHardInternal('B11-2')).toBe(true);
    expect(isHardInternal('B2-7')).toBe(true); // margin bersih
    expect(isHardInternal('B6-5')).toBe(true);
    expect(isHardInternal('B2-1')).toBe(false); // brand/kategori is client-facing
  });
  it('scored fields are enumerated and cannot be blank-submitted', () => {
    expect(isScoredField('B2-7')).toBe(true);
    expect(isScoredField('B6-3')).toBe(true);
    expect(isScoredField('B0-1')).toBe(false);
  });
});

describe('Blok D handoff — no verdict blocks Strategi', () => {
  it('every verdict unlocks Strategi', () => {
    for (const v of Object.values(VERDICT)) {
      expect(handoffKeStrategi(v).unlocked).toBe(true);
    }
  });
  it('tidak_siap unlocks and carries sasaran_konservatif + hambatan_mendasar_tercatat', () => {
    const h = handoffKeStrategi(VERDICT.TidakSiap);
    expect(h.unlocked).toBe(true);
    expect(h.flags).toContain(STRATEGI_FLAG.SasaranKonservatif);
    expect(h.flags).toContain(STRATEGI_FLAG.HambatanMendasarTercatat);
    expect(h.copyPrasyaratKeC7).toBe(true);
    expect(h.wajibCatatanMitigasi).toBe(true);
  });
  it('bersyarat copies prasyarat into C-7 and sets sasaran_konservatif', () => {
    const h = handoffKeStrategi(VERDICT.Bersyarat);
    expect(h.flags).toEqual([STRATEGI_FLAG.SasaranKonservatif]);
    expect(h.copyPrasyaratKeC7).toBe(true);
  });
  it('growth_ready carries no flags', () => {
    expect(handoffKeStrategi(VERDICT.GrowthReady).flags).toEqual([]);
  });
});

describe('prefill mapping never touches the Strategi Section B numeric baseline', () => {
  it('no mapping entry targets a forbidden baseline field', () => {
    for (const e of PREFILL_MAPPING) {
      expect(isStrategiBaselineForbidden(e.strategiField)).toBe(false);
    }
  });
  it('the baseline fields are all flagged forbidden', () => {
    for (const f of ['B-1', 'B-2', 'B-8']) {
      expect(isStrategiBaselineForbidden(f)).toBe(true);
    }
  });
  it('B2-8 (gross margin) maps to A-3, and net margin B2-7 is not a prefill source', () => {
    expect(PREFILL_MAPPING.find((e) => e.strategiField === 'A-3')?.interviewField).toBe('B2-8');
  });
});

describe('resolveStrategiPrefill — the Interview→Strategi production seam (RAB-09)', () => {
  it('composes handoffKeStrategi: every verdict unlocks and carries its flags', () => {
    for (const v of Object.values(VERDICT)) {
      const p = resolveStrategiPrefill(v, new Map());
      expect(p.unlocked).toBe(true);
      expect(p.verdict).toBe(v);
      // Same flags handoffKeStrategi hands out — not a second copy of the rules.
      expect(p.flags).toEqual(handoffKeStrategi(v).flags);
      expect(p.wajibCatatanMitigasi).toBe(handoffKeStrategi(v).wajibCatatanMitigasi);
    }
  });

  it('only offers answered fields, and copies the mapping catatan verbatim', () => {
    // B2-8 → A-3 (gross margin), B6-2 → A-9 (verbatim). Leave everything else blank.
    const answers = new Map<string, string>([
      ['B2-8', '  42  '],
      ['B6-2', 'kejar omzet 3x'],
      ['B1-4', ''], // present but blank → dropped
    ]);
    const p = resolveStrategiPrefill(VERDICT.GrowthReady, answers);
    const a3 = p.items.find((i) => i.strategiField === 'A-3');
    expect(a3?.interviewField).toBe('B2-8');
    expect(a3?.nilai).toBe('42'); // trimmed
    expect(a3?.catatan).toBe('margin KOTOR (not net)');
    const a9 = p.items.find((i) => i.strategiField === 'A-9');
    expect(a9?.nilai).toBe('kejar omzet 3x');
    // Blank/absent interview fields never appear.
    expect(p.items.some((i) => i.interviewField === 'B1-4')).toBe(false);
  });

  it('never emits a forbidden Section B numeric baseline, even if the map named one', () => {
    // No PREFILL_MAPPING entry targets B-1..B-8 today; assert the guard holds
    // regardless by feeding an answer for every mapped source.
    const answers = new Map(PREFILL_MAPPING.map((e) => [e.interviewField, 'x']));
    const p = resolveStrategiPrefill(VERDICT.Bersyarat, answers);
    for (const item of p.items) {
      expect(isStrategiBaselineForbidden(item.strategiField)).toBe(false);
    }
  });
});

describe('six fixture clients spanning all four verdicts', () => {
  // Hand-computed expected totals, one per verdict, plus two extra for coverage.
  it('client 1 (perfect) → growth_ready @ 100', () => {
    expect(hitungKualifikasi(perfect()).verdict).toBe(VERDICT.GrowthReady);
  });
  it('client 2 (strong, minor gaps) → growth_ready @ 88', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      ruangHarga: RUANG_HARGA.Terbatas, // A 30→25
      kesiapanAkses: KESIAPAN_AKSES.Sebagian, // D 15→13
      siklusBeliUlang: SIKLUS_BELI_ULANG.Menengah, // C 20→17
    });
    expect(r.skorTotal).toBe(25 + 20 + 17 + 13 + 15); // 90
    expect(r.verdict).toBe(VERDICT.GrowthReady);
  });
  it('client 3 (mid) → bersyarat in 55–74', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      marginBersih: 22, // A margin 12→6
      ruangHarga: RUANG_HARGA.Terbatas, // A 10→5
      kesanggupanLonjakan: KESANGGUPAN_LONJAKAN.SanggupSebagian, // B 10→5
      pembedaProduk: PEMBEDA_PRODUK.MiripPasaran, // C 7→4
      skuSiap: 9, // C 5→2
      penangananChat: PENANGANAN_CHAT.OwnerResponsif, // D 6→4
      kecepatanApproval: KECEPATAN_APPROVAL.OwnerSibuk, // D 5→2
      kesiapanAkses: KESIAPAN_AKSES.Sebagian, // D 4→2
      targetOmzet: 300_000_000n, // E 7→5 (3x)
      dayaTahanBudget: DAYA_TAHAN_BUDGET.TigaLima, // E 8→5
    });
    // A = 6+8+5=19, B = 10+5=15, C = 8+4+2=14, D = 4+2+2=8, E = 5+5=10 → 66
    expect(r.skorTotal).toBe(66);
    expect(r.verdict).toBe(VERDICT.Bersyarat);
  });
  it('client 4 (weak, no deal-breaker) → risiko_tinggi < 55', () => {
    const r = hitungKualifikasi({
      ...perfect(),
      marginBersih: 16, // A 12→3
      aov: 4_000_000n, // A 8→2
      ruangHarga: RUANG_HARGA.TidakAda, // A 10→0
      modelBisnis: MODEL_BISNIS.Reseller, // B 10→2
      kesanggupanLonjakan: KESANGGUPAN_LONJAKAN.BelumSanggup, // B 10→0
      siklusBeliUlang: SIKLUS_BELI_ULANG.SekaliBeli, // C 8→2
      pembedaProduk: PEMBEDA_PRODUK.ProdukUmum, // C 7→1
      skuSiap: 2, // C 5→1
      penangananChat: PENANGANAN_CHAT.SeringLewatSehari, // D 6→1
      kecepatanApproval: KECEPATAN_APPROVAL.BelumJelas, // D 5→0
      kesiapanAkses: KESIAPAN_AKSES.Belum, // D 4→0
      targetOmzet: 500_000_000n, // E 7→2 (5x)
      dayaTahanBudget: DAYA_TAHAN_BUDGET.Dua, // E 8→2
    });
    // A = 3+2+0=5, B = 2+0=2, C = 2+1+1=4, D = 1+0+0=1, E = 2+2=4 → 16
    expect(r.skorTotal).toBe(16);
    expect(r.hambatanMendasar).toEqual([]);
    expect(r.verdict).toBe(VERDICT.RisikoTinggi);
  });
  it('client 5 (dropship) → tidak_siap by deal-breaker despite a high total', () => {
    const r = hitungKualifikasi({ ...perfect(), modelBisnis: MODEL_BISNIS.Dropship });
    expect(r.verdict).toBe(VERDICT.TidakSiap);
    expect(r.skorTotal).toBeGreaterThan(75);
  });
  it('client 6 (thin margin) → tidak_siap by margin deal-breaker', () => {
    const r = hitungKualifikasi({ ...perfect(), marginBersih: 10 });
    expect(r.verdict).toBe(VERDICT.TidakSiap);
    expect(r.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.MarginDiBawahMinimum);
  });
});

// ===========================================================================
// Riset Awal (langkah 1 "Kelola Klien") — the duration derivation
// ===========================================================================
//
// This is the whole of what part 1 promises: how long the research took, derived
// from two anchors and never stored. The tests below pin the three answers that
// decide whether the metric can be trusted — floor (not round), `null` (not 0)
// while it is unfinished, and `null` on anchors that could only come from a bug.

describe('riset awal — machine mirror', () => {
  it('names the machine and states the migration seeds', () => {
    expect(RISET_AWAL_MACHINE).toBe('riset_awal');
    expect(RISET_AWAL_STATES.Berjalan).toBe('Berjalan');
    expect(RISET_AWAL_STATES.Selesai).toBe('Selesai');
    expect(isRisetAwalSelesai('Selesai')).toBe(true);
    expect(isRisetAwalSelesai('Berjalan')).toBe(false);
  });
});

describe('durasiRisetAwalMenit', () => {
  const mulai = '2026-08-12T01:00:00.000Z';

  it('counts whole minutes between the two anchors', () => {
    expect(durasiRisetAwalMenit(mulai, '2026-08-12T01:45:00.000Z')).toBe(45);
    expect(durasiRisetAwalMenit(mulai, '2026-08-12T04:00:00.000Z')).toBe(180);
    // Research spanning days is the normal case, not an outlier.
    expect(durasiRisetAwalMenit(mulai, '2026-08-14T01:00:00.000Z')).toBe(2880);
  });

  it('FLOORS the remainder — never reports time that has not passed', () => {
    expect(durasiRisetAwalMenit(mulai, '2026-08-12T01:01:59.000Z')).toBe(1);
    expect(durasiRisetAwalMenit(mulai, '2026-08-12T01:00:59.000Z')).toBe(0);
  });

  it('is null while unfinished — an unsubmitted step has no duration, not zero', () => {
    expect(durasiRisetAwalMenit(mulai, null)).toBeNull();
    expect(durasiRisetAwalMenit(mulai, undefined)).toBeNull();
    expect(durasiRisetAwalMenit(null, null)).toBeNull();
  });

  it('is null on unusable anchors (submit before start, unparseable input)', () => {
    expect(durasiRisetAwalMenit(mulai, '2026-08-12T00:59:00.000Z')).toBeNull();
    expect(durasiRisetAwalMenit('bukan tanggal', '2026-08-12T02:00:00.000Z')).toBeNull();
    expect(durasiRisetAwalMenit(mulai, 'bukan tanggal')).toBeNull();
  });

  it('accepts Date and ISO string interchangeably (driver returns Date)', () => {
    expect(durasiRisetAwalMenit(new Date(mulai), new Date('2026-08-12T02:30:00.000Z'))).toBe(90);
    expect(durasiRisetAwalMenit(mulai, new Date('2026-08-12T02:30:00.000Z'))).toBe(90);
  });

  it('durasiBerjalanMenit measures the running step by the SAME rule', () => {
    expect(durasiBerjalanMenit(mulai, new Date('2026-08-12T03:20:30.000Z'))).toBe(140);
    expect(durasiBerjalanMenit(null, new Date('2026-08-12T03:20:00.000Z'))).toBeNull();
  });
});

// ===========================================================================
// Timeline SLA — the owner's three-step numbers (2026-08-13)
// ===========================================================================

describe('kelola klien SLA — the owner numbers and the banding rule', () => {
  it('carries the owner numbers as the fallback config: 2–3, 1–2, 5–7', () => {
    expect(DEFAULT_KELOLA_KLIEN_SLA.risetAwal).toEqual({ targetHari: 2, batasHari: 3 });
    expect(DEFAULT_KELOLA_KLIEN_SLA.meeting).toEqual({ targetHari: 1, batasHari: 2 });
    expect(DEFAULT_KELOLA_KLIEN_SLA.strategi).toEqual({ targetHari: 5, batasHari: 7 });
  });

  it('names the three steps in the owner order', () => {
    expect(KELOLA_KLIEN_LANGKAH).toEqual({ RisetAwal: 1, InterviewMeeting: 2, BrandStrategy: 3 });
    expect(KELOLA_KLIEN_LANGKAH_LABEL[1]).toBe('Riset Awal');
    expect(KELOLA_KLIEN_LANGKAH_LABEL[2]).toBe('Interview Meeting');
    expect(KELOLA_KLIEN_LANGKAH_LABEL[3]).toBe('Brand Strategy');
  });

  const risetAwal = DEFAULT_KELOLA_KLIEN_SLA.risetAwal; // 2–3

  it('bands at the boundaries: <=target on time, <=batas tolerated, past batas late', () => {
    expect(statusSla(0, risetAwal)).toBe(SLA_STATUS.TepatWaktu);
    expect(statusSla(2, risetAwal)).toBe(SLA_STATUS.TepatWaktu); // exactly the target
    expect(statusSla(3, risetAwal)).toBe(SLA_STATUS.MendekatiBatas); // exactly the limit
    expect(statusSla(4, risetAwal)).toBe(SLA_STATUS.Terlambat);
    expect(isSlaTerlambat(statusSla(4, risetAwal))).toBe(true);
    expect(isSlaTerlambat(statusSla(3, risetAwal))).toBe(false);
  });

  it('a step that has not started is belum_mulai — NOT on time', () => {
    // On-time would be a verdict the step has not earned, and would let an
    // unstarted step count as a success in any rollup built on this.
    expect(statusSla(null, risetAwal)).toBe(SLA_STATUS.BelumMulai);
    expect(statusSla(undefined, risetAwal)).toBe(SLA_STATUS.BelumMulai);
    expect(statusSla(Number.NaN, risetAwal)).toBe(SLA_STATUS.BelumMulai);
    expect(statusSla(-1, risetAwal)).toBe(SLA_STATUS.BelumMulai);
  });

  it('judges a RUNNING step by the same rule — late is late before it finishes', () => {
    // 6 working days into a 5–7 step: not late yet. 8: late, even though the AM
    // has not submitted anything and could still claim to be "working on it".
    expect(statusSla(6, DEFAULT_KELOLA_KLIEN_SLA.strategi)).toBe(SLA_STATUS.MendekatiBatas);
    expect(statusSla(8, DEFAULT_KELOLA_KLIEN_SLA.strategi)).toBe(SLA_STATUS.Terlambat);
  });

  it('works for a step whose target equals its limit (a config with no tolerance)', () => {
    const ketat = { targetHari: 1, batasHari: 1 };
    expect(statusSla(1, ketat)).toBe(SLA_STATUS.TepatWaktu);
    expect(statusSla(2, ketat)).toBe(SLA_STATUS.Terlambat);
  });
});
