/**
 * POST /api/v1/account/pdt/laporan/kiriman/{id}/terbitkan — M20 Gelombang C
 * (C-03), publikasi PERTAMA (R4/R5): `[Draf]` → `[Terbit]`, paku
 * `insight_revisi` ke revisi terbaru. `[Terbit]`/`[Dicabut]` ⇒
 * `pdt.ConflictError` `MSG_SUDAH_TERBIT` (pakai `POST .../terbitkan-ulang`).
 * Nol body.
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { pdtLaporanPublikasiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const kirimanId = Number((await ctx.params).id);
    if (!Number.isInteger(kirimanId) || kirimanId <= 0) {
      throw new BadRequestError('id is required (positive integer)');
    }
    const pub = await pdt.terbitkanKiriman(db(), actor, kirimanId);
    return json(pdtLaporanPublikasiToWire(pub));
  });
}
