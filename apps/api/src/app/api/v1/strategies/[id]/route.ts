/**
 * /api/v1/strategies/{id} — a Strategy & Plan (M6 §4).
 *
 * GET: one Strategy with its derived revision count, if the actor may read it
 * (owning AM / Account lead / OD / Director). Ports Go's handleGetStrategy.
 *
 * PUT: a draft-only content edit — owning AM (or Director), only in [Strategy
 * Drafting] (M6 §4). Ports Go's handleUpdateStrategy.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategyToWire, toStrategyInput } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const st = await readAsActor(actor, (sql) => account.getStrategy(sql, actor, id));
    return json(strategyToWire(st));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toStrategyInput>[0]>(request);
    await account.updateDraft(db(), actor, id, toStrategyInput(b));
    return json({ id });
  });
}
