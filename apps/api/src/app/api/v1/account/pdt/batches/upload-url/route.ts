/**
 * POST /api/v1/account/pdt/batches/upload-url — PDT G1-09-BODY-BESAR
 * (`docs/DECISIONS.md` 2026-09-13), mendahului Flow A langkah 2.
 *
 * ZIP TIDAK PERNAH lewat badan request route Next.js — limit keras platform
 * deploy (Vercel Serverless Functions) untuk badan request adalah 4,5 MB,
 * jauh di bawah Rule 42 (paket ZIP boleh sampai 50 MB). Route ini HANYA
 * menegakkan gerbang izin (`pdt.siapkanUploadBatch`) dan meminta signed
 * upload URL ke Storage (`buatPdtRawSignedUploadUrl`) — nol berkas disentuh
 * di sini. Browser meng-PUT ZIP LANGSUNG ke `upload_url` yang dikembalikan,
 * lalu memanggil `POST /account/pdt/batches/preview` dengan `storage_path`
 * yang sama untuk memicu deteksi (route itu yang mengunduh baliknya lewat
 * `unduhPdtRawObjek`, server-ke-server — bukan lewat badan request).
 *
 * Body: JSON `{ client_platform_id }`.
 */
import { pdt as pdtDomain } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { buatPdtRawSignedUploadUrl } from '@/lib/pdt-storage';
import { pdtUploadUrlToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);

    const body = (await request.json().catch(() => ({}))) as { client_platform_id?: unknown };
    const clientPlatformId = typeof body.client_platform_id === 'number' ? body.client_platform_id : NaN;
    if (!Number.isInteger(clientPlatformId) || clientPlatformId <= 0) {
      throw new BadRequestError('client_platform_id is required (positive integer)');
    }

    const siap = await pdtDomain.siapkanUploadBatch(db(), actor, clientPlatformId);
    const uploadUrl = await buatPdtRawSignedUploadUrl(siap.stagingPath);
    return json(pdtUploadUrlToWire(siap, uploadUrl));
  });
}
