-- ===========================================================================
-- Adopsi Sistem — `page_views`: satu-satunya sumber "siapa memakai CDPS,
-- berapa lama"
-- ===========================================================================
--
-- Permintaan pemilik 2026-09-10 (Bagian 1, verbatim): *"Dari log page-view,
-- sesi = aktivitas beruntun, gap > 30 menit memulai sesi baru. Kolom: Bulan ·
-- Anggota · Role · Jam/Bulan · Sesi · Page View. Plus baris persentase
-- penggunaan fitur untuk role-nya."* Ditegaskan pemilik: **"Indikator adaptasi
-- tim ke sistem baru — bukan komponen reward."**
--
-- ── Yang harus dinyatakan lebih dulu: TIDAK ADA DATA HISTORIS ─────────────
--
-- Sampai migrasi ini, CDPS punya **nol telemetri**: tidak ada tabel page-view,
-- tidak ada SDK analytics, tidak ada middleware di `apps/api`. Diperiksa
-- sebelum ditulis, bukan diasumsikan.
--
-- Konsekuensinya harus dibaca sekarang, bukan ditemukan nanti: **baris pertama
-- lahir dari tanggal deploy.** Contoh `2026-08` pada permintaan pemilik TIDAK
-- bisa direproduksi surut, dan tidak ada cara jujur untuk membuatnya ada.
-- Layarnya menyatakan ini sendiri; tidak ada angka yang dikarang untuk
-- menutupi lubangnya.
--
-- ── Kenapa `nav_href` DAN `nav_total` disimpan per baris ──────────────────
--
-- "Persentase penggunaan fitur untuk role-nya" (ketokan pemilik #3: **cakupan
-- fitur role** — % menu yang boleh diakses role itu yang benar-benar pernah
-- dibuka bulan itu) butuh DUA angka: berapa menu yang dibuka, dan berapa menu
-- yang BOLEH dibuka.
--
-- Yang kedua hanya diketahui satu tempat di seluruh sistem: `visibleNav(role)`
-- di `web-internal/src/lib/nav.ts`. Gerbang-gerbangnya adalah FUNGSI
-- (`ownedBy(...)`, `divisionQueue(...)`, `canUseSkuScreener`), bukan data —
-- menyalinnya ke tabel di sini akan menciptakan versi kedua dari aturan
-- visibilitas menu, dan versi kedua itu akan menyimpang. (Justru kelas cacat
-- yang sama dengan yang dilarang kepala `CLAUDE.md` untuk `archive/backend-go`.)
--
-- Jadi **pengirimnya yang melaporkan keduanya**: `nav_href` (entri menu yang
-- cocok dengan rute ini, NULL untuk halaman yang memang bukan entri menu) dan
-- `nav_total` (berapa entri menu yang terlihat oleh peran itu SAAT ITU).
--
-- Menyimpan `nav_total` per baris terlihat berlebihan sampai seseorang bertanya
-- "berapa cakupan Agustus?" setelah kita merilis sepuluh menu baru di September.
-- Permukaan fitur BERUBAH; menghitung cakupan Agustus dengan penyebut hari ini
-- akan membuat angka masa lalu bergerak setiap kali kita merilis apa pun.
-- Dengan penyebut ikut tercatat, angka bulan tertutup **tetap** — aturan rumah
-- #4 ("selalu bisa dihitung ulang dari log") dibaca apa adanya.
--
-- ── Kenapa tidak ada prefix `PV-` ─────────────────────────────────────────
--
-- `docs/DATA_MODEL.md` mendaftarkan prefix untuk entitas yang dirujuk MANUSIA.
-- Sebuah page-view tidak pernah dirujuk, disebut, atau ditautkan oleh siapa
-- pun — ia hanya diagregasi. `bigint identity` sudah cukup, dan itu pola yang
-- sama dengan `strategi_share_access_log` (`20260809010000`), preseden terdekat
-- "seseorang membuka X" di repo ini. Gate prefix TIDAK bergerak.
--
-- ── Append-only, dan terkunci penuh dari `authenticated` ──────────────────
--
-- Aturan rumah #3: nol jalur UPDATE/DELETE. Sebuah log pemakaian yang bisa
-- diedit tidak lagi mengukur apa pun.
--
-- RLS-nya dikunci PENUH (nol grant untuk `anon` maupun `authenticated`, nol
-- policy) — pola O51, sama dengan `strategi_share_token`. Alasannya bukan
-- kerahasiaan skema melainkan bentuk aksesnya: penulisan datang lewat rute
-- `POST /adopsi/page-view` yang memakai jalur tulis service-role, dan
-- pembacaan lewat `adopsi.*` yang menegakkan gerbangnya sendiri. Nol pihak
-- menyentuh tabel ini sebagai `authenticated` langsung, jadi membuka grant
-- apa pun di sini hanya memperluas permukaan tanpa ada yang memakainya.
--
-- Dan ada alasan kedua yang lebih penting: baris ini adalah **jejak pemakaian
-- per-orang**. Pemilik sendiri yang menyatakan ini bukan komponen reward.
-- Tabel yang terbuka untuk `authenticated` akan membuat setiap karyawan bisa
-- membaca jam pemakaian rekannya lewat PostgREST, dan itu bukan sistem yang
-- diminta siapa pun.
--
-- Gate: tabel 155 → **156**. Nol prefix, nol mesin, nol event.
-- ===========================================================================

