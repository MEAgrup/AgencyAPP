/**
 * PUT /api/v1/strategi/{id}/channels/{channelId}/baseline — B-1 / B-5 months.
 *
 * Scoped to one channel because the baseline window is declared per channel
 * (B-0.7 / D11): Shopee may carry six months while a store opened last month
 * carries one, so "the baseline" is not a single grid that can be saved at once.
 *
 * Blank and `0` are different answers here (Rule 5). The mapper passes a missing
 * figure through as `null` rather than coercing it to zero, so the domain can
 * reject it instead of recording a number nobody entered.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiBaselineFromWire, strategiDetailToWire } from '@/lib/wire';

interface Body {
  months?: unknown;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string; channelId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id, channelId } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await strategi.saveBaseline(
      db(),
      actor,
      id,
      Number(channelId),
      strategiBaselineFromWire(b.months ?? []),
    );
    return json(strategiDetailToWire(saved));
  });
}
