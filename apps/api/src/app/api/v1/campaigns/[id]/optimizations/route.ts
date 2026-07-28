/**
 * /api/v1/campaigns/{id}/optimizations — the Optimization Log (M8 §6).
 *
 * POST: record one Optimization entry (a >50% budget change needs sign-off; a
 * Creative Swap re-points linkage). Ports Go's handleLogOptimization.
 * GET: the campaign's Optimization Log in id order (view-gated). Ports Go's
 * handleListOptimizations.
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { optimizationToWire, toOptimizationInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toOptimizationInput>[0]>(request);
    const o = await ads.logOptimization(db(), actor, id, toOptimizationInput(b));
    return json(optimizationToWire(o));
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await readAsActor(actor, (sql) => ads.listOptimizations(sql, actor, id));
    return json({ data: rows.map(optimizationToWire) });
  });
}
