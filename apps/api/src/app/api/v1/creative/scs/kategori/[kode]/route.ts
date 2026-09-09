/**
 * /api/v1/creative/scs/kategori/{kode} — sunting satu Kategori.
 *
 * NOL jalur DELETE, dan itu keputusan: baris pekerjaan historis menunjuk
 * Kategori-nya lewat FK (nol CASCADE, nol SET NULL), jadi menghapus satu baris
 * taksonomi membuat riwayat tidak bisa dirender. Menonaktifkan dilakukan lewat
 * `aktif: false` — ia hilang dari picker, tetap terbaca di baris lama.
 */
import { scs } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { scsKategoriToWire, toScsKategoriInput } from '@/lib/wire';

export async function PUT(request: Request, ctx: { params: Promise<{ kode: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { kode } = await ctx.params;
    const b = await readJson<Parameters<typeof toScsKategoriInput>[0]>(request);
    const row = await scs.updateKategori(db(), actor, kode, toScsKategoriInput({ ...(b ?? {}), kode }));
    return json(scsKategoriToWire(row));
  });
}
