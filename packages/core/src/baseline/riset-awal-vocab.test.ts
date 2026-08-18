/**
 * RAB-03 — `belum_dapat_diukur` + vocabulary firewall.
 *
 * The Kondisi Toko score (how healthy the STORE is) and the Blok C verdict (how
 * qualified the CLIENT is) measure different things with near-identical names
 * (DECISIONS 2026-08-17). Merging them would invert MEA's business logic: a weak
 * store is the REASON a client hires MEA, not a mark against the client. These
 * tests make that firewall permanent — they read BOTH enums from source and prove
 * the intersection is empty, so a rename that collapses `'Risiko Tinggi'` into
 * `'risiko_tinggi'` fails CI instead of silently sharing a column.
 *
 * DoD (`docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` RAB-03):
 *  - vocabulary intersection (Blok C verdict ∩ Kondisi Toko) = ∅
 *  - Kondisi Toko never triggers `kualifikasi_tidak_siap` or a Blok C gate
 *  - `belum_dapat_diukur` ⇒ zero TANTANGAN, and ≠ `mesin_belum_terbangun`
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_KONDISI_TOKO,
  BENCH_V1,
  COMPUTED_KONDISI_TOKO,
  kondisiTokoFromScore,
  runBaseline,
  type KondisiToko,
  type RunSlots,
} from './index';
import {
  DAYA_TAHAN_BUDGET,
  HAMBATAN,
  KECEPATAN_APPROVAL,
  KESANGGUPAN_LONJAKAN,
  KESIAPAN_AKSES,
  MODEL_BISNIS,
  PEMBEDA_PRODUK,
  PENANGANAN_CHAT,
  RUANG_HARGA,
  SIKLUS_BELI_ULANG,
  SUMBER_ANGKA,
  VERDICT,
  hitungKualifikasi,
  type KualifikasiInput,
} from '../interview';

// A fully-qualified client (mirrors interview.test.ts `perfect()`): margin 35%,
// own producer, target 2×, six-month budget → growth_ready with no deal-breaker.
function strongClient(): KualifikasiInput {
  return {
    marginBersih: 35,
    marginBersihSumber: SUMBER_ANGKA.KlienHitung,
    marginKotor: 45,
    aov: 15_000_000n,
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

describe('RAB-03 · vocabulary firewall (Kondisi Toko ∩ Blok C = ∅)', () => {
  it('the two enums share no value (read from source)', () => {
    const verdicts = new Set<string>(Object.values(VERDICT));
    const kondisi = new Set<string>(ALL_KONDISI_TOKO);

    const intersection = [...kondisi].filter((v) => verdicts.has(v));
    expect(intersection).toEqual([]);

    // Symmetric — no verdict value leaks into the Kondisi Toko vocabulary either.
    expect(Object.values(VERDICT).filter((v) => kondisi.has(v))).toEqual([]);
  });

  it('lists exactly the five Kondisi Toko values, `belum_dapat_diukur` included', () => {
    expect(ALL_KONDISI_TOKO).toHaveLength(5);
    expect(new Set(ALL_KONDISI_TOKO).size).toBe(5);
    expect(ALL_KONDISI_TOKO).toContain('belum_dapat_diukur');
  });
});

describe('RAB-03 · Kondisi Toko never triggers a Blok C gate', () => {
  it('no Kondisi Toko value can act as a deal-breaker code (HAMBATAN)', () => {
    const hambatan = new Set<string>(Object.values(HAMBATAN));
    for (const k of ALL_KONDISI_TOKO) {
      expect(hambatan.has(k)).toBe(false);
    }
  });

  it('a broken store (mesin_belum_terbangun) does not drag a strong client to tidak_siap', () => {
    // DECISIONS worked example: store ≈38 ⇒ Mesin Belum Terbangun, yet the SAME
    // client (margin 32%, own producer, target 1.46×, 6-month budget) is
    // growth_ready. Both true — that is exactly MEA's ideal client.
    const storeCondition: KondisiToko = kondisiTokoFromScore(38);
    expect(storeCondition).toBe('mesin_belum_terbangun');

    const client = hitungKualifikasi(strongClient());
    expect(client.verdict).toBe(VERDICT.GrowthReady);
    expect(client.verdict).not.toBe(VERDICT.TidakSiap);
    // The verdict is driven only by Blok C deal-breakers — the store never enters it.
    expect(client.hambatanMendasar).toEqual([]);
  });

  it('tidak_siap comes ONLY from a Blok C deal-breaker, not the store score', () => {
    // Flip a real Blok C deal-breaker (dropship) — that, and only that, forces
    // tidak_siap; the store condition is not even an input to the scorer.
    const dropship = hitungKualifikasi({ ...strongClient(), modelBisnis: MODEL_BISNIS.Dropship });
    expect(dropship.verdict).toBe(VERDICT.TidakSiap);
    expect(dropship.hambatanMendasar.map((h) => h.kode)).toContain(HAMBATAN.Dropship);
  });
});

describe('RAB-03 · belum_dapat_diukur is distinct and carries no TANTANGAN', () => {
  it('the analysis engine never computes belum_dapat_diukur', () => {
    // Across the whole score domain (incl. null "nothing scorable") the engine
    // only yields the four COMPUTED values — belum_dapat_diukur is caller-only.
    const computed = new Set<string>(COMPUTED_KONDISI_TOKO);
    for (let s = 0; s <= 100; s++) {
      const k = kondisiTokoFromScore(s);
      expect(k).not.toBe('belum_dapat_diukur');
      expect(computed.has(k)).toBe(true);
    }
    expect(kondisiTokoFromScore(null)).not.toBe('belum_dapat_diukur');
  });

  it('an empty analysis floors to mesin_belum_terbangun, NOT belum_dapat_diukur (§2.3)', () => {
    // "engine ran, store is genuinely weak" (mesin_belum_terbangun) must never be
    // conflated with "no engine for this platform" (belum_dapat_diukur).
    expect(kondisiTokoFromScore(null)).toBe('mesin_belum_terbangun');
    expect('belum_dapat_diukur' as KondisiToko).not.toBe('mesin_belum_terbangun');

    const empty: RunSlots = {};
    const { sc, F, payload } = runBaseline(empty, [], {
      bench: BENCH_V1,
      benchmarkVersi: 1,
      net: true,
      klien: {
        nama: 'Kosong',
        toko: null,
        akun_tiktok: null,
        kategori: null,
        umur_toko_bulan: null,
        account_manager: null,
      },
      generatedAt: '2026-08-18T03:00:00.000Z',
    });
    // Nothing real was uploaded ⇒ the score floors low, so the mapping lands on
    // mesin_belum_terbangun (never belum_dapat_diukur, which is caller-only).
    expect(sc.total == null || sc.total < 45).toBe(true);
    expect(payload.skor.kondisi_toko).toBe('mesin_belum_terbangun');
    // No data ⇒ no findings at all, so certainly no TANTANGAN.
    expect(F.filter((f) => f.lv === 'tantangan')).toEqual([]);
  });

  it('whenever the engine emits TANTANGAN, kondisi_toko is a computed value (never belum_dapat_diukur)', () => {
    // A declining store with zero LIVE sessions produces TANTANGAN findings; its
    // kondisi_toko must still be one of the four computed values, proving TANTANGAN
    // and belum_dapat_diukur can never co-occur on the analysis path.
    const declining = [
      { key: '2026-03', label: 'Mar 2026', gmv: 200_000_000, order: 500, flag: 'normal' as const },
      { key: '2026-04', label: 'Apr 2026', gmv: 180_000_000, order: 450, flag: 'normal' as const },
      { key: '2026-05', label: 'Mei 2026', gmv: 170_000_000, order: 430, flag: 'normal' as const },
      { key: '2026-06', label: 'Jun 2026', gmv: 150_000_000, order: 400, flag: 'normal' as const },
      { key: '2026-07', label: 'Jul 2026', gmv: 130_000_000, order: 360, flag: 'normal' as const },
      { key: '2026-08', label: 'Agu 2026', gmv: 110_000_000, order: 320, flag: 'normal' as const },
    ];
    const { F, payload } = runBaseline({}, declining, {
      bench: BENCH_V1,
      benchmarkVersi: 1,
      net: true,
      klien: {
        nama: 'Menurun',
        toko: null,
        akun_tiktok: null,
        kategori: null,
        umur_toko_bulan: null,
        account_manager: null,
      },
      generatedAt: '2026-08-18T03:00:00.000Z',
    });
    expect(F.some((f) => f.lv === 'tantangan')).toBe(true);
    expect(payload.skor.kondisi_toko).not.toBe('belum_dapat_diukur');
    expect(COMPUTED_KONDISI_TOKO).toContain(payload.skor.kondisi_toko);
  });
});
