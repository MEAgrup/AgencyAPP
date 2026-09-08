/**
 * /api/v1/strategies/{id} — a Strategy & Plan (M6 §4).
 *
 * GET: one Strategy with its derived revision count, if the actor may read it
 * (owning AM / Account lead / OD / Director). Ports Go's handleGetStrategy.
 * **Tetap hidup** — dua baris `STR-` di produksi adalah riwayat kesepakatan
 * sungguhan, dan riwayat tidak dipensiunkan (aturan rumah #3).
 *
 * PUT: **DIPENSIUNKAN 2026-09-08.** Menyunting draft `STR-` menjanjikan kemajuan
 * menuju persetujuan yang sudah dicabut — persis "tombol yang menjanjikan hal
 * yang tidak lagi terjadi". Alasan lengkap: `@/lib/retired-str`.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strPensiun } from '@/lib/retired-str';
import { strategyToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const st = await readAsActor(actor, (sql) => account.getStrategy(sql, actor, id));
    return json(strategyToWire(st));
  });
}

export async function PUT(): Promise<Response> {
  return handle(async () => strPensiun());
}
