/**
 * POST /api/v1/services/{id}/completion/approve — O75: Head of Account
 * MENYETUJUI pengajuan selesai ([Completion Requested] → Done). Account lead /
 * Director. Memberi tahu AM pemilik.
 *
 * `Done` terminal: tidak ada edge keluar darinya, jadi ini keputusan yang tidak
 * bisa dibatalkan. Tanggal baris auditnya adalah sumber `accrual.tanggalSelesai`.
 * Forbidden → 403, NotFound → 404, wrong state → 409.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await client.approveServiceCompletion(db(), actor, id);
    return json({ ok: true });
  });
}
