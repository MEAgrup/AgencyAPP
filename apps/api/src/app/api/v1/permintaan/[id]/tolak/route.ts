/**
 * POST /api/v1/permintaan/{id}/tolak — [Diajukan]|[Diproses] → [Ditolak].
 * Body: { alasan } — MANDATORY.
 */
import { req } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { permintaanToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ alasan?: string }>(request);
    const p = await req.rejectPermintaan(db(), actor, id, b.alasan ?? '');
    return json(permintaanToWire(p));
  });
}
