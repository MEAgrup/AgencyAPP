/**
 * GET /api/v1/performance/teams/{division}[?period=YYYYMM] — M14 §2 Rule 5 / OA-8:
 * the team rollup (simple average of members' final scores, derived on read).
 * OD/Director may view any team; a lead only their own division. Ports Go's
 * handlePerfTeam.
 */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { perfTeamRollupToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ division: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { division } = await ctx.params;
    const period = new URL(request.url).searchParams.get('period') ?? '';
    const roll = await performance.teamRollup(db(), actor, division, period);
    return json(perfTeamRollupToWire(roll));
  });
}
