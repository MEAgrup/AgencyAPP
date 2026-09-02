-- ===========================================================================
-- C1 lanjutan — insight laporan yang bisa disunting + gerbang publikasi ke klien
-- ===========================================================================
--
-- MASALAH. `client_reports` sudah menghasilkan laporan performa klien yang
-- lengkap (13 seksi, mode `klien`/`internal`), tapi dua hal belum ada:
--
--   1. NARASINYA tidak bisa disunting. `payload.insight` lahir dari
--      `buildInsights()` dan `payload` dibekukan `trg_client_reports_frozen`
--      untuk SEMUA update — jadi kalimat mesin adalah kalimat final, padahal AM
--      yang tahu konteks kliennya. Menyunting `payload` berarti mencabut
--      aturan rumah #3/#4 (angka harus immutable & recomputable), yang tidak
--      boleh terjadi hanya karena teksnya ikut menumpang di jsonb yang sama.
--
--   2. Tidak ada status. Begitu klien punya portal, SETIAP baris laporan yang
--      pernah dibuat langsung terbaca klien — termasuk percobaan, laporan
--      setengah jadi, dan laporan yang ternyata salah berkas.
--
-- BENTUK YANG DIPILIH. Dua tabel pendamping, nol perubahan pada `client_reports`:
--
--   * `client_report_insight` — APPEND-ONLY. Satu baris per revisi teks.
--     Revisi 0 selalu snapshot mesin (`sumber='mesin'`), jadi "kembalikan ke
--     insight mesin" adalah menyalin baris yang masih ada, bukan menghitung
--     ulang mesin dengan benchmark yang mungkin sudah berganti versi.
--
--   * `client_report_publikasi` — satu baris per laporan; `status` ditulis
--     EKSKLUSIF oleh `sm_transition` (mesin `client_report`), dan
--     `insight_revisi` MEMAKU revisi mana yang dilihat klien.
--
-- MENGAPA DIPAKU, BUKAN "revisi terbaru menang". Kalau klien selalu membaca
-- revisi terbaru, setiap simpanan setengah jadi langsung terbit — AM tidak
-- punya cara menyunting laporan yang sudah tayang tanpa klien melihat
-- prosesnya. Dengan paku: menyimpan itu aman, `Terbitkan pembaruan` yang
-- memindahkan paku. Pratinjau internal membaca revisi terbaru; klien membaca
-- yang terpaku. Satu kolom, dua kebenaran yang memang beda.
--
-- MENGAPA STATUS TIDAK DI `client_reports`. Tabel itu beku untuk UPDATE apa
-- pun — bukan per kolom. Menaruh `status` di sana berarti melonggarkan trigger
-- itu jadi selektif-kolom, yaitu memperlemah satu-satunya penjaga angka
-- laporan demi kenyamanan penulisan. `sm_transition` sudah menerima
-- `p_table`/`p_id_col`/`p_status_col` sebagai parameter, jadi tabel pendamping
-- jalan tanpa satu baris pun perubahan di engine state machine.
--
-- Ikut di migrasi ini karena satu klaster kerja yang sama (Client Portal):
--   * pintu ketiga `complaints` (M15 Rule 5, STATE_MACHINES §11 sudah menyebut
--     tiga pintu tapi kolomnya belum ada);
--   * rate limit form komplain (spec §5.2: 5/kontak/jam + 20/IP/jam).
--
-- Referensi: docs/prd/CDPS_Module15_Client_Team_Portal.md Rule 3/5/6,
-- docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md §4.2/§4.3/§5.1/§5.2/§6,
-- docs/DECISIONS.md 2026-09-08.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Mesin status `client_report` (mesin #31)
--
--    Nol state terminal, SENGAJA: laporan yang dicabut harus bisa dikoreksi
--    (insight diperbaiki, atau laporan baru dibuat dari berkas yang benar) lalu
--    diterbitkan lagi. Mengunci `[Dicabut]` sebagai terminal berarti satu salah
--    unggah menghanguskan periode itu selamanya, karena UNIQUE(toko × tipe ×
--    rentang) menolak baris pengganti.
--
--    `require_lead=false` di ketiga edge: pemilik memutuskan AM menyunting DAN
--    menerbitkan sendiri, tanpa gerbang review (keputusan pemilik 2026-09-08).
--    Ruang lingkupnya tetap sempit — `canWriteReport` di domain membatasi ke AM
--    pemilik klien / lead Account / Director, dan RLS mengulanginya.
-- ---------------------------------------------------------------------------
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('client_report', '[Draf]', false, '{}');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('client_report', '[Draf]',    '[Terbit]',  false),
    ('client_report', '[Terbit]',  '[Dicabut]', false),
    ('client_report', '[Dicabut]', '[Draf]',    false);

-- ---------------------------------------------------------------------------
-- 2. client_report_insight — revisi teks, append-only
-- ---------------------------------------------------------------------------
CREATE TABLE client_report_insight (
    id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id          bigint       NOT NULL,
    revisi             integer      NOT NULL,       -- 0 = snapshot mesin
    sumber             varchar(16)  NOT NULL,       -- mesin | manual
    ringkasan          text         NOT NULL,
    poin               jsonb        NOT NULL,       -- string[]
    rekomendasi_tinggi jsonb        NOT NULL,       -- {judul,target,dampak,timeline}[]
    rekomendasi_sedang jsonb        NOT NULL,
    outlook            text         NOT NULL,
    indikator          jsonb        NOT NULL,       -- {nama,target}[]
    catatan_revisi     text         NULL,           -- kenapa disunting (jejak, bukan syarat)
    created_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         varchar(64)  NOT NULL,
    CONSTRAINT fk_cri_report FOREIGN KEY (report_id) REFERENCES client_reports (id),
    CONSTRAINT uq_cri_revisi UNIQUE (report_id, revisi),
    CONSTRAINT ck_cri_revisi CHECK (revisi >= 0),
    CONSTRAINT ck_cri_sumber CHECK (sumber IN ('mesin', 'manual')),
    -- revisi 0 ⇔ mesin. Bukan dua aturan: revisi 0 adalah DEFINISI snapshot
    -- mesin, dan snapshot mesin hanya lahir sekali (saat laporan dibuat).
    -- Tanpa ini, "kembalikan ke insight mesin" bisa menimpa baseline-nya.
    CONSTRAINT ck_cri_mesin_revisi_nol CHECK ((revisi = 0) = (sumber = 'mesin')),
    CONSTRAINT ck_cri_teks CHECK (btrim(ringkasan) <> '' AND btrim(outlook) <> ''),
    -- jsonb harus benar-benar array; objek/skalar di sini bikin renderer diam-diam
    -- merender `[object Object]` ke laporan yang dibaca klien
    CONSTRAINT ck_cri_bentuk_json CHECK (
        jsonb_typeof(poin) = 'array' AND jsonb_typeof(rekomendasi_tinggi) = 'array'
        AND jsonb_typeof(rekomendasi_sedang) = 'array' AND jsonb_typeof(indikator) = 'array')
);

CREATE INDEX idx_cri_report ON client_report_insight (report_id, revisi DESC);

CREATE TRIGGER trg_cri_no_update BEFORE UPDATE ON client_report_insight
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_cri_no_delete BEFORE DELETE ON client_report_insight
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE client_report_insight IS
  'C1 — revisi teks insight laporan klien, append-only. Angka laporan tetap di '
  'client_reports.payload yang beku; ini HANYA narasi (ringkasan, poin, '
  'rekomendasi, outlook, indikator). Revisi 0 = snapshot mesin, jadi '
  'pengembalian ke insight mesin menyalin baris yang ada, bukan menghitung '
  'ulang dengan benchmark yang mungkin sudah berganti versi.';
COMMENT ON COLUMN client_report_insight.revisi IS
  'Nomor urut per laporan, 0 = snapshot mesin. Yang dilihat klien BUKAN yang '
  'terbaru melainkan yang dipaku di client_report_publikasi.insight_revisi.';

-- ---------------------------------------------------------------------------
-- 3. client_report_publikasi — status + revisi yang dipaku
-- ---------------------------------------------------------------------------
CREATE TABLE client_report_publikasi (
    report_id        bigint       NOT NULL PRIMARY KEY,
    status           varchar(24)  NOT NULL DEFAULT '[Draf]',  -- mesin client_report
    insight_revisi   integer      NULL,       -- revisi yang dibaca klien; NULL = belum/tidak tayang
    diterbitkan_pada timestamptz  NULL,
    diterbitkan_oleh varchar(64)  NULL,
    dicabut_pada     timestamptz  NULL,
    dicabut_oleh     varchar(64)  NULL,
    alasan_cabut     text         NULL,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    created_by       varchar(64)  NOT NULL,
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT fk_crp_report FOREIGN KEY (report_id) REFERENCES client_reports (id),
    -- Paku dan status tidak boleh berbeda pendapat: kalau tayang, harus jelas
    -- REVISI MANA yang tayang dan sejak kapan. Tanpa CHECK ini, sebuah baris
    -- `[Terbit]` dengan insight_revisi NULL akan membuat route klien memilih
    -- "terbaru" sebagai fallback — persis perilaku yang paku ini mencegah.
    CONSTRAINT ck_crp_terbit_lengkap CHECK (
        status <> '[Terbit]'
        OR (insight_revisi IS NOT NULL AND diterbitkan_pada IS NOT NULL AND diterbitkan_oleh IS NOT NULL)),
    CONSTRAINT ck_crp_cabut_lengkap CHECK (
        status <> '[Dicabut]'
        OR (dicabut_pada IS NOT NULL AND dicabut_oleh IS NOT NULL AND btrim(coalesce(alasan_cabut, '')) <> '')),
    -- Laporan yang dicabut tidak boleh menyisakan paku: satu baris tersisa
    -- akan tetap lolos filter "ada revisi terpaku" di query portal.
    CONSTRAINT ck_crp_dicabut_tanpa_paku CHECK (status <> '[Dicabut]' OR insight_revisi IS NULL),
    CONSTRAINT ck_crp_revisi CHECK (insight_revisi IS NULL OR insight_revisi >= 0)
);

CREATE INDEX idx_crp_status ON client_report_publikasi (status);

CREATE TRIGGER trg_crp_updated_at BEFORE UPDATE ON client_report_publikasi
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE client_report_publikasi IS
  'C1 — gerbang publikasi laporan klien. status HANYA lewat sm_transition '
  '(mesin client_report); insight_revisi memaku revisi client_report_insight '
  'yang dibaca klien, supaya AM bisa menyunting laporan yang sudah tayang '
  'tanpa klien melihat draf. Tabel terpisah karena client_reports beku untuk '
  'SEMUA update — bukan per kolom.';

-- ---------------------------------------------------------------------------
-- 4. Pintu ketiga komplain: Client Portal (M15 Rule 5)
--
--    Tidak menambah CHECK whitelist pada `source`: kolom itu lahir tanpa
--    constraint dan pintu Sales (M6 §8 pintu #1) belum punya nilai baku, jadi
--    mengunci kosakatanya sekarang akan menolak pintu yang memang direncanakan
--    PRD. Yang DITEGAKKAN adalah kaitannya: komplain dari portal wajib
--    membawa kontak yang mengirimnya — tanpa itu jejak "siapa dari klien ini
--    yang komplain" (spec §5.1) hilang dan komplain jadi anonim.
-- ---------------------------------------------------------------------------
ALTER TABLE complaints ADD COLUMN submitting_contact_id uuid NULL;

ALTER TABLE complaints ADD CONSTRAINT fk_complaint_contact
    FOREIGN KEY (submitting_contact_id) REFERENCES client_contacts (auth_user_id);

ALTER TABLE complaints ADD CONSTRAINT ck_complaint_portal_contact
    CHECK (source <> 'Client Portal' OR submitting_contact_id IS NOT NULL);

CREATE INDEX idx_complaints_contact ON complaints (submitting_contact_id)
    WHERE submitting_contact_id IS NOT NULL;

COMMENT ON COLUMN complaints.submitting_contact_id IS
  'M15 Rule 5 — kontak klien yang menekan kirim di Client Portal. Wajib untuk '
  'source=''Client Portal'' (spec §5.1: aksi dicatat per KONTAK, bukan per klien).';

-- ---------------------------------------------------------------------------
-- 5. Rate limit form komplain (spec §5.2)
--
--    Bentuknya menyalin 20260906010000_login_rate_limit.sql: tabel "internal
--    murni" (RLS on, NOL policy) + fungsi SECURITY DEFINER yang memangkas,
--    menghitung, lalu mencatat-dan-izinkan atau memblokir-tanpa-mencatat —
--    percobaan yang diblokir tidak boleh memperpanjang jendelanya sendiri.
--
--    Dua ambang sekaligus, bukan satu: per-kontak menahan satu orang yang
--    menekan kirim berulang; per-IP menahan satu jaringan memakai banyak akun
--    kontak. Keduanya starting point (spec §5.2), revisinya cukup entri
--    DECISIONS baru.
-- ---------------------------------------------------------------------------
CREATE TABLE complaint_rate_limit_attempts (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contact_id uuid        NOT NULL,
    ip         inet        NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crl_contact ON complaint_rate_limit_attempts (contact_id, created_at DESC);
CREATE INDEX idx_crl_ip ON complaint_rate_limit_attempts (ip, created_at DESC) WHERE ip IS NOT NULL;

ALTER TABLE public.complaint_rate_limit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.complaint_rate_limit_attempts FROM anon;
REVOKE ALL ON public.complaint_rate_limit_attempts FROM authenticated;

COMMENT ON TABLE complaint_rate_limit_attempts IS
  'Spec §5.2 — jejak percobaan submit komplain Client Portal untuk rate limit. '
  'Internal murni: RLS aktif dengan NOL policy, hanya service-role lewat '
  'check_complaint_rate_limit(). Pola sama login_rate_limit_attempts.';

CREATE OR REPLACE FUNCTION public.check_complaint_rate_limit(
    p_contact_id     uuid,
    p_ip             inet,
    p_max_per_kontak integer DEFAULT 5,
    p_max_per_ip     integer DEFAULT 20,
    p_window_minutes integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_cutoff  timestamptz := now() - make_interval(mins => p_window_minutes);
    v_kontak  integer;
    v_ip      integer;
BEGIN
    IF p_contact_id IS NULL THEN
        RETURN false;                       -- tanpa kontak tak ada yang bisa dibatasi
    END IF;

    DELETE FROM complaint_rate_limit_attempts WHERE created_at < v_cutoff;

    SELECT count(*) INTO v_kontak
      FROM complaint_rate_limit_attempts
     WHERE contact_id = p_contact_id AND created_at >= v_cutoff;

    IF v_kontak >= p_max_per_kontak THEN
        RETURN false;
    END IF;

    IF p_ip IS NOT NULL THEN
        SELECT count(*) INTO v_ip
          FROM complaint_rate_limit_attempts
         WHERE ip = p_ip AND created_at >= v_cutoff;
        IF v_ip >= p_max_per_ip THEN
            RETURN false;
        END IF;
    END IF;

    INSERT INTO complaint_rate_limit_attempts (contact_id, ip) VALUES (p_contact_id, p_ip);
    RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.check_complaint_rate_limit(uuid, inet, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.check_complaint_rate_limit(uuid, inet, integer, integer, integer) FROM authenticated;

COMMENT ON FUNCTION public.check_complaint_rate_limit(uuid, inet, integer, integer, integer) IS
  'Spec §5.2 — true kalau submit diizinkan (dan dicatat), false kalau diblokir '
  '(TIDAK dicatat, supaya percobaan yang diblokir tak memperpanjang jendelanya).';

-- ---------------------------------------------------------------------------
-- 6. RLS
--
--    Dua penonton yang berbeda, jadi dua kelompok policy:
--
--    (a) Karyawan — salinan INLINE predikat `client_reports_sel` (arm
--        lead/divisi diulang eksplisit, bukan hanya diwarisi lewat EXISTS,
--        supaya detektor sintaktik O48 melihatnya — pola yang sama dipakai
--        `client_report_berkas_sel`).
--
--    (b) Kontak klien — `jwt_client_id()` (sudah ada, 20260905010000 §3; klaim
--        ini yang pertama kali memakainya) DAN laporan harus `[Terbit]` DAN,
--        untuk baris insight, revisinya harus yang DIPAKU. Klien tidak pernah
--        melihat draf, laporan tercabut, atau revisi yang belum diterbitkan —
--        ditegakkan di DB, bukan hanya di predikat TS.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.client_report_insight    FROM anon;
REVOKE ALL ON public.client_report_insight    FROM authenticated;
REVOKE ALL ON public.client_report_publikasi  FROM anon;
REVOKE ALL ON public.client_report_publikasi  FROM authenticated;

ALTER TABLE public.client_report_insight   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_report_publikasi ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.client_report_insight, public.client_report_publikasi TO authenticated;

CREATE POLICY client_report_insight_sel ON public.client_report_insight FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR EXISTS (SELECT 1 FROM public.client_reports r
                       WHERE r.id = client_report_insight.report_id
                         AND public.jwt_owns_client_am(r.client_id)));

CREATE POLICY client_report_publikasi_sel ON public.client_report_publikasi FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR EXISTS (SELECT 1 FROM public.client_reports r
                       WHERE r.id = client_report_publikasi.report_id
                         AND public.jwt_owns_client_am(r.client_id)));

-- (b) Kontak Client Portal — hanya laporan miliknya yang berstatus [Terbit].
CREATE POLICY client_reports_sel_portal ON public.client_reports FOR SELECT TO authenticated
    USING (public.jwt_client_id() IS NOT NULL
           AND client_id = public.jwt_client_id()
           AND EXISTS (SELECT 1 FROM public.client_report_publikasi p
                        WHERE p.report_id = client_reports.id AND p.status = '[Terbit]'));

CREATE POLICY client_report_publikasi_sel_portal ON public.client_report_publikasi FOR SELECT TO authenticated
    USING (public.jwt_client_id() IS NOT NULL
           AND status = '[Terbit]'
           AND EXISTS (SELECT 1 FROM public.client_reports r
                        WHERE r.id = client_report_publikasi.report_id
                          AND r.client_id = public.jwt_client_id()));

-- Insight: bukan cuma "laporannya terbit" — harus revisi YANG DIPAKU.
CREATE POLICY client_report_insight_sel_portal ON public.client_report_insight FOR SELECT TO authenticated
    USING (public.jwt_client_id() IS NOT NULL
           AND EXISTS (SELECT 1
                         FROM public.client_report_publikasi p
                         JOIN public.client_reports r ON r.id = p.report_id
                        WHERE p.report_id = client_report_insight.report_id
                          AND p.status = '[Terbit]'
                          AND p.insight_revisi = client_report_insight.revisi
                          AND r.client_id = public.jwt_client_id()));
