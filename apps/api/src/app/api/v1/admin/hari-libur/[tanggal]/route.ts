/**
 * DELETE /api/v1/admin/hari-libur/{tanggal} — remove one holiday (Director only).
 *
 * A delete is right for a config calendar: a mistyped date must be removable.
 * The audit row records who removed it, so the change is still accounted for.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function DELETE(request: Request, ctx: { params: Promise<{ tanggal: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { tanggal } = await ctx.params;
    await admin.removeHariLibur(db(), actor, decodeURIComponent(tanggal));
    return json({ deleted: true });
  });
}
