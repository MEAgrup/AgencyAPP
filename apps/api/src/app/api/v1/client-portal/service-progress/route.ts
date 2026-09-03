/**
 * GET /api/v1/client-portal/service-progress — M15 Rule 2.
 *
 * Client-friendly service name + the relabelled column (Queued / In Production /
 * Finalizing / In Review / Completed). The internal status names, `BRF-`/`AST-`/
 * `BKG-` ids, the PIC and every SLA timestamp are not filtered out downstream —
 * the domain query never selects them.
 */
import { clientPortal } from '@cdps/domain';
import { requireClientContactActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { portalServiceProgressToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireClientContactActor(request);
    const rows = await clientPortal.serviceProgress(db(), actor);
    await clientPortal.logAccess(db(), clientPortal.contactScope(actor), 'view:progress');
    return json(rows.map(portalServiceProgressToWire));
  });
}
