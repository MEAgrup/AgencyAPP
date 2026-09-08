-- CDPS M16 — LT-1 sisa terbuka DITUTUP (pemilik, 2026-09-08: "buat 1 hari
-- kerja"), menjawab pertanyaan yang seed `20260901010000_lt1_am_review_weight`
-- sengaja tinggalkan sebagai placeholder: target normalisasi `kecepatan_review_am`.
--
-- Bobot komponen (10%, Σ=100) TIDAK berubah di sini — itu sudah diputuskan dan
-- diterapkan migrasi itu. Yang berubah HANYA baris target: `is_placeholder`
-- true -> false. Nilainya (24) TIDAK berubah — itulah "1 hari kerja" yang
-- dimaksud jawaban pemilik: seed asalnya sendiri sudah menyamakan keduanya
-- ("24 jam dipilih sebagai placeholder... seluruh checkpoint `Cek Brief AM`
-- di semua pipeline bertarget 1 hari kerja", `20260901010000_lt1_am_review_
-- weight.sql` §2), jadi mengonfirmasi "1 hari kerja" berarti mengonfirmasi
-- ANGKA yang sudah ada, bukan menghitung ulang.
--
-- Nol tabel/mesin/prefix/event baru — satu UPDATE data, persis seperti yang
-- migrasi asalnya sendiri prediksikan ("Mengubahnya = satu UPDATE data").
-- Gate TETAP: db-rebuild.sh tidak berubah (149/41/33/73).
UPDATE perf_period_targets
   SET is_placeholder = false, updated_by = 'SYSTEM'
 WHERE role_type = 'AM' AND component = 'kecepatan_review_am'
   AND staff_id = '*' AND period_start = '0001-01-01'
   AND target_value = 24;
