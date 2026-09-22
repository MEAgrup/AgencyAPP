/**
 * @cdps/core pdt — registry modul parser + pencocok tanda tangan (G1-02),
 * normalisasi angka terpusat (G1-03), pagar paket ZIP (G1-04), identitas
 * toko & periode dari berkas (G1-06), rekonsiliasi (G1-07).
 * Lihat `modules.ts` untuk daftar 25 modul dan sumbernya, `detect.ts` untuk
 * pencocokan (Rule 6/7), `angka.ts` untuk parser angka, `zip-pagar.ts` untuk
 * evaluasi Rule 41-42 (pembaca ZIP sungguhan ada di `apps/api`, bukan di sini),
 * `identitas.ts` untuk Rule 2-5 (preamble Shopee, `ID Kreator` TikTok, resolusi
 * periode batch), `rekonsiliasi.ts` untuk Rule 13-16 (gerbang 0,5%, larangan
 * campur basis), `parsestatus.ts` untuk Rule 9-10 (kolom wajib + parse_status)
 * dan Rule 12 (skor netral dihapus, renormalisasi bobot dimensi), `header.ts`
 * untuk Rule 7 (baris header dicari, bukan diasumsikan) + Rule 8 (kolom
 * dipanen/kolom baru, G1-09), `fakta.ts` untuk baris fakta tertipe
 * (`pdt_fact_ads` dari `shopee_ads_live`, G1-09 sub-langkah 2b-ii), `skor.ts`
 * untuk mesin skor TikTok+Shopee (G2-01, Rule 21, enam dimensi via
 * `renormalisasiDimensi`), `laporan.ts` untuk payload "laporan" v1 (Rule 21,
 * KPI ringkas + kedalaman jelajah + skor + sembilan bagian rincian yang
 * setara mesin HTML lama, lihat docblock berkas), `insight-edit.ts` untuk
 * validasi draf insight AM (G2-01-INSIGHT-EDIT), `kuadran.ts` untuk
 * klasifikasi kuadran SKU DUA platform — TikTok (benchmark
 * `quad_klik`/`quad_cvr`, dua band) dan Shopee (ambang absolut, tiga band,
 * ember `no_data`) — plus ambang relatif percentile keduanya.
 * `verdict.ts` untuk mesin verdict Shopee (G4-03 Tahap 1, Rule 26-32 Flow C)
 * — katalog aksi BARU membaca `pdt_fact_*` langsung, terpisah dari
 * `pilarkatalog.ts` (katalog lama, payload baseline). `render.ts` untuk
 * renderer HTML payload "laporan" (B-01/B-02) — port M14's renderer ke PDT,
 * satu renderer untuk kedua platform.
 */
export * from './types';
export * from './modules';
export * from './detect';
export * from './angka';
export * from './zip-pagar';
export * from './identitas';
export * from './rekonsiliasi';
export * from './parsestatus';
export * from './header';
export * from './fakta';
export * from './skor';
export * from './laporan';
export * from './insight-edit';
export * from './kuadran';
export * from './verdict';
export * from './render';
