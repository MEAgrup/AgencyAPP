-- CDPS M16 — Akun A, Fase 2 (LT-21). Seed SELURUH 5 pipeline tahapan: Creative,
-- KOL, Live Stream, DAN AI Optimizer ×2 (Optimasi SKU + AI Video) — Akun A
-- menyeed AI Optimizer meski divisinya milik Akun B, karena stage_pipeline/
-- stage_definition adalah tabel Akun A (docs/handoff/PARALEL_M16_DUA_AKUN.md §2).
--
-- Sumber tunggal kebenaran urutan tahap: STATE_MACHINES.md §18 + PRD §4. Setiap
-- pipeline mendapat SATU mesin sm_machines; sm_edges HANYA merangkai checkpoint
-- ber-sumber='stage' (checkpoint 'status_brief' — QC Account Service / Revisi —
-- TIDAK punya edge, PRD §2 Rule 3 / STATE_MACHINES §18 "⟨…⟩").
--
-- ---------------------------------------------------------------------------
-- "Brief Dikembalikan ke AM" — TERMINAL TAK-TERDAFTAR (bukan tanpa-edge-keluar
-- yang terdaftar di sm_terminal_states). Ambiguitas PRD, dipilih SADAR, dicatat
-- di HANDOFF_M16_AKUN_A.md: PRD tidak menspesifikasikan alur "kirim ulang" brief
-- yang dikembalikan. Kalau state ini didaftarkan di sm_terminal_states, guard
-- submitTask (LT-26, yang mengecek "production_stage ∈ sm_terminal_states utk
-- machine ini") akan meloloskan Brief yang JUSTRU BELUM dikerjakan divisi
-- (dikembalikan, bukan selesai) ke [Submitted] — bug kelas Rule 11 PRD §2.
-- Karena itu ia punya edge MASUK (dari 'Cek Brief AM') tapi TIDAK terdaftar di
-- sm_terminal_states sama sekali — sm_terminal_states memang murni introspeksi
-- (komentar 20260723055732: "tidak dipakai enforcement"), jadi guard LT-26 yang
-- membaca tabel itu otomatis TIDAK menganggapnya tahap selesai. Dead-end yang
-- disengaja: kalau AM memperbaiki brief dan ingin divisi meninjau ulang, itu
-- alur SUSULAN yang belum dispesifikasikan PRD manapun (dicatat sebagai
-- pertanyaan terbuka, bukan dipilih diam-diam).
--
-- ---------------------------------------------------------------------------
-- Live Stream TIDAK punya state 'Cek Brief AM' — mengikuti STATE_MACHINES §18
-- tabel pipeline ("Terima Sampel → Briefing Klien Live → Live Start") APA
-- ADANYA, walau PRD §2 Rule 10 menyatakan gerbang itu "wajib di semua divisi".
-- Ambiguitas ini diselesaikan dengan memisahkan DUA hal yang PRD gabungkan:
-- brief_review (keputusan Cek Brief AM, universal — lihat migrasi sebelumnya)
-- TETAP terisi untuk Brief Live Stream, tapi mesin tahapannya sendiri tidak
-- punya STATE bernama itu (mengikuti tabel pipeline eksplisit apa adanya).
-- stage.reviewBrief (LT-22) mendeteksi ini: hanya menjalankan sm_transition
-- kalau production_stage brief SAAT INI persis 'Cek Brief AM'; untuk Live
-- Stream (initial_state = 'Terima Sampel') itu tidak pernah true, jadi
-- reviewBrief hanya menulis brief_review tanpa menggerakkan mesin. Dicatat di
-- HANDOFF_M16_AKUN_A.md sebagai pertanyaan terbuka untuk pemilik.
--
-- ---------------------------------------------------------------------------
-- Target hari kerja: PRD §4 HANYA memberi angka untuk Creative (semua 1hk) dan
-- KOL (1/3/1/2/1/14/14). AI Optimizer (§4.5) dan Live Stream (§4.4) TIDAK
-- pernah diberi angka "(Nhk)" oleh pemilik di requirement manapun — keduanya
-- diseed dengan target_hari_kerja NULL (⇒ N/A, PRD §2 Rule 8, "tidak pernah
-- di-default diam-diam"). Bukan bug: begitu pemilik menetapkan angkanya, itu
-- SATU UPDATE data, nol migrasi struktural (pola LT-2/LT-3).
--
-- 'Cek Brief AM' pada SETIAP pipeline juga NULL target — PRD §3 mengukur
-- rentang ini via briefs.created_at → brief_review.created_at (leadtime.ts),
-- bukan via target_hari_kerja stage_definition.
--
-- ---------------------------------------------------------------------------
-- GATE: sm_machines 23 → 28 (+5: stage_creative, stage_kol, stage_live,
-- stage_ai_opt_sku, stage_ai_opt_video). tabel public 123 → 127 (migrasi
-- sebelumnya menciptakan 4 tabel; migrasi ini HANYA mengisi baris, nol tabel
-- baru). entity_prefix TETAP 36, notif_events TETAP 65 (sudah dibereskan Tahap
-- F). scripts/db-rebuild.sh + .github/workflows/ci.yml dinaikkan di commit yang
-- sama — lihat catatan deviasi §4 di kepala migrasi 20260830010000.

-- ===========================================================================
-- 1. sm_machines (5 baru) + sm_terminal_states (HANYA tahap sukses akhir tiap
--    pipeline — 'Brief Dikembalikan ke AM' sengaja TIDAK didaftarkan, lihat
--    catatan kepala berkas).
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('stage_creative',     'Cek Brief AM',   false, '{}'),
    ('stage_kol',          'Cek Brief AM',   false, '{}'),
    ('stage_live',         'Terima Sampel',  false, '{}'),
    ('stage_ai_opt_sku',   'Cek Brief AM',   false, '{}'),
    ('stage_ai_opt_video', 'Cek Brief AM',   false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('stage_creative',     'Jadwal Posting'),
    ('stage_kol',          'QC & Approval Video Creator'),
    ('stage_live',         'Live Start'),
    ('stage_ai_opt_sku',   'Terapkan'),
    ('stage_ai_opt_video', 'Jadwal Posting');

-- ===========================================================================
-- 2. sm_edges — HANYA checkpoint ber-sumber='stage'. `require_lead=false` di
--    semua edge biasa (staff divisi/PIC yang menjalankan); gate_pihak='AM'
--    (Approve, AI Optimizer SKU) ditegakkan di TS (stage.ts advanceStage),
--    BUKAN require_lead — AM bukan "lead divisi eksekusi", jadi flag itu salah
--    semantik untuknya (lihat komentar stage_definition.gate_pihak).
-- ===========================================================================
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    -- Creative (§4.1)
    ('stage_creative', 'Cek Brief AM', 'Script',          false),
    ('stage_creative', 'Cek Brief AM', 'Brief Dikembalikan ke AM', false),
    ('stage_creative', 'Script',       'QC internal',     false),
    ('stage_creative', 'QC internal',  'Shooting',        false),
    ('stage_creative', 'Shooting',     'Edit',            false),
    ('stage_creative', 'Edit',         'Jadwal Posting',  false),
    -- KOL (§4.3, versi kedua — DECISIONS.md 2026-08-28)
    ('stage_kol', 'Cek Brief AM', 'Buat Campaign',                          false),
    ('stage_kol', 'Cek Brief AM', 'Brief Dikembalikan ke AM',               false),
    ('stage_kol', 'Buat Campaign', 'Approach Creator & Sebar Link Product', false),
    ('stage_kol', 'Approach Creator & Sebar Link Product', 'Buat & Update Daftar Creator', false),
    ('stage_kol', 'Buat & Update Daftar Creator', 'Nego & Dealing Creator', false),
    ('stage_kol', 'Nego & Dealing Creator', 'Approval Sampel',              false),
    ('stage_kol', 'Approval Sampel', 'Follow up Video Creator',             false),
    ('stage_kol', 'Follow up Video Creator', 'QC & Approval Video Creator', false),
    -- Live Stream (§4.4) — pelaporan progres vendor, TIDAK menyentuh LSS-.
    ('stage_live', 'Terima Sampel',       'Briefing Klien Live', false),
    ('stage_live', 'Briefing Klien Live', 'Live Start',          false),
    -- AI Optimizer — Optimasi SKU (§4.5)
    ('stage_ai_opt_sku', 'Cek Brief AM', 'Ambil SKU',                   false),
    ('stage_ai_opt_sku', 'Cek Brief AM', 'Brief Dikembalikan ke AM',    false),
    ('stage_ai_opt_sku', 'Ambil SKU',    'Riset',                       false),
    ('stage_ai_opt_sku', 'Riset',        'Perbaikan',                   false),
    ('stage_ai_opt_sku', 'Perbaikan',    'QC',                          false),
    ('stage_ai_opt_sku', 'QC',           'Approve',                     false),
    ('stage_ai_opt_sku', 'Approve',      'Terapkan',                    false),
    -- AI Optimizer — AI Video (§4.5)
    ('stage_ai_opt_video', 'Cek Brief AM', 'Script',                    false),
    ('stage_ai_opt_video', 'Cek Brief AM', 'Brief Dikembalikan ke AM',  false),
    ('stage_ai_opt_video', 'Script',       'Generate AI',               false),
    ('stage_ai_opt_video', 'Generate AI',  'Edit',                      false),
    ('stage_ai_opt_video', 'Edit',         'QC',                        false),
    ('stage_ai_opt_video', 'QC',           'Jadwal Posting',            false);

-- ===========================================================================
-- 3. stage_pipeline — satu baris per pipeline.
-- ===========================================================================
INSERT INTO stage_pipeline (code, division_code, deliverable_type, machine_name, aktif) VALUES
    ('CREATIVE_CONTENT', 'CREATIVE', NULL,             'stage_creative',     true),
    ('KOL_DEFAULT',       'KOL',      NULL,             'stage_kol',          true),
    ('LIVE_DEFAULT',      'LIVE',     NULL,             'stage_live',         true),
    ('AI_OPT_SKU',        'AI_OPT',   'Optimasi SKU',   'stage_ai_opt_sku',   true),
    ('AI_OPT_VIDEO',      'AI_OPT',   'AI Video',       'stage_ai_opt_video', true);
    -- STORE_OPS sengaja TANPA baris — Rule 12 PRD §2 (divisi aktif tanpa
    -- pipeline). Menyeed pipeline-nya nanti = SATU migrasi tambahan di sini,
    -- nol perubahan kode TS (DECISIONS.md LT-2).

-- ===========================================================================
-- 4. stage_definition — SETIAP checkpoint, termasuk 'status_brief'.
--    label diisi IDENTIK dengan stage_code (PRD tidak mendefinisikan kode
--    pendek terpisah — lihat komentar migrasi sebelumnya).
-- ===========================================================================
INSERT INTO stage_definition
    (pipeline_code, stage_code, label, urutan, sumber, status_dipetakan, gate_pihak, target_hari_kerja) VALUES
    -- --- Creative (§4.1): 8 checkpoint, 2 status_brief ---
    ('CREATIVE_CONTENT', 'Cek Brief AM',       'Cek Brief AM',       1, 'stage', NULL, NULL, NULL),
    ('CREATIVE_CONTENT', 'Script',             'Script',             2, 'stage', NULL, NULL, 1),
    ('CREATIVE_CONTENT', 'QC internal',        'QC internal',        3, 'stage', NULL, NULL, 1),
    ('CREATIVE_CONTENT', 'Shooting',           'Shooting',           4, 'stage', NULL, NULL, 1),
    ('CREATIVE_CONTENT', 'Edit',               'Edit',               5, 'stage', NULL, NULL, 1),
    ('CREATIVE_CONTENT', 'QC Account Service', 'QC Account Service', 6, 'status_brief', '[In Review]',           NULL, 1),
    ('CREATIVE_CONTENT', 'Revisi',             'Revisi',             7, 'status_brief', '[Revision Requested]',  NULL, 1),
    ('CREATIVE_CONTENT', 'Jadwal Posting',     'Jadwal Posting',     8, 'stage', NULL, NULL, 1),
    -- --- KOL (§4.3): 8 checkpoint, gate KLIEN di Approval Sampel, target 14hk
    --     MASING-MASING pada dua tahap terakhir (DECISIONS.md LT-3, harfiah) ---
    ('KOL_DEFAULT', 'Cek Brief AM',                          'Cek Brief AM',                          1, 'stage', NULL, NULL,     NULL),
    ('KOL_DEFAULT', 'Buat Campaign',                         'Buat Campaign',                         2, 'stage', NULL, NULL,     1),
    ('KOL_DEFAULT', 'Approach Creator & Sebar Link Product', 'Approach Creator & Sebar Link Product', 3, 'stage', NULL, NULL,     3),
    ('KOL_DEFAULT', 'Buat & Update Daftar Creator',          'Buat & Update Daftar Creator',          4, 'stage', NULL, NULL,     1),
    ('KOL_DEFAULT', 'Nego & Dealing Creator',                'Nego & Dealing Creator',                5, 'stage', NULL, NULL,     2),
    ('KOL_DEFAULT', 'Approval Sampel',                       'Approval Sampel',                       6, 'stage', NULL, 'KLIEN', 1),
    ('KOL_DEFAULT', 'Follow up Video Creator',                'Follow up Video Creator',              7, 'stage', NULL, NULL,     14),
    ('KOL_DEFAULT', 'QC & Approval Video Creator',            'QC & Approval Video Creator',           8, 'stage', NULL, NULL,     14),
    -- --- Live Stream (§4.4): 3 checkpoint, nol target (pemilik tidak memberi angka) ---
    ('LIVE_DEFAULT', 'Terima Sampel',       'Terima Sampel',       1, 'stage', NULL, NULL, NULL),
    ('LIVE_DEFAULT', 'Briefing Klien Live', 'Briefing Klien Live', 2, 'stage', NULL, NULL, NULL),
    ('LIVE_DEFAULT', 'Live Start',          'Live Start',          3, 'stage', NULL, NULL, NULL),
    -- --- AI Optimizer — Optimasi SKU (§4.5): 7 checkpoint, gate AM di Approve ---
    ('AI_OPT_SKU', 'Cek Brief AM', 'Cek Brief AM', 1, 'stage', NULL, NULL, NULL),
    ('AI_OPT_SKU', 'Ambil SKU',    'Ambil SKU',    2, 'stage', NULL, NULL, NULL),
    ('AI_OPT_SKU', 'Riset',        'Riset',        3, 'stage', NULL, NULL, NULL),
    ('AI_OPT_SKU', 'Perbaikan',    'Perbaikan',    4, 'stage', NULL, NULL, NULL),
    ('AI_OPT_SKU', 'QC',           'QC',           5, 'stage', NULL, NULL, NULL),
    ('AI_OPT_SKU', 'Approve',      'Approve',      6, 'stage', NULL, 'AM', NULL),
    ('AI_OPT_SKU', 'Terapkan',     'Terapkan',     7, 'stage', NULL, NULL, NULL),
    -- --- AI Optimizer — AI Video (§4.5): 6 checkpoint ---
    ('AI_OPT_VIDEO', 'Cek Brief AM', 'Cek Brief AM', 1, 'stage', NULL, NULL, NULL),
    ('AI_OPT_VIDEO', 'Script',       'Script',       2, 'stage', NULL, NULL, NULL),
    ('AI_OPT_VIDEO', 'Generate AI',  'Generate AI',  3, 'stage', NULL, NULL, NULL),
    ('AI_OPT_VIDEO', 'Edit',         'Edit',         4, 'stage', NULL, NULL, NULL),
    ('AI_OPT_VIDEO', 'QC',           'QC',           5, 'stage', NULL, NULL, NULL),
    ('AI_OPT_VIDEO', 'Jadwal Posting', 'Jadwal Posting', 6, 'stage', NULL, NULL, NULL);
