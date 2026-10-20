/**
 * Saklar fitur portal — build-time, bukan runtime.
 *
 * `NEXT_PUBLIC_*` di-inline Next saat `next build`, jadi nilai yang berlaku
 * adalah nilai env pada saat build. Mengubahnya di Vercel baru berpengaruh
 * setelah redeploy; tidak perlu ubah kode. Nama variabel harus ditulis utuh
 * (`process.env.NEXT_PUBLIC_…`), bukan lewat indeks dinamis — kalau tidak,
 * Next tidak meng-inline-nya dan di browser nilainya selalu kosong.
 */

/** Hanya `'1'`/`'true'` yang menyalakan. Tidak di-set, `''`, `'0'`, `'false'` = mati. */
function nyala(nilai: string | undefined): boolean {
  const v = (nilai ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Tab "Progres Layanan" (M15 Rule 2). DEFAULT MATI — ditangguhkan sementara,
 * `docs/decisions/2026-10-20-portal-progres-layanan-nonaktif.md`.
 */
export function progresAktif(): boolean {
  return nyala(process.env.NEXT_PUBLIC_PORTAL_PROGRES_AKTIF);
}
