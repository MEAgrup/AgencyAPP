-- CDPS M16 — LT-5 DIPUTUSKAN (pemilik, 2026-08-29): "Live Stream buat Cek
-- Brief AM / Terima Brief AM (nama baru yg lebih relevan)". Live Stream
-- BUKAN LAGI pengecualian sengaja (dulu: "Live dikerjakan vendor, gerbang
-- terima/tolak kurang bermakna untuk sesi yang sudah dijadwalkan lewat
-- booking terpisah") — Live sekarang mendapat gerbang intake yang sama
-- seperti keempat pipeline lain, hanya dengan LABEL yang lebih pas untuk
-- konteksnya: **"Terima Brief AM"**, bukan "Cek Brief AM" verbatim.
--
-- Nol tabel baru — hanya `sm_machines` (1 update), `sm_edges` (3 baris),
-- `stage_definition` (1 insert + 1 shift + 1 insert). Gate TETAP: tabel 128,
-- entity_prefix 36, sm_machines 29 (state baru, bukan mesin baru), notif_events 65.
--
-- ---------------------------------------------------------------------------
-- 1. KENAPA `stage_code` TETAP LITERAL 'Cek Brief AM' — hanya `label` berubah
-- ---------------------------------------------------------------------------
-- `reviewBrief` (stage.ts) menggerakkan mesin tahapan HANYA kalau
-- `production_stage` brief PERSIS SAMA DENGAN konstanta `STAGE_CEK_BRIEF_AM =
-- 'Cek Brief AM'` (literal, hardcoded — bukan dibaca dari `stage_definition`).
-- Kalau state Live diberi `stage_code` LAIN (mis. 'Terima Brief AM'),
-- `reviewBrief` tidak akan pernah mengenalinya, dan Live kembali ke perilaku
-- lama: `brief_review` tercatat tapi mesin tidak pernah bergerak — persis
-- masalah yang LT-5 diminta untuk menutup.
--
-- Solusinya justru sudah disediakan LT-7 (dijawab bersamaan, "aman dibiarkan
-- kosmetik"): `stage_definition.label` boleh berbeda dari `stage_code`. Jadi
-- `stage_code = 'Cek Brief AM'` (mempertahankan kontrak `reviewBrief`, NOL
-- kode TS berubah) sementara `label = 'Terima Brief AM'` (nama yang pemilik
-- minta, tampil di FE). Checkpoint pertama Live jadi SATU-SATUNYA baris
-- `stage_definition` di seluruh sistem yang labelnya berbeda dari kodenya —
-- persis kasus yang LT-7 bilang "aman, tunggu sampai ada yang benar-benar
-- butuh" — sekarang ada yang benar-benar butuh.
--
-- ---------------------------------------------------------------------------
-- 2. KENAPA EDGE 'Brief Dikembalikan ke AM' WAJIB IKUT — bukan opsional
-- ---------------------------------------------------------------------------
-- `reviewBrief` dengan `keputusan='Dikembalikan'` SELALU mencoba transisi ke
-- `STAGE_RETURNED` ('Brief Dikembalikan ke AM') begitu `production_stage`
-- brief adalah 'Cek Brief AM' — tanpa memandang divisi. Tanpa edge
-- `'Cek Brief AM' -> 'Brief Dikembalikan ke AM'` di `stage_live`, jalur
-- PENOLAKAN brief Live akan gagal dengan ConflictError (edge tidak ada) —
-- bukan opsi desain, tapi syarat supaya jalur Dikembalikan-nya sendiri
-- berfungsi. `nextStageAfterIntake` (jalur Diterima) juga butuh TEPAT SATU
-- edge keluar selain STAGE_RETURNED — itulah edge ke 'Terima Sampel'.
--
-- ---------------------------------------------------------------------------
-- 3. KENAPA EDGE BALIK LT-4 IKUT DIPASANG UNTUK LIVE JUGA
-- ---------------------------------------------------------------------------
-- LT-4 (migrasi sebelumnya, 20260901030000) sengaja TIDAK menyentuh
-- `stage_live` karena saat itu Live belum punya state 'Cek Brief AM' sama
-- sekali. LT-5 baru saja menghapus alasan itu — membiarkan Live TANPA jalur
-- kirim-ulang sekarang akan menciptakan PERSIS asimetri yang baru saja
-- ditutup untuk 4 pipeline lain (dan pasti jadi pertanyaan susulan). Jadi
-- edge balik `'Brief Dikembalikan ke AM' -> 'Cek Brief AM'` (gerbang
-- `gate_pihak='AM'`, alasan identik LT-4) dipasang di migrasi yang sama.
--
-- ---------------------------------------------------------------------------
-- 4. Data lama TIDAK disentuh
-- ---------------------------------------------------------------------------
-- Brief Live Stream yang sudah ada punya `production_stage='Terima Sampel'`
-- (initial_state lama) — baris itu TIDAK diubah. Mereka melanjutkan
-- perilaku lama (brief_review tercatat, mesin tidak bergerak — sudah lewat
-- gerbang itu secara implisit) persis seperti Brief yang sudah lolos
-- `Cek Brief AM` di pipeline lain sebelum LT-4/LT-5 ada. Hanya Brief BARU
-- yang lahir setelah migrasi ini yang mulai di 'Cek Brief AM'
-- (`sm_machines.initial_state`, dibaca `createBrief`/`account.ts` saat itu).
--
-- `urutan` existing (Terima Sampel/Briefing Klien Live/Live Start) DIGESER
-- +1 (turun dari langkah tertinggi dulu supaya tidak menabrak
-- `uq_stage_definition_urutan`), checkpoint baru masuk di urutan 1 — sama
-- persis pola pipeline lain (`Cek Brief AM` selalu langkah pertama).

-- ===========================================================================
-- 1. sm_machines — initial_state Live pindah ke 'Cek Brief AM'.
-- ===========================================================================
UPDATE sm_machines SET initial_state = 'Cek Brief AM' WHERE name = 'stage_live';

-- ===========================================================================
-- 2. sm_edges — intake (masuk + balik LT-22) + kirim-ulang (LT-4 simetri).
-- ===========================================================================
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('stage_live', 'Cek Brief AM', 'Terima Sampel',            false),
    ('stage_live', 'Cek Brief AM', 'Brief Dikembalikan ke AM', false),
    ('stage_live', 'Brief Dikembalikan ke AM', 'Cek Brief AM', false);

-- ===========================================================================
-- 3. stage_definition — geser urutan existing (+1, dari tertinggi dulu),
--    lalu sisipkan 'Cek Brief AM' (label 'Terima Brief AM') di urutan 1 dan
--    'Brief Dikembalikan ke AM' di urutan 99 (pola identik LT-4).
-- ===========================================================================
UPDATE stage_definition SET urutan = 4 WHERE pipeline_code = 'LIVE_DEFAULT' AND stage_code = 'Live Start';
UPDATE stage_definition SET urutan = 3 WHERE pipeline_code = 'LIVE_DEFAULT' AND stage_code = 'Briefing Klien Live';
UPDATE stage_definition SET urutan = 2 WHERE pipeline_code = 'LIVE_DEFAULT' AND stage_code = 'Terima Sampel';

INSERT INTO stage_definition
    (pipeline_code, stage_code, label, urutan, sumber, status_dipetakan, gate_pihak, target_hari_kerja) VALUES
    ('LIVE_DEFAULT', 'Cek Brief AM',               'Terima Brief AM',          1,  'stage', NULL, NULL, NULL),
    ('LIVE_DEFAULT', 'Brief Dikembalikan ke AM',    'Brief Dikembalikan ke AM', 99, 'stage', NULL, 'AM', NULL);
