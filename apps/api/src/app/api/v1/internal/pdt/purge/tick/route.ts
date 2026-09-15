/**
 * POST /api/v1/internal/pdt/purge/tick — PDT G1-10, job purge harian
 * (Flow E, Rule 45-49 — `docs/backlog/PDT_BACKLOG.md` G1-10,
 * `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §3/§4).
 *
 * Driven by an EXTERNAL cron — Vercel Cron, sama pola `plan`/`health`/
 * `performance`/`penugasan` tick — bukan pengguna yang login, jadi TIDAK
 * memverifikasi JWT. Gerbangnya `x-plan-tick-secret`/`Authorization: Bearer`
 * (`@/lib/tick-auth`, secret DIBAGI dengan tick lain — bukan kredensial
 * baru); secret tidak dikonfigurasi ⇒ endpoint TERTUTUP, tidak pernah
 * terbuka.
 *
 * Kedua verb menjalankan tick yang SAMA: POST (curl/GitHub Actions, dengan
 * override tanggal opsional) dan GET (Vercel Cron mengirim GET, tidak bisa
 * membawa body). `tanggal` (`YYYY-MM-DD`) di body POST menimpa tanggal WIB
 * untuk backfill/pengujian; default hari ini WIB.
 *
 * Urutan kerja (Flow E, dipecah dua PASS — masing-masing dipecah lagi dua
 * panggilan domain, lihat docblock `packages/domain/src/pdt.ts` untuk alasan
 * pemecahannya):
 *
 * **Pass pertama (langkah 1-4, batch `retensi_sampai` lewat):**
 *   1. `planPdtPurgeTick` — pilih kandidat (langkah 1) + pagar 5%/hari
 *      (langkah 3, Rule 48). Pagar terlampaui ⇒ kandidat kosong, notifikasi
 *      Director SUDAH dikirim di dalam fungsi ini, NOL objek disentuh.
 *   2. Untuk TIAP kandidat: `hapusPdtRawObjek` (`@/lib/pdt-storage`) —
 *      dipanggil SATU per SATU, di lapisan route (bukan domain), supaya
 *      kegagalan satu objek tidak menggagalkan objek lain dalam tick yang
 *      sama (Rule 46 error path). Gagal ⇒ dicatat `berhasil: false`, batch
 *      itu dicoba lagi tick besok (retensi_sampai-nya sudah lewat, jadi
 *      tetap jadi kandidat).
 *   3. `finalizePdtPurgeTick` — isi `raw_dihapus_pada` untuk yang berhasil +
 *      SATU entri `audit_log` merekap jumlah objek/byte (Rule 47).
 *
 * **Pass kedua (langkah 5, objek yatim > 7 hari, Rule 49 — G1-10-ORPHAN-PASS):**
 *   4. `listPdtRawObjekRekursif` (`@/lib/pdt-storage`) — list SELURUH objek
 *      bucket `pdt-raw` (I/O, lapisan route; domain tidak pernah bicara
 *      Storage REST).
 *   5. `planPdtOrphanPurgeTick` — bandingkan terhadap `pdt_upload_batch.raw_path`
 *      yang dikenal + umur (Rule 49: > 7 hari, `createdAt` tidak diketahui ⇒
 *      TIDAK PERNAH kandidat).
 *   6. Untuk TIAP kandidat: `hapusPdtRawObjek` SATU per SATU (Rule 46 error
 *      path, sama pass pertama).
 *   7. `finalizePdtOrphanPurgeTick` — SATU entri `audit_log`
 *      (`pdt_raw_orphan_purged`) merekap jumlah objek (Rule 47).
 *
 * Route ini TIDAK punya pemanggil `web-internal` by design (route-parity
 * adalah FE→API): cron adalah satu-satunya klien.
 */
import { tz } from '@cdps/core';
import { pdt } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { hapusPdtRawObjek, listPdtRawObjekRekursif } from '@/lib/pdt-storage';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  tanggal?: unknown;
}

/** The tick itself, shared by GET (Vercel Cron) and POST (curl / GitHub Actions). */
async function runTick(override: string | null): Promise<Response> {
  const today = override ?? tz.dateString(new Date());
  const sql = db();
  const rencana = await pdt.planPdtPurgeTick(sql, today);

  const hasil: pdt.PdtPurgeOutcome[] = [];
  for (const kandidat of rencana.kandidat) {
    try {
      await hapusPdtRawObjek(kandidat.rawPath);
      hasil.push({ batchId: kandidat.batchId, bytes: kandidat.rawBytes, berhasil: true });
    } catch {
      // Rule 46 error path: satu objek gagal dihapus TIDAK menghentikan
      // sisanya — batch ini tetap punya raw_dihapus_pada NULL, jadi tetap
      // jadi kandidat tick besok (retensi_sampai-nya sudah lewat).
      hasil.push({ batchId: kandidat.batchId, bytes: kandidat.rawBytes, berhasil: false });
    }
  }

  const rekap = await pdt.finalizePdtPurgeTick(sql, today, hasil);

  // Pass kedua (Rule 49, G1-10-ORPHAN-PASS) — jalan TERLEPAS dari hasil pass
  // pertama (termasuk saat pagar 5% pass pertama terlampaui): objek yatim
  // tidak dikenakan pagar itu (lihat docblock `planPdtOrphanPurgeTick`).
  const semuaObjek = await listPdtRawObjekRekursif();
  const rencanaYatim = await pdt.planPdtOrphanPurgeTick(sql, today, semuaObjek);
  const hasilYatim: pdt.PdtOrphanPurgeOutcome[] = [];
  for (const kandidat of rencanaYatim.kandidat) {
    try {
      await hapusPdtRawObjek(kandidat.path);
      hasilYatim.push({ path: kandidat.path, berhasil: true });
    } catch {
      // Rule 46 error path — sama pass pertama: satu objek gagal tidak
      // menghentikan sisanya, dicoba lagi tick besok (umurnya hanya bertambah).
      hasilYatim.push({ path: kandidat.path, berhasil: false });
    }
  }
  const rekapYatim = await pdt.finalizePdtOrphanPurgeTick(sql, today, hasilYatim);

  return json({
    today: rekap.today,
    dihapus: rekap.dihapus,
    bytes_dihapus: rekap.bytesDihapus,
    gagal: rekap.gagal,
    pagar_terlampaui: rencana.pagarTerlampaui,
    total_objek_aktif: rencana.totalObjekAktif,
    ambang_objek: rencana.ambangObjek,
    yatim_dihapus: rekapYatim.dihapus,
    yatim_gagal: rekapYatim.gagal,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const override =
      typeof body.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.tanggal)
        ? body.tanggal
        : null;
    return runTick(override);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick(null);
  });
}
