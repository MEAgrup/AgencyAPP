-- G1-09 sub-langkah 2 (commit) · koreksi skema `pdt_file` (PRD §3.2 Rule 10,
-- §6.1). Ditemukan menulis `commitUploadBatch` (`packages/domain/src/pdt.ts`):
-- migrasi G1-01 (`20261011010000_g1_01_pdt_tables.sql`) mengunci `sha256 text
-- NOT NULL`, `bytes bigint NOT NULL`, `baris_header smallint NOT NULL` —
-- tapi Rule 10 EKSPLISIT minta setiap ENTRI di dalam ZIP (bukan hanya yang
-- berhasil diparse) bisa dibedakan "berkas tidak diunggah" dari "diunggah
-- tapi gagal diparse" **DI DB, bukan cuma di UI**. Tiga kelas entri yang lolos
-- pagar zip-bomb (Rule 41-42, jadi BUKAN "tidak diunggah") tapi TIDAK PERNAH
-- sampai ke tahap deteksi modul/header — jadi structural tidak punya nilai
-- sha256/bytes/baris_header untuk disimpan:
--   (a) `ditolakPagar` per-entri (terenkripsi/ekstensi salah/zip-slip, Rule 41)
--       — pagar menolak dari METADATA direktori pusat SEBELUM entri dibuka
--       sama sekali (`bacaDanEkstrakPdtZip` G1-04), jadi nol byte pernah dibaca.
--   (b) `gagalEkstrak` (metadata ukuran bohong, ekstraksi streaming gagal
--       di tengah — G1-04) — sha256/bytes JUGA nol karena gagal SEBELUM
--       hash selesai dihitung.
--   (c) `decodeGagal` tanpa entri ter-ekstrak (fallback struktural
--       "berkas hilang dari hasil ekstraksi/parse", `pdt-preview.ts`) —
--       kasus yang TIDAK SEHARUSNYA terjadi, tapi bila terjadi juga nol data.
-- Menolak menulis pdt_file sama sekali untuk ketiga kelas ini akan melanggar
-- Rule 10 (kegagalan itu jadi HANYA terlihat di respons HTTP komit sesaat,
-- tidak pernah di DB, tidak bisa didiagnosis belakangan) — jadi kolomnya yang
-- dilonggarkan, bukan Rule 10 yang dilanggar diam-diam.
--
-- `decodeGagal` YANG entrinya sempat ter-ekstrak (XLSX/CSV rusak tapi
-- byte-nya sudah lengkap) TETAP mengisi sha256/bytes seperti sebelumnya
-- (`bangunPreviewBerkasInputs` sudah membawa nilai itu) — hanya baris_header
-- yang nol untuk kasus ini (modul/header belum sempat dicari). Kolom
-- tetap NOT NULL sampai ada baris nyata yang butuh NULL; melonggarkan di sini
-- membuat KETIGA kolom konsisten NULLable untuk kelas kegagalan yang sama.
--
-- Nol tabel baru/dihapus, nol constraint lain berubah — nol gerbang CI
-- (public/entity_prefix/sm_machines/notif_events) bergerak.

ALTER TABLE pdt_file ALTER COLUMN sha256 DROP NOT NULL;
ALTER TABLE pdt_file ALTER COLUMN bytes DROP NOT NULL;
ALTER TABLE pdt_file ALTER COLUMN baris_header DROP NOT NULL;

COMMENT ON COLUMN pdt_file.sha256 IS
  'NULL hanya untuk entri yang TIDAK PERNAH sampai diekstrak (ditolakPagar/gagalEkstrak, Rule 41) — Rule 10 tetap menulis baris ini, hanya tanpa sidik jari.';
COMMENT ON COLUMN pdt_file.bytes IS
  'NULL bersamaan dengan sha256 (lihat komentarnya) — entri yang gagal sebelum byte sungguhan pernah dibaca.';
COMMENT ON COLUMN pdt_file.baris_header IS
  'NULL bila modul tidak pernah terdeteksi untuk entri ini (ditolakPagar/gagalEkstrak/decodeGagal/perlu_pilih_modul yang AM tidak override) — pencarian header (Rule 7) butuh modul yang sudah diketahui lebih dulu.';
