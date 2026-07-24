/**
 * POST /api/v1/clients/{id}/assign-am — assign an Account Manager to a released,
 * currently-unassigned client (M6 §3 Rules 2–4). SPV/Head Account or Director
 * only; the assignee must be active Account staff. Body: { am_id }. Ports Go's
 * handleAssignAM. Invalid AM → 400, Forbidden → 403, NotFound → 404,
 * AlreadyAssigned → 409 (shared error mapper).
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
    const b = await readJson<{ am_id?: string }>(request);
    const res = await account.assignAM(db(), actor, id, b.am_id ?? '');
    return json(assignmentToWire(res));
  });
}
