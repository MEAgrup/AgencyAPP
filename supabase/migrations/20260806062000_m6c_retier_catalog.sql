-- CDPS — Module 6C GA-2: penetapan tier untuk katalog yang sudah ada.
--
-- ---------------------------------------------------------------------------
-- KENAPA MIGRASI INI ADA (temuan QA 2026-08-06)
-- ---------------------------------------------------------------------------
-- Semua 36 baris `master_service_versions` di `CDPS SG` punya
-- `requires_strategy_plan = false`. Artinya NOL layanan di produksi plan-gated,
-- dan seluruh jalur Strategi & Plan tidak bisa dijangkau: halaman Service
-- melabeli setiap layanan "Direct (tanpa Plan)" lalu menawarkan form Brief.
-- Termasuk **"Store Management (Paket)"** — yang menurut M6A Rule 1 dan tabel
-- tier M6C §3 SELALU `Plan Wajib` ("Full Store Management is always
-- `butuh_plan = true`").
--
-- Jadi bug-nya bukan di kode: kode menghormati flag dengan benar. Datanya yang
-- belum pernah ditetapkan. M6C GA-2 sudah menduga ini: *"every catalog entry
-- needs re-tiering, which is a data task, not a code task."*
--
-- ---------------------------------------------------------------------------
-- DASAR PEMETAAN — dan batasnya
-- ---------------------------------------------------------------------------
-- Pemetaan di bawah diturunkan MEKANIS dari contoh yang ditulis M6C §3 sendiri:
--
--   Plan Wajib      : Full Store Management, retainer paket lengkap
--   Ditentukan AM   : ads management satuan, KOL package, live vendor booking,
--                     SKU optimization
--   Tanpa Plan      : one-off design, single listing revamp, one-time audit
--
-- ⚠️ **Ini USULAN, bukan keputusan pemilik.** Tier menentukan seberapa sering
-- form G-B muncul, dan §12 memakai "% `Plan Ditentukan AM` dari seluruh service"
-- (<40%) sebagai sinyal bahwa tier-nya salah set. Usulan ini menempatkan 12 dari
-- 33 entri (36%) di tier tengah — di bawah ambang itu, tapi tipis. Dicatat
-- sebagai pertanyaan terbuka di `docs/DECISIONS.md` (2026-08-06, O54).
--
-- Membalikkannya murah: tier bisa diubah lewat admin Master Service List, dan
-- setiap perubahan melahirkan versi katalog baru (immutable-version chain) —
-- jadi mengoreksi usulan ini TIDAK menyentuh engagement yang sedang jalan.
--
-- Backfill ini adalah satu-satunya kali baris versi yang sudah ada disentuh
-- langsung: ia MENGKLASIFIKASI versi lama ke kolom yang baru diperkenalkan,
-- seperti `ALTER TABLE … DEFAULT` sebelumnya. Perubahan tier SESUDAH ini wajib
-- lewat MSL admin (versi baru), bukan UPDATE.

-- --- Plan Wajib -------------------------------------------------------------
-- Paket store management penuh: MEA menjalankan toko klien end-to-end lintas
-- channel. M6A Rule 1 mengunci ini.
UPDATE master_service_versions
   SET plan_tier = 'plan_wajib', requires_strategy_plan = true
 WHERE name IN ('Store Management (Paket)');

-- --- Plan Ditentukan AM -----------------------------------------------------
-- Tier tengah: SKU service yang sama bisa jadi pekerjaan dua minggu untuk satu
-- klien dan komitmen berjalan untuk klien lain. Sistem merekomendasi, AM
-- memutuskan, penyimpangannya tercatat.
UPDATE master_service_versions
   SET plan_tier = 'ditentukan_am', requires_strategy_plan = false
 WHERE name IN (
    -- ads management satuan
    'Awareness & Consideration Ads Spending',
    'GMV Max',
    'Total Awareness',
    -- KOL package
    'Nano KOL (1K–10K followers)',
    'Micro KOL (10K–50K followers)',
    'Macro & Mega KOL (50K–500K followers)',
    'Live with TC / KOL / Celebrities (10% Rate Card)',
    'Video with TC / KOL / Celebrities (10% Rate Card)',
    -- live vendor booking
    'Live Streaming (education & selling)',
    -- SKU / rating optimization (berjalan, bukan sekali jadi)
    'Shopee Rating Optimization',
    'TikTok Rating Optimization',
    'Customer Review Management',
    -- volume besar: kuota-nya sendiri yang menyalakan pemicu lunak
    'Massive Video Production (sample required)'
 );

-- --- Tanpa Plan -------------------------------------------------------------
-- Sisanya tetap `tanpa_plan` (nilai default kolom + backfill migrasi
-- 20260806061000): pekerjaan deliverable sekali jadi — foto, desain, video,
-- add-on. Tidak di-UPDATE di sini karena sudah benar; disebut eksplisit supaya
-- pembaca tahu itu keputusan, bukan kelalaian.

-- ---------------------------------------------------------------------------
-- Re-pin Service yang BELUM jalan
-- ---------------------------------------------------------------------------
-- Service menangkap tier dari versi MSL saat closing (M6 §2), dan Service yang
-- sudah ada dibuat SEBELUM kolom tier ada — jadi pin-nya `tanpa_plan` bawaan
-- default, bukan hasil pembacaan katalog.
--
-- Hanya Service yang masih `[Awaiting Onboarding]` DAN belum punya Strategy yang
-- di-re-pin. Yang sudah lewat gerbangnya tidak disentuh: mengubah jalur eksekusi
-- di tengah jalan akan menulis ulang keputusan yang sudah diambil, dan justru
-- pin-lah yang ada untuk mencegah itu.
UPDATE services sv
   SET plan_tier = msv.plan_tier,
       requires_strategy_plan = msv.requires_strategy_plan
  FROM master_service_versions msv
 WHERE msv.service_id = sv.master_service_id
   AND msv.version_no = sv.master_version_no
   AND sv.status = '[Awaiting Onboarding]'
   AND sv.requires_strategy_plan_override IS NULL
   AND NOT EXISTS (SELECT 1 FROM strategy_plans sp WHERE sp.service_id = sv.id)
   AND sv.plan_tier <> msv.plan_tier;
