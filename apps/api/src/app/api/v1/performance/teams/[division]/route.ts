/** GET /api/v1/performance/teams/{division}[?period=YYYYMM] — the team rollup (simple average, derived on read; M14 OA-8). */
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
    return json(perfTeamRollupToWire(await performance.teamRollup(db(), actor, division, period)));
  });
}
