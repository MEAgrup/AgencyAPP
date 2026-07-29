/**
 * POST /api/v1/leads/delete-requests/{reqId}/reject — the Head refusing a lead
 * delete request (owner decision 2026-07-29, `docs/DECISIONS.md`).
 *
 * Same Head gate as `/approve` (Head of the lead's origin division, Director
 * everywhere). The lead is left exactly as it was; only the request row is
 * resolved, with the optional `note` kept as `decision_note`, and the requester is
 * notified through the same event both verdicts use. A request that was already
 * decided answers 409 `[permintaan hapus sudah diputuskan]`.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { deleteRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ reqId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { reqId } = await ctx.params;
    const body = await readJson<{ note?: string }>(request);
    const { request: req } = await leads.rejectDelete(db(), actor, reqId, body.note ?? '');
    return json({ request: deleteRequestToWire(req) }, 200);
  });
}
