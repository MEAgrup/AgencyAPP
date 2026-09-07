/**
 * GET /api/v1/accrual/months/{bulan} — laporan pengakuan pendapatan satu bulan
 * kalender (Gelombang D, D-3). Finance segala level, OD, atau Director.
 *
 * Badan responsnya membawa **`sumber`** (`'beku'` | `'dihitung'`) apa adanya
 * dari domain, dan itu bukan detail internal: dua laporan yang terlihat identik
 * tapi satu beku dan satu dihitung ulang adalah dua hal yang sangat berbeda
 * saat angkanya dipertanyakan, dan halaman harus bisa menyebutnya sendiri.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { laporanBulanToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ bulan: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { bulan } = await ctx.params;
    const lap = await readAsActor(actor, (sql) => tutupbuku.laporanBulan(sql, actor, bulan));
    return json(laporanBulanToWire(lap));
  });
}
