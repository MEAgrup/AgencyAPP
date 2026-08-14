/**
 * POST /api/v1/rekap/{id}/catatan-divisi — RM-D6 weekly note a touching division
 * owes. Append-only (no edit/delete). Written by the lead of the touching
 * division, or an Account lead/Director as override (`canWriteRecapDivisiNote`).
 * The division must actually have touched the client this week. Body:
 * `{ divisi, catatan }`. Returns the created note row.
 */
import { recap } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { recapCatatanDivisiToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ divisi?: unknown; catatan?: unknown }>(request);
    const divisi = b.divisi === undefined || b.divisi === null ? '' : String(b.divisi);
    const catatan = b.catatan === undefined || b.catatan === null ? '' : String(b.catatan);
    const created = await recap.addRecapCatatanDivisi(db(), actor, id, divisi, catatan);
    return json(recapCatatanDivisiToWire(created));
  });
}
