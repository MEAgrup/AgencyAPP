/**
 * GET  /api/v1/contracts/{id}/services — the Service ids the agreement covers.
 * POST /api/v1/contracts/{id}/services — put a Service under it (O57).
 *
 * This is the endpoint that makes a Contract more than a renamed Service: it is
 * how "Store Management + GMV Max + Nano KOL in one twelve-month agreement"
 * becomes one row set with one Strategi over it.
 */
import { contract } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { contractToWire } from '@/lib/wire';

interface Body {
  service_id?: unknown;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // Read gate first: listServicesOfContract answers about the agreement, so it
    // must not answer before getContract has said the actor may see it.
    await contract.getContract(db(), actor, id);
    return json({ service_ids: await contract.listServicesOfContract(db(), id) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const saved = await contract.attachService(db(), actor, String(b.service_id ?? ''), id);
    return json(contractToWire(saved));
  });
}
