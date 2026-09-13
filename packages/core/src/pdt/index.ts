/**
 * @cdps/core pdt — registry modul parser + pencocok tanda tangan (G1-02),
 * normalisasi angka terpusat (G1-03), pagar paket ZIP (G1-04).
 * Lihat `modules.ts` untuk daftar 25 modul dan sumbernya, `detect.ts` untuk
 * pencocokan (Rule 6/7), `angka.ts` untuk parser angka, `zip-pagar.ts` untuk
 * evaluasi Rule 41-42 (pembaca ZIP sungguhan ada di `apps/api`, bukan di sini).
 */
export * from './types';
export * from './modules';
export * from './detect';
export * from './angka';
export * from './zip-pagar';
