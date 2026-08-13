-- CDPS — Module 6D (Rekap Hasil Mingguan / Weekly Result Recap) — D-01: SKEMA.
--
-- Lapisan agregasi-dan-narasi mingguan milik AM/CRO, lintas divisi, untuk SEMUA
-- klien aktif (dengan ATAU tanpa Plan). Satu rekap per klien per minggu ISO,
-- dibuka otomatis Senin 00:00 WIB (mesin #18). PRD:
-- docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md · backlog: docs/backlog/M6D_BACKLOG.md.
--
-- ---------------------------------------------------------------------------
-- BATAS TIKET (D-01) — apa yang ADA di sini vs apa yang MENYUSUL
-- ---------------------------------------------------------------------------
-- INI (D-01): tabel induk `weekly_result_recap` (WRR-) + 4 anak (wrr_divisi,
--   wrr_metrik, wrr_catatan, wrr_catatan_divisi) + FK + index (incl. unik per
--   klien-minggu) + prefix `WRR` di entity_prefix + RLS enable + kebijakan
--   SELECT (lingkup baca). CHECK struktural yang mendefinisikan bentuk tabel.
--
-- MENYUSUL (jangan diduplikasi di sini):
--   * D-02 — mesin #18: `sm_machines`/`sm_edges`/`sm_terminal_states`. Kolom
--     `status` di sini hanya varchar berdefault 'Terjadwal'; transisinya HANYA
--     lewat `sm_transition` sesudah edge didaftar (pola `plan`, mesin #16).
--   * D-03 — agregasi auto + UPDATE-block baris `otomatis` (trigger DB + RLS
--     `WITH CHECK`, invariant beku bentuk sama `plan_actual` M6B).
--   * D-04 — jalur manual: CHECK `file_bukti`+`tanggal_ambil` NOT NULL saat
--     `sumber='manual'` (RM-C7) + field teks-only RM-C9 "Catatan Metrik
--     Tambahan". Kolom `sumber`/`file_bukti`/`tanggal_ambil` sudah dibuat di
--     sini (struktural); CHECK kondisionalnya milik D-04.
--   * D-05 — narasi wajib saat tutup + `Sengketa Angka` + immutability
--     append-only `wrr_catatan_divisi`. Kolom `sengketa`/tabel thread dibuat di
--     sini; penegakan alur + append-only guard milik D-05.
--   * D-06 job Senin · D-07 notif v7 · D-08 rollup Plan · D-09 domain/API/wire.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB
-- ---------------------------------------------------------------------------
--  * Kunci minggu ISO DISIMPAN EKSPLISIT (`iso_year`,`iso_week`) — tak pernah
--    diturunkan saat baca (PRD §9), jadi identitas rekap stabil lintas
--    aritmetika zona waktu/tanggal. Batas minggu WIB (Sen 00:00 → Min 23:59:59).
--  * Satu rekap per (klien, tahun-ISO, minggu-ISO): index UNIK. Buka-kembali
--    (Head, D-02) memakai ULANG baris yang sama lewat transisi status — tak
--    pernah membuat baris kedua — jadi keunikan berlaku di SEMUA state (PRD
--    menyebut "partial unique index"; karena tak ada state yang membolehkan
--    duplikat, ia terwujud sebagai unik penuh, bukan berpredikat).
--  * `plan_id` NULLABLE — klien `Tanpa Plan` (Direct/Satuan) tetap dapat rekap
--    (R2, tutup gap Direct-path). FK ON DELETE SET NULL: rekap tak ikut hilang
--    kalau periode Plan dihapus (rekap bukan milik Plan; ia hanya me-rollup).
--  * `pernah_ditutup_otomatis` — sinyal non-performa AM yang PERMANEN (RM-5/
--    RM-9): di-set true saat force-close (D-06), tak pernah dicabut walau Head
--    buka-kembali (D-02). Skor disiplin M14 (D-14) & blok H-2 membaca flag ini,
--    bukan status akhir. Guard "tak pernah dicabut" menyusul di D-02 bersama
--    edge buka-kembali.
--  * GMV single-source: rekap TAK PERNAH menulis M6B PE-1. `wrr_metrik` hanya
--    memuat `gmv_interim` (Σ interim, read-only) — GMV resmi tetap `plan_actual`
--    M6B Rule 11. Dua angka wajib berlabel beda di halaman health (D-11).
--
-- Migrasi lewat supabase/migrations/** + apply_migration — JANGAN `psql -f`
-- (O38). DB lokal dibangun ulang HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- 1. Prefix `WRR` — registry memutuskan (M6A §7). Dua mekanisme: baris ini
--    (PK ⇒ duplikat mustahil) + PREFIXES di packages/core/src/ident.ts
--    (dijaga packages/db/src/ident.registry.test.ts, dua arah). `WRR` bebas.
--    ID = house PREFIX-YYYYMM-NNNN via ident_next (preseden STRG/PLAN/VND/ITV).
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('WRR', 'Rekap Hasil Mingguan', 'M6D');

-- ===========================================================================
-- 2. `weekly_result_recap` — induk (Section RM-A header/konteks + RM-F jejak)
-- ===========================================================================
CREATE TABLE weekly_result_recap (
    id             varchar(32)  NOT NULL PRIMARY KEY,

    client_id      varchar(32)  NOT NULL,          -- RM-A2
    -- RM-A3: periode Plan `Aktif` yang mencakup minggu ini, atau NULL (Tanpa
    -- Plan). Rekap me-rollup ke Plan (D-08), bukan dimiliki Plan.
    plan_id        varchar(32)  NULL,

    -- Kunci minggu ISO, disimpan eksplisit (PRD §9). WIB Sen–Min.
    iso_year       integer      NOT NULL,
    iso_week       integer      NOT NULL,           -- 1..53
    minggu_mulai   date         NOT NULL,           -- Senin WIB (RM-A1)
    minggu_akhir   date         NOT NULL,           -- Minggu WIB (RM-A1)

    -- RM-A4 / mesin #18 (HANYA lewat sm_transition; edge didaftar D-02).
    status         varchar(32)  NOT NULL DEFAULT 'Terjadwal',
    -- Sinyal non-performa AM permanen (RM-5/RM-9). Set true saat force-close
    -- (D-06), tak pernah dicabut (guard trigger menyusul D-02).
    pernah_ditutup_otomatis boolean NOT NULL DEFAULT false,

    catatan_pembuka text        NULL,               -- RM-A6 (W saat tutup; NULL saat pra-buka/autosave)

    -- RM-F: jejak penutupan (dasar freshness H-2 + jendela N hari kerja D-06).
    ditutup_pada   timestamptz  NULL,
    ditutup_oleh   varchar(64)  NULL,

    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    created_by     varchar(64)  NOT NULL,

    CONSTRAINT fk_wrr_client FOREIGN KEY (client_id) REFERENCES clients (id),
    -- Nullable ⇒ MATCH SIMPLE tak memeriksa saat NULL (klien Tanpa Plan sah).
    -- SET NULL: rekap selamat kalau periode Plan dihapus (rekap ≠ milik Plan).
    CONSTRAINT fk_wrr_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE SET NULL,

    CONSTRAINT ck_wrr_iso_week CHECK (iso_week BETWEEN 1 AND 53),
    CONSTRAINT ck_wrr_iso_year CHECK (iso_year BETWEEN 2000 AND 2100),
    CONSTRAINT ck_wrr_jendela  CHECK (minggu_akhir > minggu_mulai)
);

-- Satu rekap per klien per minggu ISO (lihat header — unik di semua state).
CREATE UNIQUE INDEX uq_wrr_client_week
    ON weekly_result_recap (client_id, iso_year, iso_week);

CREATE INDEX idx_wrr_client ON weekly_result_recap (client_id);
CREATE INDEX idx_wrr_plan   ON weekly_result_recap (plan_id);
CREATE INDEX idx_wrr_status ON weekly_result_recap (status);

CREATE TRIGGER trg_wrr_updated_at BEFORE UPDATE ON weekly_result_recap
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE weekly_result_recap IS
  'M6D — satu rekap hasil mingguan (WRR-) per klien aktif per minggu ISO, '
  'dibuka Senin 00:00 WIB (mesin #18). Lapisan agregasi-dan-narasi: tak '
  'memiliki data eksekusi (RM-B/RM-C dibaca dari M7/M8/M9/M10 + M6B). '
  'plan_id NULL = klien Tanpa Plan. Status lewat sm_transition saja.';
COMMENT ON COLUMN weekly_result_recap.pernah_ditutup_otomatis IS
  'RM-5/RM-9 — sinyal non-performa AM permanen. Set saat force-close, tak '
  'pernah dicabut (buka-kembali Head menyelamatkan DATA, bukan CATATAN AM). '
  'Dibaca skor disiplin M14 (D-14) + blok H-2 — bukan status akhir.';

-- ===========================================================================
-- 3. `wrr_divisi` — Section RM-B (produksi per divisi, auto/read-only)
--    Satu baris per divisi yang menyentuh klien minggu ini. Ini tabel
--    "berapa video / berapa live / berapa creator". Angka DIISI job agregasi
--    D-03 dari modul eksekusi (M7/M8/M9/M10 + M6/M11); UPDATE-block D-03.
-- ===========================================================================
CREATE TABLE wrr_divisi (
    recap_id       varchar(32)  NOT NULL,
    divisi         varchar(32)  NOT NULL,   -- Creative | Ads | KOL | Live Stream

    -- Headline count (RM-B): Creative=# video, KOL=# creator, Live=# live,
    -- Ads=# Ad Campaign Active dgn Metric Entry minggu ini.
    jumlah_produksi integer     NOT NULL DEFAULT 0,
    -- Rincian heterogen per divisi + RM-B5 (Brief bergerak: submitted/approved/
    -- revision/blocked) sebagai data, bukan kolom sparse tiap divisi. Diisi
    -- D-03 dari modul pemiliknya. Contoh Creative:
    -- {"video":N,"gambar":N,"desain":N,"sku_setup":N,"copy":N,
    --  "brief":{"submitted":N,"approved":N,"revision":N,"blocked":N}}.
    rincian        jsonb        NOT NULL DEFAULT '{}'::jsonb,

    -- RM-B6 Sengketa Angka (bantahan AM atas angka RM-B) → notif SPV (D-05).
    sengketa       text         NULL,

    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    created_by     varchar(64)  NOT NULL,

    CONSTRAINT pk_wrr_divisi PRIMARY KEY (recap_id, divisi),
    CONSTRAINT fk_wrr_divisi_recap FOREIGN KEY (recap_id)
        REFERENCES weekly_result_recap (id) ON DELETE CASCADE,
    CONSTRAINT ck_wrr_divisi_nama CHECK (divisi IN ('Creative', 'Ads', 'KOL', 'Live Stream')),
    CONSTRAINT ck_wrr_divisi_nonneg CHECK (jumlah_produksi >= 0)
);

CREATE INDEX idx_wrr_divisi_recap ON wrr_divisi (recap_id);

CREATE TRIGGER trg_wrr_divisi_updated_at BEFORE UPDATE ON wrr_divisi
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE wrr_divisi IS
  'M6D RM-B — produksi per divisi minggu ini (auto/read-only). Diisi agregasi '
  'D-03 dari M7/M8/M9/M10 + M6/M11. Baris otomatis UPDATE-blocked (D-03).';

-- ===========================================================================
-- 4. `wrr_metrik` — Section RM-C (metrik hasil konsolidasi)
--    Bentuk sama `plan_actual` M6B (sumber/nilai/file_bukti/tanggal_ambil/
--    sengketa). `nilai` NULLABLE: `tidak_tersedia` → NULL → dirender `—`
--    (aturan rumah #7; bagi-nol ROAS/CTR/CVR juga `—`, tak pernah error).
-- ===========================================================================
CREATE TABLE wrr_metrik (
    recap_id        varchar(32)   NOT NULL,
    metrik          varchar(24)   NOT NULL,   -- kunci metrik konsolidasi RM-C

    nilai           numeric(18,2) NULL,        -- NULL saat tidak_tersedia (render —)
    -- Kepemilikan metrik beku (PRD §9): otomatis (modul pemilik) / manual
    -- (fallback bersumber RM-C7) / tidak_tersedia (`—`). Default otomatis:
    -- agregasi D-03 menulis baris otomatis.
    sumber          varchar(16)   NOT NULL DEFAULT 'otomatis',
    file_bukti      text          NULL,        -- RM-C7 (W saat manual — CHECK di D-04)
    tanggal_ambil   date          NULL,        -- RM-C7 (W saat manual — CHECK di D-04)
    -- RM-C8 delta: nilai metrik yang sama dari rekap minggu sebelumnya (klien
    -- sama). Diisi D-03; arah & besaran dihitung, tak disimpan (recomputable).
    nilai_minggu_lalu numeric(18,2) NULL,
    -- RM-C Sengketa Angka atas angka OTOMATIS → notif SPV (D-05). Membantah
    -- angka yang AM ketik sendiri (manual) tak masuk akal — CHECK di bawah.
    sengketa        text          NULL,

    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    created_by      varchar(64)   NOT NULL,

    CONSTRAINT pk_wrr_metrik PRIMARY KEY (recap_id, metrik),
    CONSTRAINT fk_wrr_metrik_recap FOREIGN KEY (recap_id)
        REFERENCES weekly_result_recap (id) ON DELETE CASCADE,
    -- Kosakata metrik konsolidasi (PRD §4/§9). BUKAN kosakata Plan (M6B) —
    -- rekap mengonsolidasi lintas divisi, bukan per channel.
    CONSTRAINT ck_wrr_metrik_key CHECK (metrik IN (
        'gmv_interim', 'roas_ads', 'total_view', 'ctr', 'cvr', 'ad_spend')),
    CONSTRAINT ck_wrr_metrik_sumber CHECK (sumber IN ('otomatis', 'manual', 'tidak_tersedia')),
    -- tidak_tersedia ⇒ tak ada nilai (dirender `—`); sebaliknya boleh 0.
    CONSTRAINT ck_wrr_metrik_kosong CHECK (
        (sumber = 'tidak_tersedia' AND nilai IS NULL)
     OR (sumber <> 'tidak_tersedia')),
    CONSTRAINT ck_wrr_metrik_nonneg CHECK (nilai IS NULL OR nilai >= 0),
    -- Sengketa hanya bermakna atas angka otomatis (cermin ck_plan_actual_sengketa).
    CONSTRAINT ck_wrr_metrik_sengketa CHECK (sengketa IS NULL OR sumber = 'otomatis')
);

CREATE INDEX idx_wrr_metrik_recap ON wrr_metrik (recap_id);

CREATE TRIGGER trg_wrr_metrik_updated_at BEFORE UPDATE ON wrr_metrik
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE wrr_metrik IS
  'M6D RM-C — metrik hasil konsolidasi (bentuk sama plan_actual). sumber ∈ '
  'otomatis/manual/tidak_tersedia. nilai NULL = `—`. gmv_interim = interim, '
  'BUKAN GMV resmi (single-source M6B PE-1). Baris otomatis UPDATE-blocked (D-03).';

-- ===========================================================================
-- 5. `wrr_catatan` — Section RM-D narasi (1:1 per rekap)
--    RM-D4 (Keluhan Terkait) = auto dari `complaints`, DIBACA tak disimpan.
--    RM-A6 (catatan pembuka) ada di induk. RM-C9 (Catatan Metrik Tambahan
--    teks-only) menyusul D-04.
-- ===========================================================================
CREATE TABLE wrr_catatan (
    recap_id            varchar(32)  NOT NULL PRIMARY KEY,

    yang_bergerak       text         NULL,   -- RM-D1 (W saat tutup — validasi D-05)
    yang_tertahan       text         NULL,   -- RM-D2 (W bila ada blocker — D-05)
    fokus_minggu_depan  text         NULL,   -- RM-D3 (W saat tutup — validasi D-05)
    bahan_untuk_klien   text         NULL,   -- RM-D5 (O)

    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    created_by          varchar(64)  NOT NULL,

    CONSTRAINT fk_wrr_catatan_recap FOREIGN KEY (recap_id)
        REFERENCES weekly_result_recap (id) ON DELETE CASCADE
);

CREATE TRIGGER trg_wrr_catatan_updated_at BEFORE UPDATE ON wrr_catatan
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE wrr_catatan IS
  'M6D RM-D — narasi AM (1:1 per rekap). Wajib-saat-tutup ditegakkan D-05.';

-- ===========================================================================
-- 6. `wrr_catatan_divisi` — Section RM-D6 (thread catatan divisi, append-only)
--    Tiap divisi yang menyentuh klien minggu ini BERUTANG satu catatan (RM-8,
--    wajib). Read-only untuk AM, tak bisa dihapus. Append-only: tak ada
--    updated_at; guard immutability (no UPDATE/DELETE) menyusul D-05.
-- ===========================================================================
CREATE TABLE wrr_catatan_divisi (
    id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recap_id    varchar(32)  NOT NULL,
    divisi      varchar(32)  NOT NULL,   -- divisi yang mengisi
    catatan     text         NOT NULL,

    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL,

    CONSTRAINT fk_wrr_catatan_divisi_recap FOREIGN KEY (recap_id)
        REFERENCES weekly_result_recap (id) ON DELETE CASCADE,
    CONSTRAINT ck_wrr_catatan_divisi_nama CHECK (divisi IN ('Creative', 'Ads', 'KOL', 'Live Stream')),
    CONSTRAINT ck_wrr_catatan_divisi_isi CHECK (btrim(catatan) <> '')
);

CREATE INDEX idx_wrr_catatan_divisi_recap ON wrr_catatan_divisi (recap_id, divisi);

COMMENT ON TABLE wrr_catatan_divisi IS
  'M6D RM-D6 — thread catatan divisi (append-only). Tiap divisi terlibat '
  'berutang satu catatan mingguan (RM-8 wajib). Immutability guard di D-05.';

-- ===========================================================================
-- 7. RLS — lingkup BACA (SELECT). Tabel dibuat SETELAH 20260723064438_rls_
--    baseline, jadi loop grant di sana tak menyentuhnya: enable + policy
--    eksplisit di sini. Jalur TULIS (INSERT/UPDATE) tetap DEFAULT-DENY sampai
--    D-03 (job service-role + UPDATE-block) / D-09 (tulis AM lewat domain).
--
--    Lingkup baca (PRD §9 Permissions):
--      * AM/CRO assigned → klien sendiri (jwt_owns_client_am — assigned_am_id).
--      * SPV / Head of Account → semua (lead divisi Account).
--      * OD / Direksi → semua (jwt_can_read_all).
--      * Divisi lead → rekap klien yang divisinya sentuh: MENYUSUL bersama
--        jalur tulis RM-D6 (D-09). Melebarkan SELECT butuh entri ledger O48 —
--        jadi TIDAK dilebarkan spekulatif di sini (mulai sempit, lebarkan saat
--        fitur yang membutuhkannya mendarat).
--      * Klien → NONE (modul internal, Rule 9).
-- ===========================================================================
GRANT SELECT ON public.weekly_result_recap TO authenticated;
ALTER TABLE public.weekly_result_recap ENABLE ROW LEVEL SECURITY;
CREATE POLICY weekly_result_recap_select ON public.weekly_result_recap
    FOR SELECT TO authenticated
    USING (jwt_can_read_all()
           OR public.jwt_owns_client_am(client_id)
           OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- Helper baca untuk tabel anak — SECURITY DEFINER supaya join ke induk +
-- clients tak ter-filter RLS induk (preseden private.jwt_can_read_plan).
CREATE OR REPLACE FUNCTION private.jwt_can_read_recap(p_recap_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.weekly_result_recap w
     WHERE w.id = p_recap_id
       AND (public.jwt_can_read_all()
            OR public.jwt_owns_client_am(w.client_id)
            OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')))
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_can_read_recap(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.jwt_can_read_recap(text) TO authenticated;

-- Anak: baca mengikuti induk (bentuk sama plan_row/plan_actual → plan).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wrr_divisi', 'wrr_metrik', 'wrr_catatan', 'wrr_catatan_divisi']
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (private.jwt_can_read_recap(recap_id))', t || '_select', t);
  END LOOP;
END $$;
