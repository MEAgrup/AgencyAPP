/**
 * /api/v1/attempts/{id}/activities — the prospect effort log (ACT-).
 *
 *   GET  → { data: ActivityWire[], effort: EffortSummaryWire } — the attempt's
 *          activities newest-first plus the DERIVED rollup (total + per-type).
 *          The rollup is recomputed from the log on every read, never stored.
 *   POST → 201 with the created activity.
 *
 * Thin shell over @cdps/domain `activity` (keputusan pemilik 2026-08-06, dicatat
 * di docs/DECISIONS.md): the mandatory-field gate, the closed type taxonomy, the
 * role matrix and the `Qualified`-or-later stage gate all live in the domain.
 * Reads run through `readAsActor` so `prospect_activities_select` narrows rows;
 * the write runs on the service-role handle after the domain gate, as every
 * other write door does.
 */
import { activity } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { activityToWire, effortToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // P-1: independent reads — issue them together so the driver pipelines them
    // instead of paying two sequential round-trips.
    const { rows, effort } = await readAsActor(actor, async (sql) => {
      const [r, e] = await Promise.all([
        activity.listByAttempt(sql, id),
        activity.effortByAttempt(sql, id),
      ]);
      return { rows: r, effort: e };
    });
    return json({ data: rows.map(activityToWire), effort: effortToWire(effort) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{
      activity_type?: string;
      occurred_at?: string;
      summary?: string;
    }>(request);
    const created = await activity.log(db(), actor, id, {
      activityType: body.activity_type ?? '',
      occurredAt: body.occurred_at,
      summary: body.summary ?? '',
    });
    return json({ data: activityToWire(created) }, 201);
  });
}
