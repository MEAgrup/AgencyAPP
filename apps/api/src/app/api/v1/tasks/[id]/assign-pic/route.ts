/**
 * POST /api/v1/tasks/{id}/assign-pic — set a Brief-as-task's accountable PIC (M12
 * §5.3). Target division Lead/SPV or Director; the PIC must be active division
 * staff. Body: { pic_id }. Ports Go's handleAssignTaskPIC.
 */
import { task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ pic_id?: string }>(request);
    await task.assignPic(db(), actor, id, b.pic_id ?? '');
    return json({ id, assigned_pic: b.pic_id ?? '' });
  });
}
