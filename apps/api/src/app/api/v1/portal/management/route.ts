/**
 * GET /api/v1/portal/management[?band=&am=&division=&sort=am] — M15 §6.3 Rule 11: the
 * Director/OD portfolio-wide Client-health scan (latest band, trend direction,
 * dragging component per Client), filterable by band/AM/division-mix and sortable.
 * Read-only. Ports Go's handlePortalManagement (+ M15-G1 division filter).
 */
import { portal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { managementDashboardToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const dash = await readAsActor(actor, (sql) =>
      portal.managementDashboard(sql, actor, params.get('band') ?? '', params.get('am') ?? '', params.get('division') ?? '', params.get('sort') ?? ''),
    );
    return json(managementDashboardToWire(dash));
  });
}
