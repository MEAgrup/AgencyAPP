/**
 * POST /api/v1/skus/{id}/transition — gerakkan satu baris SKU di mesin #32.
 *
 * Body: `{ to, link_output?, catatan_ops?, dampak? }`.
 *
 * ## KENAPA SATU RUTE, BUKAN LIMA
 *
 * Kelima edge mesin ini adalah pekerjaan orang yang SAMA (PIC baris itu atau
 * leader divisinya) pada baris yang SAMA, dan gerbangnya identik; yang berbeda
 * hanya muatan yang wajib menyertainya. Lima rute berarti lima tempat yang
 * masing-masing harus mengulang `requireActor` + `params` + pemetaan galat, dan
 * satu di antaranya akan menyimpang.
 *
 * Yang TIDAK dilakukan di sini: memilih transisi berdasarkan status baris.
 * `to` datang dari pemanggil dan dicocokkan ke fungsi domainnya; domain yang
 * mem-pin state asalnya dan `sm_transition` yang menolak edge tak terdaftar
 * dengan pesan BI mesin. Route ini tidak pernah menebak langkah berikutnya.
 */
import { storeops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface Body {
  to?: string;
  /**
   * Status yang pemanggil TERAKHIR LIHAT. Hanya dipakai untuk membedakan dua
   * edge yang tujuannya sama (`[Menunggu Eksekusi]`→`[Dikerjakan]` = mulai,
   * `[Gagal Upload]`→`[Dikerjakan]` = ulangi). Nilai basi TIDAK berbahaya: fungsi
   * domainnya mem-pin state asal di dalam transaksi, jadi baris yang berubah di
   * bawah tangan pemanggil menghasilkan 409 — yang memang jawaban yang benar,
   * bukan transisi diam-diam atas baris yang sudah bukan yang ia lihat.
   */
  from?: string;
  link_output?: string;
  catatan_ops?: string;
  dampak?: {
    ctr_sebelum?: number;
    cvr_sebelum?: number;
    rating_sebelum?: number;
    ctr_sesudah?: number;
    cvr_sesudah?: number;
    rating_sesudah?: number;
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const sql = db();
    switch (b.to) {
      case storeops.STATE_DIKERJAKAN:
        // Dua edge menuju [Dikerjakan]; `from` yang memilih. Sengaja TIDAK
        // "coba yang satu, kalau gagal coba yang lain": percobaan pertama bisa
        // gagal karena 403, dan galat yang muncul ke pengguna akan jadi galat
        // percobaan KEDUA — pesan yang menyesatkan tentang sebab yang salah.
        return json(b.from === storeops.STATE_GAGAL_UPLOAD
          ? await storeops.ulangiKerja(sql, actor, id)
          : await storeops.mulaiKerja(sql, actor, id));
      case storeops.STATE_TERUPLOAD:
        return json(await storeops.tandaiTerupload(sql, actor, id, b.link_output ?? ''));
      case storeops.STATE_GAGAL_UPLOAD:
        return json(await storeops.tandaiGagalUpload(sql, actor, id, b.catatan_ops ?? ''));
      case storeops.STATE_DIEVALUASI:
        return json(await storeops.catatDampak(sql, actor, id, {
          ctrSebelum: Number(b.dampak?.ctr_sebelum),
          cvrSebelum: Number(b.dampak?.cvr_sebelum),
          ratingSebelum: Number(b.dampak?.rating_sebelum),
          ctrSesudah: Number(b.dampak?.ctr_sesudah),
          cvrSesudah: Number(b.dampak?.cvr_sesudah),
          ratingSesudah: Number(b.dampak?.rating_sesudah),
        }));
      default:
        throw new storeops.ConflictError();
    }
  });
}
