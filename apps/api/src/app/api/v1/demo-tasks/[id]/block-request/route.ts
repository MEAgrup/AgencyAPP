/**
 * /api/v1/demo-tasks/{id}/block-request — a staff/AM submits a block request
 * (POST { reason }). Ported from Go's handleBlockRequest. The submitter cannot
 * set [Blocked] directly; this records a pending request and notifies the
 * division leads (M12 catalog). Reason is a mandatory field (BI gate).
 */
import { demo } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ reason?: string }>(request);
    const req = await demo.submitBlockRequest(db(), actor, id, body.reason ?? '');
    return json({ blockRequest: req }, 201);
  });
}
