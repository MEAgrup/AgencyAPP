-- CDPS — Module 6A, tiket **A-05: Section A "Konteks Klien & Bisnis"** (16 field)
-- plus **A-15/A-16** (matriks akses per channel + blocker akses).
--
-- Ini ALTER di atas bentuk yang sudah dibangun A-03, bukan desain ulang: Section A
-- diisi SEKALI per Strategi (bukan per channel, M6A §4 "Filled once, not per
-- channel"), jadi ia kolom di `strategi`. Yang menjadi tabel sendiri hanya A-15,
-- karena ia satu-satunya bagian Section A yang berbentuk MATRIKS.
--
-- ===========================================================================
-- Empat keputusan bentuk, dan kenapa
-- ===========================================================================
--
-- (1) **Kolomnya NULLable, dan kelengkapannya ditegakkan di gerbang submit.**
--     Setiap field Section A bertanda W (wajib) di PRD, tapi record lahir
--     `Draft` dan §7 Non-functional meminta **autosave tiap 20 detik**. Kolom
--     `NOT NULL` berarti autosave pertama gagal sampai keenambelas field terisi
--     — dan §5 langkah 5 justru meminta sebaliknya: tombol submit menampilkan
--     "hitungan hidup field wajib yang belum terisi", yang hanya mungkin kalau
--     keadaan setengah-terisi BISA disimpan. Jadi: bentuk & rentang ditegakkan
--     CHECK di sini (nilai yang ADA wajib sah), KEHADIRAN ditegakkan
--     `checkCompleteness` di dalam transaksi submit yang sama.
--
--     Bedanya dengan Section B baseline (Rule 5, `NOT NULL` tanpa default): di
--     sana baris baseline di-INSERT utuh per bulan dan "blank" adalah nilai yang
--     harus mustahil disimpan. Section A tidak punya aturan sekelas itu.
--
-- (2) **Multi-enum tertutup dijaga `<@` atas jsonb, bukan tabel lookup.**
--     A-14 (aset dari klien) adalah checkbox bertaksonomi tetap. Containment
--     jsonb (`aset_dari_klien <@ '[...]'`) menolak nilai di luar daftar di level
--     DB tanpa subquery — CHECK Postgres tidak boleh mengandung subquery, jadi
--     `NOT EXISTS (select … jsonb_array_elements_text …)` bukan pilihan yang ada.
--
-- (3) **A-16 BUKAN tabel kedua — ia flag di baris A-15.** PRD menuliskannya
--     sebagai daftar tersendiri ("akses yang belum ada dan memblokir eksekusi +
--     target tanggal beres"), tapi setiap barisnya adalah baris A-15 yang
--     statusnya belum `sudah`. Dua tabel berarti pasangan `(channel, akses)`
--     tersimpan dua kali dan bisa berselisih — dan blocker yang tidak menunjuk
--     baris akses mana pun adalah blocker yang tidak bisa dibereskan siapa pun.
--     Jadi `memblokir` + `target_tanggal_beres` menempel di `strategi_akses`,
--     dijaga CHECK: memblokir hanya sah kalau aksesnya memang belum ada, dan
--     wajib bertanggal.
--
-- (4) **`channel = 'Umum'` disediakan di matriks akses.** A-15 menyebut lima
--     akses "per channel", tapi salah satunya — akses gudang/stok — bukan milik
--     channel mana pun. Tanpa nilai `Umum`, akses gudang harus dicatat di bawah
--     channel yang dikarang, dan matriksnya berbohong tentang apa yang diblokir.
--
-- ===========================================================================
-- Yang TIDAK dibangun di sini
-- ===========================================================================
-- * **Overlay visibilitas Rule 16 (A-10).** A-3/A-13 default `Internal Saja` dan
--   A-10 hard-internal menurut §4.1, tapi penegakannya butuh daftar hard-internal
--   sebagai konstanta `packages/core` yang ditolak di predikat TS DAN CHECK DB
--   (invariant beku, §7). Membuat overlay-nya sekarang = penjagaan yang tidak
--   menolak apa pun. Tetap tiket A-10.
-- * **Nol event notifikasi baru** (O55). `notif_events` tetap 17.

-- ===========================================================================
-- 1. Section A — kolom di `strategi`
-- ===========================================================================
ALTER TABLE strategi
    -- A-1 Brand & Kategori
    ADD COLUMN nama_brand             varchar(191) NULL,
    ADD COLUMN kategori_utama         varchar(96)  NULL,
    ADD COLUMN sub_kategori           jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- A-2 Model Bisnis
    ADD COLUMN model_bisnis           varchar(16)  NULL,
    -- A-3 Ruang Margin (§4.1: default `Internal Saja`, AM boleh membagikan)
    ADD COLUMN margin_kotor_persen    numeric(6,2) NULL,
    -- A-4 Posisi Harga
    ADD COLUMN posisi_harga           varchar(16)  NULL,
    -- A-5 USP Produk (min 3 — dijaga gerbang submit, lihat keputusan (1))
    ADD COLUMN usp                    jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- A-6 Kapasitas Stok
    ADD COLUMN kapasitas_stok         varchar(24)  NULL,
    ADD COLUMN lead_time_restock_hari integer      NULL,
    -- A-7 Plafon Kapasitas
    ADD COLUMN plafon_unit_per_bulan  integer      NULL,
    -- A-8 Titik Kirim
    ADD COLUMN titik_kirim_kota       varchar(96)  NULL,
    ADD COLUMN titik_kirim_detail     text         NULL,
    -- A-9 Ekspektasi Klien — verbatim dari kickoff, sengaja teks bebas
    ADD COLUMN ekspektasi_klien       text         NULL,
    -- A-10 Riwayat Agensi (§4.1: HARD-INTERNAL, tidak pernah bisa dibagikan)
    ADD COLUMN riwayat_agensi         text         NULL,
    -- A-11 Pantangan Klien
    ADD COLUMN pantangan_klien        jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- A-12 Decision Maker: [{nama, jabatan, berhak_approve, jalur_eskalasi}]
    ADD COLUMN decision_maker         jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- A-13 SLA Klien (§4.1: default `Internal Saja`)
    ADD COLUMN sla_klien_jam          numeric(7,2) NULL,
    ADD COLUMN sla_klien_catatan      text         NULL,
    -- A-14 Aset dari Klien
    ADD COLUMN aset_dari_klien        jsonb        NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN aset_catatan           text         NULL;

ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_model_bisnis CHECK (
        model_bisnis IS NULL
     OR model_bisnis IN ('produsen', 'brand_owner', 'distributor', 'reseller')),
    ADD CONSTRAINT ck_strategi_posisi_harga CHECK (
        posisi_harga IS NULL
     OR posisi_harga IN ('premium', 'mid', 'budget', 'price_fighter')),
    ADD CONSTRAINT ck_strategi_kapasitas_stok CHECK (
        kapasitas_stok IS NULL
     OR kapasitas_stok IN ('ready_stock', 'produksi_per_order')),
    -- A-3: margin kotor adalah persen. Angka di luar 0–100 di sini akan
    -- merambat ke setiap perhitungan floor price E-4 sebagai guardrail palsu.
    ADD CONSTRAINT ck_strategi_margin CHECK (
        margin_kotor_persen IS NULL
     OR (margin_kotor_persen >= 0 AND margin_kotor_persen <= 100)),
    ADD CONSTRAINT ck_strategi_kapasitas_nonneg CHECK (
        (lead_time_restock_hari IS NULL OR lead_time_restock_hari >= 0)
    AND (plafon_unit_per_bulan  IS NULL OR plafon_unit_per_bulan  >= 0)
    AND (sla_klien_jam          IS NULL OR sla_klien_jam          >= 0)),
    ADD CONSTRAINT ck_strategi_array_kolom CHECK (
        jsonb_typeof(sub_kategori)    = 'array'
    AND jsonb_typeof(usp)             = 'array'
    AND jsonb_typeof(pantangan_klien) = 'array'
    AND jsonb_typeof(decision_maker)  = 'array'
    AND jsonb_typeof(aset_dari_klien) = 'array'),
    -- A-14: taksonomi TERTUTUP (M6A §4 A-14). Containment jsonb, bukan subquery
    -- — CHECK Postgres tidak boleh mengandung subquery.
    ADD CONSTRAINT ck_strategi_aset_taksonomi CHECK (
        aset_dari_klien <@ '["foto_produk","video","sampel","katalog","budget_iklan","host_live"]'::jsonb);

COMMENT ON COLUMN strategi.riwayat_agensi IS
  'M6A A-10 — HARD-INTERNAL (§4.1): tidak pernah bisa di-toggle shareable oleh '
  'AM. Penegakannya (konstanta packages/core + CHECK overlay) adalah tiket A-10.';
COMMENT ON COLUMN strategi.ekspektasi_klien IS
  'M6A A-9 — definisi sukses MENURUT KLIEN, verbatim dari kickoff. Bukan '
  'parafrase AM: ia yang dibandingkan saat klien menyanggah hasil.';

-- ===========================================================================
-- 2. A-15 + A-16 — `strategi_akses` (matriks channel × akses × status)
-- ===========================================================================
-- §5 langkah 3: "Access blockers are visible on the SPV dashboard from this
-- point — they are the most common cause of a stalled Strategi." Itu hanya bisa
-- dijawab kalau blocker adalah BARIS yang bisa di-query per status, bukan
-- paragraf di dalam satu kolom teks.
CREATE TABLE strategi_akses (
    id                   bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id          varchar(32)  NOT NULL,
    -- `Umum` = akses yang bukan milik channel mana pun (mis. gudang/stok).
    channel              varchar(32)  NOT NULL,
    akses                varchar(24)  NOT NULL,
    status               varchar(16)  NOT NULL,
    -- A-16: blocker BUKAN daftar kedua — ia flag di baris ini.
    memblokir            boolean      NOT NULL DEFAULT false,
    target_tanggal_beres date         NULL,
    catatan              text         NOT NULL DEFAULT '',

    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    created_by           varchar(64)  NOT NULL,

    CONSTRAINT fk_strakses_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT uq_strakses_sel UNIQUE (strategi_id, channel, akses),
    CONSTRAINT ck_strakses_channel CHECK (channel IN (
        'Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Website', 'Lainnya', 'Umum')),
    CONSTRAINT ck_strakses_akses CHECK (akses IN (
        'seller_center', 'ads_manager', 'affiliate_center', 'akun_chat', 'gudang_stok')),
    CONSTRAINT ck_strakses_status CHECK (status IN ('sudah', 'pending', 'ditolak')),
    -- A-16: sebuah blocker adalah akses yang BELUM ada dan punya tanggal beres.
    -- Tanpa tanggal, "memblokir" adalah keluhan; dengan tanggal, ia pekerjaan
    -- yang bisa jatuh tempo dan muncul di dashboard SPV.
    CONSTRAINT ck_strakses_blocker CHECK (
        NOT memblokir OR (status <> 'sudah' AND target_tanggal_beres IS NOT NULL))
);

CREATE INDEX idx_strakses_strategi ON strategi_akses (strategi_id);
-- Dashboard SPV membaca lewat index ini: blocker terbuka, paling jatuh tempo dulu.
CREATE INDEX idx_strakses_blocker ON strategi_akses (target_tanggal_beres)
    WHERE memblokir;

CREATE TRIGGER trg_strategi_akses_updated_at BEFORE UPDATE ON strategi_akses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_akses IS
  'M6A A-15 (matriks channel × akses × status) + A-16 (blocker = flag memblokir '
  '+ target_tanggal_beres pada baris yang sama, bukan tabel kedua).';

-- ===========================================================================
-- 3. RLS — mewarisi scope induk, seperti anak-anak A-03
-- ===========================================================================
-- Tabel ini dibuat SETELAH 20260723064438_rls_baseline, jadi loop grant di sana
-- tidak menyentuhnya. Predikat baris tetap ditulis di SATU tempat
-- (`private.jwt_can_read_strategi`) — menyalinnya ke tiap anak melahirkan
-- salinan yang bisa menyimpang.
REVOKE ALL ON public.strategi_akses FROM anon;
REVOKE ALL ON public.strategi_akses FROM authenticated;
GRANT SELECT ON public.strategi_akses TO authenticated;
ALTER TABLE public.strategi_akses ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_akses_select ON public.strategi_akses FOR SELECT TO authenticated
USING (private.jwt_can_read_strategi(strategi_id));
