/**
 * POST /api/v1/clients/{id}/reassign-am — move a client from its current AM to a
 * new one (M6 §3 Rule 3, M6-OA-6 coverage). SPV/Head Account or Director only;
 * reason mandatory and logged; target must be a valid, active Account AM and
 * differ from the current owner. Body: { am_id, reason }. Ports Go's
 * handleReassignAM. Invalid AM / missing reason → 400, Forbidden → 403,
 * NotFound → 404, NotAssigned / SameAM → 409 (shared error mapper).
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { assignmentToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ am_id?: string; reason?: string }>(request);
    const res = await account.reassignAM(db(), actor, id, b.am_id ?? '', b.reason ?? '');
    return json(assignmentToWire(res));
  });
}
