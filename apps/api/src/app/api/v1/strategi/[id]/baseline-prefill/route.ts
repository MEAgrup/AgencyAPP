/**
 * GET /api/v1/strategi/{id}/baseline-prefill — the Section B baseline the client's
 * riset awal produced, shaped as per-channel suggestions (RAB-11 / RAB-12).
 *
 * This is the path RAB-09's `/prefill` deliberately did NOT carry: RAB-09 hands
 * Section A the interview answers, this hands Section B the baseline numbers +
 * Rule 5 provenance. One channel suggestion per analysed platform; `gmv_mix` rides
 * the TikTok Shop suggestion as a rincian (RAB-12), never as its own channel.
 *
 * Suggestions only — the AM accepts each figure through the Section B editor
 * (`saveChannels`/`saveBaseline`), and acceptance is gated by the existing
 * submit → approve gate (machine #15, RAB-13); this route writes nothing and
 * approves nothing. Returns `null` when there is no scored interview / analysis.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiBaselinePrefillToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const prefill = await strategi.getBaselinePrefill(db(), actor, id);
    return json(prefill === null ? null : strategiBaselinePrefillToWire(prefill));
  });
}
