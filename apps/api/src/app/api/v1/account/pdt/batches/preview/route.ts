/**
 * POST /api/v1/account/pdt/batches/preview — PDT G1-09 Flow A langkah 2-5,
 * SEBELUM disimpan (PRD `docs/prd/CDPS_PDT_Pusat_Data_Toko.md`, backlog
 * `docs/backlog/PDT_BACKLOG.md` G1-09).
 *
 * Body: bytes ZIP MENTAH (`application/zip`/`application/octet-stream`), query
 * `client_platform_id`. Route ini HANYA membaca+memparse+mendeteksi (G1-04
 * `bacaDanEkstrakPdtZip` → G1-05 `parsePdtZipEntries` → G1-09
 * `previewUploadBatch`) dan mengembalikan tabel hasil deteksi — nol tulis DB,
 * nol upload ke bucket `pdt-raw`. Sub-langkah commit (menulis
 * `pdt_upload_batch`/`pdt_file`, mengunggah paket) BELUM ada di sini — lihat
 * handoff sesi ini untuk batasnya.
 *
 * Direktori sementara G1-04 (`zipHasil.direktoriSementara`) SELALU dibersihkan
 * di `finally` — pratinjau tidak pernah menyisakan file di disk sementara
 * server, apa pun hasilnya (sukses, gagal domain, atau exception).
 */
import { pdt } from '@cdps/core';
import { pdt as pdtDomain } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { bangunPreviewBerkasInputs } from '@/lib/pdt-preview';
import { pdtPreviewBatchToWire } from '@/lib/wire';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from '@/lib/pdt-zip';
import { parsePdtZipEntries } from '@/lib/pdt-parse';

const { PDT_MODULES, formatAlasanTolakPaket } = pdt;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);

    const clientPlatformIdRaw = new URL(request.url).searchParams.get('client_platform_id');
    const clientPlatformId = clientPlatformIdRaw ? Number(clientPlatformIdRaw) : NaN;
    if (!clientPlatformIdRaw || !Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }

    const buf = Buffer.from(await request.arrayBuffer());
    let zipHasil;
    try {
      zipHasil = await bacaDanEkstrakPdtZip(buf);
    } catch {
      // `yauzl` MELEMPAR (bukan mengembalikan hasil) untuk buffer yang bukan ZIP
      // sama sekali (kosong/rusak/format lain) — beda dari Rule 42 (pagar
      // menolak PAKET ZIP yang valid tapi melebihi ambang). Keduanya 400 —
      // AM salah unggah berkas, bukan kegagalan server.
      throw new BadRequestError("[berkas yang diunggah bukan paket ZIP yang valid]");
    }
    try {
      if (!zipHasil.pagar.ok) {
        // Rule 42 — paket ditolak SEBELUM entri mana pun dibaca. 400, bukan 500:
        // ini penolakan VALIDASI (ukuran/jumlah entri/rasio), bukan kegagalan server.
        throw new BadRequestError(formatAlasanTolakPaket(zipHasil.pagar.alasanTolakPaket!));
      }

      const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
      const inputs = bangunPreviewBerkasInputs(zipHasil, parseHasil);
      const hasil = await pdtDomain.previewUploadBatch(db(), actor, clientPlatformId, inputs);
      return json(pdtPreviewBatchToWire(hasil));
    } finally {
      if (zipHasil.direktoriSementara) await bersihkanDirektoriSementaraPdt(zipHasil.direktoriSementara);
    }
  });
}
