/**
 * Mesin verdict PDT — G4-03 Tahap 1 (`docs/backlog/PDT_BACKLOG.md` G4-03,
 * PRD §3.6 Rule 26-32, Flow C "Usulan & evaluasi").
 *
 * Beda dari `../pilarkatalog.ts` (katalog 20 aksi lama, G4-01): modul itu membaca
 * `MetrikKunci` dari payload `riset_awal_analisa` (baseline snapshot).
 * Modul INI membaca fakta `pdt_fact_*` langsung per `client_platform_id` +
 * periode (Flow C langkah 1: "mesin menjalankan katalog aksi terhadap fakta +
 * benchmark") — kosakata metrik BERBEDA (`roasShopee`/`acosShopee`, bukan
 * `MetrikKunci`), jadi sengaja TIDAK memakai ulang `evaluasiPemicu`/
 * `gabungKatalogDb` dari `pilarkatalog.ts`.
 *
 * Murni: nol akses DB, nol tahu aktor. Pembaca fakta ada di
 * `@cdps/domain` `pdt-verdict.ts` (pola sama pemisahan `pilarkatalog.ts`/
 * `strategi.ts`).
 *
 * Ambang di-port apa adanya dari `report_benchmark_shopee` (lihat migrasi
 * `20261114010000`) — HANYA `roas_good`/`acos_good`, satu-satunya dua kunci
 * yang dua aksi Tahap 1 ini konsumsi. `target_nilai` usulan = ambang `_good`
 * itu sendiri (bukan ambisi persen buatan) — nol angka dikarang.
 *
 * `SHP-KREATOR-AKTIF` (aksi 6, ditambah sesi berikutnya) beda pola: nol
 * benchmark dikonsumsi (`docs/DECISIONS.md` G4-03-KATALOG-KESIAPAN — "aktif"
 * = `gmv > 0` DIKETOK, tapi target/ambang COUNT tidak pernah punya sumber
 * terverifikasi). Pemicu yang diketok pemilik: HANYA nol kreator aktif (floor
 * alami, bukan angka dikarang) — `targetNilai` fixed di 1 (keluar dari nol),
 * bukan target ambisi jumlah.
 */

export type PdtVerdictAksiKode = 'SHP-ROAS' | 'SHP-ACOS' | 'SHP-KREATOR-AKTIF';

export type PdtVerdictSatuan = 'rasio' | 'persen' | 'hitungan';

export type PdtVerdictArah = 'naik' | 'turun';

export interface PdtVerdictBenchmarkShopee {
  roasGood: number;
  acosGood: number;
}

export interface PdtVerdictHasil {
  kodeAksi: PdtVerdictAksiKode;
  /** `true` ⇒ aksi ini memenuhi syarat diusulkan (pemicu menyala). */
  menyala: boolean;
  nilaiSekarang: number;
  satuanSekarang: PdtVerdictSatuan;
  targetNilai: number;
  satuanTarget: PdtVerdictSatuan;
  arah: PdtVerdictArah;
}

/**
 * ROAS = Σgmv / Σbiaya (ratio-of-sums, pola sama `report/shopee/metrik.ts`
 * baris 832 `roas = omzet/spend` — BUKAN rata-rata `roas` per-baris).
 * `biaya <= 0` ⇒ `null` (Rule 7: pembagian nol tidak pernah dihitung, bukan
 * dianggap 0/∞).
 */
export function evaluasiRoasShopee(
  sigmaGmv: number,
  sigmaBiaya: number,
  bench: PdtVerdictBenchmarkShopee,
): PdtVerdictHasil | null {
  if (sigmaBiaya <= 0) return null;
  const nilai = sigmaGmv / sigmaBiaya;
  return {
    kodeAksi: 'SHP-ROAS',
    menyala: nilai < bench.roasGood,
    nilaiSekarang: nilai,
    satuanSekarang: 'rasio',
    targetNilai: bench.roasGood,
    satuanTarget: 'rasio',
    arah: 'naik',
  };
}

/** ACoS = Σbiaya / Σgmv (ratio-of-sums). `gmv <= 0` ⇒ `null` (Rule 7). */
export function evaluasiAcosShopee(
  sigmaBiaya: number,
  sigmaGmv: number,
  bench: PdtVerdictBenchmarkShopee,
): PdtVerdictHasil | null {
  if (sigmaGmv <= 0) return null;
  const nilai = sigmaBiaya / sigmaGmv;
  return {
    kodeAksi: 'SHP-ACOS',
    menyala: nilai > bench.acosGood,
    nilaiSekarang: nilai,
    satuanSekarang: 'persen',
    targetNilai: bench.acosGood,
    satuanTarget: 'persen',
    arah: 'turun',
  };
}

/**
 * Aksi 6 — afiliasi/KOL Shopee aktif. "Aktif" = `gmv > 0` (definisi diketok
 * pemilik), COUNT dihitung pemanggil dari `pdt_fact_creator_period` (satu
 * baris/kreator/periode — COUNT baris yang `gmv > 0` = jumlah kreator aktif,
 * pola sama `ringkasAfiliasiDariFakta` G3-05). Selalu mengembalikan hasil
 * (beda dari ROAS/ACoS) — jumlah kreator selalu terhitung meski nol baris.
 */
export function evaluasiKreatorAktifShopee(jumlahKreatorAktif: number): PdtVerdictHasil {
  return {
    kodeAksi: 'SHP-KREATOR-AKTIF',
    menyala: jumlahKreatorAktif === 0,
    nilaiSekarang: jumlahKreatorAktif,
    satuanSekarang: 'hitungan',
    targetNilai: 1,
    satuanTarget: 'hitungan',
    arah: 'naik',
  };
}

export type PdtVerdictOutcome = 'tidak_dikerjakan' | 'gagal' | 'tercapai';

/**
 * Rule 31: pemisahan "tidak dikerjakan" (masalah tim) vs "gagal" (masalah
 * taktik) — satu-satunya sinyal adalah `planRef` (`pdt_usulan.plan_ref`,
 * diisi Flow C langkah 3 saat usulan diteruskan ke Plan → Brief divisi;
 * BELUM ada penulis `plan_ref` hari ini di luar modul ini — Tahap 1 sengaja
 * tidak membangun jembatan Plan/Brief, jadi setiap usulan Tahap 1 yang belum
 * pernah dijembatani akan bertahan `tidak_dikerjakan`, bukan bug: mencerminkan
 * keadaan sesungguhnya "loop ini belum pernah jalan").
 */
export function tentukanVerdict(
  planRef: string | null,
  realisasiNilai: number,
  targetNilai: number,
  arah: PdtVerdictArah,
): PdtVerdictOutcome {
  if (planRef == null) return 'tidak_dikerjakan';
  const tercapai = arah === 'naik' ? realisasiNilai >= targetNilai : realisasiNilai <= targetNilai;
  return tercapai ? 'tercapai' : 'gagal';
}
