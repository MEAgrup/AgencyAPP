/**
 * GET/POST /api/v1/clients/{id}/renewals — R-03 (Kinerja Sales): the
 * renewal/cross-sell offers made on an existing client. GET lists every
 * `RNW-` ever raised for this client, newest first (R-04's history panel).
 * POST opens a new one (the "Perpanjangan / Cross Sell" button) — `no_nego`
 * mirrors M0 §5: standard lines only ⇒ born Auto Approved, any custom line
 * ⇒ Pending Approval (Sales Head/SPV decides).
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { renewalToWire, toProposalLines, type ProposalLineBody } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await renewal.listRenewalsForClient(db(), actor, id);
    return json(rows.map(renewalToWire));
  });
}

interface Body {
  jenis?: string;
  no_nego?: boolean;
  lines?: ProposalLineBody[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const rn = await renewal.proposeRenewal(db(), actor, id, b.jenis ?? '', toProposalLines(b.lines), b.no_nego === true);
    return json(renewalToWire(rn), 201);
  });
}
