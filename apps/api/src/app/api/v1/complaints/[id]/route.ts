/**
 * GET /api/v1/complaints/{id} — one Complaint, if the actor may read it (M6 §8
 * Rule 4 / §9.1: OD/Director, Account lead, owning AM, or the related Brief's
 * division staff/lead). Ports Go's handleGetComplaint.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { complaintToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const c = await account.getComplaint(db(), actor, id);
    return json(complaintToWire(c));
  });
}