CREATE TABLE page_views (
    id          bigint       GENERATED ALWAYS AS IDENTITY,

    employee_id varchar(64)  NOT NULL,
    -- Rute yang dibuka, apa adanya (`/sales/kinerja`). Query string DIBUANG
    -- pengirimnya: ia bisa memuat isi filter — nama klien, ID karyawan — dan
    -- log adopsi tidak butuh satu pun dari itu untuk menjawab pertanyaannya.
    path        varchar(255) NOT NULL,
    -- Entri menu yang cocok dengan rute ini, atau NULL kalau rutenya memang
    -- bukan entri menu (halaman detail, rute dalam). NULL berarti "bukan
    -- fitur menu", BUKAN "tidak diketahui".
    nav_href    varchar(255) NULL,
    -- Berapa entri menu yang terlihat oleh peran pengirim SAAT ITU — penyebut
    -- cakupan fitur, dibekukan bersama barisnya (lihat kepala berkas).
    nav_total   integer      NOT NULL,

    occurred_at timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_page_views PRIMARY KEY (id),
    CONSTRAINT ck_page_views_nav_total CHECK (nav_total >= 0)
);

-- Kueri laporannya SELALU (karyawan, rentang waktu) lalu diurut waktu —
-- sesionisasi butuh baris berurutan per orang.
CREATE INDEX ix_page_views_emp_at ON page_views (employee_id, occurred_at);
-- Dan bentuk kedua: "bulan ini, semua orang" untuk baris roster.
CREATE INDEX ix_page_views_at ON page_views (occurred_at);

-- Aturan rumah #3 — riwayat immutable.
DROP TRIGGER IF EXISTS trg_page_views_no_update ON page_views;
CREATE TRIGGER trg_page_views_no_update
    BEFORE UPDATE ON page_views
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS trg_page_views_no_delete ON page_views;
CREATE TRIGGER trg_page_views_no_delete
    BEFORE DELETE ON page_views
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

REVOKE ALL ON public.page_views FROM anon;
REVOKE ALL ON public.page_views FROM authenticated;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE page_views IS
  'Adopsi Sistem (pemilik 2026-09-10) — satu baris per pembukaan halaman di '
  'web-internal. Append-only (forbid_mutation), terkunci penuh dari anon & '
  'authenticated (pola O51): ditulis lewat jalur service-role, dibaca lewat '
  'adopsi.* yang menegakkan gerbangnya. TIDAK ADA DATA SEBELUM TANGGAL DEPLOY '
  '— repo ini nol telemetri sampai migrasi ini, dan tidak ada cara jujur '
  'membuat bulan lampau ada.';
COMMENT ON COLUMN page_views.nav_href IS
  'Entri menu yang cocok dengan `path`, diresolusi PENGIRIM lewat nav.ts '
  '(satu-satunya tempat gerbang menu hidup). NULL = rutenya memang bukan entri '
  'menu, bukan "tidak diketahui".';
COMMENT ON COLUMN page_views.nav_total IS
  'Berapa entri menu yang terlihat peran pengirim saat baris ini lahir — '
  'PENYEBUT cakupan fitur, dibekukan bersama barisnya supaya angka bulan '
  'tertutup tidak bergerak setiap kali menu baru dirilis.';
