/**
 * /api/v1/briefs/{id}/skus — baris SKU sebuah Brief Store Operation (M18 §3).
 *
 * GET  daftar baris, terurut lahir. Dibaca lewat `readAsActor` supaya RLS ikut
 *      memikul scope-nya, bukan gerbang TS sendirian.
 * POST tambah satu baris. Penulisnya AM pemilik klien (ketokan 2026-09-08) —
 *      domain yang menolak Store Operation, bukan route ini.
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
    const rows = await readAsActor(actor, (sql) => storeops.listByBrief(sql, actor, id));
    return json({ data: rows.map(skuToWire) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toSkuScopeInput>[0]>(request);
    const row = await storeops.createSku(db(), actor, id, toSkuScopeInput(b));
    return json(skuToWire(row));
  });
}
