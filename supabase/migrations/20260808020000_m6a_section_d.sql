-- CDPS — Module 6A A-08: Section D — Target & KPI (sisa D-5, D-6, D-7)
--
-- Section D sudah separuh mendarat sebelum tiket ini:
--   D-1/D-2/D-4  `strategi_target` (A-03), stretch >= floor di CHECK DB
--   D-3          TURUNAN dari D-2 (X-11) — nol kolom, dan itu disengaja
--   D-8/D-9      `strategi_assumption` (A-03) + validasi mapping di domain
--
-- Yang ditambahkan di sini adalah tiga field yang belum punya rumah sama
-- sekali — D-5, D-6, D-7 — plus pembukaan jalur flip asumsi ke `Gugur` yang
-- selama ini terblokir katalog notifikasi (O55, sekarang selesai).
--
-- Yang TIDAK ditambahkan, dan alasannya:
--   * Nol kolom untuk D-3. Keputusan X-11 (pemilik 2026-08-07) menaruh nilainya
--     justru pada tidak adanya kolom itu; menambah kolom nanti mudah, mencabut
--     kolom yang sudah diisi produksi tidak.
--   * Nol perubahan pada `strategi_target`. D-7 adalah SANGGAHAN, dan Rule 7 +
--     Rule 19 mengatakan sanggahan TIDAK menurunkan floor. Kalau ia menulis ke
--     `strategi_target`, teks aturannya tetap benar tapi penegaknya hilang.
-- ===========================================================================

-- ===========================================================================
-- 1. `strategi_definisi_berhasil` — D-5 (struct × 3: 30 / 60 / 90 hari)
-- ===========================================================================
-- Tabel anak, bukan tiga kolom `definisi_30/60/90` di `strategi`: horizonnya
-- adalah DATA (30/60/90), bukan nama kolom. Sebagai baris ia bisa di-CHECK
-- sebagai set tertutup dan di-UNIQUE-kan; sebagai kolom, "definisi di 45 hari"
-- hanya bisa ditolak oleh kode yang kebetulan ingat.
--
-- Cardinality 3 TIDAK dipaksakan di DB: form ini punya autosave 20 detik (§7),
-- jadi keadaan setengah-terisi wajib bisa disimpan — sama alasannya dengan
-- Section B (Rule 5 ditegakkan gerbang submit, bukan NOT NULL). Kelengkapan
-- ketiganya diperiksa `checkCompleteness`.
CREATE TABLE strategi_definisi_berhasil (
    strategi_id     varchar(32)     NOT NULL,

    -- D-5: 30 / 60 / 90 hari. Set tertutup — PRD menyebut tiga horizon, dan
    -- horizon keempat adalah field baru, bukan baris baru.
    horizon_hari    smallint        NOT NULL,

    -- Jawaban AM: apa yang membuat periode ini disebut berhasil.
    definisi        text            NOT NULL,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT pk_strdef PRIMARY KEY (strategi_id, horizon_hari),
    CONSTRAINT fk_strdef_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strdef_horizon CHECK (horizon_hari IN (30, 60, 90)),
    CONSTRAINT ck_strdef_isi CHECK (btrim(definisi) <> '')
);

CREATE TRIGGER trg_strategi_definisi_berhasil_updated_at
    BEFORE UPDATE ON strategi_definisi_berhasil
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_definisi_berhasil IS
  'A-08 — Section D-5: definisi berhasil di 30/60/90 hari. Ketiganya wajib '
  'sebelum submit (diperiksa checkCompleteness, bukan NOT NULL — autosave).';

