/**
 * POST /api/v1/permintaan/{id}/selesai — [Diproses] → [Selesai].
 * Body: { catatan? } — optional context, not a gate.
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
    const b = await readJson<{ catatan?: string }>(request);
    const p = await req.completePermintaan(db(), actor, id, b.catatan ?? '');
    return json(permintaanToWire(p));
  });
}
