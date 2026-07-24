/**
 * POST /api/v1/services/{id}/strategy — draft a Strategy & Plan for a plan-gated
 * Service (M6 §4 Rules 1, 6). Owning AM (or Director) only, while the Service is
 * [Awaiting Onboarding], once (1:1). Ports Go's handleCreateStrategy.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategyToWire, toStrategyInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toStrategyInput>[0]>(request);
    const st = await account.createStrategy(db(), actor, id, toStrategyInput(b));
    return json(strategyToWire(st));
  });
}
