/**
 * GET /api/v1/health/portfolio — M6D §8 / D-12: the /health landing table. One
 * row per ACTIVE client the actor may view (RM-2 ≥1 non-terminal service): latest
 * band + score, a Rule-12 band-drop flag, open-complaint count, and weekly-recap
 * freshness. Read-only aggregation — stores nothing.
 *
 * Uses a plain connection (`db()`) with the TS gate (canScope + per-row canView),
 * like the recap reads and the health scan: the query fans out over clients /
 * snapshots / complaints / recaps, and a spurious RLS blank on a sub-select would
 * silently drop rows. The row filter is the canView predicate the per-client view
 * already applies, so the table never widens the M13 read scope (DECISIONS O48).
 */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthPortfolioRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await health.portfolio(db(), actor);
    return json({ data: rows.map(healthPortfolioRowToWire) });
  });
}
