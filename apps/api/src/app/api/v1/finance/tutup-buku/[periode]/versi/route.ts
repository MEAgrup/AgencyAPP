/**
 * /api/v1/finance/tutup-buku/{periode}/versi — semua versi angka beku, tertua
 * dulu, LENGKAP dengan angkanya.
 *
 * Ada karena buka-ulang tidak menghapus apa pun: "berapa angkanya waktu
 * ditutup pertama kali" harus tetap bisa dijawab selamanya.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { snapshotVersiToWire } from '@/lib/wire';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ periode: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    const versi = await readAsActor(actor, (sql) => tutupbuku.listVersi(sql, periode));
    return json({ data: versi.map(snapshotVersiToWire) });
  });
}
