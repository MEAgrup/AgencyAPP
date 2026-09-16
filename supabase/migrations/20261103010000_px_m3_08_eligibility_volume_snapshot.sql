-- ============================================================================
-- PX-M3-08-SENGKETA-90-HARI DIJAWAB (opsi B) — px_sku_eligibility sekarang
-- menyimpan snapshot volume yang MENDASARI setiap baris verdict, permanen,
-- terpisah dari retensi file ZIP mentah (`pdt_upload_batch.raw_path`, PX-M3-08
-- asli, migrasi 20261101010000).
--
-- MASALAH (docs/DECISIONS.md, entri 2026-09-16 "O60"+sesi ini): retensi ZIP
-- mentah diperpanjang HANYA selama SKU `lolos` (GREATEST(existing,
-- current_date+90), packages/domain/src/productexchange-m3.ts). Begitu
-- verdict berhenti `lolos`, perpanjangan berhenti — retensi membeku, lalu
-- `planPdtPurgeTick` (packages/domain/src/pdt.ts) MENGHAPUS PERMANEN file ZIP
-- itu dari storage begitu tanggalnya lewat. Kalau klien mempersoalkan verdict
-- `lolos` itu > 90 hari SETELAH SKU turun dari katalog, CDPS tidak lagi punya
-- cara membuktikan ulang angka GMV yang mendasarinya — baris
-- `px_sku_eligibility` yang ada HANYA menyimpan verdict/lapis_gagal/kategori/
-- price_segment, sengaja "Nol kolom angka volume" (komentar tabel asli,
-- migrasi 20261101010000) karena waktu itu volume diasumsikan SELALU bisa
-- dihitung ulang dari `pdt_fact_sku_period`/file mentah. Asumsi itu pecah
-- persis di titik file mentahnya sudah dihapus.
--
-- JAWABAN pemilik (2026-09-16, langsung — bukan menunggu Nerissa lebih dulu,
-- pola sama M3-01/M3-02): opsi (b) dari tiga yang diajukan (a: perpanjang
-- jendela ke 180 hari; b: simpan snapshot AGREGAT permanen terpisah dari file
-- mentah; c: terima risiko apa adanya). Alasan: opsi (a) hanya MENUNDA
-- masalah (sengketa masih bisa muncul di hari ke-181) dan melipatgandakan
-- biaya storage ZIP untuk SKU yang lama lolos lalu turun; opsi (b) menutup
-- gap SECARA PERMANEN dengan biaya storage kecil (beberapa kolom angka per
-- baris verdict, bukan file ZIP penuh) TANPA mengubah retensi file mentah
-- (tetap 90 hari, PX-M3-08 asli tidak disentuh).
--
-- YANG DITAMBAHKAN — EMPAT kolom NULLABLE di px_sku_eligibility (tabel
-- append-only yang SUDAH ada, dibekukan trigger trg_px_sku_eligibility_frozen
-- sejak lahir — pilihan paling murah, bukan tabel baru): `gmv_30d`/
-- `jendela_mulai`/`jendela_selesai`/`batch_ids`, disalin PERSIS dari
-- `px_sku_volume` pada saat baris verdict itu ditulis (lihat perubahan kode
-- `evaluateStoreProducts`, commit yang sama). NULLABLE karena baris SEBELUM
-- migrasi ini lahir tanpa snapshot (kejujuran riwayat — Rule 3 CLAUDE.md:
-- baris lama TIDAK PERNAH diubah, termasuk untuk mengisi kolom baru secara
-- retroaktif; kita tidak punya datanya lagi untuk baris lama, jadi NULL,
-- bukan dikarang).
--
-- KENAPA BUKAN insert baris baru setiap tick (row explosion): baris verdict
-- baru HANYA ditulis saat `berubah` (verdict/lapis_gagal/kategori/
-- price_segment/coverage_snapshot_batch_key berbeda dari baris terakhir) —
-- perilaku itu TIDAK diubah migrasi ini. Snapshot volume yang tersimpan
-- adalah angka PADA SAAT verdict itu terbentuk/berubah — persis "angka yang
-- mendasari klaim ini", bukan angka hari ini yang terus bergerak.
--
-- Nol perubahan ke `px_sku_volume` (masih upsert per recompute, bukan
-- append-only — perannya TETAP operasional/L2 real-time, bukan arsip
-- sengketa) dan nol perubahan ke jendela retensi file ZIP (tetap 90 hari,
-- PX-M3-08 asli). Nol perubahan gerbang CI (176→181 tabel TIDAK berubah,
-- ini ALTER kolom pada tabel yang sudah ada; entity_prefix/sm_machines/
-- notif_events juga tidak tersentuh — px_sku_eligibility tidak punya prefix
-- ID sendiri, bukan lifecycle sm_transition, bukan event notifikasi).
-- ============================================================================

ALTER TABLE px_sku_eligibility
  ADD COLUMN gmv_30d        numeric(15,2) NULL,
  ADD COLUMN jendela_mulai   date          NULL,
  ADD COLUMN jendela_selesai date          NULL,
  ADD COLUMN batch_ids       bigint[]      NULL,
  ADD CONSTRAINT ck_px_sku_eligibility_snapshot_nonneg
    CHECK (gmv_30d IS NULL OR gmv_30d >= 0),
  ADD CONSTRAINT ck_px_sku_eligibility_snapshot_batch_ids
    CHECK (batch_ids IS NULL OR cardinality(batch_ids) >= 1);

COMMENT ON TABLE px_sku_eligibility IS
  'Riwayat verdict kelayakan SKU Product Exchange, append-only (baris beku via trigger). '
  'Verdict terbaru per (client_platform_id, platform_product_id) pada versi_policy aktif '
  'adalah yang dibaca px_catalog_item_v/halaman Kandidat. Sejak PX-M3-08 opsi B '
  '(20261103010000): gmv_30d/jendela_mulai/jendela_selesai/batch_ids menyimpan snapshot '
  'volume yang mendasari baris ini SAAT DITULIS — audit permanen untuk sengketa >90 hari '
  'sesudah SKU turun dari katalog, karena file ZIP mentahnya sendiri sudah dihapus purge '
  '(retensi PX-M3-08 asli, migrasi 20261101010000, TIDAK berubah). NULL pada baris yang '
  'lahir sebelum migrasi ini — riwayat lama tidak diisi retroaktif (Rule 3).';
