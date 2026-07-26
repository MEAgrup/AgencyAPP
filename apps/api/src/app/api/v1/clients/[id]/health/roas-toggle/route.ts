/** GET|PUT /api/v1/clients/{id}/health/roas-toggle — the ROAS Inclusion Toggle (M13 Rule 13 / §5.4). */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { roasToggleToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    return json(roasToggleToWire(await health.getRoasToggle(db(), actor, id)));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ override?: boolean | null }>(request);
    const override = b.override === undefined ? null : b.override;
    return json(roasToggleToWire(await health.setRoasToggle(db(), actor, id, override)));
  });
}
