/**
 * POST /api/v1/services/{id}/completion/reject — O75: Head of Account MENOLAK
 * pengajuan selesai ([Completion Requested] → [In Execution]). Account lead /
 * Director, alasan opsional (cermin `/hold/reject`). Memberi tahu AM pemilik.
 * Forbidden → 403, NotFound → 404, wrong state → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ reason?: string }>(request);
    await client.rejectServiceCompletion(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
