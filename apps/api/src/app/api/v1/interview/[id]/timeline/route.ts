/**
 * GET /api/v1/interview/{id}/timeline — the three-step "Kelola Klien" SLA
 * (owner decision 2026-08-13): Riset Awal 2–3, Interview Meeting 1–2, Brand
 * Strategy 5–7 working days.
 *
 * Served separately from the interview detail on purpose: the detail is refetched
 * on every autosave, and the timeline runs holiday-aware working-day arithmetic
 * plus a strategy lookup that has no business being on that path.
 *
 * Account scope — the timeline says how fast an AM worked, so it is read-gated
 * like the full record (never the verdict surface).
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { kelolaKlienTimelineToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const t = await interview.getKelolaKlienTimeline(db(), actor, id);
    return json(kelolaKlienTimelineToWire(t));
  });
}
