-- CDPS — LT-13 (DECISIONS.md 2026-08-31 M16 Akun B, arah (a) dipilih pemilik
-- 2026-08-29): revisi Strategi yang dipicu OTOMATIS oleh AI Optimizer
-- (`syncAiOptimizerSkuRevision`, M17 §4/LT-54) mendapat jalur BARU yang tidak
-- mewajibkan Rule 13(c) (asumsi D-8 yang gugur).
--
-- ## Kenapa
-- `guard_strver_asumsi_gugur()` (migrasi 20260826010000) menolak
-- `peristiwa='revisi_dibuka'` tanpa `asumsi_gugur` kalau Strategi-nya PERNAH
-- punya baris `strategi_assumption` — benar untuk revisi MANUSIA (Rule 13(c)
-- memang mewajibkan itu), tapi salah sasaran untuk sinkronisasi OTOMATIS: AI
-- Optimizer tidak pernah bisa mengarang alasan gugurnya asumsi bisnis manusia,
-- jadi hampir semua klien aktif (yang sudah pernah mengisi Section D asumsi)
-- gagal disinkron — persis gap yang dicatat LT-13. Pemilik memilih arah (a):
-- jalur baru tanpa `asumsiGugur`, BUKAN desain ulang manusia-buka-revisi (b).
--
-- ## Yang diubah
-- Peristiwa BARU `revisi_dibuka_otomatis` — bukan menambah pengecualian ke
-- `revisi_dibuka` — supaya provenance tetap jujur (aturan rumah #3): siapa pun
-- membaca `strategi_version` langsung tahu mana revisi yang dibuka manusia
-- (Rule 13 penuh a+b+c) dan mana yang dibuka mesin (Rule 13 a+b saja).
-- `guard_strver_asumsi_gugur()` HANYA memeriksa `peristiwa='revisi_dibuka'`
-- (migrasi 20260826010000) — nilai baru ini otomatis TIDAK PERNAH melewati
-- trigger itu, nol perubahan pada fungsinya (migrasi lama tidak disentuh).
-- `ck_strver_revisi_lengkap` diperluas mencakup nilai baru dengan syarat yang
-- SAMA (trigger + alasan wajib) — Rule 13(a)(b) tetap berlaku penuh untuk
-- revisi otomatis, hanya (c) yang dibebaskan.

ALTER TABLE strategi_version DROP CONSTRAINT IF EXISTS ck_strver_peristiwa;
ALTER TABLE strategi_version ADD CONSTRAINT ck_strver_peristiwa CHECK (peristiwa IN (
    'dibuat', 'diajukan', 'disetujui', 'dikembalikan', 'revisi_dibuka',
    'revisi_dibuka_otomatis', 'kedaluwarsa', 'diarsipkan'));

ALTER TABLE strategi_version DROP CONSTRAINT IF EXISTS ck_strver_revisi_lengkap;
ALTER TABLE strategi_version ADD CONSTRAINT ck_strver_revisi_lengkap CHECK (
    peristiwa NOT IN ('revisi_dibuka', 'revisi_dibuka_otomatis')
 OR (jsonb_array_length(trigger_revisi) > 0
     AND alasan_revisi IS NOT NULL AND btrim(alasan_revisi) <> ''));

COMMENT ON CONSTRAINT ck_strver_revisi_lengkap ON strategi_version IS
  'Rule 13(a)(b): trigger + alasan wajib untuk revisi_dibuka DAN '
  'revisi_dibuka_otomatis. Syarat (c) — asumsi D-8 gugur — hanya diperiksa '
  'trg_strver_asumsi_gugur untuk peristiwa=''revisi_dibuka'' (migrasi '
  '20260826010000); revisi_dibuka_otomatis (LT-13, sinkron AI Optimizer) '
  'sengaja tidak pernah melewati trigger itu, bukan celah — mesin tidak bisa '
  'mengarang alasan gugurnya asumsi manusia.';
