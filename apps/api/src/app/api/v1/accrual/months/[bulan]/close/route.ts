/**
 * POST /api/v1/accrual/months/{bulan}/close — MENUTUP buku satu bulan
 * (Gelombang D, D-3). Head of Finance (Finance level lead) atau Director.
 *
 * ⚠️ TIDAK ADA JALAN KEMBALI. Penutupan membekukan angka pengakuan bulan itu ke
 * `periode_buku_baris` dan mengunci barisnya di DB terhadap setiap `UPDATE`/
 * `DELETE`; koreksi sesudahnya hanya lewat jurnal koreksi di bulan berjalan.
 * Karena itu ia POST (satu aksi yang mengubah keadaan sekali), bukan PUT.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { periodeBukuToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ bulan: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { bulan } = await ctx.params;
    const p = await tutupbuku.tutupBulan(db(), actor, bulan);
    return json({ periode: periodeBukuToWire(p) });
  });
}
