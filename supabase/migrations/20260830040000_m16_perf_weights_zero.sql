-- CDPS M16 — Akun A, Fase 2b (LT-32/LT-33). Registrasi bobot AWAL untuk
-- component key baru `kecepatan_review_am` (AM) dan dua `role_type` baru
-- (AI Optimizer, Store Operation) — SEMUANYA 0 (DECISIONS.md 2026-08-28:
-- "didaftarkan dengan bobot 0 dan TIDAK ada skor siapa pun yang bergeser").
--
-- Nol tabel/mesin/prefix/event baru di sini — hanya baris config
-- `perf_kpi_weights` (pola persis `20260814090000_d14_recap_discipline.sql`
-- untuk komponen, TAPI TIDAK sama perlakuannya — lihat di bawah). Gate TETAP:
-- tabel 127, entity_prefix 36, sm_machines 28, notif_events 65.
--
-- ---------------------------------------------------------------------------
-- KENAPA `kecepatan_review_am` DITAMBAHKAN, BUKAN DI-CARVE PROPORSIONAL
-- ---------------------------------------------------------------------------
-- D-14 (migrasi di atas) meng-carve PROPORSIONAL bobot Creative/Ads/KOL yang
-- SUDAH ADA supaya Σ tetap 100 saat menambah note_compliance — itu tepat
-- karena pemilik MENGONFIRMASI angka carve-nya (RM-9a). `kecepatan_review_am`
-- BERBEDA: pemilik secara eksplisit TIDAK menetapkan angka apa pun (DECISIONS
-- 2026-08-28 "menetapkan angkanya me-ranking ulang tim: itu keputusan COO,
-- bukan implementasi"). Menambahnya di 0 (bukan carve proporsional) berarti
-- Σ AM TETAP 100 (45+22.5+22.5+10+0=100) TANPA mengubah SATU PUN skor AM
-- existing — persis yang diminta. Meng-carve-nya sekarang berarti menebak
-- angka yang pemilik sendiri belum putuskan.
--
-- ---------------------------------------------------------------------------
-- KENAPA AI Optimizer / Store Operation SENGAJA Σ=0 (BUKAN Σ=100)
-- ---------------------------------------------------------------------------
-- Keduanya role_type BARU tanpa distribusi bobot historis untuk dipertahankan.
-- `scoreProfile` (performance.ts) menghasilkan `profileOk=false` ("—", house
-- convention 7) saat `availableBase=0` — itulah state yang benar untuk "belum
-- ada seorang pun yang tahu bobotnya harus berapa", BUKAN menebak proporsi
-- awal yang nanti harus di-carve ulang. Begitu Director memanggil
-- `setWeights` untuk salah satu role_type ini, TS itu SENDIRI menegakkan
-- Σ=100 (`MSG_WEIGHTS_NOT_HUNDRED`) — migrasi ini tidak perlu menegakkannya
-- karena baris ini murni SEED default developer, seperti seed asli
-- `20260722060429_team_performance.sql`, sebelum admin pernah menyentuhnya.
--
-- Komponen yang diseed untuk kedua role_type baru meniru definisi
-- `briefDivisionCandidates` (performance.ts): speed_score + output_quantity +
-- revision_count (identik pola Creative tanpa gmv_impact — AI
-- Optimizer/Store Operation belum punya kolom `attributed_gmv` yang
-- relevan) + note_compliance (akan terisi begitu WRR Fase 4/LT-55 berjalan,
-- sampai itu selalu dikecualikan + diredistribusi — Rule 6 bekerja seperti
-- dirancang, bukan bug).
INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
    ('AM', 'kecepatan_review_am', 0, 'SYSTEM'),
    ('AI Optimizer', 'speed_score',      0, 'SYSTEM'),
    ('AI Optimizer', 'output_quantity',  0, 'SYSTEM'),
    ('AI Optimizer', 'revision_count',   0, 'SYSTEM'),
    ('AI Optimizer', 'note_compliance',  0, 'SYSTEM'),
    ('Store Operation', 'speed_score',     0, 'SYSTEM'),
    ('Store Operation', 'output_quantity', 0, 'SYSTEM'),
    ('Store Operation', 'revision_count',  0, 'SYSTEM'),
    ('Store Operation', 'note_compliance', 0, 'SYSTEM');
