/**
 * GET /api/v1/leads/delete-requests[?status=] — the Head's ACC queue for
 * Head-gated lead deletion (owner decision 2026-07-29, `docs/DECISIONS.md`).
 *
 * Defaults to `status=pending` (the actionable set); pass `status=` for every
 * request, or an explicit `approved`/`rejected` for the decided history.
 *
 * A static segment, so Next resolves it ahead of the sibling `[id]` route — the
 * same arrangement `/leads/pool` already uses.
 *
 * Row scope is the `lead_delete_requests_select` policy's: the query runs through
 * `readAsActor`, so a Head sees their own division's leads, the requester sees
 * their own requests, and OD/Director see everything. There is no endpoint-level
 * gate on top of that — an actor with nothing to approve simply gets an empty
 * queue, which is the honest answer here (unlike the Pool board, where O37 wants
 * a refusal rather than a misleading empty list).
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { deleteRequestQueueRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    // `?status=` present-but-empty means "all"; absent means the pending default.
    const status = params.has('status') ? (params.get('status') ?? '') : undefined;
    const rows = await readAsActor(actor, (sql) => leads.deleteRequestQueue(sql, { status }));
    return json({ data: rows.map(deleteRequestQueueRowToWire) });
  });
}
