/**
 * POST /api/v1/account/pdt/laporan/kiriman/{id}/insight/reset — M20
 * Gelombang C (C-03), tombol "Reset ke narasi mesin" (C-04). Menulis revisi
 * BARU = salinan revisi 0 (mesin), `sumber` tetap `'am'` — lihat docblock
 * `pdt.resetInsightKiriman`. Nol body.
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { pdtLaporanInsightRowToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const kirimanId = Number((await ctx.params).id);
    if (!Number.isInteger(kirimanId) || kirimanId <= 0) {
      throw new BadRequestError('id is required (positive integer)');
    }
    const row = await pdt.resetInsightKiriman(db(), actor, kirimanId);
    return json(pdtLaporanInsightRowToWire(row));
  });
}
