/**
 * GET /api/v1/px/laporan/kreator-kosong — laporan internal untuk MCN:
 * kategori/segmen dengan permintaan nyata (SKU lolos L1-L3) tapi nol kreator
 * (verdict `kreator_kosong`, PRD §5 skenario "SKU Tas Wanita/mid"). Input
 * rekrutmen kreator berbasis demand, bukan target volume yang ditebak.
 *
 * Lead Account/Director/OD saja, sama gerbang `listKatalog`. Nol angka GMV
 * (agregat jumlah produk/klien saja) — D-06.
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pxKreatorKosongToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await productexchange.listKreatorKosong(db(), actor);
    return json({ data: rows.map(pxKreatorKosongToWire) });
  });
}
