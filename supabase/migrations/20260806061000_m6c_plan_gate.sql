-- CDPS — Module 6C: Penentuan Kebutuhan Plan (Service Satuan).
--
-- Tiga perubahan:
--   1) tier katalog tiga nilai (M6C S4 / §3) di master_service_versions + pin di
--      services — menggantikan pertanyaan biner "butuh_plan ya/tidak";
--   2) `plan_gate_config` — ambang pemicu sebagai KONFIGURASI berversi, bukan
--      konstanta (M6C §10);
--   3) `service_plan_gate` — satu penentuan per service (M6C §10).
--
-- ---------------------------------------------------------------------------
-- Kenapa tier, bukan boolean (M6C §1 + GA-2)
-- ---------------------------------------------------------------------------
-- `requires_strategy_plan` boolean benar untuk dua ujung (Full Store Management
-- selalu butuh; satu permintaan desain tidak pernah butuh) dan SALAH untuk
-- tengahnya, di mana SKU service yang sama bisa jadi pekerjaan dua minggu untuk
-- satu klien dan komitmen berjalan untuk klien lain. Tier memisahkan "katalog
-- yang memutuskan" dari "AM yang memutuskan", dan itulah yang membuat angka
-- override bisa diukur (§12).
--
-- Boolean-nya TIDAK dibuang: ia tetap kolom sumber untuk dua tier terkunci, dan
-- CHECK di bawah mengikat keduanya supaya tidak bisa hanyut. Untuk
-- `ditentukan_am` gerbang efektifnya datang dari `service_plan_gate.keputusan_am`
-- — resolusinya ada di `packages/domain/src/account.ts` (effectiveRequiresPlan)
-- dan HARUS sama dengan CHECK di sini (invariant beku: predikat TS dan DB tidak
-- boleh menyimpang).
--
-- ---------------------------------------------------------------------------
-- Deviasi yang dicatat (docs/DECISIONS.md 2026-08-06)
-- ---------------------------------------------------------------------------
-- * M6C §10 meminta kolom `riwayat jsonb[]` untuk jejak eskalasi/de-eskalasi.
--   TIDAK dibuat: aturan rumah 3 menyatakan riwayat immutable hidup di
--   `audit_log` dan tally turunan tidak pernah disimpan. GC-1/GC-3 dibaca dari
--   `audit_log`, jadi menyimpannya dua kali hanya menciptakan dua versi
--   kebenaran yang bisa berbeda.
-- * `plan_id` dibuat nullable TANPA FK: tabel `PLAN` (M6B) belum ada. Rule 6
--   ("service pertama MEMBUKA Plan Satuan") karena itu belum bisa dijalankan —
--   penentuannya tercatat penuh, pembukaan Plan-nya menyusul bersama M6B.
--   FK ditambahkan pada migrasi M6B, bukan di sini.
-- * Tiga event notifikasi M6C (`gate_override_dicatat`,
--   `plan_sekarang_disarankan`, `gate_deeskalasi_diminta`) TIDAK ditambahkan.
--   Katalog notifikasi adalah invariant BEKU dan amandemen v2 (28 event) masih
--   menunggu tanda tangan Hans — M6A RA-1 / M6B PA-8 / M6C GA-8, ketiganya
--   masih terbuka. Menambah baris ke `notif_events` di sini akan mendahului
--   keputusan itu. Override tetap TERCATAT (audit_log + kolom `kesesuaian`),
--   hanya SPV-nya belum diberi tahu lewat notifikasi.

-- ---------------------------------------------------------------------------
-- 1. Tier katalog
-- ---------------------------------------------------------------------------
ALTER TABLE master_service_versions
    ADD COLUMN plan_tier varchar(24) NOT NULL DEFAULT 'tanpa_plan';
ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_plan_tier
    CHECK (plan_tier IN ('plan_wajib', 'ditentukan_am', 'tanpa_plan'));

