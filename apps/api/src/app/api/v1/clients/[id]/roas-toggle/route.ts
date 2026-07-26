/**
 * /api/v1/clients/{id}/roas-toggle — M13 §5.4 / Rule 13: the per-Client ROAS
 * Inclusion Toggle.
 *
 * GET: the resolved toggle state (explicit override, Ads-service signals, and the
 * effective inclusion the scorer will use). Visibility gated (Rule 11).
 *
 * PUT: set (`override` true/false) or clear (`override` null → back to the default)
 * the override. Write-gated: AM/SPV Account or Director (OD read-only); an AM may
 * only toggle a client in its own book. The change is appended to the immutable
 * audit_log and affects the NEXT run — it never mutates an existing snapshot.
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
