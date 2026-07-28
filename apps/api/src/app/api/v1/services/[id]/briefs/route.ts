/**
 * /api/v1/services/{id}/briefs — the Briefs of a Service (M6 §5).
 *
 * POST: break the Service down into one Brief for a target division (owning AM or
 * Director; Strategy gate enforced). Ports Go's handleCreateBrief.
 * GET: all Briefs of the Service (§5 fan-out), readable by the owning AM, Account
 * lead, OD/Director. Ports Go's handleListServiceBriefs.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { briefToWire, toBriefInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toBriefInput>[0]>(request);
    const brief = await account.createBrief(db(), actor, id, toBriefInput(b));
    return json(briefToWire(brief));
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await readAsActor(actor, (sql) => account.listServiceBriefs(sql, actor, id));
    return json({ data: rows.map(briefToWire) });
  });
}
