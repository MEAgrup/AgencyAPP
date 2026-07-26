/**
 * GET /api/v1/portal/team[?division=&period=YYYYMM] — M15 §6.2 Rule 10: the SPV/Lead
 * landing. Division Performance rollup (M14) + Client-Board shortcuts (M11) + the
 * pending block-request approval queue (M12). division defaults to the actor's own;
 * a Director may pass any. Lead-of-division / Director only. Ports Go's handlePortalTeam.
 */
import { portal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { teamPortalToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const team = await portal.teamPortal(db(), actor, params.get('division') ?? '', params.get('period') ?? '');
    return json(teamPortalToWire(team));
  });
}
