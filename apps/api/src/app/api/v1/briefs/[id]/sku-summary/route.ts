/**
 * GET /api/v1/briefs/{id}/sku-summary — angka worksheet Store Operation untuk
 * satu Brief (M18 §5): n dari N selesai, %Ontime, % SKU pernah gagal upload.
 *
 * Semuanya TURUNAN, dihitung saat baca. Rute terpisah dari `/skus` karena
 * halaman antrean butuh angkanya tanpa menarik seluruh barisnya.
 */
import { storeops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { skuSummaryToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const s = await readAsActor(actor, (sql) => storeops.summaryByBrief(sql, actor, id));
    return json(skuSummaryToWire(s));
  });
}
