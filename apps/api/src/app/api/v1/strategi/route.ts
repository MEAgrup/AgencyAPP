/**
 * GET /api/v1/strategi — the `STRG-` versions visible to the actor, across
 * every client (M6A §7): Account lead / OD / Director see all, an
 * Account-staff AM sees only contracts they own. Feeds the `/account`
 * "Strategi (STRG-)" queue so SPV/Head of Account can find and open a
 * `Diajukan` version to approve — the read model `listStrategies` already
 * gives the legacy `STR-` `strategy_plans` queue, but nothing listed the
 * newer `strategi` table (owner QA 2026-08-26).
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiQueueRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await strategi.listStrategiQueue(db(), actor);
    return json({ data: rows.map(strategiQueueRowToWire) });
  });
}
