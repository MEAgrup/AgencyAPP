-- `Store Management (Paket)` — qty yang dibeli klien menambah DURASI, bukan volume.
--
-- Diketok pemilik 2026-09-07 (Nerissa, COO) atas empat layanan grup F yang
-- migrasi 187 sengaja beri pilihan AMAN (`volume`) karena keduanya mungkin:
--
--   Store Management (Paket)    -> durasi   (diubah di sini)
--   AI Video                    -> volume   (tetap, nol perubahan)
--   Optimasi SKU                -> volume   (tetap, nol perubahan)
--   Customer Review Management  -> volume   (tetap, nol perubahan)
--
-- Jadi migrasi ini menyentuh SATU layanan. Tiga sisanya sudah bernilai benar
-- sejak 187 dan tidak diikutkan — bukan karena terlewat, tapi karena ketokannya
-- memang sama dengan nilai yang sudah ada.
--
-- `qty_menambah = 'durasi'` menuntut `durasi_bulan IS NOT NULL`
-- (`ck_msv_qty_durasi_butuh_durasi_bulan`). `Store Management (Paket)` sudah
-- berdurasi 1 bulan sejak 187, jadi kombinasinya sah: beli 3 = 3 bulan.
--
-- Aman mendahului kode: murni data, nol perubahan skema.

-- CATATAN POLA — ini memperbaiki cara migrasi 188 menulis auditnya.
--
-- 188 menyaring `INSERT ... SELECT` auditnya dengan predikat atas NILAI BARU
-- (`WHERE unit = 'paket'`), dan predikat itu dievaluasi SESUDAH `UPDATE`-nya,
-- sehingga ikut mencocoki baris yang tidak berubah: 44 baris audit tercatat
-- untuk 16 layanan yang benar-benar diubah (lihat `DECISIONS.md` 2026-09-07).
--
-- Di sini auditnya diturunkan dari `UPDATE ... RETURNING`, jadi ia mencatat
-- PERSIS baris yang berubah — tidak bisa lebih, tidak bisa kurang.

WITH terkini AS (
    SELECT DISTINCT ON (service_id)
           id, service_id, name, durasi_bulan, qty_menambah, active
      FROM master_service_versions
     ORDER BY service_id, version_no DESC
),
diubah AS (
    UPDATE master_service_versions msv
       SET qty_menambah = 'durasi'
      FROM terkini t
     WHERE msv.id = t.id
       AND t.active
       AND t.name = 'Store Management (Paket)'
       AND t.qty_menambah IS DISTINCT FROM 'durasi'
    RETURNING msv.service_id, msv.name, msv.durasi_bulan, msv.qty_menambah
)
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'master_service', service_id, 'SYSTEM', 'ketokan_qty_menambah',
       jsonb_build_object('qty_menambah', 'volume',
                          'catatan', 'pilihan aman migrasi 20260919010000, menunggu ketokan pemilik'),
       jsonb_build_object('name', name,
                          'durasi_bulan', durasi_bulan,
                          'qty_menambah', qty_menambah),
       'SYSTEM'
  FROM diubah;
