/**
 * POST /api/v1/account/pdt/batches/konfirmasi-identitas — G1-09-KONFIRMASI-
 * IDENTITAS (`docs/backlog/PDT_BACKLOG.md`, terbuka sejak sub-langkah 2a,
 * ditutup sesi ini), Rule 2 (Shopee)/Rule 4 (TikTok): AM mengonfirmasi SEKALI
 * usulan identitas batch `identitas_belum_terikat`.
 *
 * Body: JSON `{ batch_id }`.
 *
 * Dua langkah: (1) `pdt.konfirmasiIdentitasBatch` mengikat nilai yang
 * diusulkan sistem ke `client_platforms.shop_id`/`akun_konten_toko` PERMANEN
 * (domain, satu transaksi, gerbang izin `canUploadBatch` — sama lingkup yang
 * boleh mengunggah batch toko itu); (2) route ini SEGERA menjalankan ulang
 * pipeline reparse (G1-11, pola SAMA `internal/pdt/reparse/tick`) untuk batch
 * yang SAMA, supaya AM melihat batch pindah dari `identitas_belum_terikat`
 * ke `verified`/`parsing`/`ditolak` tanpa menunggu tick harian besok.
 *
 * Paket sudah dipurge (`raw_dihapus_pada` terisi) atau reparse gagal ⇒
 * identitas TETAP terikat (langkah 1 sudah commit sebelum langkah 2 dicoba),
 * `status_setelah_reparse` dibalas `null` — AM tahu identitas sudah terikat
 * tapi batch INI perlu diunggah ulang untuk lolos ke `verified` (Flow D
 * langkah 4, pola sama tick: dilaporkan, bukan digagalkan diam-diam).
 */
import { pdt } from '@cdps/core';
import { pdt as pdtDomain } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { bangunPreviewBerkasInputs } from '@/lib/pdt-preview';
import { unduhPdtRawObjek } from '@/lib/pdt-storage';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from '@/lib/pdt-zip';
import { parsePdtZipEntries } from '@/lib/pdt-parse';
import { pdtKonfirmasiIdentitasToWire } from '@/lib/wire';

const { PDT_MODULES } = pdt;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = (await request.json().catch(() => ({}))) as { batch_id?: unknown };
    const batchId = typeof body.batch_id === 'number' ? body.batch_id : NaN;
    if (!Number.isInteger(batchId) || batchId <= 0) {
      throw new BadRequestError('batch_id is required (positive integer)');
    }

    const ikat = await pdtDomain.konfirmasiIdentitasBatch(db(), actor, batchId);

    // Paket belum pernah selesai diunggah (nol raw_path) atau sudah dipurge — identitas
    // sudah terikat, tapi reparse langsung tidak mungkin. AM perlu unggah ulang batch baru.
    if (ikat.rawPath == null || ikat.rawDihapusPada != null) {
      return json(pdtKonfirmasiIdentitasToWire(ikat, null));
    }

    let direktoriSementara: string | null = null;
    try {
      const buf = await unduhPdtRawObjek(ikat.rawPath);
      const zipHasil = await bacaDanEkstrakPdtZip(buf);
      direktoriSementara = zipHasil.direktoriSementara;
      if (!zipHasil.pagar.ok) return json(pdtKonfirmasiIdentitasToWire(ikat, null));

      const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
      const inputs = bangunPreviewBerkasInputs(zipHasil, parseHasil);
      const hasilReparse = await pdtDomain.reparsePdtBatch(db(), batchId, inputs);
      return json(pdtKonfirmasiIdentitasToWire(ikat, hasilReparse.direparse ? hasilReparse.status : null));
    } catch {
      // Identitas SUDAH terikat (langkah 1 sukses, di luar try ini) — kegagalan reparse
      // di sini tidak membatalkannya; batch akan diambil tick reparse harian berikutnya.
      return json(pdtKonfirmasiIdentitasToWire(ikat, null));
    } finally {
      if (direktoriSementara) await bersihkanDirektoriSementaraPdt(direktoriSementara);
    }
  });
}
