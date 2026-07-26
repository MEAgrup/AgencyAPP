/**
 * /api/v1/clients/{id}/health/roas-toggle — M13 Rule 13 / §5.4: the per-Client
 * ROAS Inclusion Toggle.
 *   GET: read the toggle (override + resolved effective inclusion). Visibility-gated.
 *   PUT: set (override true/false) or clear (override null → default). AM/SPV or
 *        Director; audited (before→after); does not mutate existing snapshots.
 * Ports Go's handleGetROASToggle / handleSetROASToggle.
 */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { roasToggleToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const tg = await health.getRoasToggle(db(), actor, id);
    return json(roasToggleToWire(tg));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ override?: boolean | null }>(request);
    const override = b.override === undefined ? null : b.override;
    const tg = await health.setRoasToggle(db(), actor, id, override);
    return json(roasToggleToWire(tg));
  });
}
