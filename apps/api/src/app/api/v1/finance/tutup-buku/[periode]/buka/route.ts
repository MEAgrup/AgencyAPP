/**
 * /api/v1/finance/tutup-buku/{periode}/buka — membuka kembali bulan tertutup.
 *
 * Director SAJA, dan wajib beralasan tertulis. Asimetri itu yang membuat
 * kuncinya menjaga sesuatu: Finance lead yang menutup tidak bisa membatalkan
 * tutupannya sendiri (ketokan pemilik 2026-09-08).
 *
 * Angka beku TIDAK dihapus — ia jadi versi, dan tutup-ulang nanti menambah
 * versi baru di sebelahnya.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { periodeToWire } from '@/lib/wire';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ periode: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    const body = await readJson<{ alasan?: string }>(request);
    // `?? ''` dan BUKAN pesan sendiri di sini: kalau alasannya hilang, yang
    // menolak harus `bukaBuku` dengan pesan BI-nya yang satu itu, supaya route
    // dan domain tidak punya dua versi pesan yang bisa berbeda.
    const p = await tutupbuku.bukaBuku(db(), actor, periode, body.alasan ?? '');
    return json({ data: periodeToWire(p) });
  });
}
