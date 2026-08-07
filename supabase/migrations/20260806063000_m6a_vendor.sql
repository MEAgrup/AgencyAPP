-- CDPS — Module 6A §7 / D19: entitas `VND-` Vendor.
--
-- Kenapa ini datang SEBELUM `strategi`, bukan sesudahnya
-- ---------------------------------------------------------------------------
-- M6A §7 menyebutnya blocker dengan kalimat eksplisit: "E-8 dan F-4 tidak bisa
-- diimplementasi sebelum ini mendarat, jadi ia masuk batch migrasi yang SAMA
-- dengan `STRG`". Alasannya bukan urutan administratif — `STRG_PILLAR` tipe
-- `live` memegang `vendor_id` sebagai FK (D15/Rule 18), dan sebuah FK ke tabel
-- yang belum ada hanya punya dua jalan keluar: kolom tanpa FK (yang persis
-- kelas masalah `plan_id` di M6C, dicatat sebagai utang) atau menunda seluruh
-- Section E. Jadi vendor lebih dulu, satu berkas sebelum `strategi`, dan
-- FK-nya nyata sejak hari pertama.
--
-- Ruang lingkup yang SENGAJA sempit
-- ---------------------------------------------------------------------------
-- §7 memberi "minimum viable shape, to be confirmed against how MSDPS tracks
-- its live-stream vendor". Yang dibangun di sini persis delapan field itu —
-- bukan modul manajemen vendor (rating, kontrak, invoice, pembayaran). Vendor
-- di M6A hanya perlu bisa: dipilih di E-8, dibooking jamnya di F-4, dan
-- dinonaktifkan tanpa menghapus jejak Strategi yang sudah menunjuknya.
--
-- Live Stream adalah mode VENDOR, bukan eksekusi internal (D15 / Rule 18):
-- pilar `live` menghasilkan vendor tracker record, BUKAN Brief, dan jam live
-- tidak pernah menarik kapasitas divisi internal (F-5). Konsekuensi teknisnya
-- ada di migrasi `strategi`: `strategi_resource` menolak `vendor_id` di baris
-- selain `live_vendor`.
--
-- Status vendor = mesin status (aturan rumah CLAUDE.md #2)
-- ---------------------------------------------------------------------------
-- `Aktif` / `Nonaktif` / `Blacklist` adalah siklus hidup entitas ber-ID, jadi ia
-- ditulis EKSKLUSIF lewat `sm_transition` seperti entitas lain — bukan UPDATE
-- mentah. PRD M6A/6B/6C hanya menomori mesin #15 (Strategi) dan #16 (Plan) —
-- mesin `vendor` tidak bernomor di sana, dan #17 sudah dipesan M6C §7 (dormansi
-- Plan Satuan), jadi ia didaftarkan tanpa nomor. Dicatat di `docs/DECISIONS.md`
-- 2026-08-06.
--
-- `Blacklist` sengaja TIDAK terminal. Terminal berarti satu-satunya jalan
-- membatalkan blacklist yang salah adalah UPDATE mentah — persis yang dilarang
-- aturan rumah #2. Jalan pulangnya `Blacklist → Nonaktif → Aktif`: dua langkah,
-- dua baris audit, keduanya butuh lead.

