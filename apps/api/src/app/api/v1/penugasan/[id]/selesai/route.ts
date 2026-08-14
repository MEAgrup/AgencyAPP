/**
 * POST /api/v1/penugasan/{id}/selesai — [Dikerjakan] → [Selesai].
 * Body: { link_hasil } — MANDATORY, same rule as M7's `output_link` on Asset
 * submit: "done" with nothing attached is a claim, not a deliverable.
 *
 * Lateness is not written here; it is derived at read time from the frozen
 * `selesai_pada` against the frozen `due_date`, so it cannot be edited later.
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
    const b = await readJson<{ link_hasil?: string }>(request);
    const t = await internaltask.completeTask(db(), actor, id, b.link_hasil ?? '');
    return json(internalTaskToWire(t));
  });
}
