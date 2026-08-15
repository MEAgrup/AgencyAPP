/**
 * POST /api/v1/penugasan/{id}/batal — → [Dibatalkan] with a mandatory reason.
 * Assigner / division Lead/SPV / Director — never the PIC, who would otherwise
 * be able to cancel away their own lateness (the failure mode M12 §5.3a locks
 * `[Blocked]` against). Body: { alasan }.
 */
import { internaltask } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { internalTaskToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ alasan?: string }>(request);
    const t = await internaltask.cancelTask(db(), actor, id, b.alasan ?? '');
    return json(internalTaskToWire(t));
  });
}
