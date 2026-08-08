-- CDPS — Module 6A A-08: Section D (Target & KPI) — D-5, D-6, D-7
--
-- ===========================================================================
-- APA YANG SUDAH ADA, DAN KARENANYA TIDAK DIBUAT ULANG DI SINI
-- ===========================================================================
-- Section D bukan lahan kosong. A-03 (20260806064000) sudah mendaratkan dua
-- tabel anak yang memikul separuh besar seksi ini:
--
--   * `strategi_target`     — D-1 (floor), D-2 (stretch GMV per bulan per
--                             channel), D-4 (metrik pendukung). Rule 7
--                             (`stretch >= floor` untuk GMV) sudah hidup
--                             sebagai CHECK `ck_strtg_stretch_gmv` di sana.
--   * `strategi_assumption` — D-8 (asumsi) + D-9 (pemetaan asumsi → target).
--
-- Dan D-3 (komposisi kontribusi channel) **sengaja tidak punya kolom sama
-- sekali**: X-11 memutuskan ia field TURUNAN, dihitung dari D-2 metrik `gmv`
-- oleh `komposisiKontribusi()` (DECISIONS 2026-08-07). Nol kolom penyimpan
-- adalah isi keputusannya, bukan kelalaian — kalau QC produksi berubah pikiran,
-- bentuknya berubah tanpa satu baris data pun untuk dimigrasikan.
--
-- Yang tersisa, dan yang migrasi ini kerjakan: **D-5, D-6, D-7.**
--
-- ===========================================================================
-- KENAPA NOL TABEL BARU
-- ===========================================================================
-- A-07 membuat empat tabel anak dan menuliskan alasannya: C-5/C-6/C-7 adalah
-- daftar REPEATABLE — nol, tiga, atau dua belas baris. Ketiga field di sini
-- tidak berbagi sifat itu:
--
--   * **D-5** kardinalitasnya TETAP tiga (30/60/90 hari). Sebuah tabel anak
--     untuk tepat tiga baris berlabel tetap tidak membeli audit apa pun yang
--     `audit_log` belum berikan, dan menukar satu CHECK "ketiganya terisi"
--     dengan sebuah agregat COUNT.
--   * **D-6** adalah multi-enum bertaksonomi tetap dengan cap — bentuk yang
--     preseden repo ini sudah memutuskan: array jsonb + containment `<@`
--     (A-05 §(2) `aset_dari_klien`, A-06 §(4) `tipe_kampanye`). Menyimpangnya
--     ke tabel anak akan menciptakan cara KEDUA menyimpan checkbox tertutup.
--   * **D-7** paling banyak satu per Strategi, dan opsional.
--
-- Jadi gerbang jumlah tabel tetap **76** — dan itu memang harapannya di
-- `.github/workflows/ci.yml` + `scripts/db-rebuild.sh`, tidak berubah commit ini.
--
-- ===========================================================================
-- ⚠️ SATU DEVIASI DAN SATU PERTANYAAN TERBUKA — keduanya tercatat, bukan diam
-- ===========================================================================
-- (1) **Katalog notifikasi naik ke v4 untuk SATU event (D-7).** §4 tabel field
--     menandai D-7 `O (notif SPV + Head of Sales)`, tapi §7 D12 hanya
--     mendaftar EMPAT event Strategi dan tidak satu pun di antaranya adalah
--     sanggahan target. Itu PRD membantah PRD, dan aturan rumah melarang
--     memilih diam-diam. Yang dilakukan: notifikasi §4 dibangun (PRD menang),
--     lewat mekanisme yang O55 justru sediakan untuk ini — versi katalog baru
--     dengan baris registry-nya sendiri, jadi amandemennya terlihat di diff.
--     v4 TIDAK ditumpangkan ke v2: v2 adalah amandemen M6A/6B/6C §7, dan
--     menyelipkan event yang §7 tidak sebut ke dalamnya membuat registry
--     berbohong tentang apa yang v2 perkenalkan (alasan yang sama dipakai v3).
--     Nama event memakai konvensi bertitik `m6a.strategi.sanggahan_target`,
--     BUKAN gaya `strategi_*` keempat event PRD: aturan penamaan v2 menyatakan
--     gaya polos dipakai justru karena PRD menulisnya begitu. PRD tidak menulis
--     yang ini, jadi ia mengikuti konvensi rumah `mN.entitas.aksi` — persis
--     alasan `m6.client.assigned` (O53) berbentuk bertitik.
--
-- (2) **Daftar enum D-6 tidak pernah ditulis PRD** (§4 hanya bilang
--     "Multi-enum (maks 5)"). Yang dipakai di sini adalah kosakata metrik yang
--     PRD SUDAH tulis sendiri di D-4 — sepuluh nilai identik dengan
--     `ck_strtg_metric` — supaya nol vocabulary baru dikarang. Ini dibuka
--     sebagai **X-13** di `docs/backlog/M6ABC_BACKLOG.md`; melebarkannya kelak
--     adalah satu `ALTER … DROP/ADD CONSTRAINT`, jadi biaya salahnya kecil dan
--     terbatas.
-- ===========================================================================

