/**
 * POST /api/v1/services/{id}/strategy-requirement — per-engagement override of a
 * Service's "Requires Strategy Plan" flag (M6-OA-1). Owning AM / Account lead /
 * Director; only while [Awaiting Onboarding] and before any Plan exists; reason
 * mandatory and logged (never mutates the pinned MSL flag). Body: {
 * requires_strategy_plan, reason }. Ports Go's handleSetStrategyRequirement.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategyRequirementToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ requires_strategy_plan?: boolean; reason?: string }>(request);
    const req = await account.setStrategyRequirement(db(), actor, id, b.requires_strategy_plan === true, b.reason ?? '');
    return json(strategyRequirementToWire(req));
  });
}
