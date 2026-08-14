-- CDPS — P-1 (optimasi kecepatan loading) — indeks untuk kolom filter panas.
--
-- KENAPA ADA. Handoff P-1 mendiagnosis akar lambatnya CDPS sebagai
-- LATENCY-BOUND: lapisan domain menembak ratusan round-trip N+1 per halaman.
-- Perbaikan utamanya ada di TS (baca ter-batch, lihat `packages/domain/src/
-- transitions.ts`). Migrasi ini menutup sisa yang lain: setelah query per-baris
-- diganti query set-based, beberapa kolom filter panas TIDAK punya indeks sama
-- sekali, jadi tiap pembacaan itu jatuh ke Seq Scan atas seluruh tabel.
--
-- Diverifikasi dengan EXPLAIN ANALYZE pada dataset uji (bukan tebakan); tiap
-- indeks di bawah menyebut query yang membutuhkannya. Indeks yang SUDAH ada
-- sengaja tidak diduplikasi: `audit_log (entity_type, entity_id)`,
-- `assets (assigned_pic)`, `clients (assigned_am_id)`,
-- `weekly_result_recap (client_id, …)`, dan
-- `client_health_snapshots (client_id, period_start)` sudah terpasang sejak
-- migrasi asalnya.
--
-- NOL perubahan perilaku: indeks tidak mengubah hasil query, hanya jalannya.
-- Semua pakai IF NOT EXISTS supaya aman diterapkan ke DB yang sudah menambalnya
-- manual. CREATE INDEX biasa (bukan CONCURRENTLY) karena migrasi berjalan dalam
-- satu transaksi dan tabel-tabel ini kecil.

-- 1. M14 `amResolutionHours` — komplain yang ditugaskan ke satu AM.
--    `select id, created_at from complaints where assigned_to = $1`
--    Sebelumnya: Seq Scan (complaints hanya berindeks client_id/status/related_ref).
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_to ON complaints (assigned_to);

-- 2. M14 `adsCandidates` — brief setup milik satu Ads specialist.
--    `select … from briefs where assigned_pic = $1 and assigned_division = $2`
--    Indeks lama (assigned_division, status) tidak menolong: kolom pemimpinnya
--    salah. Urutan (assigned_pic, assigned_division) melayani juga pencarian
--    "brief milik PIC ini" tanpa divisi (mis. gerbang visibilitas board).
CREATE INDEX IF NOT EXISTS idx_briefs_pic_division ON briefs (assigned_pic, assigned_division);

-- 3. M14 `campaignsPeriodSpendGMV` + M13 ROAS periode — Σ spend/gmv satu bulan.
--    `select … from metric_entries where campaign_id = any($1) and period_start between $2 and $3`
--    idx_mtr_campaign (campaign_id) memaksa filter periode dikerjakan per baris;
--    indeks komposit menjadikannya satu range scan.
CREATE INDEX IF NOT EXISTS idx_mtr_campaign_period ON metric_entries (campaign_id, period_start);

-- 4. M14 `adsCandidates` — Optimization Activity = optimisasi milik staf ini
--    pada periode. `select count(*) from optimization_logs
--     where actor = $1 and created_at >= $2 and created_at < $3`
--    optimization_logs sebelumnya hanya berindeks campaign_id.
CREATE INDEX IF NOT EXISTS idx_opt_actor_created ON optimization_logs (actor, created_at);
