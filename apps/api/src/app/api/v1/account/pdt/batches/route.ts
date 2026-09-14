/**
 * POST /api/v1/account/pdt/batches — PDT G1-09 sub-langkah 2a+2b-i: commit
 * (Flow A langkah 6 sisi batch/berkas + langkah 7 rekonsiliasi Shopee +
 * langkah 9 error path). Beda dari `/preview`
 * (`docs/backlog/PDT_BACKLOG.md` G1-09, `docs/prd/CDPS_PDT_Pusat_Data_Toko.md`):
 * ini benar-benar MENULIS `pdt_upload_batch`/`pdt_file` dan mengunggah paket
 * ZIP ke path FINAL Rule 44 — bukan sekadar pratinjau.
 *
 * Body: JSON `{ client_platform_id, storage_path, overrides? }` — bentuk yang
 * SAMA dengan `/preview` (`storage_path` = path staging dari
 * `POST .../upload-url`), plus `overrides` opsional: array
 * `{ nama, modul_kode }` untuk berkas yang AM timpa dari dropdown (PRD Flow A
 * langkah 4, `module_options` pratinjau).
 *
 * **Pipeline DIJALANKAN ULANG** dari `storage_path` yang sama — route ini
 * TIDAK menerima cache hasil `/preview` dari klien (`docs/DECISIONS.md`
 * 2026-09-14, alasan lengkap di kepala `pdt.commitUploadBatch`). Urutan:
 * unduh ZIP staging (server-ke-server) → G1-04 → G1-05 → G1-09
 * `pdt.commitUploadBatch` (menulis batch+file+rekonsiliasi dalam SATU
 * transaksi) → unggah byte yang SAMA ke path final Rule 44
 * (`unggahPdtRawObjek`) → `pdt.markRawStored` (mengisi
 * `raw_path`/`raw_sha256`/`raw_bytes`/dst.).
 *
 * **Rekonsiliasi (Rule 13-16, sub-langkah 2b-i) — Shopee saja, basis Siap
 * Dikirim, GMV saja** (nol kolom jumlah-pesanan per-SKU terverifikasi,
 * `G1-07-PERSKU-PESANAN`, `docs/DECISIONS.md`) — `commitUploadBatch` yang
 * menjalankannya, route ini tidak menyentuh logikanya sama sekali. `status`
 * hasil commit BISA `'verified'` sekarang (bukan lagi selalu berhenti di
 * `'parsing'`) untuk batch Shopee yang lolos ambang. Penulisan baris fakta
 * tertipe (Flow A langkah 8) + rekonsiliasi TikTok
 * (`G1-07-TIKTOK-REKONSILIASI`, Open) BELUM ada — sub-langkah 2b-ii.
 */
import { pdt } from '@cdps/core';
import { pdt as pdtDomain } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { hitungPdtCommitRawMeta } from '@/lib/pdt-commit';
import { bangunPreviewBerkasInputs } from '@/lib/pdt-preview';
import { unduhPdtRawObjek, unggahPdtRawObjek } from '@/lib/pdt-storage';
import { bacaDanEkstrakPdtZip, bersihkanDirektoriSementaraPdt } from '@/lib/pdt-zip';
import { parsePdtZipEntries } from '@/lib/pdt-parse';
import { pdtCommitBatchToWire } from '@/lib/wire';

const { PDT_MODULES, formatAlasanTolakPaket } = pdt;

interface OverrideBody {
  nama?: unknown;
  modul_kode?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);

    const body = (await request.json().catch(() => ({}))) as {
      client_platform_id?: unknown;
      storage_path?: unknown;
      overrides?: unknown;
    };
    const clientPlatformId = typeof body.client_platform_id === 'number' ? body.client_platform_id : NaN;
    if (!Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }
    const storagePath = body.storage_path;
    if (typeof storagePath !== 'string' || storagePath === '') {
      throw new BadRequestError('storage_path is required');
    }
    const overridesRaw = Array.isArray(body.overrides) ? (body.overrides as OverrideBody[]) : [];
    const overrides: pdtDomain.PdtCommitOverride[] = overridesRaw.map((o, i) => {
      if (typeof o.nama !== 'string' || o.nama === '' || typeof o.modul_kode !== 'string' || o.modul_kode === '') {
        throw new BadRequestError(`overrides[${i}] harus { nama: string, modul_kode: string }`);
      }
      return { nama: o.nama, modulKode: o.modul_kode };
    });

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
      throw new BadRequestError('[berkas yang diunggah bukan paket ZIP yang valid]');
    }
    try {
      if (!zipHasil.pagar.ok) {
        throw new BadRequestError(formatAlasanTolakPaket(zipHasil.pagar.alasanTolakPaket!));
      }

      const parseHasil = await parsePdtZipEntries(zipHasil.diekstrak, PDT_MODULES);
      const inputs = bangunPreviewBerkasInputs(zipHasil, parseHasil);
      const persiapan = await pdtDomain.commitUploadBatch(db(), actor, clientPlatformId, inputs, overrides);

      await unggahPdtRawObjek(persiapan.rawPath, buf);
      await pdtDomain.markRawStored(db(), persiapan.batchId, persiapan.rawPath, hitungPdtCommitRawMeta(zipHasil, buf));

      return json(pdtCommitBatchToWire(persiapan));
    } finally {
      if (zipHasil.direktoriSementara) await bersihkanDirektoriSementaraPdt(zipHasil.direktoriSementara);
    }
  });
}
