-- G2-01 · `pdt_laporan_kiriman.benchmark_versi` — DROP NOT NULL (Flow B
-- langkah 4, "Kirim ke klien").
--
-- Ditemukan sesi 34 (docs/backlog/PDT_BACKLOG.md §2 "Catatan skema
-- ditemukan"), diputuskan pemilik lewat AskUserQuestion saat "Kirim ke
-- klien" mulai dibangun untuk kedua platform sekaligus:
--
-- `pdt_laporan_kiriman.benchmark_versi` lahir `NOT NULL REFERENCES
-- pdt_benchmark (versi)` di G1-01, ditulis saat PRD hanya membayangkan alur
-- TikTok (benchmark berversi, dibaca `pdt_benchmark`). Riset G2-01 Shopee
-- (sesi 34 lanjutan) membuktikan `report/shopee/skor.ts` — mesin PRODUKSI
-- yang jadi rujukan porting — TIDAK menerima parameter benchmark SAMA
-- SEKALI: setiap ambang adalah konstanta hardcode di dalam fungsi
-- `computeSkor(M)`, asimetri NYATA terhadap TikTok, bukan bug untuk
-- "diperbaiki" saat porting (docs/DECISIONS.md 2026-09-15). `hitungSkorShopee`/
-- `rakitLaporanShopee` karena itu TIDAK PERNAH mengembalikan `benchmarkVersi`
-- sama sekali — `pdt.PdtLaporanShopee` (packages/core/src/pdt/laporan.ts)
-- bahkan tidak punya field itu di tipenya. Wire layer sudah membalas
-- `benchmark_versi: null` eksplisit untuk Shopee sejak PR #403
-- (`GET /account/pdt/laporan`, rumah #4/O43 "kunci hilang lebih berbahaya
-- dari null") — migrasi ini hanya melanjutkan asimetri yang SAMA ke tabel
-- frozen-nya, bukan pola baru.
--
-- Opsi yang DITOLAK (dan kenapa): (a) baris `pdt_benchmark` sentinel palsu
-- untuk Shopee (mis. versi 0, nilai {}) — akan merusak TEPAT tujuan Rule 23
-- ("laporan yang sudah dikirim tetap memakai versi saat pengiriman"): kalau
-- ambang hardcode Shopee di kode berubah lewat deploy baru, setiap kiriman
-- Shopee lama MAUPUN baru tetap mengaku "versi 0" yang sama — jejak versi
-- jadi bohong, bukan sekadar kosong; (b) menunda "Kirim ke klien" Shopee ke
-- tiket lain — menyisakan separuh platform PDT tanpa fitur yang diminta
-- sekarang, untuk masalah yang perbaikannya sendiri kecil dan tanpa risiko.
--
-- Aman dieksekusi sekarang: `pdt_laporan_kiriman` masih NOL baris di
-- produksi (fitur "Kirim ke klien" belum pernah dibangun sebelum tiket ini)
-- — nol backfill, nol baris NULL lama yang perlu disisipi.
ALTER TABLE pdt_laporan_kiriman ALTER COLUMN benchmark_versi DROP NOT NULL;

COMMENT ON COLUMN pdt_laporan_kiriman.benchmark_versi IS
  'Versi pdt_benchmark yang dipakai saat pengiriman (Rule 23) — NOT NULL untuk TikTok. NULL untuk '
  'Shopee: mesin skor Shopee (report/shopee/skor.ts) memakai ambang hardcode, nol pdt_benchmark '
  'dibaca sama sekali (docs/DECISIONS.md 2026-09-15/16) — NULL berarti "platform ini tidak dinilai '
  'pakai benchmark bernomor", bukan data hilang.';

-- Gerbang CI — nol perubahan struktural (satu ALTER COLUMN DROP NOT NULL):
--   public base tables : 176 → 176 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
