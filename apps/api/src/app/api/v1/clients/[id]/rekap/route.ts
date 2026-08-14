/**
 * GET /api/v1/clients/{id}/rekap — a client's weekly-recap chain, newest week
 * first. Scope-gated in the domain (`listRecapsForClient`): the owning AM /
 * Account lead / OD+Director. Returns `{ data: RecapWire[] }`.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { recapToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await recap.listRecapsForClient(db(), actor, id);
    return json({ data: rows.map(recapToWire) });
  });
}