-- ===========================================================================
-- 1. D-5 — Definisi berhasil di 30 / 60 / 90 hari
-- ===========================================================================
-- NULLable, seperti seluruh field Section A/B: §7 meminta autosave 20 detik dan
-- §5 langkah 5 meminta panel "kekurangan" yang hidup, dan keduanya menuntut
-- keadaan setengah-terisi bisa DISIMPAN. Kewajiban (`W`) ditegakkan di gerbang
-- submit `checkCompleteness`, bukan `NOT NULL` — pola yang A-05/A-06 tetapkan.
ALTER TABLE strategi
    ADD COLUMN IF NOT EXISTS definisi_berhasil_30 text NULL,
    ADD COLUMN IF NOT EXISTS definisi_berhasil_60 text NULL,
    ADD COLUMN IF NOT EXISTS definisi_berhasil_90 text NULL;

-- Yang DB perjaga: kalau terisi, ia bukan spasi. Sebuah definisi berhasil
-- berisi " " lolos pemeriksaan "tidak null" dan gagal setiap gunanya.
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_definisi_berhasil_isi;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_definisi_berhasil_isi CHECK (
        (definisi_berhasil_30 IS NULL OR btrim(definisi_berhasil_30) <> '')
    AND (definisi_berhasil_60 IS NULL OR btrim(definisi_berhasil_60) <> '')
    AND (definisi_berhasil_90 IS NULL OR btrim(definisi_berhasil_90) <> ''));

COMMENT ON COLUMN strategi.definisi_berhasil_30 IS
    'M6A §4 D-5 — definisi berhasil di 30 hari. Horizon TETAP 30/60/90, karena '
    'itu tiga kolom dan bukan tabel anak. Wajib di gerbang submit, bukan NOT NULL.';
COMMENT ON COLUMN strategi.definisi_berhasil_60 IS 'M6A §4 D-5 — definisi berhasil di 60 hari.';
COMMENT ON COLUMN strategi.definisi_berhasil_90 IS 'M6A §4 D-5 — definisi berhasil di 90 hari.';

-- ===========================================================================
-- 2. D-6 — Leading indicator yang dipantau mingguan (maks 5)
-- ===========================================================================
-- Tiga hal ditegakkan DB, bukan cuma TS: bentuk array, cap 5, dan keanggotaan
-- set tertutup. Yang ketiga adalah alasan `<@` dipakai alih-alih tabel lookup —
-- CHECK tidak boleh mengandung subquery, dan containment jsonb memberi set
-- tertutup yang sama tanpa satu pun JOIN di jalur tulis.
--
-- Setnya identik dengan `ck_strtg_metric` (D-4). Kalau salah satu dari keduanya
-- pernah dilebarkan, yang lain harus ikut di commit yang SAMA — dua daftar
-- yang bisa menyimpang adalah cacat yang O48/O51 sudah dua kali dibayar.
ALTER TABLE strategi
    ADD COLUMN IF NOT EXISTS leading_indicator jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_leading_indicator;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_leading_indicator CHECK (
        jsonb_typeof(leading_indicator) = 'array'
    AND jsonb_array_length(leading_indicator) <= 5
    AND leading_indicator <@ '["gmv","pengunjung","cr","aov","roas_min","acos_maks","sku_winner","affiliate_aktif","jam_live","jumlah_video"]'::jsonb);

COMMENT ON COLUMN strategi.leading_indicator IS
    'M6A §4 D-6 — leading indicator mingguan, maks 5. Set tertutup = kosakata '
    'metrik D-4 (ck_strtg_metric); PRD tidak pernah menuliskan daftarnya sendiri '
    '(pertanyaan terbuka X-13). Cap dan keanggotaan ditegakkan CHECK, bukan TS saja.';

-- ===========================================================================
-- 3. D-7 — Sanggahan Target (advisory, HARD-INTERNAL)
-- ===========================================================================
-- Rule 19: sanggahan memberi tahu SPV + Head of Sales dan tersimpan di record
-- untuk post-mortem, tapi floor kontrak (D-1) TIDAK tersentuh dan stretch tetap
-- wajib `>= floor`. Penegak "tidak menurunkan floor" bukan kolom di sini —
-- ia `ck_strtg_stretch_gmv` di `strategi_target`, yang sudah ada. Kolom-kolom
-- di bawah adalah bukti argumennya, bukan jalan keluarnya.
--
-- §4.1 menaruh D-7 di tier **hard-internal** (never shareable). Tier itu belum
-- punya penegak (A-10 = `STRG_FIELD_VISIBILITY` + konstanta `packages/core`,
-- belum dibangun), jadi yang bisa dilakukan commit ini adalah TIDAK memasukkan
-- field-field ini ke jalur shareable mana pun dan menandainya di sini supaya
-- A-10 tidak perlu menebak. Tautan klien `/s/{token}` (A-11) belum ada, jadi
-- belum ada permukaan yang bisa membocorkannya.
ALTER TABLE strategi
    ADD COLUMN IF NOT EXISTS sanggahan_alasan           text          NULL,
    ADD COLUMN IF NOT EXISTS sanggahan_angka_pembanding numeric(18,2) NULL,
    ADD COLUMN IF NOT EXISTS sanggahan_target_realistis numeric(18,2) NULL,
    ADD COLUMN IF NOT EXISTS sanggahan_diajukan_pada    timestamptz   NULL,
    ADD COLUMN IF NOT EXISTS sanggahan_diajukan_oleh    varchar(64)   NULL;

