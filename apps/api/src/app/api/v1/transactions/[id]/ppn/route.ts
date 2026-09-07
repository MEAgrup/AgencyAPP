/**
 * PUT /api/v1/transactions/{id}/ppn — mencatat perlakuan PPN satu Transaksi
 * (Gelombang D, ketokan D-4). Finance segala level atau Director.
 *
 * Nilai `total_agreed_value` TIDAK disentuh: yang disimpan bruto, yang dicatat
 * hanya pilihannya. Forbidden → 403, NotFound → 404, pilihan di luar kosakata
 * → 400 dengan pesan BI-nya sendiri.
 *
 * PUT dan bukan POST karena ia mengganti satu nilai yang sudah punya tempatnya
 * (idempoten: mengirim pilihan yang sama dua kali menghasilkan keadaan yang
 * sama), sejalan dengan `PUT /master-services/{id}`.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ ppn_pilihan?: string }>(request);
    const pilihan = await finance.setPpnPilihan(db(), actor, id, b.ppn_pilihan ?? '');
    return json({ ppn_pilihan: pilihan });
  });
}
