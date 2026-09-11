/** POST /api/v1/admin/external-service-map/{id}/deactivate — Director only. */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await bridge.deactivateServiceMap(db(), actor, Number(id));
    return json({ ok: true });
  });
}