-- Satu sanggahan adalah SATU catatan, jadi ia ada seluruhnya atau tidak ada
-- sama sekali. Setengah sanggahan — alasan tanpa angka pembanding — persis
-- bentuk yang membuat post-mortem tidak bisa dijawab: "kata siapa tidak
-- realistis, dibanding apa?".
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_sanggahan_utuh;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_sanggahan_utuh CHECK (
        (sanggahan_alasan IS NULL
         AND sanggahan_angka_pembanding IS NULL
         AND sanggahan_target_realistis IS NULL
         AND sanggahan_diajukan_pada IS NULL
         AND sanggahan_diajukan_oleh IS NULL)
     OR (btrim(COALESCE(sanggahan_alasan, '')) <> ''
         AND sanggahan_angka_pembanding IS NOT NULL
         AND sanggahan_target_realistis IS NOT NULL
         AND sanggahan_diajukan_pada IS NOT NULL
         AND btrim(COALESCE(sanggahan_diajukan_oleh, '')) <> ''));

ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_sanggahan_nonneg;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_sanggahan_nonneg CHECK (
        (sanggahan_angka_pembanding IS NULL OR sanggahan_angka_pembanding >= 0)
    AND (sanggahan_target_realistis IS NULL OR sanggahan_target_realistis >= 0));

COMMENT ON COLUMN strategi.sanggahan_alasan IS
    'M6A §4 D-7 / Rule 19 — sanggahan target, ADVISORY dan HARD-INTERNAL (§4.1: '
    'never shareable). Tidak menurunkan floor: penegaknya ck_strtg_stretch_gmv.';
COMMENT ON COLUMN strategi.sanggahan_angka_pembanding IS
    'M6A §4 D-7 — angka pembanding yang mendasari sanggahan. HARD-INTERNAL.';
COMMENT ON COLUMN strategi.sanggahan_target_realistis IS
    'M6A §4 D-7 — target yang menurut AM realistis. HARD-INTERNAL. BUKAN floor '
    'baru dan tidak pernah dibaca sebagai floor.';

-- ===========================================================================
-- 4. Katalog notifikasi v4 — satu event untuk D-7
-- ===========================================================================
-- Lihat catatan (1) di kepala berkas untuk kenapa ini versi tersendiri dan
-- kenapa namanya bertitik. Resolver `explicitOrLeads`: `leadsOfDivision` hanya
-- bisa menyelesaikan SATU divisi, sementara penerima D-7 melintasi dua (SPV
-- Account lewat `division`, Head of Sales lewat `explicit` yang domain isi).
-- `ON CONFLICT` bukan kelonggaran: live sudah punya baris v4 (isi berbeda, lihat
-- kepala berkas), dan yang menormalkannya adalah migrasi rekonsiliasi O59.
-- Tanpa ini, berkas ini gagal di live pada PK `version`.
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (4, 'M6A §4 D-7 — sanggahan target memberi tahu SPV Account + Head of Sales: 1 event Strategi', 1,
        'docs/DECISIONS.md 2026-08-08 (A-08 — §4 vs §7 D12)')
ON CONFLICT (version) DO NOTHING;

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m6a.strategi.sanggahan_target',
     'AM mengajukan Sanggahan Target (D-7, advisory) — ke SPV Account + Head of Sales',
     'explicitOrLeads', 4)
ON CONFLICT (event_type) DO NOTHING;

-- ===========================================================================
-- 5. RLS — nol perubahan, dan itu disengaja
-- ===========================================================================
-- Semua yang ditambahkan di sini adalah KOLOM pada `strategi` dan baris pada
-- dua tabel katalog. `strategi_select` sudah memikul row-scope-nya, dan
-- `notif_events` / `notif_catalog_versions` di-REVOKE penuh dari
-- `authenticated` (hanya `notify_emit` yang SECURITY DEFINER membacanya).
--
-- Yang TIDAK bisa RLS lakukan, dan karenanya ditulis di sini alih-alih
-- diasumsikan: memisahkan tier hard-internal D-7 dari sisa baris `strategi`.
-- Itu scope KOLOM, dan pemiliknya A-10. Sampai A-10 mendarat, setiap aktor yang
-- lolos `strategi_select` (AM pemilik, lead Account, OD/Direksi) melihat
-- sanggahan itu — ketiganya memang internal, jadi tidak ada kebocoran ke luar,
-- tapi jangan salah baca ini sebagai "tier sudah ditegakkan".
