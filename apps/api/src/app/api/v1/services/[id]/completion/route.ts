/**
 * POST /api/v1/services/{id}/completion — O75: AM pemilik MENGAJUKAN Service
 * selesai ([In Execution] → [Completion Requested]). AM pemilik / Account lead /
 * Director, alasan WAJIB. Head of Account lalu menyetujui/menolak (endpoint
 * terpisah). Memberi tahu Head of Account.
 *
 * Gerbang wajibnya (`contracts.tanggal_akhir` sudah lewat) ditegakkan di domain
 * DAN oleh trigger DB — keduanya menjawab dengan pesan BI yang sama.
 * Incomplete → 400, Forbidden → 403, NotFound → 404, state/gerbang → 409.
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
    await client.requestServiceCompletion(db(), actor, id, b.reason ?? '');
    return json({ ok: true });
  });
}
