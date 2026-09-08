-- ===========================================================================
-- D-3 (2/3) — kunci tutup buku per bulan
-- ===========================================================================
--
-- KETOKAN PEMILIK yang migrasi ini bangun (docs/DECISIONS.md 2026-09-07 &
-- 2026-09-08, arsip bahan di handoff/KEPUTUSAN_PEMILIK_GELOMBANG_C_D_20260907.md
-- §D-3):
--
--   * Ada kunci tutup buku per bulan. Angka bulan yang sudah ditutup tidak
--     boleh berubah diam-diam.
--   * Menutup  : Finance level lead ATAU Director.
--   * Membuka  : Director SAJA. Yang menutup tidak bisa membatalkan tutupannya
--                sendiri — asimetri itulah yang membuat kuncinya menjaga
--                sesuatu.
--   * Buka-ulang WAJIB berlasan tertulis, dan angka beku TIDAK dihapus: ia jadi
--     VERSI, supaya "berapa angkanya waktu ditutup pertama kali" tetap bisa
--     dijawab selamanya.
--   * Koreksi dilakukan lewat JURNAL KOREKSI di bulan berjalan, BUKAN dengan
--     menyunting bulan tertutup.
--
-- ── Kenapa kunci utamanya BULAN, bukan ID rumah `PREFIX-YYYYMM-NNNN` ───────
--
-- Aturan rumah #1 memberi ID ber-prefix kepada ENTITAS yang bisa ada lebih dari
-- satu dengan sifat sama. "Bulan Agustus 2026" hanya ada satu, selamanya, dan
-- identitasnya adalah bulannya sendiri. Kunci alami `periode` membuat dua baris
-- untuk bulan yang sama MUSTAHIL secara struktur — sementara ID surrogate hanya
-- membuatnya "tidak seharusnya terjadi" dan menyerahkan penegakannya ke
-- constraint unik yang harus diingat orang. Preseden di rumah ini sudah ada:
-- `client_reports.id` bigint, "laporan bukan entitas ber-prefix"
-- (20260908010000).
--
-- `sm_transition` sudah sadar tipe kolom id sejak 20260908020000, jadi kunci
-- bertipe `date` dilayaninya tanpa perlakuan khusus.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Nama bulan Bahasa Indonesia — untuk pesan yang bisa dibaca orang
-- ---------------------------------------------------------------------------
--
-- `to_char` bergantung pada lc_time server dan akan menghasilkan "August" di
-- mesin yang setelan localenya beda. Pesan validasi rumah ini wajib Bahasa
-- Indonesia (aturan rumah #5), jadi namanya diambil dari array, bukan locale.
CREATE OR REPLACE FUNCTION bulan_indonesia(p_tanggal date) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT (ARRAY['Januari','Februari','Maret','April','Mei','Juni',
                  'Juli','Agustus','September','Oktober','November','Desember']
           )[extract(month from p_tanggal)::int]
           || ' ' || extract(year from p_tanggal)::text;
$$;

COMMENT ON FUNCTION bulan_indonesia(date) IS
  'Nama bulan Bahasa Indonesia + tahun (mis. ''Agustus 2026''). Dari array, '
  'BUKAN to_char — to_char mengikuti lc_time server dan bisa menghasilkan '
  'bahasa lain di mesin yang setelannya berbeda.';

-- ---------------------------------------------------------------------------
-- 1. book_periods — satu baris per bulan, statusnya dijaga mesin
-- ---------------------------------------------------------------------------
CREATE TABLE book_periods (
    periode        date        NOT NULL PRIMARY KEY,
    status         varchar(24) NOT NULL DEFAULT '[Terbuka]',
    -- Versi angka beku TERAKHIR. 0 = belum pernah ditutup sama sekali.
    -- Dipisah dari `book_period_snapshots` supaya nomor versi berikutnya bisa
    -- diambil di bawah row lock yang sama dengan transisinya.
    versi_terakhir integer     NOT NULL DEFAULT 0,

    -- Jejak buka-ulang TERAKHIR. Riwayat LENGKAPnya ada di audit_log (yang
    -- memang tabel riwayat rumah ini, dan sudah menolak UPDATE/DELETE);
    -- ketiga kolom ini ada supaya "wajib berlasan" bisa ditegakkan DI DB,
    -- bukan sebagai kesopanan lapisan TypeScript.
    dibuka_pada    timestamptz NULL,
    dibuka_oleh    varchar(64) NULL,
    alasan_buka    text        NULL,

    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     varchar(64) NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),

    -- `periode` selalu hari PERTAMA bulannya. Tanpa ini, '2026-08-01' dan
    -- '2026-08-15' jadi dua bulan Agustus yang berbeda dan kuncinya bocor.
    -- `extract` atas `date` IMMUTABLE, jadi sah dipakai di CHECK.
    CONSTRAINT ck_bp_awal_bulan CHECK (extract(day from periode) = 1),

    CONSTRAINT ck_bp_versi_nonneg CHECK (versi_terakhir >= 0),

    -- Jejak buka-ulang harus LENGKAP atau tidak ada sama sekali. Separuh jejak
    -- ("dibuka oleh siapa" tanpa "kenapa") adalah bentuk terburuk: ia terlihat
    -- seperti catatan, tapi tidak menjawab satu-satunya pertanyaan yang
    -- membuat catatan itu ada.
    --
    -- Sengaja TIDAK menyebut `status` maupun `versi_terakhir`. Versi pertama
    -- CHECK ini berbunyi "status='[Terbuka]' DAN versi_terakhir>=1 ⇒ wajib
    -- beralasan", dan itu membuat penutupan PERTAMA mustahil: menaikkan
    -- versi_terakhir ke 1 (yang harus terjadi SEBELUM transisi, karena
    -- sm_transition hanya menulis kolom status) melanggarnya, sementara
    -- menaikkannya sesudah transisi melanggar syarat "tertutup ⇒ ada angka".
    -- Dua arah tertutup = tidak ada urutan tulis yang sah, dan constraint yang
    -- tak punya urutan valid bukan penjaga, ia jalan buntu (pelajaran yang
    -- sudah tertulis di ck_crp_cabut_lengkap, 20260908010000 — dan tetap
    -- terulang di sini sampai dijalankan sungguhan).
    --
    -- Yang MEMAKSA sebuah buka-ulang benar-benar beralasan bukan CHECK ini,
    -- melainkan trigger trg_bp_jaga_transisi di bawah, yang bisa melihat
    -- perpindahan status DAN membaca tabel lain.
    CONSTRAINT ck_bp_jejak_buka_utuh CHECK (
        (dibuka_pada IS NULL AND dibuka_oleh IS NULL AND alasan_buka IS NULL)
        OR (dibuka_pada IS NOT NULL
            AND dibuka_oleh IS NOT NULL
            AND btrim(coalesce(alasan_buka, '')) <> ''))
);

