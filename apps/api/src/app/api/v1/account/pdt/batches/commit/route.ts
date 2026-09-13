/**
 * POST /api/v1/account/pdt/batches/commit — PDT G1-09 sub-langkah 2, Flow A
 * langkah 6-9 (PRD `docs/prd/CDPS_PDT_Pusat_Data_Toko.md`, backlog
 * `docs/backlog/PDT_BACKLOG.md` G1-09).
 *
 * Body: JSON `{ client_platform_id, storage_path, module_overrides?,
 * konfirmasi_ikat_identitas? }` — pola unduh-server-ke-server yang SAMA
 * dengan `POST .../preview` (`G1-09-BODY-BESAR`): ZIP tidak pernah lewat
 * badan request route ini, AM sudah meng-PUT ke Storage lewat signed upload
 * URL (`POST .../upload-url`), route ini mengunduhnya balik
 * (`unduhPdtRawObjek`) sebelum pipeline G1-04/05/09 berjalan.
 *
 * Beda dari `preview`: route ini MENULIS DB (`pdt.commitUploadBatch`) dan,
 * sesudah baris batch ada, MEMINDAHKAN objek dari path staging ke path final
 * Rule 44 (`pindahkanPdtRawObjek`) — satu-satunya tempat kedua operasi itu
 * dirangkai, karena path final butuh `batch_id` yang baru lahir dari INSERT.
 * Kegagalan pemindahan (infra, SESUDAH baris batch ada) membalik status ke
 * `ditolak` (`pdt.tandaiBatchGagalRaw`) — Flow A langkah 9: baris TETAP
 * tersimpan, bukan rollback total. Lihat catatan §komit di kepala
 * `packages/domain/src/pdt.ts` untuk pembagian tanggung jawab lengkapnya.
 *
 * **Sub-langkah 2a (lingkup route ini):** hanya `pdt_upload_batch`/`pdt_file`
 * + (bila dikonfirmasi) ikat identitas `client_platforms`. Baris fakta
 * (`pdt_fact_*`), `pdt_usulan` (G4), `pdt_laporan_kiriman` (G2) BELUM ada di
 * sini — lihat `docs/backlog/PDT_BACKLOG.md` G1-09 §status.
 */
import { pdt } from '@cdps/core';
import { pdt as pdtDomain } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { bangunPreviewBerkasInputs } from '@/lib/pdt-preview';
import { pindahkanPdtRawObjek, unduhPdtRawObjek } from '@/lib/pdt-storage';
import { pdtCommitBatchToWire } from '@/lib/wire';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from '@/lib/pdt-zip';
import { parsePdtZipEntries } from '@/lib/pdt-parse';

const { PDT_MODULES, formatAlasanTolakPaket } = pdt;

interface CommitBody {
  client_platform_id?: unknown;
  storage_path?: unknown;
  module_overrides?: unknown;
  konfirmasi_ikat_identitas?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);

    const body = (await request.json().catch(() => ({}))) as CommitBody;
    const clientPlatformId = typeof body.client_platform_id === 'number' ? body.client_platform_id : NaN;
    if (!Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }
    const storagePath = body.storage_path;
    if (typeof storagePath !== 'string' || storagePath === '') {
      throw new BadRequestError('storage_path is required');
    }
    const moduleOverrides =
      body.module_overrides != null && typeof body.module_overrides === 'object' && !Array.isArray(body.module_overrides)
        ? (body.module_overrides as Record<string, string>)
        : undefined;
    const konfirmasiIkatIdentitas = body.konfirmasi_ikat_identitas === true;

    let buf: Buffer;
    try {
      buf = await unduhPdtRawObjek(storagePath);
    } catch {
      throw new BadRequestError('[berkas yang diunggah tidak ditemukan di penyimpanan sementara, unggah ulang]');
    }

    let zipHasil;
    try {
      zipHasil = await bacaDanEkstrakPdtZip(buf);
    } catch {
      throw new BadRequestError("[berkas yang diunggah bukan paket ZIP yang valid]");
    }
    try {
      if (!zipHasil.pagar.ok) {
        throw new BadRequestError(formatAlasanTolakPaket(zipHasil.pagar.alasanTolakPaket!));
      }

      const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
      const inputs = bangunPreviewBerkasInputs(zipHasil, parseHasil);
      const entriDilewati = zipHasil.pagar.entri.filter((e) => e.keputusan.kode === 'dilewati').length;

      let hasil = await pdtDomain.commitUploadBatch(db(), actor, clientPlatformId, inputs, {
        moduleOverrides,
        konfirmasiIkatIdentitas,
        paket: {
          sha256Paket: zipHasil.sha256Paket,
          bytesPaket: buf.length,
          entriTotal: zipHasil.pagar.entri.length,
          entriDilewati,
        },
        sekarang: new Date(),
      });

      const finalPath = `${hasil.clientId}/${hasil.clientPlatformId}/${hasil.periodeSelesai}/${hasil.batchId}.zip`;
      try {
        await pindahkanPdtRawObjek(storagePath, finalPath);
        await pdtDomain.tandaiRawTersimpan(db(), hasil.batchId, finalPath);
      } catch (err) {
        const pesan = '[gagal memindahkan paket ke penyimpanan permanen, hubungi engineer]';
        await pdtDomain.tandaiBatchGagalRaw(db(), hasil.batchId, pesan, new Date());
        console.error('[pdt commit] pindahkanPdtRawObjek gagal:', err);
        hasil = { ...hasil, status: 'ditolak', alasanDitolak: pesan };
      }

      return json(pdtCommitBatchToWire(hasil));
    } finally {
      if (zipHasil.direktoriSementara) await bersihkanDirektoriSementaraPdt(zipHasil.direktoriSementara);
    }
  });
}
