/**
 * /api/v1/leads/{id}/delete-requests — the AJUKAN half of the Head-gated lead
 * delete (owner decision 2026-07-29, `docs/DECISIONS.md`).
 *
 * POST raises a pending request carrying a mandatory `reason`; nothing about the
 * lead changes yet. The Heads of the lead's origin division are notified so the
 * ACC queue does not need polling. A lead that is already a client, already
 * deleted, or already has a pending request surfaces as 409 with the verbatim BI
 * message; an actor unconnected to the lead as 403 (shared error mapper).
 *
 * GET lists this lead's requests (any status) for the detail page. It reads
 * through `readAsActor`, so the `lead_delete_requests_select` policy decides
 * which rows come back.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { deleteRequestQueueRowToWire, deleteRequestToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ reason?: string }>(request);
    const req = await leads.requestDelete(db(), actor, id, body.reason ?? '');
    return json(deleteRequestToWire(req), 201);
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // '' = every status, so the detail page can show the decided ones too.
    const rows = await readAsActor(actor, (sql) => leads.deleteRequestQueue(sql, { leadId: id, status: '' }));
    return json({ data: rows.map(deleteRequestQueueRowToWire) });
  });
}
