/**
 * GET /api/v1/strategi/{id} — the whole record (header + every child block).
 * PUT /api/v1/strategi/{id} — the header: contract window, G-0, F-7.
 *
 * One GET rather than a call per section: the form loads Section A→J at once
 * (§7 non-functional: "full form load < 2s with 5 channel blocks"), and seven
 * round-trips would spend that budget on latency.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiDetailToWire, strategiHeaderFromWire, strategiToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(strategiDetailToWire(await strategi.getStrategi(db(), actor, id)));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await strategi.updateHeader(db(), actor, id, strategiHeaderFromWire(b));
    return json(strategiToWire(saved));
  });
}
