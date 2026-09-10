/**
 * GET /api/v1/master-services/{id}/refs — berapa kali id katalog ini muncul di
 * keempat tabel snapshot, plus bendera `unused`.
 *
 * Ia ada untuk SATU tujuan: panel konfirmasi hapus harus bisa menyatakan
 * konsekuensinya SEBELUM bertanya, bukan menemukannya lewat 409. Pola yang sama
 * dengan daftar serah-terima pada resign permanen (2026-09-10) — sebuah aksi
 * tanpa undo tidak boleh dimulai dari tombol yang belum tahu jawabannya.
 *
 * Read-only dan tanpa gerbang tulis: angka pemakaian bukan data sensitif, dan
 * layar MSL sendiri sudah terbuka bagi setiap staff (`master_services` sekelas
 * `standard_price`). Yang digerbangi adalah HAPUS-nya, di `msl.deleteService`.
 */
import { msl } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { refsToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const refs = await readAsActor(actor, (sql) => msl.serviceRefs(sql, id));
    return json({ data: refsToWire(refs) });
  });
}