-- ===========================================================================
-- 2. D-6 — leading indicator mingguan (maks 5)
-- ===========================================================================
-- Kolom jsonb array di `strategi`, bukan tabel anak: ini multi-enum berbatas
-- (≤5) tanpa atribut per baris — persis bentuk `aset_dari_klien`/`pantangan_klien`
-- (A-05), dan taksonominya dijaga `<@` dengan cara yang sama.
--
-- ⚠️ KOSAKATANYA. PRD menulis D-6 sebagai "Multi-enum (≤5)" TANPA mendaftar
-- nilainya. Yang dipakai di sini adalah kosakata metrik D-4 yang SUDAH ada di
-- DB (`ck_strtg_metric`) — nol nama baru dikarang, dan leading indicator jadi
-- terjamin merujuk sesuatu yang Strategi ini memang menargetkannya. Kalau AM
-- ternyata butuh indikator operasional di luar metrik target (mis. "jumlah
-- keluhan"), itu penambahan taksonomi, bukan pembongkaran bentuk.
-- Dibuka sebagai pertanyaan X-13 (backlog §4), tidak diputuskan diam-diam.
ALTER TABLE strategi
    ADD COLUMN leading_indicator jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_leading_array
        CHECK (jsonb_typeof(leading_indicator) = 'array'),
    ADD CONSTRAINT ck_strategi_leading_maks
        CHECK (jsonb_array_length(leading_indicator) <= 5),
    ADD CONSTRAINT ck_strategi_leading_taksonomi
        CHECK (leading_indicator <@ '["gmv", "pengunjung", "cr", "aov", "roas_min",
                                      "acos_maks", "sku_winner", "affiliate_aktif",
                                      "jam_live", "jumlah_video"]'::jsonb);

COMMENT ON COLUMN strategi.leading_indicator IS
  'M6A D-6 — leading indicator yang dipantau mingguan, maks 5. Kosakata = '
  'metrik D-4 (ck_strtg_metric). Min 1 diperiksa di checkCompleteness.';

-- ===========================================================================
-- 3. D-7 — Sanggahan Target (advisory, hard-internal, Rule 19)
-- ===========================================================================
-- Kolom di header, bukan tabel anak: PRD menandainya `O` dan tunggal — satu
-- sanggahan per versi Strategi. Kalau AM berubah pikiran, itu EDIT sanggahan
-- versi ini (audit log menyimpan before/after), bukan sanggahan kedua.
--
-- Rule 19: advisory. Ia memberi tahu SPV + Head of Sales dan disimpan untuk
-- post-mortem; floor kontrak (D-1) tidak tersentuh dan stretch tetap wajib
-- >= floor. Penegaknya adalah letak kolom ini: nol jalur dari sini ke
-- `strategi_target`.
--
-- §4.1: D-7 hard-internal — tidak pernah bisa di-toggle shareable oleh AM.
-- Daftar hard-internal itu sendiri milik tiket A-10 (konstanta packages/core +
-- CHECK DB yang tidak boleh menyimpang); tiket ini tidak mendahuluinya.
ALTER TABLE strategi
    ADD COLUMN sanggahan_alasan           text,
    ADD COLUMN sanggahan_angka_pembanding numeric(18,2),
    ADD COLUMN sanggahan_target_realistis numeric(18,2),
    ADD COLUMN sanggahan_diajukan_oleh    varchar(64),
    ADD COLUMN sanggahan_diajukan_pada    timestamptz;

-- Semua-atau-tidak-sama-sekali. Sanggahan tanpa angka pembanding adalah
-- keluhan; PRD meminta ketiganya ("alasan, angka pembanding, target yang
-- menurut AM realistis") justru supaya ia bisa dibaca sebagai bukti di
-- post-mortem. Jejak aktor+waktu ikut wajib: tanpa itu, "siapa yang
-- menyanggah, kapan" hanya ada di audit log dan hilang dari barisnya sendiri.
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_sanggahan CHECK (
        (sanggahan_alasan IS NULL
            AND sanggahan_angka_pembanding IS NULL
            AND sanggahan_target_realistis IS NULL
            AND sanggahan_diajukan_oleh IS NULL
            AND sanggahan_diajukan_pada IS NULL)
        OR
        (btrim(sanggahan_alasan) <> ''
            AND sanggahan_angka_pembanding IS NOT NULL
            AND sanggahan_target_realistis IS NOT NULL
            AND sanggahan_diajukan_oleh IS NOT NULL
            AND sanggahan_diajukan_pada IS NOT NULL)
    ),
    ADD CONSTRAINT ck_strategi_sanggahan_nonneg CHECK (
        (sanggahan_angka_pembanding IS NULL OR sanggahan_angka_pembanding >= 0)
        AND (sanggahan_target_realistis IS NULL OR sanggahan_target_realistis >= 0)
    );

COMMENT ON COLUMN strategi.sanggahan_alasan IS
  'M6A D-7 / Rule 19 — Sanggahan Target: advisory, HARD-INTERNAL (§4.1). '
  'Tidak menurunkan floor kontrak; stretch tetap wajib >= floor.';

-- ===========================================================================
-- 4. Katalog notifikasi: +1 event sebagai VERSI 4 (33 → 34)
-- ===========================================================================
-- D-7 menuntut notifikasi ("O (notif SPV + Head of Sales)"), dan Rule 19
-- mengulanginya sebagai perilaku, bukan sebagai catatan. Katalog §7 hanya
-- mendaftar EMPAT event Strategi — keempatnya siklus hidup (diajukan,
-- disetujui, dikembalikan, revisi_disarankan) — jadi sanggahan tidak punya
-- event untuk ditumpangi.
--
-- Menumpangkannya ke `strategi_diajukan` akan lebih buruk daripada tidak
-- mengirim apa pun: penerimanya berbeda (Head of Sales tidak menerima
-- pengajuan Strategi) dan artinya berbeda ("ini menunggu persetujuan Anda"
-- vs "AM menilai floor kontraknya tidak realistis").
--
-- VERSI 4, bukan tambahan ke v2, dengan alasan yang sama seperti v3 Finance
-- (20260807130000): v2 adalah amandemen M6A/6B/6C sebagaimana ia mendarat, dan
-- menyisipkan baris ke dalamnya membuat registry berbohong tentang apa yang
-- amandemen itu perkenalkan. Invariant O55 (COUNT = SUM(event_count)) tetap
-- terpenuhi karena versinya didaftarkan bersama event-nya.
-- Harus tetap sinkron dengan packages/core/src/notification.ts (CATALOG).
--
-- Resolver `explicitOrLeads`: SPV di-resolve lewat division (Account), Head of
-- Sales dikirim eksplisit dari domain. Sales bukan divisi entitas ini, jadi ia
-- tidak bisa datang dari `p_division`.
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (4, 'M6A A-08 — Sanggahan Target (D-7 / Rule 19): 1 event advisory', 1,
        'docs/DECISIONS.md 2026-08-08 (A-08 Section D)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('strategi_sanggahan_target',
     'AM menyanggah target kontrak (D-7, advisory) — ke SPV Account + Head of Sales',
     'explicitOrLeads', 4);

-- ===========================================================================
-- 5. Asumsi D-8 — jalur flip ke `Gugur` tidak lagi terblokir
-- ===========================================================================
-- Komentar lama menyebut event `strategi_revisi_disarankan` "terblokir O55".
-- O55 selesai 2026-08-07 (katalog v2), dan A-08 menyambung pemanggilnya:
-- `setAssumptionStatus` menulis audit lalu emit ke AM + SPV.
--
-- Yang penting dibaca apa adanya: flip ini SENGAJA tidak dibatasi ke Draft.
-- Asumsi gugur justru paling berarti saat Strategi sudah `Aktif` — itulah
-- momen "revisi disarankan" punya makna. Membatasinya ke Draft akan membuat
-- event-nya tidak pernah menyala di keadaan yang PRD tulis untuknya.
COMMENT ON COLUMN strategi_assumption.status IS
  'M6A §7 — Berlaku/Gugur/Terverifikasi. Flip ke Gugur memicu '
  'strategi_revisi_disarankan (A-08: tersambung, katalog v2 O55).';

-- ===========================================================================
-- 6. RLS — tabel anak baru mengikuti pola jwt_can_read_strategi
-- ===========================================================================
-- Sama seperti 11 tabel anak Strategi lain: visibilitasnya MENGALIR dari
-- induknya, jadi ia tidak punya arm lead/divisi sendiri dan akan muncul di
-- ledger O48 (`rls_checks.sql` §42). Itu menambah SATU baris ke daftar yang
-- "hanya boleh menyusut" — penambahan yang dicatat sebagai keputusan
-- (DECISIONS 2026-08-08), bukan yang mendarat karena tesnya diperbarui.
-- Alternatifnya — memberi tabel ini arm sendiri — akan membuat definisi
-- berhasil terbaca oleh divisi yang tidak bisa membaca Strategi induknya.
REVOKE ALL ON public.strategi_definisi_berhasil FROM anon;
REVOKE ALL ON public.strategi_definisi_berhasil FROM authenticated;
GRANT SELECT ON public.strategi_definisi_berhasil TO authenticated;
ALTER TABLE public.strategi_definisi_berhasil ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_definisi_berhasil_select ON public.strategi_definisi_berhasil
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));
