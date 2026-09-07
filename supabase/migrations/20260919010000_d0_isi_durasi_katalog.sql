-- Isi `durasi_bulan` + `qty_menambah` untuk seluruh katalog MSL aktif.
--
-- Klasifikasi diketok Nerissa (COO) 2026-09-07 per GRUP, bukan per baris, dan
-- aturannya ditulis apa adanya di CASE di bawah supaya keputusan pemilik dan
-- kode yang menjalankannya bisa dibaca berdampingan. Enam grup:
--
--   A  `unit` berisi angka > 1        durasi = angka itu   qty = durasi
--   B  nama menyebut "JAM"           durasi = 1 bulan     qty = durasi
--   C  frequency = 'One-time'        durasi = NULL        qty = volume
--   D  Jasa Pengajuan/Buka Toko/Web  durasi = NULL        qty = volume
--   E  `unit` = '1' (sisanya)        durasi = 1 bulan     qty = durasi
--   F  satuan volume (sisanya)       durasi = NULL        qty = volume
--        kecuali lima yang jelas bulanan  -> durasi = 1 bulan
--        kecuali `GMV Max`                -> qty = durasi
--
-- KENAPA MENGOREKSI BARIS VERSI YANG ADA, BUKAN MENERBITKAN VERSI BARU
-- (diketok pemilik 2026-09-07, `AskUserQuestion`): durasi itu SELALU ada.
-- `GMV MAX MEA PRO` memang paket 6 bulan sejak hari pertama — angkanya cuma
-- tercatat di kolom `unit` karena kolom durasi belum ada. Jadi ini koreksi
-- SALAH-CATAT, bukan perubahan atas apa yang dijual, dan memperlakukannya
-- sebagai versi baru justru akan berbohong: klien yang kontraknya sedang
-- berjalan ter-pin ke versi lama, jadi paket 6 bulan yang baru jalan 2 bulan
-- tidak akan pernah punya durasi dan sisa pendapatannya tidak pernah masuk
-- skedul accrual. Setiap koreksi tetap meninggalkan jejak: satu baris
-- `audit_log` per layanan, dengan nilai sebelum dan sesudahnya.
--
-- Grup A adalah yang paling mahal kalau dibiarkan: harga di sana adalah harga
-- PAKET. `GMV MAX MEA PRO` Rp 20.000.000 untuk 6 bulan yang terbaca berdurasi
-- 1 bulan akan diakui seluruhnya di bulan pertama — kelebihan akui
-- Rp 16.666.667 per layanan per klien.
--
-- Migrasi ini AMAN dijalankan pada database yang katalognya kosong (mis.
-- `db-rebuild.sh` yang tidak menyemai 80 layanan produksi): semua UPDATE-nya
-- ber-WHERE, jadi nol baris cocok = nol perubahan.

-- `klasifikasi` memberi setiap layanan AKTIF tepat satu grup. Urutan CASE
-- adalah urutan prioritas grup, dan itu yang menjamin satu baris tidak pernah
-- masuk dua grup (mis. layanan ber-"JAM" yang `unit`-nya '1' adalah B, bukan E).
WITH terkini AS (
    SELECT DISTINCT ON (service_id)
           id, service_id, name, unit, frequency, durasi_bulan, qty_menambah, active
      FROM master_service_versions
     ORDER BY service_id, version_no DESC
),
klasifikasi AS (
    SELECT id, service_id, name, unit AS unit_lama,
           durasi_bulan AS durasi_lama, qty_menambah AS qty_lama,
           CASE
             WHEN unit ~ '^[0-9]+$' AND unit::int > 1 THEN 'A'
             WHEN name ~* 'jam'                       THEN 'B'
             WHEN frequency = 'One-time'              THEN 'C'
             WHEN name ~* '^jasa (pengajuan|buka toko|website)' THEN 'D'
             WHEN unit ~ '^[0-9]+$'                   THEN 'E'
             ELSE 'F'
           END AS grup,
           unit
      FROM terkini
     WHERE active
),
target AS (
    SELECT id, service_id, name, grup, unit_lama, durasi_lama, qty_lama,
           CASE grup
             WHEN 'A' THEN unit::int
             WHEN 'B' THEN 1
             WHEN 'E' THEN 1
             WHEN 'F' THEN CASE
                             WHEN name IN ('Store Management (Paket)',
                                           'Customer Review Management',
                                           'AI Video',
                                           'Optimasi SKU',
                                           'GMV Max') THEN 1
                             ELSE NULL
                           END
             ELSE NULL          -- C, D
           END AS durasi_baru,
           CASE
             WHEN grup IN ('A', 'B', 'E') THEN 'durasi'
             -- `GMV Max` adalah contoh yang pemilik sendiri pakai saat mengetok
             -- Q3: "gmax defaultnya 1 bulan, kalau beli 3 artinya 3 bulan".
             WHEN name = 'GMV Max'        THEN 'durasi'
             ELSE 'volume'                -- C, D, sisa F
           END AS qty_baru,
           -- Grup A dan E menyimpan ANGKA BULAN di kolom `unit`. Setelah
           -- angkanya pindah ke kolom durasi, `unit` diisi satuan yang
           -- sebenarnya. 'paket' dipilih karena itulah bentuk jualannya dan ia
           -- tidak mengarang angka baru apa pun.
           CASE WHEN grup IN ('A', 'E') THEN 'paket' ELSE unit_lama END AS unit_baru
      FROM klasifikasi
)
UPDATE master_service_versions msv
   SET durasi_bulan = t.durasi_baru,
       qty_menambah = t.qty_baru,
       unit         = t.unit_baru
  FROM target t
 WHERE msv.id = t.id
   AND (msv.durasi_bulan IS DISTINCT FROM t.durasi_baru
     OR msv.qty_menambah IS DISTINCT FROM t.qty_baru
     OR msv.unit         IS DISTINCT FROM t.unit_baru);

-- Jejak koreksinya. Satu baris per layanan yang benar-benar BERUBAH, memuat
-- nilai sebelum dan sesudah, supaya "kenapa durasi layanan ini 6" bisa dijawab
-- tanpa membaca migrasi. `audit_log` menolak UPDATE dan DELETE (aturan rumah
-- #3), jadi baris ini permanen.
WITH terkini AS (
    SELECT DISTINCT ON (service_id)
           service_id, name, unit, durasi_bulan, qty_menambah, active
      FROM master_service_versions
     ORDER BY service_id, version_no DESC
)
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'master_service', service_id, 'SYSTEM', 'koreksi_durasi_katalog',
       jsonb_build_object('catatan', 'durasi/qty belum ada sebelum migrasi 20260918010000'),
       jsonb_build_object('name', name, 'unit', unit,
                          'durasi_bulan', durasi_bulan, 'qty_menambah', qty_menambah),
       'SYSTEM'
  FROM terkini
 WHERE active;
