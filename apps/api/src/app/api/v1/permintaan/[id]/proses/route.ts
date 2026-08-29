/**
 * POST /api/v1/permintaan/{id}/proses — [Diajukan] → [Diproses]. The resolved
 * tujuan (named employee or anyone in the destination division) or Director.
 */
import { req } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { permintaanToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const p = await req.processPermintaan(db(), actor, id);
    return json(permintaanToWire(p));
  });
}
