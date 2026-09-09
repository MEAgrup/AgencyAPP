/**
 * /api/v1/creative/unavailability/{id} — cabut satu catatan ketidaktersediaan.
 *
 * DELETE ada, UPDATE tidak (trigger DB menolaknya): salah catat harus bisa
 * dicabut, tapi menyunting rentangnya sesudah jadwal disusun di atasnya
 * mengubah arti peringatan yang sudah ditampilkan. Cabut lalu catat ulang.
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await dailyops.removeUnavailability(db(), actor, Number(id));
    return json({ ok: true });
  });
}
