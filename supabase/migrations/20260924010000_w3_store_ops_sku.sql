-- ===========================================================================
-- CDPS — Wave 3, modul Store Operation. Unit kerja per SKU (`SKU-`).
--
-- Menutup keluhan divisi Store Ops (K-4/K-5/K-6, `docs/DECISIONS.md` 2026-09-07)
-- dan ketokan pemilik (Nerissa/COO) 2026-09-08:
--
--   > "Daftar jenis SKU yang dioptimasi diisi oleh AM, beserta targetnya.
--   >  Store Ops menjalankan dan mengevaluasi."
--
-- PRD: `docs/prd/CDPS_Module18_Store_Ops.md`. Baca dulu — di sanalah alasan
-- setiap kolom di bawah ditulis sebagai Rule, bukan sebagai catatan.
--
-- ---------------------------------------------------------------------------
-- SATU BARIS, TIGA MOMEN, DUA PENULIS
-- ---------------------------------------------------------------------------
--   1. LAHIR    — AM: SKU mana, jenis optimasinya, dan TARGET-nya.
--   2. EKSEKUSI — Store Ops: hasil kerja. SELESAI saat gambar ter-upload (K-6).
--   3. EVALUASI — Store Ops: CTR/CVR (+rating) sesudah ±30 hari. Langkah
--                 TERPISAH, sesudah momen 2.
--
-- K-6 adalah alasan momen 2 dan 3 tidak boleh menyatu. Kalau "selesai" menunggu
-- angka dampak, leadtime PRODUKSI Store Ops ternoda waktu tunggu pasar, dan
-- angka yang mengukur dua hal sekaligus tidak mengukur apa pun. Itu ditegakkan
-- di sini oleh `ck_sku_terupload` (yang TIDAK menyebut satu pun kolom dampak)
-- berpasangan dengan `ck_sku_dievaluasi` (yang mewajibkannya, satu state
-- kemudian).
--
-- ---------------------------------------------------------------------------
-- KENAPA DINDINGNYA BERSYARAT-STATE, BUKAN BERSYARAT-AKTOR
-- ---------------------------------------------------------------------------
-- Ketokan §2 menuntut "kolom target read-only bagi Store Ops; kolom hasil
-- read-only bagi AM — ditegakkan di DB, bukan cuma TS", dan menunjuk preseden
-- `trg_strategi_target_guard_floor` (O57 (b)).
--
-- Preseden itu **bersyarat-state** (`IF OLD.sumber_floor = 'disetujui_head'`),
-- dan itu bukan kebetulan. Trigger yang bertanya "siapa yang menulis ini?"
-- hanya punya satu sumber jawaban di CDPS: klaim JWT (`jwt_employee_id()`,
-- `jwt_division()`) — dan SETIAP tulisan domain masuk lewat koneksi service-role
-- yang NOL klaim. Trigger bersyarat-aktor karena itu akan diam untuk persis
-- jalur yang ia klaim jaga: ia teater, bukan dinding. Dinding bersyarat-state di
-- bawah berlaku untuk SEMUA koneksi, service-role termasuk.
--
-- Pembagian peran yang sesungguhnya karena itu dipikul BERTINGKAT, dan ketiganya
-- ada — bukan satu menggantikan yang lain:
--   (a) gerbang peran + pesan `[...]` BI ada di `packages/domain` (Wave 3 PR 2);
--   (b) RLS di bawah membatasi SIAPA yang barisnya kelihatan sama sekali;
--   (c) trigger `sku_optimizations_dinding()` di bawah membekukan KOLOM MANA
--       yang masih boleh bergerak pada state mana — dan inilah satu-satunya
--       lapisan yang tidak bisa dilewati siapa pun.
--
-- Mode gagal yang (c) tutup adalah mode gagal yang ketokan §2 sebut sendiri:
-- **target berubah SESUDAH hasilnya keluar.** Begitu baris meninggalkan
-- `[Belum Dikerjakan]`, target beku selamanya — tidak ada urutan langkah apa pun
-- yang bisa membuat "% Achievement" dihitung terhadap angka yang digeser
-- belakangan.
--
-- Arah sebaliknya dijaga simetris: kolom hasil/dampak tidak boleh terisi selama
-- baris masih `[Belum Dikerjakan]` — nol pekerjaan sudah terjadi, jadi setiap
-- angka hasil di sana adalah angka yang tidak punya asal.
--
-- ---------------------------------------------------------------------------
-- YANG SENGAJA TIDAK ADA DI SINI
-- ---------------------------------------------------------------------------
--  * NOL KOLOM TURUNAN (aturan rumah #4). `On Time`/`Late`, `%Ontime`,
--    `% SKU Gagal Upload`, dan `% Achievement` semuanya diturunkan saat baca:
--       On Time      : (terupload_pada AT TIME ZONE 'Asia/Jakarta')::date <= expected_done
--       % Achievement : ctr_sesudah / target_ctr  (dan cvr_sesudah / target_cvr)
--    Menyimpannya berarti membuat angka yang bisa berbohong terhadap jangkarnya.
--  * NOL KOLOM `actual_done`/`upload_date` TERPISAH. Worksheet aslinya menulis
--    keduanya; keduanya adalah momen yang SAMA — saat gambar ter-upload. Satu
--    jangkar beku `terupload_pada` melayani dua-duanya, dan baseline "rata-rata
--    30 hari sebelum" di-anchor ke sana juga. Dua kolom untuk satu fakta adalah
--    dua jawaban yang menunggu berbeda.
--  * NOL LOOP REVISI per baris SKU. `Shopee Revision`/`Tiktok Revision` adalah
--    JENIS PERMINTAAN (satu baris SKU sendiri), bukan putaran review di dalam
--    satu baris. Menambahkan loop revisi berarti mengarang transisi yang tidak
--    ada di worksheet mana pun (aturan rumah: jangan mengarang status).
--  * NOL BOBOT M14. Bobot Store Ops tetap 0 (LT-1) sampai metriknya berjalan
--    sungguhan — butir 9 Wave 3, bukan di sini.
--  * NOL EVENT NOTIFIKASI BARU. `notif_events` TETAP 73; notifikasi rollup
--    menyusul di PR 2 bersama mesinnya kalau katalog memang menuntutnya.
--
-- ---------------------------------------------------------------------------
-- GATE
-- ---------------------------------------------------------------------------
--   tabel public   146 → 147   (`sku_optimizations`)
--   entity_prefix   40 →  41   (`SKU`)
--   sm_machines     31 →  32   (`store_ops_sku`)
--   notif_events    73 →  73   (TIDAK bergeser)
-- Angka-angka itu dinaikkan di `scripts/db-rebuild.sh` DAN `.github/workflows/ci.yml`
-- pada commit yang sama dengan berkas ini — counter-nya ABSOLUT, bukan delta.
-- ===========================================================================


-- ===========================================================================
-- 1. Registry prefix (`SKU`) — aturan rumah #1, ID lahir HANYA lewat ident_next.
--
--    Sisi TS-nya `packages/core/src/ident.ts` (`PREFIXES.SKU`); `ident.registry
--    .test.ts` menuntut kedua sisi identik, jadi menambah di satu tempat saja
--    memerahkan tes. `SKU` diverifikasi bebas terhadap 40 prefix terdaftar.
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('SKU', 'Baris SKU (unit kerja Store Operation)', 'M18');


-- ===========================================================================
-- 2. Mesin #32 `store_ops_sku` (data, bukan kode — `sm_transition` sudah generik).
--
--    [Belum Dikerjakan] → [Dikerjakan] → [Terupload] → [Dievaluasi]  (terminal)
--    [Belum Dikerjakan] → [Dibatalkan]                               (terminal)
--    [Dikerjakan]       → [Dibatalkan]                               (terminal)
--
--    `[Terupload]` ADALAH "selesai" untuk leadtime produksi (K-6) — ia bukan
--    state antara menuju kelengkapan administratif. Ia sengaja BUKAN terminal:
--    langkah evaluasi ±30 hari kemudian adalah transisi yang sah dan berjejak,
--    bukan UPDATE senyap ke baris yang sudah tutup. Konsekuensinya rollup
--    "selesai" harus membaca `[Terupload]` **atau** `[Dievaluasi]`; kalau ia
--    hanya membaca state terminal, produksi Store Ops akan terlihat mandek
--    selama sebulan penuh setiap kali. Ditulis sebagai Rule di PRD §2.
--
--    `require_lead` pada kedua edge `[Dibatalkan]`: membatalkan baris SKU
--    mencabutnya dari hitungan `%Ontime` divisi, dan orang yang sedang diukur
--    tidak boleh bisa mencabut ukurannya sendiri — gerbang yang sama persis
--    dengan alasan M12 §5.3a mengunci `[Blocked]` ke SPV/Lead, dan dengan kedua
--    edge `[Dibatalkan]` mesin #21 `internal_task`.
--
--    TIDAK ADA edge "buka kembali" dari `[Dievaluasi]`: ia akan memindahkan
--    `dievaluasi_pada` dan angka dampak yang sudah dilaporkan ke klien. Salah
--    angka ⇒ keputusan pemilik lebih dulu (pola mesin #20/#21).
--
--    TIDAK ADA edge `[Terupload]` → `[Dikerjakan]`: `terupload_pada` beku, jadi
--    mundur ke sana hanya akan menghasilkan baris yang jangkar produksinya
--    sudah lewat tapi statusnya bilang belum. Salah upload ⇒ baris SKU baru.
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('store_ops_sku', '[Belum Dikerjakan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('store_ops_sku', '[Dievaluasi]'),
    ('store_ops_sku', '[Dibatalkan]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('store_ops_sku', '[Belum Dikerjakan]', '[Dikerjakan]',  false),  -- PIC mulai
    ('store_ops_sku', '[Dikerjakan]',       '[Terupload]',   false),  -- gambar ter-upload = SELESAI (K-6)
    ('store_ops_sku', '[Terupload]',        '[Dievaluasi]',  false),  -- dampak ±30 hari (K-6, langkah terpisah)
    ('store_ops_sku', '[Belum Dikerjakan]', '[Dibatalkan]',  true),   -- lead divisi
    ('store_ops_sku', '[Dikerjakan]',       '[Dibatalkan]',  true);   -- lead divisi


-- ===========================================================================
-- 3. Tabel `sku_optimizations` — anak `briefs`, satu baris per SKU (K-5).
--
--    Pola induk-anak-nya PERSIS `assets` (Creative) dan `creator_bookings`
--    (KOL): FK ke `briefs`, `sequence_no` unik per Brief. `sequence_no` dipakai
--    ulang saat ada lubang, sama seperti `assets` — itulah kenapa ia UNIQUE per
--    Brief dan bukan identity global.
--
--    Kolomnya dipisah DUA KELOMPOK dengan komentar yang eksplisit, karena
--    pemisahan itulah yang dijaga trigger di §4. Jangan menyisipkan kolom baru
--    tanpa menempatkannya di salah satu kelompok — kolom tak berkelompok adalah
--    kolom yang tidak dijaga siapa pun.
-- ===========================================================================
CREATE TABLE sku_optimizations (
    id                 varchar(32)   NOT NULL PRIMARY KEY,        -- SKU-YYYYMM-NNNN
    brief_id           varchar(32)   NOT NULL,
    sequence_no        integer       NOT NULL,

    -- ---------------------------------------------------------------------
    -- KELOMPOK A — CAKUPAN + TARGET. Ditulis AM saat baris lahir.
    --
    -- Ini "apa yang dikerjakan dan diukur terhadap apa", bukan "siapa yang
    -- mengerjakan". Batas itu penting: K-1/A-5 mencabut hak AM memilih nama
    -- STAFF, dan tidak mencabut hak AM menetapkan CAKUPAN. `assigned_pic` ada
    -- di kelompok B justru karena itu. Kalau nanti ada yang mengira kelompok A
    -- adalah regresi K-1, baris inilah jawabannya.
    -- ---------------------------------------------------------------------
    request_type       varchar(32)   NOT NULL,
    jenis_gambar       varchar(32)   NOT NULL,
    nama_produk        varchar(191)  NOT NULL,
    link_sku           text          NOT NULL,
    total_req_picture  integer       NOT NULL,
    expected_done      date          NOT NULL,

    -- Target WAJIB, dan itu ketokan pemilik yang diterjemahkan langsung jadi
    -- NOT NULL: "diisi oleh AM, BESERTA targetnya". Baris SKU tanpa target
    -- adalah baris yang evaluasinya nanti tidak punya pembanding — dan yang
    -- akan diisi belakangan oleh orang yang sudah tahu hasilnya.
    -- `target_rating` NULL-able: rating tidak selalu bergerak untuk setiap SKU,
    -- dan K-6 menyebut CTR/CVR sebagai yang wajib. Ia ditawarkan, tidak dipaksa.
    target_ctr         numeric(7,4)  NOT NULL,
    target_cvr         numeric(7,4)  NOT NULL,
    target_rating      numeric(3,2)  NULL,
    catatan_am         text          NOT NULL DEFAULT '',

    -- ---------------------------------------------------------------------
    -- KELOMPOK B — HASIL + DAMPAK. Ditulis Store Ops.
    --
    -- `assigned_pic` ADA DI SINI, bukan di kelompok A: penugasan nama orang
    -- adalah wewenang lead divisi (K-1/A-5), bukan AM.
    -- ---------------------------------------------------------------------
    assigned_pic       varchar(64)   NULL,
    link_output        text          NOT NULL DEFAULT '',
    catatan_store_ops  text          NOT NULL DEFAULT '',

    -- Jangkar beku. `terupload_pada` melayani "Actual Done" DAN "Upload Date"
    -- worksheet sekaligus (satu fakta, satu kolom) dan menjadi titik nol
    -- baseline "rata-rata 30 hari sebelum".
    terupload_pada     timestamptz   NULL,
    dievaluasi_pada    timestamptz   NULL,

    -- Dampak. `*_sebelum` = rata-rata 30 hari SEBELUM `terupload_pada`;
    -- `*_sesudah` = rata-rata ±30 hari SESUDAHnya. Keduanya diisi di langkah
    -- evaluasi yang sama, karena keduanya baru bisa dibaca dari Seller Center
    -- pada saat itu — mengisi `*_sebelum` lebih awal berarti mengunci baseline
    -- dari jendela yang belum lengkap.
    ctr_sebelum        numeric(7,4)  NULL,
    cvr_sebelum        numeric(7,4)  NULL,
    rating_sebelum     numeric(3,2)  NULL,
    ctr_sesudah        numeric(7,4)  NULL,
    cvr_sesudah        numeric(7,4)  NULL,
    rating_sesudah     numeric(3,2)  NULL,

    -- ---------------------------------------------------------------------
    -- Mesin + pembatalan + jejak.
    -- ---------------------------------------------------------------------
    status             varchar(32)   NOT NULL DEFAULT '[Belum Dikerjakan]',
    dibatalkan_pada    timestamptz   NULL,
    alasan_pembatalan  text          NOT NULL DEFAULT '',

    created_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         varchar(64)   NOT NULL,                    -- AM yang menetapkan cakupan
    updated_at         timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT uq_sku_brief_seq UNIQUE (brief_id, sequence_no),
    CONSTRAINT fk_sku_brief FOREIGN KEY (brief_id) REFERENCES briefs (id),
    CONSTRAINT fk_sku_pic   FOREIGN KEY (assigned_pic) REFERENCES employees (employee_id),
    CONSTRAINT fk_sku_creator FOREIGN KEY (created_by) REFERENCES employees (employee_id),

    -- Kosakata worksheet, harfiah. Tujuh jenis permintaan dan empat jenis
    -- gambar adalah daftar yang divisi itu sendiri pakai hari ini — bukan
    -- taksonomi baru. Menambah nilai = migrasi + baris PRD, bukan teks bebas.
    CONSTRAINT ck_sku_request_type CHECK (request_type IN (
        'Shopee New', 'Shopee Revision', 'Shopee Additional',
        'Tiktok New', 'Tiktok Revision', 'Tiktok Additional',
        'CPAS New')),
    CONSTRAINT ck_sku_jenis_gambar CHECK (jenis_gambar IN (
        'Cover Only', 'Cover + Pendamping', 'Varian + Pendamping', 'Iklan CPAS')),

    CONSTRAINT ck_sku_total_picture CHECK (total_req_picture > 0),
    CONSTRAINT ck_sku_target_positif CHECK (target_ctr >= 0 AND target_cvr >= 0
        AND (target_rating IS NULL OR (target_rating >= 0 AND target_rating <= 5))),

    -- K-6, SISI PERTAMA: "selesai" hanya menuntut bukti produksi. Perhatikan
    -- bahwa constraint ini TIDAK menyebut satu pun kolom dampak — itu bukan
    -- kelalaian, itu isi ketokannya. Ada tesnya (PRD §7 DoD).
    CONSTRAINT ck_sku_terupload CHECK (
        status NOT IN ('[Terupload]', '[Dievaluasi]')
        OR (terupload_pada IS NOT NULL AND btrim(link_output) <> '')),

    -- K-6, SISI KEDUA: angka dampak WAJIB — satu state kemudian. Rating tidak
    -- ikut diwajibkan, sejalan dengan `target_rating` yang NULL-able.
    CONSTRAINT ck_sku_dievaluasi CHECK (
        status <> '[Dievaluasi]'
        OR (dievaluasi_pada IS NOT NULL
            AND ctr_sebelum IS NOT NULL AND cvr_sebelum IS NOT NULL
            AND ctr_sesudah IS NOT NULL AND cvr_sesudah IS NOT NULL)),

    CONSTRAINT ck_sku_batal CHECK (
        status <> '[Dibatalkan]' OR dibatalkan_pada IS NOT NULL),

    -- Waktu tidak boleh mundur.
    CONSTRAINT ck_sku_urutan_waktu CHECK (
        dievaluasi_pada IS NULL OR terupload_pada IS NULL
        OR dievaluasi_pada >= terupload_pada)
);

-- Antrean divisi (status per Brief) dan "SKU saya" (per PIC).
CREATE INDEX idx_sku_brief_status ON sku_optimizations (brief_id, status);
CREATE INDEX idx_sku_pic          ON sku_optimizations (assigned_pic);

CREATE TRIGGER trg_sku_updated_at BEFORE UPDATE ON sku_optimizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sku_optimizations IS
  'M18 Store Operation — unit kerja per SKU di bawah satu Brief (K-5). Dua '
  'kelompok kolom dengan dua penulis: cakupan+target milik AM, hasil+dampak '
  'milik Store Ops (ketokan pemilik 2026-09-08). Dindingnya trigger '
  'trg_sku_dinding, bukan konvensi.';

COMMENT ON COLUMN sku_optimizations.terupload_pada IS
  'Jangkar produksi. Melayani "Actual Done" DAN "Upload Date" worksheet '
  'sekaligus — satu fakta, satu kolom — dan menjadi titik nol baseline '
  '"rata-rata 30 hari sebelum". Beku setelah terisi.';

COMMENT ON COLUMN sku_optimizations.target_ctr IS
  'NOT NULL karena ketokan pemilik 2026-09-08 berbunyi "diisi oleh AM, BESERTA '
  'targetnya". Beku begitu baris meninggalkan [Belum Dikerjakan] — mode gagal '
  'yang dijaga adalah target yang berubah SESUDAH hasilnya keluar.';


-- ===========================================================================
-- 4. DINDING dua penulis.
--
--    Baca catatan kepala berkas ("kenapa bersyarat-state, bukan bersyarat-aktor")
--    sebelum mengubah apa pun di sini.
--
--    Yang diizinkan UPDATE: menggerakkan `status` (lewat `sm_transition`),
--    mengisi jangkar SEKALI, mengisi hasil/dampak pada state yang tepat,
--    menugaskan PIC, memperbaiki catatan. Selebihnya ditolak — termasuk oleh
--    service role.
-- ===========================================================================
CREATE OR REPLACE FUNCTION sku_optimizations_dinding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- --- identitas & induk: beku selamanya --------------------------------
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'sku_optimizations: id beku';
    END IF;
    IF NEW.brief_id IS DISTINCT FROM OLD.brief_id THEN
        RAISE EXCEPTION 'sku_optimizations: brief_id beku — baris SKU tidak berpindah Brief';
    END IF;
    IF NEW.sequence_no IS DISTINCT FROM OLD.sequence_no THEN
        RAISE EXCEPTION 'sku_optimizations: sequence_no beku';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'sku_optimizations: created_by beku';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'sku_optimizations: created_at beku';
    END IF;

    -- --- KELOMPOK A: cakupan + target -------------------------------------
    -- Bebas dikoreksi AM selama nol pekerjaan sudah terjadi; BEKU begitu baris
    -- meninggalkan [Belum Dikerjakan]. Inilah dinding yang ketokan §2 minta:
    -- sesudah Store Ops mulai, tidak ada urutan langkah apa pun yang membuat
    -- "% Achievement" dihitung terhadap angka yang digeser belakangan.
    IF OLD.status <> '[Belum Dikerjakan]' THEN
        IF NEW.request_type      IS DISTINCT FROM OLD.request_type
        OR NEW.jenis_gambar      IS DISTINCT FROM OLD.jenis_gambar
        OR NEW.nama_produk       IS DISTINCT FROM OLD.nama_produk
        OR NEW.link_sku          IS DISTINCT FROM OLD.link_sku
        OR NEW.total_req_picture IS DISTINCT FROM OLD.total_req_picture
        OR NEW.expected_done     IS DISTINCT FROM OLD.expected_done THEN
            RAISE EXCEPTION
              'sku_optimizations: cakupan SKU beku setelah pekerjaan dimulai — batalkan baris lalu buat baris baru';
        END IF;
        IF NEW.target_ctr    IS DISTINCT FROM OLD.target_ctr
        OR NEW.target_cvr    IS DISTINCT FROM OLD.target_cvr
        OR NEW.target_rating IS DISTINCT FROM OLD.target_rating THEN
            RAISE EXCEPTION
              'sku_optimizations: target beku setelah pekerjaan dimulai — target yang bergerak sesudah hasilnya keluar tidak mengukur apa pun';
        END IF;
    END IF;

    -- --- KELOMPOK B: hasil + dampak ---------------------------------------
    -- Arah sebaliknya, simetris: nol hasil boleh muncul sebelum ada pekerjaan.
    -- `assigned_pic` DIKECUALIKAN — menugaskan orang adalah langkah yang wajar
    -- dilakukan lead divisi SEBELUM barisnya mulai dikerjakan.
    IF OLD.status = '[Belum Dikerjakan]' AND NEW.status = '[Belum Dikerjakan]' THEN
        IF btrim(NEW.link_output) <> btrim(OLD.link_output)
        OR NEW.terupload_pada  IS DISTINCT FROM OLD.terupload_pada
        OR NEW.dievaluasi_pada IS DISTINCT FROM OLD.dievaluasi_pada
        OR NEW.ctr_sebelum     IS DISTINCT FROM OLD.ctr_sebelum
        OR NEW.cvr_sebelum     IS DISTINCT FROM OLD.cvr_sebelum
        OR NEW.rating_sebelum  IS DISTINCT FROM OLD.rating_sebelum
        OR NEW.ctr_sesudah     IS DISTINCT FROM OLD.ctr_sesudah
        OR NEW.cvr_sesudah     IS DISTINCT FROM OLD.cvr_sesudah
        OR NEW.rating_sesudah  IS DISTINCT FROM OLD.rating_sesudah THEN
            RAISE EXCEPTION
              'sku_optimizations: hasil/dampak tidak boleh terisi selama baris masih [Belum Dikerjakan]';
        END IF;
    END IF;

    -- --- jangkar: sekali tulis --------------------------------------------
    IF OLD.terupload_pada IS NOT NULL AND NEW.terupload_pada IS DISTINCT FROM OLD.terupload_pada THEN
        RAISE EXCEPTION 'sku_optimizations: terupload_pada beku — jangkar leadtime produksi tidak boleh diubah';
    END IF;
    IF OLD.dievaluasi_pada IS NOT NULL AND NEW.dievaluasi_pada IS DISTINCT FROM OLD.dievaluasi_pada THEN
        RAISE EXCEPTION 'sku_optimizations: dievaluasi_pada beku';
    END IF;
    IF OLD.dibatalkan_pada IS NOT NULL AND NEW.dibatalkan_pada IS DISTINCT FROM OLD.dibatalkan_pada THEN
        RAISE EXCEPTION 'sku_optimizations: dibatalkan_pada beku';
    END IF;

    -- --- bukti produksi: beku setelah ter-upload ---------------------------
    -- Mengganti bukti setelah pekerjaan dinilai adalah mengedit riwayat (pola
    -- `internal_tasks.link_hasil`). Sebelum itu ia bebas diperbaiki PIC.
    IF OLD.status IN ('[Terupload]', '[Dievaluasi]')
       AND NEW.link_output IS DISTINCT FROM OLD.link_output THEN
        RAISE EXCEPTION 'sku_optimizations: link_output beku setelah [Terupload]';
    END IF;

    -- --- angka dampak: beku setelah dievaluasi -----------------------------
    IF OLD.status = '[Dievaluasi]' THEN
        IF NEW.ctr_sebelum    IS DISTINCT FROM OLD.ctr_sebelum
        OR NEW.cvr_sebelum    IS DISTINCT FROM OLD.cvr_sebelum
        OR NEW.rating_sebelum IS DISTINCT FROM OLD.rating_sebelum
        OR NEW.ctr_sesudah    IS DISTINCT FROM OLD.ctr_sesudah
        OR NEW.cvr_sesudah    IS DISTINCT FROM OLD.cvr_sesudah
        OR NEW.rating_sesudah IS DISTINCT FROM OLD.rating_sesudah THEN
            RAISE EXCEPTION 'sku_optimizations: angka dampak beku setelah [Dievaluasi]';
        END IF;
    END IF;

    -- --- terminal tetap terminal -------------------------------------------
    IF OLD.status IN ('[Dievaluasi]', '[Dibatalkan]') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'sku_optimizations: % adalah state terminal', OLD.status;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sku_dinding
    BEFORE UPDATE ON sku_optimizations
    FOR EACH ROW EXECUTE FUNCTION sku_optimizations_dinding();


-- ===========================================================================
-- 5. RLS — kunci kedua di bawah gerbang TS.
--
--    Empat arm, cermin Role Matrix Fase 0 §4 dan pembagian peran §2:
--      * OD/Direktur           : semua                       (jwt_can_read_all)
--      * Lead/SPV Store Ops    : seluruh divisinya            (jwt_is_lead + divisi)
--      * Staff Store Ops       : baris yang ditugaskan padanya (assigned_pic)
--      * AM pemilik klien      : SEMUA baris SKU Brief-nya     (private.brief_owner_am)
--
--    Arm AM memakai pintu `private.brief_owner_am` SECURITY DEFINER, BUKAN join
--    `briefs`/`services`/`clients` di dalam predikat. Itu perangkap O52, dan ia
--    MEMBUANG barisnya alih-alih mengosongkan kolomnya — halaman menjawab 404,
--    bukan 403, dan seluruh suite domain tetap hijau karena koneksi tes
--    BYPASSRLS. Sudah tiga kali terjadi dalam satu sesi; jangan yang keempat.
--
--    Divisi lain TIDAK punya arm: baris SKU adalah pekerjaan Store Ops atas
--    klien seorang AM, dan tidak ada halaman divisi lain yang membacanya.
--
--    Arm lead/divisi ada INLINE di sini ⇒ policy ini LULUS detektor sintaktik
--    ledger O48 (`rls_checks.sql` §42) dan karena itu TIDAK ditambahkan ke
--    daftar `expected` di sana. Daftar itu hanya boleh menyusut.
-- ===========================================================================
ALTER TABLE public.sku_optimizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY sku_optimizations_select ON public.sku_optimizations
FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Store Operation')
       OR public.jwt_employee_id() = assigned_pic
       OR public.jwt_employee_id() = private.brief_owner_am(brief_id));

-- ⚠️ WAJIB, dan mudah terlupa: `readAsActor` (apps/api/src/lib/db.ts, O37)
-- BERPINDAH ke role `authenticated` sebelum membaca. Tanpa GRANT ini policy di
-- atas tidak pernah sempat dievaluasi — Postgres menolak lebih dulu dengan
-- "permission denied for table sku_optimizations", dan SETIAP pembacaan lewat
-- API gagal untuk SEMUA orang. RLS memberi row-scope; GRANT-lah yang memberi
-- akses tabelnya.
GRANT SELECT ON public.sku_optimizations TO authenticated;

REVOKE ALL ON public.sku_optimizations FROM anon;


-- ===========================================================================
-- 6. `private.brief_jumlah_anak` — tambahkan CABANG Store Operation.
--
--    Fungsi ini (A-req-3, migrasi 20260922100500) sudah ber-`CASE` per divisi
--    dengan `ELSE 0`, dan Store Ops selama ini jatuh ke `ELSE`. Cabangnya
--    ditambahkan DI SINI, bukan lewat fungsi kedua: dua fungsi yang menjawab
--    "berapa anaknya" adalah dua jawaban yang menunggu berbeda.
--
--    Baris `[Dibatalkan]` IKUT TERHITUNG, sama seperti Asset/Booking yang
--    dibatalkan ikut terhitung di cabangnya masing-masing: angka ini menjawab
--    "Brief ini sudah dipecah jadi berapa unit kerja", bukan "berapa yang masih
--    hidup". Yang kedua adalah pekerjaan rollup (PR 2), dan ia butuh pembilang
--    DAN penyebut — bukan satu angka yang diam-diam sudah menyaring.
--
--    Seluruh badan fungsi ditulis ulang apa adanya (CREATE OR REPLACE tidak
--    menerima patch), jadi keempat cabang lama harus tetap identik. Kalau ada
--    yang berbeda dari 20260922100500 selain cabang baru, itu bug.
-- ===========================================================================
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
             (SELECT count(*) FROM public.sku_optimizations s WHERE s.brief_id = b.id)
           ELSE 0
         END::integer
    FROM public.briefs b
   WHERE b.id = p_brief_id
$$;

COMMENT ON FUNCTION private.brief_jumlah_anak(text) IS
  'A-req-3 — jumlah unit kerja anak sebuah Brief (Asset / Campaign / Booking / '
  'Sesi Live / baris SKU), lewat pintu SECURITY DEFINER. Ada karena `briefCols` '
  'dibaca di bawah RLS: subquery count(*) langsung akan dipersempit policy '
  'pembacanya dan seorang staff melihat angka yang SALAH tanpa galat apa pun. '
  'Cabang Store Operation ditambahkan Wave 3 (M18). Divisi tanpa tabel anak '
  'mengembalikan 0, bukan NULL.';

-- Grant-nya diulang: `CREATE OR REPLACE` mempertahankan ACL yang ada, tapi
-- menuliskannya lagi membuat berkas ini benar kalau dijalankan di atas basis
-- yang fungsinya belum pernah ada (mis. rebuild dari nol dengan urutan berbeda).
REVOKE EXECUTE ON FUNCTION private.brief_jumlah_anak(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_jumlah_anak(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_jumlah_anak(text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION private.brief_jumlah_anak(text) TO service_role;
  END IF;
END $$;
