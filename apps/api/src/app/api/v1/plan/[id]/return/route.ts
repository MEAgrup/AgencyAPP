/**
 * POST /api/v1/plan/{id}/return — period 1 `Diajukan → Draft` (Rule 3): the SPV
 * sends it back with a MANDATORY note, which lands in the immutable audit log
 * (Rule 19). The empty-note rejection + the Account-lead gate live in the domain.
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planToWire } from '@/lib/wire';

interface ReturnBody {
  catatan?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<ReturnBody>(request);
    return json(planToWire(await plan.returnPlanPeriode(db(), actor, id, b.catatan ?? '')));
  });
}
