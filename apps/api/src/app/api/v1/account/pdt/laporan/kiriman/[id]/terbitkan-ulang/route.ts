/**
 * POST /api/v1/account/pdt/laporan/kiriman/{id}/terbitkan-ulang — M20
 * Gelombang C (C-03), "Terbitkan pembaruan" (R4) SETELAH laporan dicabut:
 * `[Dicabut]` → `[Terbit]`, paku pindah ke revisi terbaru. `[Draf]` (belum
 * pernah terbit) ⇒ `MSG_BELUM_TERBIT`; masih `[Terbit]` ⇒ `MSG_SUDAH_TERBIT`
 * (cabut dulu — lihat docblock `pdt.terbitkanUlangKiriman`). Nol body.
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
    const pub = await pdt.terbitkanUlangKiriman(db(), actor, kirimanId);
    return json(pdtLaporanPublikasiToWire(pub));
  });
}
