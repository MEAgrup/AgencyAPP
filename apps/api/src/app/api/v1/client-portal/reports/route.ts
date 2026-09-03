/**
 * GET /api/v1/client-portal/reports — the client's PUBLISHED reports.
 *
 * `requireClientContactActor` exclusively, never `requireActor`: the Portal now
 * shares `app.meagency.co.id` with `web-internal`, so a browser can legitimately
 * hold both cookies at once, and reading the general one first would resolve an
 * AM's employee session on a Portal route (see `client-portal/me`).
 *
 * The rows are scoped in the domain by the ACTOR's client id — no `client_id`
 * parameter exists on this endpoint to be tampered with.
 */
import { clientPortal } from '@cdps/domain';
import { requireClientContactActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { portalReportRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireClientContactActor(request);
    const rows = await clientPortal.listReports(db(), actor);
    // View-level audit (spec §5.1): who opened what, when — not just writes.
    await clientPortal.logAccess(db(), clientPortal.contactScope(actor), 'view:reports');
    return json(rows.map(portalReportRowToWire));
  });
}