-- Backfill dari boolean supaya perilaku hari ini tidak berubah sedikit pun:
-- true → plan_wajib, false → tanpa_plan. Penetapan tier yang sesungguhnya untuk
-- 36 entri katalog live adalah tugas DATA (M6C GA-2), migrasi terpisah.
UPDATE master_service_versions SET plan_tier = 'plan_wajib' WHERE requires_strategy_plan;

-- Ikat tier ↔ boolean untuk dua tier terkunci. `ditentukan_am` sengaja dibiarkan
-- false: gerbang efektifnya ditentukan baris `service_plan_gate`, bukan katalog.
ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_tier_matches_flag
    CHECK (
        (plan_tier = 'plan_wajib'    AND requires_strategy_plan)
     OR (plan_tier = 'tanpa_plan'    AND NOT requires_strategy_plan)
     OR (plan_tier = 'ditentukan_am' AND NOT requires_strategy_plan)
    );

-- Pin di Service (M6 §2: Service menangkap flag dari versi MSL yang dipin saat
-- closing, jadi edit katalog belakangan tidak pernah mengubah jalur eksekusi
-- engagement yang sedang jalan).
ALTER TABLE services
    ADD COLUMN plan_tier varchar(24) NOT NULL DEFAULT 'tanpa_plan';
ALTER TABLE services
    ADD CONSTRAINT ck_services_plan_tier
    CHECK (plan_tier IN ('plan_wajib', 'ditentukan_am', 'tanpa_plan'));
UPDATE services SET plan_tier = 'plan_wajib' WHERE requires_strategy_plan;
ALTER TABLE services
    ADD CONSTRAINT ck_services_tier_matches_flag
    CHECK (
        (plan_tier = 'plan_wajib'    AND requires_strategy_plan)
     OR (plan_tier = 'tanpa_plan'    AND NOT requires_strategy_plan)
     OR (plan_tier = 'ditentukan_am' AND NOT requires_strategy_plan)
    );

-- ---------------------------------------------------------------------------
-- 1b. Normalisasi tier ↔ boolean, supaya CHECK di atas tidak memaksa SETIAP
--     penulis INSERT mengingat dua kolom.
-- ---------------------------------------------------------------------------
-- Tanpa ini, setiap INSERT lama yang hanya menyetel `requires_strategy_plan`
-- (seeder, fixture test, `msl.createService`) mendadak melanggar CHECK — dan
-- "tambahkan kolom kedua di 20 tempat" adalah cara paling pasti melahirkan
-- drift yang CHECK-nya justru dibuat untuk mencegah.
--
-- Aturannya menormalkan KE ARAH kesepakatan, dan arah mana yang menang
-- ditentukan oleh kolom mana yang sebenarnya diisi:
--   * tier masih default (`tanpa_plan`) tapi boolean true  ⇒ penulis lama
--     bicara lewat boolean ⇒ tier menjadi `plan_wajib`;
--   * tier eksplisit `plan_wajib` tapi boolean false        ⇒ penulis M6C
--     bicara lewat tier ⇒ boolean menjadi true;
--   * tier `ditentukan_am`                                  ⇒ boolean WAJIB
--     false: gerbang efektifnya datang dari `service_plan_gate`, bukan katalog.
-- CHECK-nya tetap ada sebagai lapis kedua — kalau trigger ini pernah salah,
-- barisnya ditolak, bukan disimpan diam-diam.
CREATE OR REPLACE FUNCTION normalize_plan_tier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.plan_tier = 'ditentukan_am' THEN
        NEW.requires_strategy_plan := false;
    ELSIF NEW.plan_tier = 'plan_wajib' THEN
        NEW.requires_strategy_plan := true;
    ELSIF NEW.requires_strategy_plan THEN
        -- tier default + boolean true = penulis pra-M6C
        NEW.plan_tier := 'plan_wajib';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_msv_normalize_plan_tier
    BEFORE INSERT OR UPDATE ON master_service_versions
    FOR EACH ROW EXECUTE FUNCTION normalize_plan_tier();

