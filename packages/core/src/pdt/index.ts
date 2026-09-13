/**
 * @cdps/core pdt — registry modul parser + pencocok tanda tangan (G1-02),
 * normalisasi angka terpusat (G1-03), pagar paket ZIP (G1-04), identitas
 * toko & periode dari berkas (G1-06).
 * Lihat `modules.ts` untuk daftar 25 modul dan sumbernya, `detect.ts` untuk
 * pencocokan (Rule 6/7), `angka.ts` untuk parser angka, `zip-pagar.ts` untuk
 * evaluasi Rule 41-42 (pembaca ZIP sungguhan ada di `apps/api`, bukan di sini),
 * `identitas.ts` untuk Rule 2-5 (preamble Shopee, `ID Kreator` TikTok, resolusi
 * periode batch).
 */
export * from './types';
export * from './modules';
export * from './detect';
export * from './angka';
export * from './zip-pagar';
export * from './identitas';
