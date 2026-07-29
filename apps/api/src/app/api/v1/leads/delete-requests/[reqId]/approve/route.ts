/**
 * POST /api/v1/leads/delete-requests/{reqId}/approve — the Head's ACC on a lead
 * delete request (owner decision 2026-07-29, `docs/DECISIONS.md`).
 *
 * Requires Head authority over the lead's ORIGIN division (Director everywhere);
 * anyone else gets 403 with the verbatim BI message. The approval drives the lead
 * to the terminal `[Deleted]` state through `sm_transition` — no row is ever
 * removed, so the lead's audit trail and its PRSP children stay intact
 * (house rule #3).
 *
 * The optional `note` is stored on the request as `decision_note`. A request that
 * was already decided answers 409 `[permintaan hapus sudah diputuskan]`; a
 * transition the engine refuses answers 409/403 with the engine's own message and
 * leaves the request pending rather than consuming it.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson, transitionResponse } from '@/lib/http';
import { deleteRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ reqId: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { reqId } = await ctx.params;
    const body = await readJson<{ note?: string }>(request);
    const { request: req, transition } = await leads.approveDelete(db(), actor, reqId, body.note ?? '');
    if (transition && !transition.ok) {
      return transitionResponse(transition);
    }
    return json({ request: deleteRequestToWire(req), transition }, 200);
  });
}
