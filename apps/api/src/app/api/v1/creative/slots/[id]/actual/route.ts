/**
 * /api/v1/creative/slots/{id}/actual — tutup slot dengan jumlah yang BENAR-BENAR
 * selesai di sesi itu (M19 Flow B).
 *
 * Jalur terpisah dari PUT /creative/slots/{id} dengan sengaja: penulisnya
 * berbeda (PIC slot itu sendiri, atau lead) dan artinya berbeda (HASIL, bukan
 * RENCANA). Satu pintu untuk keduanya berarti angka hasil bisa diubah oleh
 * siapa pun yang boleh menyunting rencana.
 *
 * Sisa TIDAK di-rollover otomatis (Flow 7): Leader membuat slot baru besok, dan
 * slot ini mempertahankan angka 9/15-nya yang jujur.
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { slotToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = (await readJson<{ actual_qty?: number | string }>(request)) ?? {};
    const row = await dailyops.enterActual(db(), actor, id, Number(b.actual_qty ?? 0));
    return json(slotToWire(row));
  });
}
