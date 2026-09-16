/**
 * POST/GET /api/v1/internal/pdt/reparse/tick — PDT G1-11, job reparse
 * (Flow D — `docs/backlog/PDT_BACKLOG.md` G1-11,
 * `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §3/§4).
 *
 * Driven by an EXTERNAL cron — Vercel Cron, sama pola `plan`/`health`/
 * `performance`/`penugasan`/`pdt/purge` tick — bukan pengguna yang login,
 * jadi TIDAK memverifikasi JWT. Gerbangnya `x-plan-tick-secret`/
 * `Authorization: Bearer` (`@/lib/tick-auth`, secret DIBAGI dengan tick
 * lain); secret tidak dikonfigurasi ⇒ endpoint TERTUTUP.
 *
 * Kedua verb menjalankan tick yang SAMA: POST (curl/GitHub Actions) dan GET
 * (Vercel Cron, tidak bisa membawa body) — beda dari `pdt/purge/tick`, tick
 * ini TIDAK menerima override tanggal (Flow D tidak berbasis tanggal-hari-
 * ini seperti retensi, ia membandingkan `parser_versi` batch terhadap
 * `PDT_PARSER_VERSI` KODE SAAT INI, sesuatu yang tidak masuk akal di-backfill
 * ke tanggal lampau).
 *
 * Urutan kerja (Flow D langkah 2-4, lihat docblock seksi G1-11
 * `packages/domain/src/pdt.ts` untuk cakupan TERBARU — keputusan pemilik
 * G1-11-REPARSE-RECOMPUTE-STATUS mewajibkan `pdt.reparsePdtBatch` menjalankan
 * ULANG identitas+rekonsiliasi, bukan hanya baris fakta):
 *   1. `pdt.planPdtReparseTick` — pilih batch `parser_versi < PDT_PARSER_VERSI`
 *      DAN `raw_path IS NOT NULL`, dipecah `kandidat` (paket masih ada) vs
 *      `perluUploadUlang` (paket sudah dipurge — Flow D langkah 4: dilaporkan
 *      sebagai daftar, BUKAN digagalkan diam-diam).
 *   2. Untuk TIAP kandidat: unduh `rawPath` (`unduhPdtRawObjek`) → ekstrak ZIP
 *      (`bacaDanEkstrakPdtZip`, G1-04) → deteksi+parse TIAP entri
 *      (`parsePdtZipEntries`, G1-05, dengan `PDT_MODULES`/`tandaTanganKolom`
 *      TERKINI — bug deteksi yang sudah diperbaiki sejak commit asli ikut
 *      membetulkan batch lama) → `bangunPreviewBerkasInputs` → `pdt.reparsePdtBatch`
 *      (menulis ulang baris fakta + status/identitas/rekonsiliasi hasil
 *      recompute + menaikkan `parser_versi` + audit).
 *      SATU per SATU, di lapisan route — kegagalan satu batch (unduh gagal,
 *      ZIP rusak, konflik `uq_pdt_upload_batch_verified`, dst.) TIDAK
 *      menghentikan batch lain dalam tick yang sama (Rule 46 error path,
 *      pola sama purge); batch gagal tetap kandidat tick besok
 *      (`parser_versi`-nya belum bertambah).
 *   3. Respons merekap jumlah berhasil/gagal + daftar `perlu_upload_ulang`
 *      (batch_id + tanggal purge — Flow D langkah 4: "UI wajib menyebut
 *      tanggal purge-nya, bukan hanya 'tidak tersedia'"; UI konsumen daftar
 *      ini BELUM dibangun sesi ini, hanya endpoint tick-nya).
 *
 * Route ini TIDAK punya pemanggil `web-internal` by design (route-parity
 * adalah FE→API): cron adalah satu-satunya klien.
 */
import { pdt } from '@cdps/core';
import { pdt as pdtDomain } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { bangunPreviewBerkasInputs } from '@/lib/pdt-preview';
import { unduhPdtRawObjek } from '@/lib/pdt-storage';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from '@/lib/pdt-zip';
import { parsePdtZipEntries } from '@/lib/pdt-parse';
import { tickSecretOk } from '@/lib/tick-auth';

const { PDT_MODULES } = pdt;

async function reparseSatuKandidat(sql: ReturnType<typeof db>, kandidat: pdtDomain.PdtReparseCandidate): Promise<boolean> {
  let direktoriSementara: string | null = null;
  try {
    const buf = await unduhPdtRawObjek(kandidat.rawPath);
    const zipHasil = await bacaDanEkstrakPdtZip(buf);
    direktoriSementara = zipHasil.direktoriSementara;
    if (!zipHasil.pagar.ok) return false;

    const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
    const inputs = bangunPreviewBerkasInputs(zipHasil, parseHasil);
    const hasil = await pdtDomain.reparsePdtBatch(sql, kandidat.batchId, inputs);
    return hasil.direparse;
  } catch {
    // Rule 46 error path — sama pola purge: satu batch gagal (unduh/ekstrak/
    // parse) TIDAK menghentikan batch lain dalam tick yang sama.
    return false;
  } finally {
    if (direktoriSementara) await bersihkanDirektoriSementaraPdt(direktoriSementara);
  }
}

/** The tick itself, shared by GET (Vercel Cron) and POST (curl / GitHub Actions). */
async function runTick(): Promise<Response> {
  const sql = db();
  const rencana = await pdtDomain.planPdtReparseTick(sql);

  let direparse = 0;
  let gagal = 0;
  for (const kandidat of rencana.kandidat) {
    if (await reparseSatuKandidat(sql, kandidat)) direparse += 1;
    else gagal += 1;
  }

  return json({
    direparse,
    gagal,
    perlu_upload_ulang: rencana.perluUploadUlang.map((s) => ({ batch_id: s.batchId, raw_dihapus_pada: s.rawDihapusPada })),
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick();
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick();
  });
}
