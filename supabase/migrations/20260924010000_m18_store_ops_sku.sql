-- ============================================================================
-- M18 — Store Operation: baris SKU (`SKU-`), unit kerja divisi.
--
-- PRD: `docs/prd/CDPS_Module18_Store_Ops.md`. Ketokan pemilik 2026-09-07 (K-4
-- "bangun modulnya", K-5 "1 Brief → banyak baris SKU", K-6 "CTR/CVR terpisah
-- dari selesai") dan 2026-09-08 ("daftar jenis SKU yang dioptimasi diisi oleh
-- AM, beserta targetnya; Store Ops menjalankan dan mengevaluasi").
--
-- Sampai hari ini Store Operation adalah SATU baris registry divisi dan tidak
-- punya satu pun tempat untuk mencatat pekerjaannya: satu Brief "optimasi 7 SKU"
-- hanya bisa dinyatakan sebagai satu baris atom yang selesai atau belum.
--
-- ## KENAPA GATE NAIK TIGA DARI EMPAT
--
--   tabel public   146 → 147   `store_ops_skus`
--   entity_prefix   40 →  41   `SKU`
--   sm_machines     31 →  32   `store_ops_sku` (mesin #32)
--   notif_events    73 →  73   TETAP — event Store Ops didaftarkan BERSAMA
--                              emitternya, bukan sebelumnya (preseden v9
--                              `internal_tasks`). Brief-nya sudah ikut
--                              `BriefSiapReviewAm`/`BriefSelesai` (B-1).
--
-- Angka-angka itu ABSOLUT, bukan delta, dan dinaikkan di `scripts/db-rebuild.sh`
-- DAN `.github/workflows/ci.yml` di commit yang sama dengan berkas ini —
-- menaikkan salah satunya saja memberi suite hijau palsu.
--
-- ## APA YANG SENGAJA TIDAK ADA DI SINI
--
-- Nol kolom `actual_done`, nol kolom durasi, nol kolom "pernah gagal". Semuanya
-- diturunkan dari `audit_log` saat baca (aturan rumah #3/#4, PRD §5). Kolom yang
-- diketik bisa dimundurkan setelah tenggat lewat; stempel transisi tidak bisa.
-- Preseden yang sama sudah diambil dua kali: M16 Rule 4 ("durasi tidak pernah
-- disimpan") dan `internal_tasks` ("NOL kolom keterlambatan").
--
-- Pipeline tahapan `STORE_OPS` (LT-2) TIDAK di-seed di sini — ia migrasi
-- tersendiri di PR berikutnya, persis seperti yang dijanjikan komentar di
-- `20260830020000_m16_stage_seed.sql`: satu migrasi, nol perubahan TS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prefix registry (M6A §7) — dual-home dengan `PREFIXES` di
--    `packages/core/src/ident.ts`, dijaga `packages/db/src/ident.registry.test.ts`.
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('SKU', 'Baris SKU Store Operation', 'M18');

-- ---------------------------------------------------------------------------
-- 2. Mesin #32 `store_ops_sku` (STATE_MACHINES.md §22).
--
--    [Menunggu Eksekusi] ─► [Dikerjakan] ─► [Terupload] ─► [Dievaluasi]
--                                │  ▲
--                                ▼  │
--                           [Gagal Upload]
--
--    `[Terupload]` = SELESAI PRODUKSI (K-6) dan sengaja BUKAN terminal.
--    `[Dievaluasi]` adalah langkah review ±30 hari kemudian yang mengisi angka
--    dampak. Menggabungkan keduanya berarti leadtime produksi Store Ops ternoda
--    waktu tunggu pasar, dan angka yang mengukur dua hal sekaligus tidak
--    mengukur apa pun.
--
--    `[Gagal Upload]` adalah STATE, bukan flag boolean, karena worksheet divisi
--    menghitung "% SKU Gagal Upload" sebagai metrik: sebuah flag bisa ditulis
--    ulang oleh orang yang sedang dinilai, sebuah state meninggalkan baris
--    `audit_log` yang tidak punya jalur UPDATE/DELETE. Mode gagal yang sama
--    dengan alasan `internal_tasks` menolak kolom `pernah_terlambat`.
--
--    Kembalinya `[Gagal Upload] → [Dikerjakan]` terjadi pada baris yang SAMA,
--    bukan sebagai `SKU-` baru — baris baru akan menyembunyikan kegagalan
--    pertama dari penyebut metriknya sendiri.
--
--    Nol edge ber-`require_lead`: keempat transisi adalah pekerjaan PIC atas
--    barisnya sendiri (pola `creator_booking`). Gerbang "siapa boleh menyentuh
--    baris ini" dipikul RLS + gerbang domain, bukan flag lead pada edge.
-- ---------------------------------------------------------------------------
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('store_ops_sku', '[Menunggu Eksekusi]', false, '{}');
INSERT INTO sm_terminal_states (machine, state) VALUES
    ('store_ops_sku', '[Dievaluasi]');
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('store_ops_sku', '[Menunggu Eksekusi]', '[Dikerjakan]',   false),
    ('store_ops_sku', '[Dikerjakan]',        '[Terupload]',    false),
    ('store_ops_sku', '[Dikerjakan]',        '[Gagal Upload]', false),
    ('store_ops_sku', '[Gagal Upload]',      '[Dikerjakan]',   false),
    ('store_ops_sku', '[Terupload]',         '[Dievaluasi]',   false);

-- ---------------------------------------------------------------------------
-- 3. Tabel `store_ops_skus` — anak `briefs`, satu baris per SKU (K-5).
--
--    Kolomnya DUA KELOMPOK yang sengaja dipisah dan diberi dinding (§5 di bawah):
--    cakupan + target ditulis AM saat baris lahir; hasil + dampak ditulis Store
--    Operation saat eksekusi lalu saat evaluasi. Dua penulis pada satu baris
--    tanpa dinding adalah cara termudah target berubah sesudah hasilnya keluar.
-- ---------------------------------------------------------------------------
CREATE TABLE store_ops_skus (
    id                varchar(32)   NOT NULL PRIMARY KEY,   -- SKU-YYYYMM-NNNN

    brief_id          varchar(32)   NOT NULL,               -- induk: Brief divisi Store Operation

    -- === KELOMPOK 1 — CAKUPAN + TARGET. Penulis: AM. Read-only bagi Store Ops. ===
    nama_produk       varchar(191)  NOT NULL,
    link_sku          text          NULL,
    request_type      varchar(32)   NOT NULL,               -- enum §3.3, dual-home core/storeops.ts
    jenis_gambar      varchar(32)   NOT NULL,               -- enum §3.4, dual-home core/storeops.ts
    total_req_picture integer       NOT NULL,               -- > 0
    expected_done     date          NULL,                   -- NULL ⇒ leadtime '—', TIDAK pernah di-default
    target_ctr        numeric(7,4)  NULL,                   -- persen; janji ke klien
    target_cvr        numeric(7,4)  NULL,                   -- persen
    target_rating     numeric(3,2)  NULL,                   -- 0..5
    catatan_am        text          NULL,

    -- === KELOMPOK 2 — HASIL + DAMPAK. Penulis: Store Operation. Read-only bagi AM. ===
    assigned_pic      varchar(64)   NULL,                   -- diisi LEADER divisi (K-1: siapa = leader)
    link_output       text          NULL,                   -- wajib saat [Terupload] (gerbang domain)
    catatan_ops       text          NULL,                   -- wajib saat [Gagal Upload]
    ctr_sebelum       numeric(7,4)  NULL,                   -- rata-rata 30 hari SEBELUM upload
    cvr_sebelum       numeric(7,4)  NULL,
    rating_sebelum    numeric(3,2)  NULL,
    ctr_sesudah       numeric(7,4)  NULL,                   -- rata-rata 30 hari SESUDAH upload
    cvr_sesudah       numeric(7,4)  NULL,
    rating_sesudah    numeric(3,2)  NULL,

    status            varchar(48)   NOT NULL DEFAULT '[Menunggu Eksekusi]',

    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,

    CONSTRAINT fk_sku_brief FOREIGN KEY (brief_id) REFERENCES briefs (id),
    CONSTRAINT ck_sku_request_type CHECK (request_type IN (
        'Shopee New', 'Shopee Revision', 'Shopee Additional',
        'Tiktok New', 'Tiktok Revision', 'Tiktok Additional',
        'CPAS New')),
    CONSTRAINT ck_sku_jenis_gambar CHECK (jenis_gambar IN (
        'Cover Only', 'Cover + Pendamping', 'Varian + Pendamping', 'Iklan CPAS')),
    CONSTRAINT ck_sku_total_req_picture CHECK (total_req_picture > 0),
    CONSTRAINT ck_sku_rating_sebelum CHECK (rating_sebelum IS NULL OR rating_sebelum BETWEEN 0 AND 5),
    CONSTRAINT ck_sku_rating_sesudah CHECK (rating_sesudah IS NULL OR rating_sesudah BETWEEN 0 AND 5),
    CONSTRAINT ck_sku_target_rating  CHECK (target_rating  IS NULL OR target_rating  BETWEEN 0 AND 5),
    CONSTRAINT ck_sku_persen_non_negatif CHECK (
        coalesce(target_ctr, 0) >= 0 AND coalesce(target_cvr, 0) >= 0
    AND coalesce(ctr_sebelum, 0) >= 0 AND coalesce(cvr_sebelum, 0) >= 0
    AND coalesce(ctr_sesudah, 0) >= 0 AND coalesce(cvr_sesudah, 0) >= 0)
);

CREATE INDEX idx_sku_brief_status ON store_ops_skus (brief_id, status);
CREATE INDEX idx_sku_pic ON store_ops_skus (assigned_pic);

CREATE TRIGGER trg_store_ops_skus_updated_at BEFORE UPDATE ON store_ops_skus
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE store_ops_skus IS
  'M18 — unit kerja Store Operation: satu baris per SKU di bawah satu Brief (K-5, '
  'pola AST-/ADC-/BKG-/LSS-). DUA penulis: AM menulis cakupan+target saat lahir, '
  'Store Operation menulis hasil saat eksekusi lalu dampak saat evaluasi. '
  'Dindingnya trg_store_ops_skus_dinding_penulis. Mesin #32 store_ops_sku.';

COMMENT ON COLUMN store_ops_skus.expected_done IS
  'M18 §3.1 — tenggat yang dijanjikan. NULL ⇒ leadtime dirender ''—'', TIDAK '
  'pernah di-default diam-diam (konsisten M16 Rule 8). Pasangannya `actual_done` '
  'sengaja TIDAK ADA sebagai kolom: ia stempel transisi pertama ke [Terupload] '
  'di audit_log (PRD §5) — tanggal yang diketik bisa dimundurkan, stempel tidak.';

-- ---------------------------------------------------------------------------
-- 4. Dinding dua penulis (PRD §6) — INI bagian yang menjawab ketokan.
--
-- ## KENAPA BUKAN RLS, DAN KENAPA BUKAN `jwt_division()`
--
-- Jalur TULIS CDPS berjalan privileged: `withClaims` (packages/db/src/client.ts)
-- hanya dipakai jalur BACA, jadi setiap tulisan domain datang tanpa klaim JWT
-- dan dengan role yang BYPASSRLS. Sebuah policy RLS tidak pernah dievaluasi
-- untuknya, dan sebuah trigger yang memanggil `jwt_division()` akan melihat NULL
-- pada SETIAP tulisan sungguhan — dinding yang selalu terbuka, yang lebih buruk
-- daripada nol dinding karena ia terlihat seperti perlindungan.
--
-- Yang dipakai: penanda sisi penulis TRANSACTION-LOCAL (`set_config(..., true)`,
-- jadi ia hilang saat COMMIT/ROLLBACK dan tidak pernah bocor ke sesi berikutnya
-- di pooler mode-transaksi — kekhawatiran yang sama yang membuat `withClaims`
-- memakai SET LOCAL). Domain wajib mendeklarasikan sisinya sebelum menulis;
-- UPDATE tanpa penanda ditolak SELURUHNYA, termasuk dari service role.
--
-- ## SATU PENGECUALIAN, SEMPIT DAN DISENGAJA
--
-- UPDATE yang hanya menyentuh `status` (dan `updated_at`) lolos tanpa penanda:
-- itu pintu `sm_transition`, satu-satunya penulis sah kolom status (aturan rumah
-- #2), yang sudah punya gerbangnya sendiri — row lock, validasi edge, gate role,
-- baris audit. Sebaliknya, UPDATE yang mengubah status BERSAMAAN dengan kolom
-- data ditolak: itu bentuk tulisan yang `sm_transition` tidak pernah hasilkan,
-- jadi ia pasti datang dari jalur lain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION store_ops_sku_dinding_penulis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_writer         text := coalesce(nullif(current_setting('cdps.sku_writer', true), ''), '');
    v_status_berubah boolean := NEW.status IS DISTINCT FROM OLD.status;
    v_data_berubah   boolean := (to_jsonb(NEW) - 'status' - 'updated_at')
                             IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at');
    v_kel1_berubah   boolean;
    v_kel2_berubah   boolean;
BEGIN
    -- Pintu sm_transition: status saja, tidak pernah bersama kolom data.
    IF v_status_berubah AND v_data_berubah THEN
        RAISE EXCEPTION '[status baris SKU hanya boleh diubah lewat mesin transisi]';
    END IF;
    IF v_status_berubah OR NOT v_data_berubah THEN
        RETURN NEW;
    END IF;

    -- Mulai sini: UPDATE kolom data. Sisi penulis WAJIB dideklarasikan.
    IF v_writer NOT IN ('am', 'ops') THEN
        RAISE EXCEPTION '[baris SKU hanya boleh diubah lewat jalur AM atau Store Operation]';
    END IF;

    v_kel1_berubah :=
           NEW.nama_produk       IS DISTINCT FROM OLD.nama_produk
        OR NEW.link_sku          IS DISTINCT FROM OLD.link_sku
        OR NEW.request_type      IS DISTINCT FROM OLD.request_type
        OR NEW.jenis_gambar      IS DISTINCT FROM OLD.jenis_gambar
        OR NEW.total_req_picture IS DISTINCT FROM OLD.total_req_picture
        OR NEW.expected_done     IS DISTINCT FROM OLD.expected_done
        OR NEW.target_ctr        IS DISTINCT FROM OLD.target_ctr
        OR NEW.target_cvr        IS DISTINCT FROM OLD.target_cvr
        OR NEW.target_rating     IS DISTINCT FROM OLD.target_rating
        OR NEW.catatan_am        IS DISTINCT FROM OLD.catatan_am;

    v_kel2_berubah :=
           NEW.assigned_pic   IS DISTINCT FROM OLD.assigned_pic
        OR NEW.link_output    IS DISTINCT FROM OLD.link_output
        OR NEW.catatan_ops    IS DISTINCT FROM OLD.catatan_ops
        OR NEW.ctr_sebelum    IS DISTINCT FROM OLD.ctr_sebelum
        OR NEW.cvr_sebelum    IS DISTINCT FROM OLD.cvr_sebelum
        OR NEW.rating_sebelum IS DISTINCT FROM OLD.rating_sebelum
        OR NEW.ctr_sesudah    IS DISTINCT FROM OLD.ctr_sesudah
        OR NEW.cvr_sesudah    IS DISTINCT FROM OLD.cvr_sesudah
        OR NEW.rating_sesudah IS DISTINCT FROM OLD.rating_sesudah;

    IF v_writer = 'ops' AND v_kel1_berubah THEN
        RAISE EXCEPTION '[kolom cakupan dan target SKU hanya boleh diisi Account Manager]';
    END IF;
    IF v_writer = 'am' AND v_kel2_berubah THEN
        RAISE EXCEPTION '[kolom hasil dan dampak SKU hanya boleh diisi Store Operation]';
    END IF;

    -- Inti ketokan: target adalah janji ke klien, dan janji tidak boleh berubah
    -- setelah hasilnya keluar. Begitu Store Operation mulai mengerjakan, seluruh
    -- Kelompok 1 beku. Salah cakupan ⇒ baris SKU baru, jejaknya utuh.
    IF v_writer = 'am' AND OLD.status <> '[Menunggu Eksekusi]' THEN
        RAISE EXCEPTION '[cakupan dan target SKU tidak dapat diubah setelah Store Operation mulai mengerjakan]';
    END IF;

    -- Kolom yang tidak masuk kelompok mana pun (id, brief_id, created_*) tidak
    -- punya penulis sah sama sekali: mengubahnya berarti memindahkan pekerjaan
    -- ke Brief lain atau mengarang penciptanya.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.brief_id IS DISTINCT FROM OLD.brief_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION '[identitas baris SKU tidak dapat diubah]';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_store_ops_skus_dinding_penulis BEFORE UPDATE ON store_ops_skus
    FOR EACH ROW EXECUTE FUNCTION store_ops_sku_dinding_penulis();

COMMENT ON FUNCTION store_ops_sku_dinding_penulis() IS
  'M18 §6 — dinding dua penulis pada satu baris SKU. Penanda sisi penulis dibaca '
  'dari GUC transaction-local `cdps.sku_writer` (''am''|''ops'') karena jalur '
  'tulis CDPS berjalan privileged tanpa klaim JWT: sebuah trigger ber-jwt_division() '
  'akan melihat NULL pada setiap tulisan sungguhan. UPDATE tanpa penanda ditolak; '
  'pengecualiannya hanya UPDATE status-saja, yaitu pintu sm_transition.';

-- ---------------------------------------------------------------------------
-- 5. RLS. Tabel lahir SETELAH `20260723064438_rls_baseline`, jadi loop grant di
--    sana tidak menyentuhnya — GRANT SELECT eksplisit WAJIB. Tanpa itu
--    `readAsActor` ditolak *permission denied* sebelum policy sempat
--    dievaluasi, dan tes domain (koneksi service-role) buta terhadapnya. Cacat
--    itu sudah pernah terjadi sungguhan pada `client_milestones`.
--
--    Cakupan bacanya cermin PRD §9, meniru `assets_select`:
--      OD/Director · PIC baris ini · pembuatnya · lead Store Ops se-Brief ·
--      AM pemilik Brief · lead Account.
--    Divisi lain: TIDAK. Perhatikan yang SENGAJA TIDAK ADA — lengan
--    "se-divisi tanpa lead" seperti `briefs_select` punya: staff Store
--    Operation melihat barisnya SENDIRI (PRD §9), pembagian barisnya urusan
--    leader (K-1).
--
--    Semua lengan yang menembus `briefs` lewat pintu `private.*` SECURITY
--    DEFINER (O52 opsi (b)) — join langsung ke `briefs` akan dipersempit
--    `briefs_select` dan MEMBUANG baris, bukan mengosongkan kolom.
--
--    Policy ini punya lengan `jwt_is_lead()`/`jwt_division()`, jadi ia TIDAK
--    masuk daftar `expected` ledger O48 (`supabase/tests/rls_checks.sql` §43).
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.store_ops_skus FROM anon;
REVOKE ALL ON public.store_ops_skus FROM authenticated;
GRANT SELECT ON public.store_ops_skus TO authenticated;
ALTER TABLE public.store_ops_skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_ops_skus_select ON public.store_ops_skus FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = assigned_pic
       OR jwt_employee_id() = created_by
       OR (jwt_is_lead() AND private.jwt_division_owns_brief(brief_id))
       OR jwt_employee_id() = private.brief_owner_am(brief_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- ---------------------------------------------------------------------------
-- 6. `private.brief_jumlah_anak` — CABANG Store Operation, bukan fungsi kedua.
--
--    Fungsinya sudah ber-CASE per divisi dengan `ELSE 0` (A-req-3), dan Store
--    Operation hari ini jatuh ke `ELSE` karena tabel anaknya belum ada. Sekarang
--    ada. Dua fungsi yang menjawab "berapa anaknya" adalah dua jawaban yang
--    menunggu berbeda, jadi yang ditambahkan adalah satu cabang di sini.
--
--    Alasan fungsinya SECURITY DEFINER tidak berubah dan berlaku persis sama
--    untuk cabang baru ini: `briefCols` dibaca di bawah RLS, dan
--    `store_ops_skus_select` punya lengan `jwt_employee_id() = assigned_pic` —
--    sebuah `count(*)` biasa akan membuat staff Store Operation melihat "1"
--    untuk Brief berisi 7 SKU, tanpa galat, dengan halaman menjawab 200.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.brief_jumlah_anak(p_brief_id text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT CASE b.assigned_division
           WHEN 'Creative' THEN
             (SELECT count(*) FROM public.assets a WHERE a.brief_id = b.id)
           WHEN 'Ads' THEN
             (SELECT count(*) FROM public.ad_campaigns c WHERE c.brief_id = b.id)
           WHEN 'KOL' THEN
             (SELECT count(*) FROM public.creator_bookings k WHERE k.brief_id = b.id)
           WHEN 'Live Stream' THEN
             (SELECT count(*) FROM public.live_stream_sessions l WHERE l.brief_id = b.id)
           WHEN 'Store Operation' THEN
             (SELECT count(*) FROM public.store_ops_skus s WHERE s.brief_id = b.id)
           ELSE 0
         END::integer
    FROM public.briefs b
   WHERE b.id = p_brief_id
$$;

COMMENT ON FUNCTION private.brief_jumlah_anak(text) IS
  'A-req-3 + M18 — jumlah unit kerja anak sebuah Brief (Asset / Campaign / '
  'Booking / Sesi Live / baris SKU Store Operation), lewat pintu SECURITY '
  'DEFINER. Ada karena `briefCols` dibaca di bawah RLS: subquery count(*) '
  'langsung akan dipersempit policy pembacanya dan seorang staff melihat angka '
  'yang SALAH tanpa galat apa pun. Divisi tanpa tabel anak mengembalikan 0, '
  'bukan NULL.';

-- Permukaan EXECUTE ditegakkan ULANG di sini, bukan diwariskan.
--
-- `CREATE OR REPLACE` memang MEMPERTAHANKAN grant fungsi yang sudah ada — dan
-- itulah asumsi yang dipakai saat blok ini semula dihilangkan. Asumsi itu hanya
-- benar kalau `20260922100500` sudah lebih dulu mendarat. Pada 2026-09-08
-- ternyata migrasi itu BELUM di-apply ke live: kalau berkas ini yang jalan
-- duluan, fungsinya LAHIR BARU — dan fungsi baru di Postgres lahir dengan
-- EXECUTE untuk PUBLIC, bukan dengan daftar eksplisit. Untuk sebuah fungsi
-- SECURITY DEFINER itu bukan detail: `rls_checks` §44 memeriksa permukaan
-- EXECUTE-nya, dan yang menahan `anon` cuma USAGE schema `private` — satu
-- lapis, bukan dua.
--
-- Mengulang empat baris ini membuat berkasnya berdiri sendiri: urutan apply
-- tetap wajib urut nama, tapi kalau suatu saat tidak, hasilnya tetap benar.
REVOKE EXECUTE ON FUNCTION private.brief_jumlah_anak(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_jumlah_anak(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_jumlah_anak(text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.brief_jumlah_anak(text) TO service_role;
  END IF;
END $$;
