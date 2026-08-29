-- CDPS M16 — LT-1 DIPUTUSKAN (pemilik/COO Nerissa, 2026-08-29: "jalankan
-- rekomendasi"). Komponen skor AM `kecepatan_review_am` naik dari bobot 0 ke
-- bobot NYATA, di-carve PROPORSIONAL dari profil AM yang ada.
--
-- Nol tabel/mesin/prefix/event baru — hanya baris config `perf_kpi_weights`
-- + satu baris `perf_period_targets`. Gate TETAP: tabel 128, entity_prefix 36,
-- sm_machines 29, notif_events 65.
--
-- ---------------------------------------------------------------------------
-- 1. ANGKANYA: 10%, bukan 15%
-- ---------------------------------------------------------------------------
-- Rekomendasi yang disetujui berbunyi "Mulai dari 10–15%, mengikuti pola carve
-- RM-9a sebelumnya (Weekly-Recap Discipline dapat 10% dari redistribusi
-- proporsional) ... bisa dinaikkan lagi setelah dilihat sebulan". Dipilih
-- LANTAI rentang itu (10%) karena dua alasan yang keduanya disebut rekomendasi
-- itu sendiri: (a) ia PERSIS preseden RM-9a yang dikutipnya — komponen AM baru
-- terakhir juga masuk di 10%; (b) "mulai dari" + "bisa dinaikkan" hanya masuk
-- akal kalau titik awalnya ujung bawah. Menaikkannya ke 15% nanti = SATU
-- migrasi seperti berkas ini, nol kode, nol deploy.
--
-- Profil AM: 45 / 22,5 / 22,5 / 10  ->  (×0,90) 40,5 / 20,25 / 20,25 / 9
--            + kecepatan_review_am 10.  Σ = 100 (ditegakkan server, setWeights).
--
-- Carve PROPORSIONAL (bukan mengambil dari satu komponen) dipilih dengan alasan
-- identik D-14/RM-9a, dan ia membawa invariant yang sama: kalau komponen baru
-- DIKECUALIKAN pada suatu periode (Rule 6 — AM tanpa Task portofolio
-- [Approved], atau target belum terkonfigurasi), redistribusi mengembalikan
-- PERSIS proporsi 45/22,5/22,5/10 lama. Jadi periode tanpa data kecepatan
-- review skornya identik dengan sebelum migrasi ini — regresinya diuji di
-- performance.test.ts ("LT-1: proportional carve").
--
-- ---------------------------------------------------------------------------
-- 2. KENAPA BOBOT SAJA TIDAK CUKUP — target `perf_period_targets`
-- ---------------------------------------------------------------------------
-- `amReviewSpeedCandidate` (performance.ts) MENGECUALIKAN komponen ini selama
-- (role_type='AM', component='kecepatan_review_am') tidak punya baris target:
-- "target kecepatan review AM belum dikonfigurasi (O9) — dikecualikan + bobot
-- didistribusi ulang". Tanpa baris target, menaikkan bobot ke 10 tidak
-- menggerakkan skor SIAPA PUN — LT-1 jadi no-op diam-diam. Karena itu berkas
-- ini menyeed targetnya juga.
--
-- 24 JAM adalah PLACEHOLDER (`is_placeholder = true`, persis pola baris
-- 'AM'/'complaint_resolution_speed' 48 jam di seed asal 20260722060429):
-- pemilik tidak pernah menyebut angka target kecepatan review, dan O9 (target
-- periode belum dikonfirmasi) memang masih terbuka. 24 jam dipilih sebagai
-- placeholder yang paling bisa dipertanggungjawabkan dari dokumen yang ADA:
-- PRD §6.1 memakai contoh AM yang baru membuka setelah 48 jam sebagai KASUS
-- BURUK yang memicu seluruh modul ini, dan seluruh checkpoint `Cek Brief AM`
-- di semua pipeline bertarget 1 hari kerja. `is_placeholder = true` membuat
-- snapshot menandai dirinya memakai target placeholder (PlaceholderTracker),
-- jadi angka ini JUJUR terlihat belum dikonfirmasi, bukan menyamar jadi
-- keputusan. Mengubahnya = satu UPDATE data.
--
-- Transform-nya OA-1 (`transformSpeed`): rata-rata `waktuAmBelumBuka` <= target
-- => 100; makin lambat makin turun, floor 0 pada 2× target. Dengan target 24
-- jam: AM yang selalu membuka di hari yang sama dapat 100; rata-rata 2 hari
-- (contoh PRD) dapat 200 - 200 = 0.
--
-- ---------------------------------------------------------------------------
-- 3. YANG SENGAJA TIDAK DISENTUH
-- ---------------------------------------------------------------------------
-- * LT-9 (perluasan portofolio skor AM ke Brief AI Optimizer/Store Operation)
--   TIDAK ikut diputuskan — pemilik hanya menjawab LT-1. Portofolio
--   `amPortfolioApprovedInPeriod` tetap seperti sekarang, jadi
--   `amRevisionEscalation` (22,5% existing, kini 20,25%) tidak bergeser
--   cakupannya. Tetap terbuka di DECISIONS.md.
-- * `role_type` AI Optimizer & Store Operation TETAP Σ=0 (LT-1 bagian kedua
--   belum dijawab): `scoreProfile` menghasilkan profileOk=false => "—"
--   (aturan rumah #7), state yang benar untuk "bobotnya belum diputuskan".
--   Baris 20260830040000 dibiarkan apa adanya.

-- ===========================================================================
-- 1. Re-seed profil AM (DELETE+INSERT satu role_type = set kanonik, pola D-14).
-- ===========================================================================
DELETE FROM perf_kpi_weights WHERE role_type = 'AM';

INSERT INTO perf_kpi_weights (role_type, component, weight, updated_by) VALUES
    -- 45 / 22,5 / 22,5 / 10 di-carve proporsional ×0,90 ...
    ('AM', 'chr_average',                40.5,  'SYSTEM'),
    ('AM', 'complaint_resolution_speed', 20.25, 'SYSTEM'),
    ('AM', 'revision_escalation_rate',   20.25, 'SYSTEM'),
    ('AM', 'recap_discipline',            9,    'SYSTEM'),
    -- ... memberi 10% untuk Kecepatan Review AM (M16 §6.4 / LT-32).
    ('AM', 'kecepatan_review_am',        10,    'SYSTEM');

-- ===========================================================================
-- 2. Target normalisasi — PLACEHOLDER (O9 masih terbuka), lihat catatan §2.
--    staff_id '*' = default untuk semua AM, period_start '0001-01-01' = default
--    untuk semua periode (konvensi kolomnya sendiri: seed 20260722060429 +
--    T-1 20260814020000). Target per-AM/per-bulan tetap bisa ditimpa Director
--    lewat setTarget tanpa menyentuh baris ini (presedensi staff > periode).
-- ===========================================================================
INSERT INTO perf_period_targets (role_type, component, staff_id, period_start, target_value, is_placeholder, updated_by) VALUES
    ('AM', 'kecepatan_review_am', '*', '0001-01-01', 24, true, 'SYSTEM')
ON CONFLICT (role_type, component, staff_id, period_start) DO NOTHING;
