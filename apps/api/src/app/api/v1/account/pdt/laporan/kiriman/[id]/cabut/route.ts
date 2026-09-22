/**
 * POST /api/v1/account/pdt/laporan/kiriman/{id}/cabut — M20 Gelombang C
 * (C-03): `[Terbit]` → `[Dicabut]` (R5). Body `{ alasan }` WAJIB diisi
 * (`MSG_ALASAN_CABUT_WAJIB`) — PRD §5 "Cabut ... wajib mengisi alasan".
 *
 * R6 (hitung ulang `total_sales`/Health Score/baseline Ads DALAM transaksi
 * yang sama) SENGAJA di luar cakupan — Gelombang E (E-02) belum ship, lihat
 * docblock `pdt.cabutKiriman`.
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
    const body = (await request.json().catch(() => ({}))) as { alasan?: unknown };
    const alasan = typeof body.alasan === 'string' ? body.alasan : '';
    const pub = await pdt.cabutKiriman(db(), actor, kirimanId, alasan);
    return json(pdtLaporanPublikasiToWire(pub));
  });
}
