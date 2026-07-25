/**
 * POST /api/v1/assets/{id}/assign-pic — set the Asset's accountable Creative PIC
 * (M7 §9.3). Creative Lead/SPV or Director. Body: { pic_id }. Ports Go's
 * handleAssignAssetPIC.
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
    await task.assignAssetPic(db(), actor, id, b.pic_id ?? '');
    return json({ id, assigned_pic: b.pic_id ?? '' });
  });
}
