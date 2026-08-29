/**
 * GET /api/v1/clients/{id}/permintaan — every Permintaan (REQ-) tied to this
 * client, view-gated per row (mirror of RLS `permintaan_select`).
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
    const rows = await readAsActor(actor, (sql) => req.listPermintaanForClient(sql, actor, id));
    return json({ data: rows.map(permintaanToWire) });
  });
}
