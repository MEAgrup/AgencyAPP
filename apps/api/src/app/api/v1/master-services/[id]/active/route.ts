/**
 * PUT /api/v1/master-services/{id}/active — arsipkan atau pulihkan satu layanan
 * katalog (permintaan pemilik 2026-09-10).
 *
 * ## Kenapa route TERSENDIRI dan bukan `PUT /master-services/{id}` dengan
 * ## `active: false`
 *
 * Karena `PUT /{id}` memanggil `msl.updateService`, dan `updateService`
 * ber-semantik FULL REPLACE. `DECISIONS.md` 2026-09-07 sudah mencatat kerusakan
 * yang ditimbulkannya: setiap "Ubah" yang tidak mengirim `durasi_jasa`
 * MENGHAPUS nilai itu diam-diam. Sebuah tombol "Arsipkan" tidak memegang dua
 * puluh field lainnya dan tidak seharusnya perlu — mengirimnya lewat pintu
 * full-replace berarti tombol itu menghapus apa pun yang ia tidak tahu.
 *
 * Route ini memanggil `msl.setActive`, yang menyalin versi berjalan VERBATIM di
 * dalam SQL dan membalik satu flag. Itu operasi yang berbeda, jadi ia mendapat
 * pintu yang berbeda.
 *
 * `PUT` dan bukan `POST /archive` + `POST /restore`: keduanya menyetel satu
 * keadaan yang sama ke nilai yang berbeda, dan dua route yang berbeda hanya
 * akan melahirkan dua salinan gerbang peran yang sama.
 */
import { msl } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ active?: boolean }>(request);
    // `active` WAJIB eksplisit. Menganggap absennya berarti `false` akan
    // membuat sebuah body kosong — atau body yang salah bentuk — mengarsipkan
    // layanan, dan itu persis kelas kesalahan yang tidak boleh punya jalur
    // diam-diam.
    if (typeof body.active !== 'boolean') {
      throw new msl.IncompleteError();
    }
    const versionNo = await msl.setActive(db(), actor, id, body.active);
    return json({ id, active: body.active, version_no: versionNo });
  });
}
