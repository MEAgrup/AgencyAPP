/**
 * /api/v1/clients/{id}/complaints — Complaint door #2 (M6 §8), the AM-via-WhatsApp
 * channel.
 *
 * POST: the owning AM (or Director) manually logs a WhatsApp complaint; Source is
 * fixed, birth [Open], EvComplaintLogged fires. Ports Go's handleLogComplaint.
 * GET: the client's complaints (owning AM, Account lead, OD/Director). Ports Go's
 * handleListClientComplaints.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { complaintToWire, toComplaintInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toComplaintInput>[0]>(request);
    const c = await account.logComplaint(db(), actor, id, toComplaintInput(b));
    return json(complaintToWire(c));
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await account.listClientComplaints(db(), actor, id);
    return json({ data: rows.map(complaintToWire) });
  });
}
