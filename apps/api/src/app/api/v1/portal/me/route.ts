/**
 * GET /api/v1/portal/me — M15 §4 Rule 9: the staff landing page. Own open tasks
 * (SLA-risk first), the running current-month Performance Score (computed-on-read,
 * never stored) and its trend. Pure aggregation over M11/M14. Ports Go's handlePortalMe.
 */
import { portal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { staffLandingToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const land = await readAsActor(actor, (sql) => portal.staffLanding(sql, actor, new Date()));
    return json(staffLandingToWire(land));
  });
}
