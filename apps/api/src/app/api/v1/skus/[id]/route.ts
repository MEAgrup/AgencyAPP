/**
 * /api/v1/skus/{id} — satu baris SKU Store Operation (M18).
 *
 * GET satu baris + angka turunannya.
 * PUT ubah cakupan + target. **Hanya AM**, dan hanya selama baris itu masih
 *     `[Menunggu Eksekusi]` — begitu Store Operation mulai, janji ke klien beku
 *     (409 dengan pesan BI-nya). Sisi hasil TIDAK punya jalur di sini; ia
 *     bergerak lewat `/transition` dan `/pic`, masing-masing dengan gerbangnya
 *     sendiri.
 */
import { storeops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { skuToWire, toSkuScopeInput } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const row = await readAsActor(actor, (sql) => storeops.getSku(sql, actor, id));
    return json(skuToWire(row));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toSkuScopeInput>[0]>(request);
    const row = await storeops.updateSkuScope(db(), actor, id, toSkuScopeInput(b));
    return json(skuToWire(row));
  });
}
