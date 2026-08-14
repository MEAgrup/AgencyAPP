/**
 * POST /api/v1/rekap/{id}/close — `Terbuka → Ditutup` (Rule 8, the owning AM
 * confirms the week). The domain belt checks completeness first: RM-A6 opening
 * note present, RM-D1/RM-D3 narrative present, and every required RM-C metric
 * filled-or-`—`; then the transition; then `catatan_divisi_belum_diisi` fires
 * for every touching division that still owes a note. No body. Returns the recap.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { recapToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const closed = await recap.closeRecap(db(), actor, id);
    return json(recapToWire(closed));
  });
}
