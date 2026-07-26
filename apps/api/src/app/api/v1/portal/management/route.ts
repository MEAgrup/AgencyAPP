/**
 * GET /api/v1/portal/management[?band=&am=&sort=am] — M15 §6.3 Rule 11: the
 * Director/OD portfolio-wide Client-health scan (latest band, trend direction,
 * dragging component per Client), filterable by band/AM and sortable. Read-only.
 * Ports Go's handlePortalManagement.
 */
import { portal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { managementDashboardToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const dash = await portal.managementDashboard(db(), actor, params.get('band') ?? '', params.get('am') ?? '', params.get('sort') ?? '');
    return json(managementDashboardToWire(dash));
  });
}
