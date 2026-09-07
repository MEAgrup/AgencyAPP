-- Tuntaskan pembersihan kolom `unit` — 16 layanan yang migrasi 187 lewatkan.
--
-- 187 memindahkan angka bulan dari `unit` ke `durasi_bulan` dan mengisi `unit`
-- dengan satuan sebenarnya HANYA untuk grup A dan E. Grup B (9 layanan ber-JAM)
-- dan grup D (7 layanan sekali jadi) juga ber-`unit` = '1' — angka bulan yang
-- sama, di kolom yang sama salahnya — tapi keduanya tidak masuk daftar yang
-- dibersihkan. Diverifikasi sesudah 187 diterapkan ke live: 16 layanan aktif
-- masih ber-`unit` numerik, dan 9 + 7 = 16.
--
-- Membiarkannya berarti separuh katalog "sesuai format baru" dan separuhnya
-- tidak, dengan angka yang sekarang MENYESATKAN dua kali: `unit` = '1' pada
-- `Jasa Pengajuan Shopee Mall` terbaca seperti durasi 1 bulan, padahal layanan
-- itu justru yang durasinya sengaja NULL (sekali jadi). Itu persis ambiguitas
-- yang pemilik minta diperbaiki.
--
-- 'paket' dipakai untuk keduanya karena itulah bentuk jualannya, dan ia tidak
-- mengarang angka baru apa pun. Aturannya ditulis sebagai "unit yang isinya
-- MURNI angka" supaya tidak ada baris numerik yang lolos lagi — bukan sebagai
-- daftar nama, yang justru cara 187 melewatkan keenambelasnya.
--
-- Tidak menyentuh `durasi_bulan` maupun `qty_menambah`: keduanya sudah benar
-- sesudah 187. Ini murni kolom satuan.

WITH terkini AS (
    SELECT DISTINCT ON (service_id) id, service_id, name, unit, active
      FROM master_service_versions
     ORDER BY service_id, version_no DESC
)
UPDATE master_service_versions msv
   SET unit = 'paket'
  FROM terkini t
 WHERE msv.id = t.id
   AND t.active
   AND t.unit ~ '^[0-9]+$';

-- Jejaknya, sama seperti 187. `audit_log` menolak UPDATE dan DELETE, jadi
-- alasan "kenapa satuan layanan ini berubah" tetap bisa dijawab nanti.
WITH terkini AS (
    SELECT DISTINCT ON (service_id) service_id, name, unit, active
      FROM master_service_versions
     ORDER BY service_id, version_no DESC
)
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'master_service', service_id, 'SYSTEM', 'koreksi_unit_sisa_angka',
       jsonb_build_object('catatan', 'unit berisi angka bulan, dilewatkan migrasi 20260919010000'),
       jsonb_build_object('name', name, 'unit', unit),
       'SYSTEM'
  FROM terkini
 WHERE active AND unit = 'paket';
