/**
 * /api/v1/finance/tutup-buku/{periode}/jurnal-koreksi
 *
 * {periode} di sini adalah bulan TERTUTUP yang dikoreksi. Koreksinya sendiri
 * dicatat di bulan yang masih TERBUKA (`periode_catat`) — itulah bentuk yang
 * dipilih pemilik: "jurnal koreksi di bulan berjalan, BUKAN mengedit bulan
 * tertutup".
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { jurnalKoreksiToWire } from '@/lib/wire';

type Ctx = { params: Promise<{ periode: string }> };

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    const list = await readAsActor(actor, (sql) => tutupbuku.listJurnalKoreksi(sql, periode));
    return json({ data: list.map(jurnalKoreksiToWire) });
  });
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    const body = await readJson<{
      periode_catat?: string; keterangan?: string; nilai?: string | null;
    }>(request);
    const j = await tutupbuku.catatJurnalKoreksi(db(), actor, {
      periodeDikoreksi: periode,
      periodeCatat: body.periode_catat ?? '',
      keterangan: body.keterangan ?? '',
      // `undefined` dan `null` dua-duanya berarti "catatan tanpa nilai"; yang
      // TIDAK boleh terjadi adalah keduanya diam-diam jadi 0.
      nilai: body.nilai ?? null,
    });
    return json({ data: jurnalKoreksiToWire(j) });
  });
}
