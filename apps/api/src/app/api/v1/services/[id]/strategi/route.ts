/**
 * GET  /api/v1/services/{id}/strategi — every Strategi version for a Service.
 * POST /api/v1/services/{id}/strategi — open version 1 in `Draft` (M6A Rule 1).
 *
 * A list, not a single record, because a version is a row (Rule 13): while a
 * revision is being written, the service legitimately has an `Aktif` version AND
 * a `Draft Revisi` one, and collapsing that to "the Strategi" would hide exactly
 * the state the rule was written to protect.
 *
 * Distinct from `/services/{id}/strategy` (singular, no `i`), which serves the
 * older M6 §4 entity the Service page still uses. The two are separate on
 * purpose until the form swap (backlog A-05…A-09).
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiHeaderFromWire, strategiToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await strategi.listStrategiForService(db(), actor, id);
    return json(rows.map(strategiToWire));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const created = await strategi.createStrategi(db(), actor, id, strategiHeaderFromWire(b));
    return json(strategiToWire(created), 201);
  });
}
