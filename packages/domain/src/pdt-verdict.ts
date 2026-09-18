/**
 * PDT — mesin verdict Shopee, sisi DB (G4-03 Tahap 1).
 *
 * Dipanggil dari `pdt.ts` `commitUploadBatch`/`reparsePdtBatch` DI DALAM
 * transaksi yang sama, hanya untuk `platform === 'shopee'` dan
 * `status === 'verified'` (Flow C langkah 1: "setelah batch verified").
 * Perhitungan murni ada di `@cdps/core` `pdt/verdict.ts` — modul ini hanya
 * baca fakta (lewat `pdt-prefill.ts`, G3-01) dan tulis `pdt_usulan`.
 *
 * Dua langkah per pemanggilan, urut:
 * 1. **Tutup usulan lama** (Rule 31 loop) — seluruh baris `pdt_usulan` milik
 *    `client_platform_id` ini yang `dievaluasi_pada IS NULL` (dari batch MANA
 *    PUN sebelumnya, bukan cuma satu periode lalu — AM bisa lewat beberapa
 *    bulan tanpa upload) dievaluasi dengan fakta batch yang BARU verified ini:
 *    `realisasi_nilai` = nilai metrik yang sama dihitung ulang untuk periode
 *    baru, `verdict` dari `tentukanVerdict` (`plan_ref` masih NULL untuk
 *    semua baris Tahap 1 — jembatan Plan/Brief belum dibangun sesi ini,
 *    dicatat di docblock `verdict.ts`).
 * 2. **Buka usulan baru** — bila metrik periode INI memicu ambang, upsert
 *    (bukan INSERT buta — reparse bisa memanggil ini berkali-kali untuk
 *    `batch_id` yang SAMA) satu baris `pdt_usulan` per kode aksi yang menyala.
 *
 * Kegagalan baca benchmark (`pdt_benchmark` platform='shopee' kosong) TIDAK
 * boleh menggagalkan commit/reparse batch itu sendiri — usulan adalah lapisan
 * turunan (Rule 4), bukan gerbang upload. Kegagalan itu di-catch dan
 * dilewati diam-diam di sini. `SHP-KREATOR-AKTIF` (aksi 6) TIDAK butuh
 * benchmark sama sekali (pemicunya nol kreator aktif, bukan ambang tabel) —
 * ia tetap dievaluasi walau `pdt_benchmark` platform='shopee' kosong.
 */
import type { Queryable } from '@cdps/db';
import { pdt } from '@cdps/core';
import { bacaFaktaAds, bacaFaktaCreatorPeriode } from './pdt-prefill';

const KATALOG_KODE = ['SHP-ROAS', 'SHP-ACOS', 'SHP-KREATOR-AKTIF'] as const;

async function bacaBenchmarkAktifShopeeVerdict(sql: Queryable): Promise<pdt.PdtVerdictBenchmarkShopee | null> {
  const rows = await sql<{ nilai: { roas_good: number; acos_good: number } }[]>`
    select nilai from pdt_benchmark
     where platform = 'shopee' and aktif = true
     order by versi desc limit 1`;
  if (rows.length === 0) return null;
  const { roas_good, acos_good } = rows[0].nilai;
  return { roasGood: roas_good, acosGood: acos_good };
}

interface HasilUntukTulis {
  kodeAksi: pdt.PdtVerdictAksiKode;
  menyala: boolean;
  nilaiSekarang: number;
  satuanSekarang: pdt.PdtVerdictSatuan;
  targetNilai: number;
  satuanTarget: pdt.PdtVerdictSatuan;
  arah: pdt.PdtVerdictArah;
}

