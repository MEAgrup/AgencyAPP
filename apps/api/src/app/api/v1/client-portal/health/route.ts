/**
 * GET /api/v1/client-portal/health — M15 Rule 4: the BAND LABEL, nothing else.
 *
 * "On Track" / "Needs Attention" / "Action Needed". No 0–100 score, no component
 * breakdown, no weight — ever. `label: null` means no snapshot exists yet (a new
 * client), which the Portal renders as "belum tersedia" rather than a bad band.
 */
import { clientPortal } from '@cdps/domain';
import { requireClientContactActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { portalHealthToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireClientContactActor(request);
    const h = await clientPortal.healthSummary(db(), actor);
    await clientPortal.logAccess(db(), clientPortal.contactScope(actor), 'view:health');
    return json(portalHealthToWire(h));
  });
}
