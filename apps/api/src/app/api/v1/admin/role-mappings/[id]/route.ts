/**
 * /api/v1/admin/role-mappings/{id} — delete a mapping rule (DELETE). Ports Go's
 * handleDeleteRoleMapping.
 *
 * Deleting a rule REVOKES the derived division/level for everyone holding that
 * divisi+jabatan, so the domain layer captures the before-state into the audit
 * row first. Director-only.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // The column is bigint; reject anything non-numeric before it reaches SQL
    // (Go returns `[id tidak valid]` from strconv.ParseInt for the same case).
    if (!/^\d+$/.test(id)) {
      throw new BadRequestError('[id tidak valid]');
    }
    await admin.deleteRoleMapping(db(), actor, id);
    return json({ status: 'ok' });
  });
}
