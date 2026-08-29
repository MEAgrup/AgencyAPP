/**
 * GET /api/v1/permintaan/{id} — one Permintaan (REQ-), read-gated by canView
 * (mirror of RLS `permintaan_select`). Keterlambatan derived at read time.
 */
import { req } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { permintaanToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const p = await readAsActor(actor, (sql) => req.getPermintaan(sql, actor, id));
    return json(permintaanToWire(p));
  });
}