-- ---------------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------------
CREATE TABLE vendors (
    id                varchar(32)   NOT NULL PRIMARY KEY,
    nama_vendor       varchar(191)  NOT NULL,
    jenis_layanan     varchar(24)   NOT NULL,
    status            varchar(16)   NOT NULL DEFAULT 'Aktif',
    pic_nama          varchar(191)  NOT NULL,
    pic_kontak        varchar(191)  NOT NULL,

    -- §7 `skema_biaya`: "enum + struct" — enum + tarifnya. Dua kolom tarif
    -- karena `bagi_hasil` bukan rupiah: menyimpan 15 (persen) di kolom yang
    -- sama dengan Rp 15.000.000 adalah cara paling pasti melahirkan angka yang
    -- salah dibaca di layar F-4.
    skema_biaya       varchar(16)   NOT NULL,
    tarif             numeric(15,2) NULL,
    bagi_hasil_persen numeric(6,2)  NULL,

    catatan_kinerja   text          NOT NULL DEFAULT '',
    dokumen           jsonb         NOT NULL DEFAULT '[]'::jsonb,

    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,

    CONSTRAINT ck_vendor_jenis CHECK (
        jenis_layanan IN ('live_stream', 'produksi_video', 'talent', 'lainnya')),
    CONSTRAINT ck_vendor_status CHECK (
        status IN ('Aktif', 'Nonaktif', 'Blacklist')),
    CONSTRAINT ck_vendor_skema CHECK (
        skema_biaya IN ('per_jam', 'per_sesi', 'bagi_hasil', 'retainer')),
    CONSTRAINT ck_vendor_nama CHECK (btrim(nama_vendor) <> ''),
    CONSTRAINT ck_vendor_pic CHECK (btrim(pic_nama) <> '' AND btrim(pic_kontak) <> ''),
    -- Tarif dan skemanya datang berpasangan: `bagi_hasil` memakai persen dan
    -- HANYA persen; tiga skema lain memakai rupiah dan HANYA rupiah. Tanpa ini
    -- F-4 bisa menyimpan vendor bagi-hasil dengan tarif per jam yang tidak
    -- pernah ditagihkan siapa pun.
    CONSTRAINT ck_vendor_tarif_pair CHECK (
        (skema_biaya =  'bagi_hasil' AND bagi_hasil_persen IS NOT NULL AND tarif IS NULL)
     OR (skema_biaya <> 'bagi_hasil' AND tarif IS NOT NULL AND bagi_hasil_persen IS NULL)),
    CONSTRAINT ck_vendor_tarif_positif CHECK (
        (tarif IS NULL OR tarif >= 0)
    AND (bagi_hasil_persen IS NULL OR (bagi_hasil_persen > 0 AND bagi_hasil_persen <= 100))),
    CONSTRAINT ck_vendor_dokumen_array CHECK (jsonb_typeof(dokumen) = 'array')
);

-- Vendor ganda adalah masalah data yang nyata: dua baris "PT Live Kita" membuat
-- jam yang dibooking terpecah di dua tempat dan laporan F-4 bohong tanpa ada
-- satu pun bug kode. Unik case-insensitive + trim, bukan sekadar unik literal.
CREATE UNIQUE INDEX uq_vendor_nama ON vendors (lower(btrim(nama_vendor)));
CREATE INDEX idx_vendors_status ON vendors (status, jenis_layanan);

CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vendors IS
  'M6A §7 / D19 — entitas VND-. Mode vendor untuk Live Stream (D15/Rule 18): '
  'pilar live menghasilkan vendor tracker record, bukan Brief internal, dan '
  'tidak menarik kapasitas divisi (F-5).';
COMMENT ON COLUMN vendors.catatan_kinerja IS
  'M6A §7 — internal only. Tidak pernah ikut ke client view /s/{token} (Rule 16).';

-- ---------------------------------------------------------------------------
-- 2. Mesin status `vendor`
-- ---------------------------------------------------------------------------
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('vendor', 'Aktif', '[transisi status vendor tidak diizinkan]', false, '{}');

-- Semua edge `require_lead`: vendor adalah master record bersama, sekelas
-- Master Service List — satu AM tidak boleh mem-blacklist vendor yang dipakai
-- AM lain. Direksi lolos lewat p_role_director di sm_transition.
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('vendor', 'Aktif',     'Nonaktif',  true),
    ('vendor', 'Nonaktif',  'Aktif',     true),
    ('vendor', 'Aktif',     'Blacklist', true),
    ('vendor', 'Nonaktif',  'Blacklist', true),
    ('vendor', 'Blacklist', 'Nonaktif',  true);

-- ---------------------------------------------------------------------------
-- 3. RLS — tabel dibuat SETELAH 20260723064438_rls_baseline, jadi loop grant di
--    sana tidak menyentuhnya.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.vendors FROM anon;
REVOKE ALL ON public.vendors FROM authenticated;
GRANT SELECT ON public.vendors TO authenticated;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- Daftar vendor dibaca SEMUA karyawan aktif: AM memilihnya di E-8/F-4, lead
-- divisi Live perlu tahu siapa yang dibooking, Finance membayarnya. Tidak ada
-- row-scope yang masuk akal di sini — vendor bukan data klien, dan mempersempit
-- SELECT hanya akan membuat dropdown E-8 kosong untuk separuh peran yang butuh.
-- Yang TETAP tertutup: tulis. Semua penulisan lewat service role + gate domain
-- (`vendor.ts`), dan perubahan status lewat sm_transition yang gate lead-nya ada
-- di dalam fungsi SQL.
CREATE POLICY vendors_select ON public.vendors FOR SELECT TO authenticated
USING (true);
