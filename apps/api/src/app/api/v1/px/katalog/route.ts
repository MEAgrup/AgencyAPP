/**
 * GET /api/v1/px/katalog — Katalog PX (Product Exchange M3-B, Rule 19-21).
 * Lead Account/Director/OD saja (`productexchange.canLihatKatalogPx`) — sisi
 * kreator (yang benar-benar melihat katalog ini) adalah halaman portal
 * terpisah, M4/M5, di luar cakupan M3-B.
 *
 * Nol `gmv_30d`/pesanan (D-06) — `listKatalog` membaca `px_catalog_item_v`,
 * yang sudah tidak membawa kolom itu sama sekali.
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pxCoverageMetaToWire, pxKatalogItemToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { data, snapshot } = await productexchange.listKatalog(db(), actor);
    return json({ data: data.map(pxKatalogItemToWire), snapshot: pxCoverageMetaToWire(snapshot) });
  });
}
