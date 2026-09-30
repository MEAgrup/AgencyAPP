/**
 * POST /api/v1/briefs/{id}/kirim-ulang — BRIEF-KEMBALI-SIKLUS (Improvement Req
 * Account butir 1, pemilik 2026-09-30): AM pemilik klien (atau Director)
 * merevisi isi Brief yang DIKEMBALIKAN divisi lalu mengirimnya ulang. Membuka
 * putaran Cek Brief AM baru. Body: { catatan (wajib), title?, instructions?,
 * reference_attachments?, due_date?, quantity_target?, priority?,
 * tanggal_mulai?, tanggal_akhir?, budget? } — kunci absen = tidak diubah.
 */
import { briefIntake } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { toKirimUlangInput } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toKirimUlangInput>[0]>(request);
    const res = await briefIntake.kirimUlangBrief(db(), actor, id, toKirimUlangInput(b));
    return json({ ok: true, putaran: res.putaran });
  });
}
