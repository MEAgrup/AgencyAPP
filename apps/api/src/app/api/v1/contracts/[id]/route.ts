/**
 * GET /api/v1/contracts/{id} — one agreement.
 * PUT /api/v1/contracts/{id} — edit the window (O57).
 *
 * The window freezes once a Strategi hangs off the agreement: M6B derives every
 * Plan period boundary from it, so a later edit would re-cut periods that
 * already carry realisation rows. The refusal is in the domain, not here.
 */
import { contract } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { contractFromWire, contractToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(contractToWire(await contract.getContract(db(), actor, id)));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const saved = await contract.updateContract(db(), actor, id, contractFromWire(b));
    return json(contractToWire(saved));
  });
}