CREATE INDEX idx_bp_status ON book_periods (status);

CREATE TRIGGER trg_bp_updated_at BEFORE UPDATE ON book_periods
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE book_periods IS
  'D-3 — kunci tutup buku per bulan. Kunci utama = bulannya sendiri (hari '
  'pertama, WIB). status HANYA lewat sm_transition (mesin book_period).';
COMMENT ON COLUMN book_periods.versi_terakhir IS
  'Nomor versi angka beku terakhir di book_period_snapshots. 0 = belum pernah '
  'ditutup. Naik satu setiap kali ditutup, TIDAK pernah turun saat dibuka.';
COMMENT ON COLUMN book_periods.alasan_buka IS
  'Alasan buka-ulang TERAKHIR, wajib (ck_bp_buka_ulang_lengkap). Riwayat semua '
  'buka-ulang ada di audit_log action=''buka_ulang_tutup_buku''.';

-- ---------------------------------------------------------------------------
-- 2. book_period_snapshots — angka beku, BERVERSI dan IMMUTABLE
-- ---------------------------------------------------------------------------
--
-- Ini inti D-3. Tutup-ulang membekukan angka BARU sebagai versi berikutnya dan
-- TIDAK menyentuh yang lama, sehingga selisih antar versi selalu bisa
-- ditampilkan. Tanpa versi, buka-tutup jadi cara mengubah angka keuangan yang
-- tidak meninggalkan jejak — yaitu persis lubang yang kunci ini tutup.
CREATE TABLE book_period_snapshots (
    periode      date        NOT NULL,
    versi        integer     NOT NULL,
    ditutup_oleh varchar(64) NOT NULL,
    ditutup_pada timestamptz NOT NULL DEFAULT now(),

    -- Siapa yang MENGHITUNG angka ini, dan versi berapa mesinnya. Angka beku
    -- tanpa penyebut mesin tidak bisa diadu dengan hitung ulang: kalau hasilnya
    -- beda, tidak ada yang tahu apakah datanya yang berubah atau rumusnya.
    penghitung   varchar(64) NOT NULL,

    -- Angka bekunya. Bentuknya milik `penghitung`, bukan milik tabel ini.
    angka        jsonb       NOT NULL,

    PRIMARY KEY (periode, versi),
    CONSTRAINT fk_bps_periode FOREIGN KEY (periode) REFERENCES book_periods (periode),
    CONSTRAINT ck_bps_versi CHECK (versi >= 1),
    CONSTRAINT ck_bps_penghitung CHECK (btrim(penghitung) <> ''),
    -- `angka` boleh melaporkan NOL rupiah — bulan tanpa pendapatan itu sah.
    -- Yang tidak sah adalah `angka` yang tidak mengatakan apa-apa: jsonb null,
    -- objek kosong, atau array kosong. Ketiganya membuat "bulan ini nol" dan
    -- "penghitungnya gagal" berbagi satu bentuk (aturan rumah #4).
    CONSTRAINT ck_bps_angka_bicara CHECK (
        jsonb_typeof(angka) = 'object' AND angka <> '{}'::jsonb)
);

CREATE INDEX idx_bps_periode ON book_period_snapshots (periode, versi DESC);

CREATE TRIGGER bps_no_update BEFORE UPDATE ON book_period_snapshots
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER bps_no_delete BEFORE DELETE ON book_period_snapshots
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE book_period_snapshots IS
  'D-3 — angka yang DIBEKUKAN saat bulan ditutup, berversi dan immutable '
  '(tanpa jalur UPDATE/DELETE, seperti audit_log). Buka-ulang tidak menghapus '
  'versi lama; tutup-ulang menambah versi baru, dan selisihnya bisa ditampilkan.';
COMMENT ON COLUMN book_period_snapshots.penghitung IS
  'Nama+versi mesin yang menghasilkan `angka` (mis. cdps.accrual.v1). Wajib: '
  'tanpa ini, selisih antara angka beku dan hitung ulang tidak bisa dijelaskan.';

-- ---------------------------------------------------------------------------
-- 2b. trg_bp_jaga_transisi — syarat yang CHECK tidak bisa mengungkapkan
-- ---------------------------------------------------------------------------
--
-- `sm_transition` hanya menulis kolom `status`. Konsekuensinya menentukan
-- seluruh bentuk penegakan di sini: apa pun yang harus BENAR pada saat sebuah
-- bulan berpindah status harus SUDAH ADA di baris itu sebelum transisinya —
-- jadi trigger ini tidak menuntut sesuatu yang mustahil, ia hanya menolak
-- transisi yang persiapannya belum dilakukan.
--
-- Dua hal yang tidak bisa dinyatakan sebagai CHECK, karena keduanya menengok
-- ke tabel lain dan ke ARAH perpindahan (CHECK tidak melihat OLD):
--
--   MENUTUP  ⇒ angka periode ini benar-benar sudah dibekukan pada versi yang
--              ditunjuk `versi_terakhir`. `versi_terakhir >= 1` saja tidak
--              membuktikan apa pun — angka itu bisa saja tidak pernah ditulis.
--              Dan kalau bulan itu pernah DIBUKA, angkanya harus dibekukan
--              ULANG sesudah dibuka; menunjuk kembali ke versi lama bukan
--              penutupan, itu hanya memasang kembali label yang sama.
--
--   MEMBUKA  ⇒ ada alasan tertulis, DAN alasan itu milik buka-ulang INI.
--              Syarat kedua yang gampang hilang: tanpa itu, sebuah bulan yang
--              pernah dibuka lalu ditutup lagi bisa dibuka untuk KEDUA kalinya
--              memakai alasan lama yang masih menempel di barisnya — jejak
--              yang terlihat sah dan sebenarnya bohong.
CREATE OR REPLACE FUNCTION jaga_transisi_book_period() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_ditutup_pada    timestamptz;
    v_dibekukan_pada  timestamptz;
BEGIN
    IF OLD.status = '[Terbuka]' AND NEW.status = '[Tertutup]' THEN
        SELECT ditutup_pada INTO v_dibekukan_pada
          FROM book_period_snapshots
         WHERE periode = NEW.periode AND versi = NEW.versi_terakhir;

        IF v_dibekukan_pada IS NULL THEN
            RAISE EXCEPTION '[angka bulan % belum dibekukan, buku tidak bisa ditutup]',
                bulan_indonesia(NEW.periode) USING ERRCODE = 'check_violation';
        END IF;

        -- Bulan yang PERNAH dibuka harus dibekukan LAGI sebelum ditutup lagi.
        -- Tanpa syarat ini, tutup-ulang boleh menunjuk kembali ke angka versi
        -- lama — dan konsekuensi ketiga dari ketokan buka-ulang ("tutup-ulang
        -- membekukan angka BARU, dan selisih antar versi harus bisa
        -- ditampilkan") jadi sekadar kebiasaan lapisan TypeScript. Yang
        -- dibandingkan waktunya, bukan nomor versinya: nomor bisa dinaikkan
        -- tanpa menghitung apa pun, sementara `ditutup_pada` yang lebih baru
        -- dari `dibuka_pada` hanya bisa dihasilkan oleh pembekuan yang benar-
        -- benar terjadi SESUDAH bulan itu dibuka.
        IF NEW.dibuka_pada IS NOT NULL AND v_dibekukan_pada <= NEW.dibuka_pada THEN
            RAISE EXCEPTION '[angka bulan % belum dihitung ulang sejak dibuka, buku tidak bisa ditutup lagi]',
                bulan_indonesia(NEW.periode) USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF OLD.status = '[Tertutup]' AND NEW.status = '[Terbuka]' THEN
        IF NEW.dibuka_pada IS NULL OR NEW.dibuka_oleh IS NULL
           OR btrim(coalesce(NEW.alasan_buka, '')) = '' THEN
            RAISE EXCEPTION '[alasan buka-ulang wajib diisi]'
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT ditutup_pada INTO v_ditutup_pada
          FROM book_period_snapshots
         WHERE periode = NEW.periode AND versi = NEW.versi_terakhir;

        IF v_ditutup_pada IS NOT NULL AND NEW.dibuka_pada < v_ditutup_pada THEN
            RAISE EXCEPTION '[alasan buka-ulang ini milik penutupan sebelumnya, isi alasan yang baru]'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Dipasang SESUDAH trg_bp_updated_at menurut abjad nama trigger, dan itu tidak
-- penting: keduanya BEFORE UPDATE dan tidak saling membaca.
CREATE TRIGGER trg_bp_jaga_transisi BEFORE UPDATE ON book_periods
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION jaga_transisi_book_period();

COMMENT ON FUNCTION jaga_transisi_book_period() IS
  'D-3 — syarat transisi book_period yang CHECK tidak bisa menyatakan: menutup '
  'wajib punya angka beku di versi_terakhir; membuka wajib punya alasan, dan '
  'alasan itu harus lebih baru dari penutupan yang dibatalkannya.';

-- ---------------------------------------------------------------------------
-- 3. Mesin book_period — 31 mesin jadi 32, DUA gerbang yang berbeda
-- ---------------------------------------------------------------------------
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('book_period', '[Terbuka]', '[transisi status tidak diizinkan]', false, '{}');

-- Sengaja TIDAK ada baris di sm_terminal_states: `[Tertutup]` BUKAN state
-- terminal, karena Director boleh membukanya lagi (ketokan 2026-09-08).
-- Mesin ini memang berputar antara dua state, dan itu disebut di sini supaya
-- ketiadaannya terbaca sebagai keputusan, bukan sebagai yang terlupa.

INSERT INTO sm_edges (machine, from_state, to_state, require_lead, require_director, require_division) VALUES
    -- MENUTUP: Finance level lead ATAU Director.
    ('book_period', '[Terbuka]',  '[Tertutup]', true,  false, 'Finance'),
    -- MEMBUKA KEMBALI: Director SAJA. Finance lead yang menutup tidak bisa
    -- membatalkan tutupannya sendiri.
    ('book_period', '[Tertutup]', '[Terbuka]',  false, true,  NULL);

-- ---------------------------------------------------------------------------
-- 4. Bacaan status bulan — satu sumber untuk TS, RLS, dan trigger
-- ---------------------------------------------------------------------------
--
-- STABLE, bukan IMMUTABLE: jawabannya berubah saat bulan ditutup/dibuka.
-- Bulan yang belum punya baris TERBUKA — belum pernah ditutup adalah keadaan
-- normal, bukan kesalahan, dan mayoritas bulan tidak akan pernah punya baris
-- sampai ada yang menutupnya.
CREATE OR REPLACE FUNCTION periode_tertutup(p_tanggal date) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM book_periods
         WHERE periode = date_trunc('month', p_tanggal)::date
           AND status = '[Tertutup]');
$$;

COMMENT ON FUNCTION periode_tertutup(date) IS
  'D-3 — apakah bulan yang memuat p_tanggal sudah ditutup. Satu sumber untuk '
  'trigger pagar, RLS, dan pembacaan TypeScript.';

-- ---------------------------------------------------------------------------
-- 5. RLS — bulan tertutup dibaca semua yang boleh baca keuangan
-- ---------------------------------------------------------------------------
ALTER TABLE public.book_periods            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_period_snapshots   ENABLE ROW LEVEL SECURITY;

-- Baca: siapa pun yang sudah boleh membaca lintas divisi (OD/Director) atau
-- lead. Angka bulan tertutup adalah fakta perusahaan, bukan data per-klien;
-- yang dijaga ketat adalah siapa yang boleh MENULIS, dan itu ada di gerbang
-- edge — bukan di sini.
CREATE POLICY book_periods_select ON public.book_periods FOR SELECT TO authenticated
    USING (jwt_can_read_all() OR jwt_is_lead());
CREATE POLICY book_period_snapshots_select ON public.book_period_snapshots FOR SELECT TO authenticated
    USING (jwt_can_read_all() OR jwt_is_lead());