CREATE TRIGGER trg_services_normalize_plan_tier
    BEFORE INSERT OR UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION normalize_plan_tier();

COMMENT ON COLUMN services.plan_tier IS
  'M6C S4 — tier katalog yang dipin saat closing: plan_wajib (terkunci on) / '
  'ditentukan_am (form G-B wajib sebelum Brief) / tanpa_plan (terkunci off, '
  'masih bisa dieskalasi lewat service_plan_gate, Rule 11).';

-- ---------------------------------------------------------------------------
-- 2. plan_gate_config — ambang sebagai konfigurasi berversi (M6C §10)
-- ---------------------------------------------------------------------------
-- "Thresholds are configuration, not constants." Berversi supaya bisa diubah
-- Direksi/Head of Account tanpa menulis ulang sejarah: karena `pemicu_*`
-- DISIMPAN per penentuan (bukan dihitung ulang), mengubah ambang tidak pernah
-- mengubah keputusan yang sudah lewat. `config_version_no` di setiap baris
-- penentuan mencatat ambang mana yang berlaku saat itu.
CREATE TABLE plan_gate_config (
    version_no             integer      NOT NULL PRIMARY KEY,
    kuota_threshold        integer      NOT NULL,
    nilai_threshold        numeric(18,2) NOT NULL,
    durasi_threshold_bulan numeric(6,2) NOT NULL,
    notif_join_threshold   numeric(18,2) NOT NULL,
    effective_from         date         NOT NULL,
    created_at             timestamptz  NOT NULL DEFAULT now(),
    created_by             varchar(64)  NOT NULL,
    CONSTRAINT ck_pgc_positive CHECK (
        kuota_threshold > 0 AND nilai_threshold > 0
        AND durasi_threshold_bulan > 0 AND notif_join_threshold > 0
    )
);

-- Versi 1 = default M6C §10 / Rule 3. GA-1 masih terbuka: ini nilai awal, bukan
-- angka yang sudah diuji terhadap data service riil.
INSERT INTO plan_gate_config
    (version_no, kuota_threshold, nilai_threshold, durasi_threshold_bulan,
     notif_join_threshold, effective_from, created_by)
VALUES (1, 20, 15000000, 1, 15000000, '2020-01-01', 'SYSTEM');

