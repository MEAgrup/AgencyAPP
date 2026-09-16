/**
 * GET /api/v1/px/kandidat — halaman Kandidat PX (Product Exchange M3-B).
 * Produk yang lolos L1-L2 dan menunggu (atau sudah lewat) konfirmasi kategori
 * AM (verdict terbaru ∈ {kategori_belum_dikonfirmasi, kreator_kosong, lolos}).
 *
 * Scope-nya ditegakkan di DOMAIN (`clients.assigned_am_id`), bukan hanya RLS:
 * AM melihat kliennya sendiri, Lead Account/Director/OD melihat semua — sama
 * pola `px/eligibility-policy` (privileged `db()`, gerbang di TS) karena
 * `px_sku_volume` yang di-join untuk `gmv_30d` default-deny total.
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pxKandidatToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await productexchange.listKandidat(db(), actor);
    return json({ data: rows.map(pxKandidatToWire) });
  });
}
