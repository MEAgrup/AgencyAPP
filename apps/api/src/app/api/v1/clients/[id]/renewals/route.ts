/**
 * GET  /api/v1/clients/{id}/renewals — every renewal/cross-sell request opened
 *      on this client, newest first.
 * POST /api/v1/clients/{id}/renewals — open a new Draft request (R-03, M0 §6
 *      deviasi). `jenis` is `perpanjangan` (requires `contract_sebelumnya_id`
 *      naming a Contract of THIS client) or `cross_sell` (always standalone).
 *
 * Keyed by client like `/contracts` — a renewal only means anything inside
 * one client's scope. Gate lives in `renewal.ts` (`canManageRenewal`/
 * `canReadRenewal`), not RLS, mirroring `contract.ts`.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { renewalToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await renewal.listRenewalsForClient(db(), actor, id);
    return json(rows.map(renewalToWire));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ jenis?: string; contract_sebelumnya_id?: string }>(request);
    const created = await renewal.createRenewal(db(), actor, id, b.jenis ?? '', b.contract_sebelumnya_id ?? null);
    return json(renewalToWire(created), 201);
  });
}