-- ---------------------------------------------------------------------------
-- 3. service_plan_gate — satu penentuan per service (M6C §10)
-- ---------------------------------------------------------------------------
CREATE TABLE service_plan_gate (
    service_id            varchar(32)   NOT NULL PRIMARY KEY,
    tier_katalog          varchar(24)   NOT NULL,

    -- G-A: konteks penugasan (auto dari kontrak/katalog + konfirmasi AM).
    divisi_terlibat       varchar(191)  NOT NULL,       -- GA-3, csv seperti divisions_involved
    deliverable           text          NOT NULL,       -- GA-4
    kuota_per_periode     integer       NULL,           -- GA-4
    durasi_bulan          numeric(6,2)  NULL,           -- GA-2
    berulang              boolean       NOT NULL,       -- GA-2
    nilai_per_bulan       numeric(18,2) NULL,           -- basis pemicu lunak nilai
    target_angka_jenis    varchar(24)   NULL,           -- GA-5: gmv / roas / growth
    target_angka_nilai    numeric(18,2) NULL,           -- GA-5
    sequence_dependency   boolean       NOT NULL,       -- pemicu lunak
    laporan_periodik      boolean       NOT NULL,       -- pemicu lunak (laporan/SLA)
    floor_price           jsonb         NULL,           -- GA-6, per SKU, level klien

    -- G-B: pemicu + rekomendasi + keputusan. `pemicu_*` DISIMPAN, tidak dihitung
    -- ulang (M6C §10) — itulah yang membuat perubahan ambang tidak retroaktif.
    pemicu_keras          jsonb         NOT NULL,
    pemicu_lunak          jsonb         NOT NULL,
    config_version_no     integer       NOT NULL,
    rekomendasi           varchar(16)   NOT NULL,
    keputusan_am          varchar(16)   NOT NULL,
    kesesuaian            varchar(16)   NOT NULL,
    alasan                text          NULL,
    pemantauan_alternatif text          NULL,
    tanggal_tinjau_ulang  date          NOT NULL,
    ringkasan_penugasan   jsonb         NULL,           -- GB-8, 4 field

    -- Plan Satuan yang diikuti. Tanpa FK sampai tabel PLAN (M6B) ada.
    plan_id               varchar(32)   NULL,

    decided_by            varchar(64)   NOT NULL,
    decided_at            timestamptz   NOT NULL DEFAULT now(),
    created_at            timestamptz   NOT NULL DEFAULT now(),
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    created_by            varchar(64)   NOT NULL,

    CONSTRAINT fk_spg_service FOREIGN KEY (service_id) REFERENCES services (id),
    CONSTRAINT fk_spg_config  FOREIGN KEY (config_version_no) REFERENCES plan_gate_config (version_no),
    CONSTRAINT ck_spg_tier    CHECK (tier_katalog IN ('plan_wajib', 'ditentukan_am', 'tanpa_plan')),
    CONSTRAINT ck_spg_rekomendasi CHECK (rekomendasi  IN ('butuh_plan', 'tanpa_plan')),
    CONSTRAINT ck_spg_keputusan   CHECK (keputusan_am IN ('butuh_plan', 'tanpa_plan')),
    CONSTRAINT ck_spg_kesesuaian  CHECK (kesesuaian   IN ('sesuai', 'tolak_plan', 'tambah_plan')),

    -- `kesesuaian` adalah turunan: ia HARUS cocok dengan (rekomendasi,
    -- keputusan_am). Disimpan supaya bisa di-index & dilaporkan (§12 mengukur
    -- rate per AM), tapi dijaga CHECK supaya tidak bisa dipalsukan.
    CONSTRAINT ck_spg_kesesuaian_derived CHECK (
        (rekomendasi = keputusan_am AND kesesuaian = 'sesuai')
     OR (rekomendasi = 'butuh_plan' AND keputusan_am = 'tanpa_plan' AND kesesuaian = 'tolak_plan')
     OR (rekomendasi = 'tanpa_plan' AND keputusan_am = 'butuh_plan' AND kesesuaian = 'tambah_plan')
    ),

    -- M6C §10: alasan wajib saat keputusan menyimpang dari rekomendasi (GB-5).
    CONSTRAINT ck_spg_alasan CHECK (
        kesesuaian = 'sesuai' OR (alasan IS NOT NULL AND btrim(alasan) <> '')
    ),
    -- GB-6: menolak Plan yang direkomendasikan wajib menyebut cara pemantauan
    -- alternatif. Hanya arah `tolak_plan` — `tambah_plan` bukan risiko
    -- akuntabilitas (Rule 5), jadi tidak dibebani pertanyaan yang sama.
    CONSTRAINT ck_spg_pemantauan CHECK (
        kesesuaian <> 'tolak_plan'
        OR (pemantauan_alternatif IS NOT NULL AND btrim(pemantauan_alternatif) <> '')
    ),
    -- GB-8: jalur `Tanpa Plan` wajib meninggalkan ringkasan penugasan, kalau
    -- tidak pekerjaannya tak terlihat sama sekali (GA-3 di M6C §11).
    CONSTRAINT ck_spg_ringkasan CHECK (
        keputusan_am <> 'tanpa_plan' OR ringkasan_penugasan IS NOT NULL
    ),
    -- GA-5: jenis dan nilai target datang berpasangan atau tidak sama sekali.
    CONSTRAINT ck_spg_target_pair CHECK (
        (target_angka_jenis IS NULL) = (target_angka_nilai IS NULL)
    ),
    CONSTRAINT ck_spg_target_jenis CHECK (
        target_angka_jenis IS NULL OR target_angka_jenis IN ('gmv', 'roas', 'growth')
    )
);