async function tutupUsulanLama(sql: Queryable, clientPlatformId: number, batchId: number, hasilByKode: ReadonlyMap<string, HasilUntukTulis>): Promise<void> {
  const pending = await sql<{ id: number; kode_aksi: string; target_nilai: string; plan_ref: string | null }[]>`
    select u.id, u.kode_aksi, u.target_nilai, u.plan_ref
      from pdt_usulan u
      join pdt_upload_batch b on b.id = u.batch_id
     where b.client_platform_id = ${clientPlatformId}
       and u.batch_id <> ${batchId}
       and u.dievaluasi_pada is null
       and u.kode_aksi = any(${KATALOG_KODE})`;

  for (const p of pending) {
    const hasil = hasilByKode.get(p.kode_aksi);
    if (!hasil) continue; // metrik periode baru tidak terhitung (mis. biaya/gmv nol) — tetap pending, dievaluasi batch berikutnya
    const verdict = pdt.tentukanVerdict(p.plan_ref, hasil.nilaiSekarang, Number(p.target_nilai), hasil.arah);
    await sql`
      update pdt_usulan
         set realisasi_nilai = ${hasil.nilaiSekarang}, verdict = ${verdict}, dievaluasi_pada = now()
       where id = ${p.id}`;
  }
}

async function bukaUsulanBaru(sql: Queryable, batchId: number, hasilByKode: ReadonlyMap<string, HasilUntukTulis>): Promise<void> {
  for (const kode of KATALOG_KODE) {
    const hasil = hasilByKode.get(kode);
    if (!hasil || !hasil.menyala) continue;

    const existing = await sql<{ id: number }[]>`
      select id from pdt_usulan where batch_id = ${batchId} and kode_aksi = ${kode}`;
    if (existing.length > 0) {
      await sql`
        update pdt_usulan
           set nilai_sekarang = ${hasil.nilaiSekarang}, satuan_sekarang = ${hasil.satuanSekarang},
               target_nilai = ${hasil.targetNilai}, satuan_target = ${hasil.satuanTarget}
         where id = ${existing[0].id}`;
    } else {
      await sql`
        insert into pdt_usulan
          (batch_id, kode_aksi, nilai_sekarang, satuan_sekarang, target_nilai, satuan_target, dibuat_oleh)
        values
          (${batchId}, ${kode}, ${hasil.nilaiSekarang}, ${hasil.satuanSekarang}, ${hasil.targetNilai}, ${hasil.satuanTarget}, 'SYSTEM')`;
    }
  }
}

/**
 * Entry point (dipanggil `pdt.ts` di dalam transaksi commit/reparse, HANYA
 * untuk `platform === 'shopee'` dan `status === 'verified'`). `sql` di sini
 * SELALU `tx` pemanggil — seluruh tulisan usulan ikut rollback bila batch
 * itu sendiri gagal ditulis.
 */
export async function evaluasiVerdictShopee(sql: Queryable, batchId: number, clientPlatformId: number, periodeAwalBulan: string): Promise<void> {
  const hasilByKode = new Map<string, HasilUntukTulis>();

  const bench = await bacaBenchmarkAktifShopeeVerdict(sql);
  if (bench) {
    const adsRows = await bacaFaktaAds(sql, clientPlatformId, periodeAwalBulan);
    const sigmaGmv = adsRows.reduce((acc, r) => acc + (r.gmv ?? 0), 0);
    const sigmaBiaya = adsRows.reduce((acc, r) => acc + r.biaya, 0);

    const roas = pdt.evaluasiRoasShopee(sigmaGmv, sigmaBiaya, bench);
    if (roas) hasilByKode.set(roas.kodeAksi, roas);
    const acos = pdt.evaluasiAcosShopee(sigmaBiaya, sigmaGmv, bench);
    if (acos) hasilByKode.set(acos.kodeAksi, acos);
  } // pdt_benchmark platform='shopee' belum ada versi aktif — usulan bukan gerbang upload (Rule 4), lewati diam-diam untuk ROAS/ACoS saja

  const creatorRows = await bacaFaktaCreatorPeriode(sql, clientPlatformId, periodeAwalBulan);
  const jumlahKreatorAktif = creatorRows.filter((r) => (r.gmv ?? 0) > 0).length;
  const kreatorAktif = pdt.evaluasiKreatorAktifShopee(jumlahKreatorAktif);
  hasilByKode.set(kreatorAktif.kodeAksi, kreatorAktif);

  await tutupUsulanLama(sql, clientPlatformId, batchId, hasilByKode);
  await bukaUsulanBaru(sql, batchId, hasilByKode);
}
