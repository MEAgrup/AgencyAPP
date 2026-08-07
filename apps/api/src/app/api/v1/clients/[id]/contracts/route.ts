/**
 * GET  /api/v1/clients/{id}/contracts — every agreement of one client.
 * POST /api/v1/clients/{id}/contracts — open a new one (O57).
 *
 * Keyed by client, not global: an agreement only means anything inside one
 * client's scope, and a flat `/contracts` list would be a cross-client read
 * nobody in the role matrix is entitled to by default.
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
    const rows = await contract.listContractsForClient(db(), actor, id);
    return json(rows.map(contractToWire));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<unknown>(request);
    const created = await contract.createContract(db(), actor, id, contractFromWire(b));
    return json(contractToWire(created), 201);
  });
}