CREATE TRIGGER trg_service_plan_gate_updated_at BEFORE UPDATE ON service_plan_gate
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Laporan §12 mengukur rate `tolak_plan` PER AM, bukan rata-rata — index
-- mengikuti bentuk query itu.
CREATE INDEX idx_spg_kesesuaian_decider ON service_plan_gate (decided_by, kesesuaian);
CREATE INDEX idx_spg_tinjau_ulang ON service_plan_gate (tanggal_tinjau_ulang)
    WHERE keputusan_am = 'tanpa_plan';

-- ---------------------------------------------------------------------------
-- 4. Integritas §4(b) — satu service tidak boleh masuk dua Plan
-- ---------------------------------------------------------------------------
-- M6C §10 meminta partial unique index + check bahwa service milik kontrak
-- full-management tidak boleh menunjuk Plan ber-`lingkup = 'klien'`. Keduanya
-- butuh tabel PLAN (M6B). Yang BISA ditegakkan sekarang: PK `service_id`
-- membuat "satu penentuan per service" mustahil dilanggar, dan `plan_id`
-- tunggal per baris membuat satu service tidak bisa menunjuk dua Plan. Sisa
-- constraint-nya ikut migrasi M6B — dicatat di sini supaya tidak hilang.

-- ---------------------------------------------------------------------------
-- 5. RLS — tabel dibuat SETELAH 20260723064438_rls_baseline, jadi loop grant di
--    sana tidak menyentuhnya.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.plan_gate_config FROM anon;
REVOKE ALL ON public.plan_gate_config FROM authenticated;
GRANT SELECT ON public.plan_gate_config TO authenticated;
ALTER TABLE public.plan_gate_config ENABLE ROW LEVEL SECURITY;
-- Ambang bukan rahasia: AM harus bisa melihat dasar angka rekomendasi (GB-1
-- "daftar pemicu + DASAR ANGKANYA"). Rekomendasi tanpa ambang yang terlihat
-- adalah kotak hitam, dan §12 justru mengukur seberapa sering AM menolaknya.
CREATE POLICY plan_gate_config_select ON public.plan_gate_config FOR SELECT TO authenticated
USING (true);

REVOKE ALL ON public.service_plan_gate FROM anon;
REVOKE ALL ON public.service_plan_gate FROM authenticated;
GRANT SELECT ON public.service_plan_gate TO authenticated;
ALTER TABLE public.service_plan_gate ENABLE ROW LEVEL SECURITY;
-- M6C §10 permissions: AM baca/tulis milik kliennya; SPV/Head Account baca
-- semua; lead divisi eksekusi baca keputusan gate untuk service yang mereka
-- kerjakan (supaya tahu KENAPA ada/tidak ada Plan); Direksi baca semua.
-- Arm lead-divisi menumpang `briefs`: divisi "yang mengerjakan" adalah divisi
-- yang punya Brief di service ini. Sebelum Brief pertama ada, `divisi_terlibat`
-- (GA-3) dipakai sebagai jawaban — itulah gunanya kolom itu diisi AM.
CREATE POLICY service_plan_gate_select ON public.service_plan_gate FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (decided_by, created_by)
       OR private.jwt_is_am_of_service(service_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account')
       OR (jwt_is_lead() AND EXISTS (
             SELECT 1 FROM briefs b
              WHERE b.service_id = service_plan_gate.service_id
                AND b.assigned_division = jwt_division()))
       OR (jwt_is_lead() AND divisi_terlibat LIKE '%' || jwt_division() || '%'));
