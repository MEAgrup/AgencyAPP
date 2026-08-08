-- CDPS — Module 6A A-09b: sisa Section E / G / H / I
--
-- E-2 prioritas channel · E-12 ketergantungan klien · G-1 fase kerja ·
-- G-2 tanggal besar · G-3 review klien · G-4 review internal ·
-- H-2 trigger revisi · I-2 divisi penerima Brief · I-3 metrik laporan klien ·
-- I-4 catatan per divisi.
--
-- Sesudah migrasi ini **Section E, G, H, dan I tertutup penuh** di lapisan data.
-- Yang tersisa dari M6A bukan lagi field, melainkan halaman (A-13), tier
-- visibilitas (A-10), tautan klien (A-11), dan UI revisi (A-12).
--
-- ===========================================================================
-- APA YANG SUDAH ADA, DAN KARENANYA TIDAK DIBANGUN ULANG
-- ===========================================================================
--   E-1, E-13, H-3, H-4  -> kolom header (A-09a, 20260808010000)
--   E-3…E-11             -> `strategi_pillar` (A-03) — enum `jenis` sudah lengkap
--   E-4 floor price      -> `strategi_pillar.floor_price` + `ck_strpil_floor_sku`
--   F-1…F-6              -> `strategi_resource`  ·  F-7 -> `toleransi_over_persen`
--   G-0                  -> `strategi.tanggal_mulai_siklus` (+ default RA-5)
--   H-1                  -> `strategi_risk`
--   J-1/J-2              -> kolom header  ·  J-3 -> `strategi_version`
--   I-1, J-4             -> TURUNAN, tidak pernah disimpan (seperti D-3/X-11)
--
-- Gerbang jumlah tabel: **76 → 81** (lima tabel anak baru).
--
-- ===========================================================================
-- KENAPA LIMA TABEL, DAN KENAPA BUKAN LEBIH SEDIKIT
-- ===========================================================================
-- Preseden A-07/A-08 dipakai apa adanya: tabel anak untuk daftar berulang,
-- kolom header untuk kardinalitas tetap, jsonb untuk multi-enum tanpa muatan
-- per-item.
--
--   E-12, G-1, G-2  -> "Repeatable struct" di §4  => tabel anak, tidak ada pilihan
--   H-2             -> "Multi-enum + threshold". Muatan per-item (ambang) adalah
--                      yang membedakannya dari D-6: D-6 memakai array jsonb
--                      justru karena ia enum polos, dan containment `<@` hanya
--                      bekerja atas array SKALAR. Array objek akan menukar satu
--                      CHECK skalar dengan ekspresi jsonb yang tidak bisa dibaca
--                      siapa pun — dan set tertutupnya adalah hal terpenting di
--                      field ini (lihat §J-3 di bawah)
--   I-2 + I-4       -> SATU tabel, bukan dua. I-4 ("catatan khusus untuk tiap
--                      divisi eksekusi") ber-key `divisi`, key yang sama dengan
--                      I-2. Tabel terpisah mengizinkan catatan untuk divisi yang
--                      BUKAN penerima Brief — sebuah baris yang tidak punya arti
--                      dan tidak punya pembaca
--   G-3, G-4        -> kardinalitas TETAP satu per Strategi => kolom header
--   I-3             -> "Multi-enum" tanpa muatan per-item => array jsonb, persis D-6
--
-- ===========================================================================
-- E-12 vs C-7 — dua tabel yang mirip, dan kenapa menggabungkannya SALAH
-- ===========================================================================
-- `strategi_prasyarat_klien` (C-7, A-07) sudah menyimpan (item, pic_klien,
-- deadline). E-12 menyimpan (item, kapan, konsekuensi). Godaannya jelas; jangan.
--
--   C-7  = "apa yang harus dibereskan klien SEBELUM eksekusi jalan" — daftar
--          gerbang, sekali, di depan. Tidak ada konsekuensi karena eksekusi
--          belum jalan: konsekuensinya adalah eksekusi tidak dimulai
--   E-12 = "ketergantungan pada klien" SELAMA eksekusi — berulang, dan setiap
--          baris membawa KONSEKUENSI jika terlambat. Itulah bedanya, dan itulah
--          yang membuat E-12 bisa dikutip saat target meleset
--
-- Menggabungkan keduanya berarti `konsekuensi` jadi nullable dan C-7 kehilangan
-- artinya sebagai gerbang. PRD menulis keduanya di dua Section berbeda dengan
-- struct berbeda; aturan rumah melarang menggabungkan field yang PRD pisahkan.
--
-- ===========================================================================
-- G-3 / G-4 "frekuensi" — TEKS BEBAS, dan itu keputusan, bukan kelalaian
-- ===========================================================================
-- §4 menandai G-3 dan G-4 sebagai **`Struct`**, BUKAN `Enum`/`Multi-enum` —
-- berbeda dari D-6, H-2, dan I-3 yang §4 tandai enum secara eksplisit. PRD tidak
-- pernah menuliskan daftar frekuensi di mana pun, dan satu-satunya field
-- frekuensi as-built (`briefs.recurring_frequency`) juga `varchar` bebas.
--
-- Jadi: teks bebas non-kosong. Mengarang `mingguan/dua_mingguan/bulanan` di sini
-- berarti menciptakan kosakata yang PRD tidak minta lalu menegakkannya dengan
-- CHECK — persis "never invent" yang CLAUDE.md larang. Kalau kelak pemilik
-- memang mau set tertutup, biayanya satu `ADD CONSTRAINT` atas kolom yang sudah
-- ada; sebaliknya (mencabut enum yang sudah diisi produksi) tidak murah.

-- ===========================================================================
-- 1. E-2 — Prioritas channel (kolom di `strategi_channel`)
-- ===========================================================================
-- §4 E-2: "mana engine utama, mana pendukung, mana maintenance + alasan".
-- Tiga nilai itu DITULIS PRD, jadi ini set tertutup yang tidak dikarang.
--
-- Ia hidup di `strategi_channel`, bukan tabel sendiri, dan itu bukan hanya soal
-- normalisasi: `saveChannels` melakukan DELETE-then-INSERT atas seluruh channel
-- Strategi. Kolom E-2 di tabel lain akan tetap hidup sementara channel-nya
-- diganti — atau, kalau ia di tabel anak ber-FK, terhapus diam-diam setiap kali
-- AM menyimpan Section B. Satu baris, satu jalur tulis.
ALTER TABLE strategi_channel
    ADD COLUMN IF NOT EXISTS prioritas        varchar(16) NULL,
    ADD COLUMN IF NOT EXISTS prioritas_alasan text        NULL;

ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strchan_prioritas;
ALTER TABLE strategi_channel
    ADD CONSTRAINT ck_strchan_prioritas CHECK (
        prioritas IS NULL
     OR prioritas IN ('engine_utama', 'pendukung', 'maintenance'));

ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strchan_prioritas_alasan;
ALTER TABLE strategi_channel
    ADD CONSTRAINT ck_strchan_prioritas_alasan CHECK (
        prioritas_alasan IS NULL OR btrim(prioritas_alasan) <> '');

COMMENT ON COLUMN strategi_channel.prioritas IS
  'M6A §4 E-2 — peran channel: engine_utama / pendukung / maintenance. Ketiga '
  'nilai ditulis PRD sendiri. Tier §4.1: DEFAULT SHAREABLE (E-1→E-3). Wajib di '
  'gerbang submit per channel, bukan NOT NULL (§7 autosave).';
COMMENT ON COLUMN strategi_channel.prioritas_alasan IS
  'M6A §4 E-2 — alasan di balik prioritas channel ("+ alasan" di §4).';

-- ===========================================================================
-- 2. E-12 — Ketergantungan pada klien (tabel anak)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS strategi_ketergantungan_klien (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    item            text            NOT NULL,  -- apa yang klien harus sediakan
    kapan           text            NOT NULL,  -- kapan — teks, BUKAN date: §4
                                               -- mencontohkan "tiap tgl 1" dan
                                               -- "H-7 sebelum campaign", yang
                                               -- keduanya bukan satu tanggal
    konsekuensi     text            NOT NULL,  -- konsekuensi jika terlambat

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strkkl_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    -- Ketiganya NOT NULL **dan** non-kosong: sebuah ketergantungan tanpa
    -- konsekuensi adalah C-7 yang ditulis di Section yang salah, dan
    -- konsekuensi adalah satu-satunya alasan E-12 ada terpisah dari C-7.
    CONSTRAINT ck_strkkl_isi CHECK (
        btrim(item) <> '' AND btrim(kapan) <> '' AND btrim(konsekuensi) <> '')
);

CREATE INDEX IF NOT EXISTS idx_strkkl_strategi
    ON strategi_ketergantungan_klien (strategi_id);
DROP TRIGGER IF EXISTS trg_strategi_ketergantungan_klien_updated_at
    ON strategi_ketergantungan_klien;
CREATE TRIGGER trg_strategi_ketergantungan_klien_updated_at
    BEFORE UPDATE ON strategi_ketergantungan_klien
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_ketergantungan_klien IS
  'M6A §4 E-12 — ketergantungan pada klien SELAMA eksekusi: apa, kapan, dan '
  'konsekuensi jika terlambat. BUKAN duplikat C-7 (strategi_prasyarat_klien): '
  'C-7 adalah gerbang sebelum eksekusi mulai dan tidak punya konsekuensi. '
  'Min 1 baris (W), diperiksa di checkCompleteness. Tier §4.1: shareable.';

-- ===========================================================================
-- 3. G-1 — Fase kerja (tabel anak, min 2)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS strategi_fase (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    nama            text            NOT NULL,
    tanggal_mulai   date            NOT NULL,
    tanggal_akhir   date            NOT NULL,
    tujuan          text            NOT NULL,
    kriteria_lulus  text            NOT NULL,

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strfase_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strfase_isi CHECK (
        btrim(nama) <> '' AND btrim(tujuan) <> '' AND btrim(kriteria_lulus) <> ''),
    -- Rentang tanggal yang terbalik adalah fase yang tidak pernah berjalan, dan
    -- H-3 ("skenario mundur jika strategi utama gagal di FASE 1") menggantungkan
    -- artinya pada fase yang punya akhir.
    CONSTRAINT ck_strfase_rentang CHECK (tanggal_akhir >= tanggal_mulai)
);

CREATE INDEX IF NOT EXISTS idx_strfase_strategi ON strategi_fase (strategi_id, urutan);
DROP TRIGGER IF EXISTS trg_strategi_fase_updated_at ON strategi_fase;
CREATE TRIGGER trg_strategi_fase_updated_at
    BEFORE UPDATE ON strategi_fase
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_fase IS
  'M6A §4 G-1 — fase kerja: nama, rentang tanggal, tujuan, kriteria lulus. '
  'Min 2 baris (§4 "Repeatable struct (min 2)"), diperiksa di checkCompleteness: '
  'satu fase bukan sebuah kalender. Fase TIDAK dipakai membentuk periode Plan — '
  'itu G-0 + Rule 17 (anniversary-month); keduanya sengaja terpisah.';

-- ===========================================================================
-- 4. G-2 — Tanggal besar (tabel anak)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS strategi_tanggal_besar (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    tanggal         date            NOT NULL,
    nama            text            NOT NULL,  -- 9.9, payday, Ramadan, Harbolnas
    peran           text            NOT NULL,  -- "peran tiap tanggal" (§4 G-2)

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strtgl_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strtgl_isi CHECK (btrim(nama) <> '' AND btrim(peran) <> '')
);

CREATE INDEX IF NOT EXISTS idx_strtgl_strategi
    ON strategi_tanggal_besar (strategi_id, tanggal);
DROP TRIGGER IF EXISTS trg_strategi_tanggal_besar_updated_at ON strategi_tanggal_besar;
CREATE TRIGGER trg_strategi_tanggal_besar_updated_at
    BEFORE UPDATE ON strategi_tanggal_besar
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_tanggal_besar IS
  'M6A §4 G-2 — tanggal besar dalam periode kontrak + peran tiap tanggal. '
  'Min 1 baris (W). Dibaca M6B Rule 7: distribusi mingguan Plan di-reweight ke '
  'minggu yang memuat tanggal ini — jadi indeksnya ber-key (strategi_id, tanggal).';

-- ===========================================================================
-- 5. H-2 — Trigger revisi (tabel anak) + PENUTUPAN SET J-3
-- ===========================================================================
-- §4 H-2 MENULIS daftarnya sendiri, jadi tujuh kode di bawah adalah transkripsi,
-- bukan karangan:
--
--   pencapaian <X% target 2 bulan berturut  -> pencapaian_di_bawah_target (+ambang %)
--   klien ubah lini produk                  -> klien_ubah_lini_produk
--   stok kosong >X hari                     -> stok_kosong               (+ambang hari)
--   budget iklan dipotong                   -> budget_iklan_dipotong
--   perubahan kebijakan platform            -> kebijakan_platform_berubah
--   ganti PIC klien                         -> ganti_pic_klien
--   lainnya                                 -> lainnya                   (+catatan wajib)
--
-- ⚠️ **Ini juga menutup lubang di J-3 yang sudah ada sejak A-03.**
-- `strategi_version.trigger_revisi` adalah array jsonb yang selama ini menerima
-- string APA PUN, sementara Rule 13 menuntut "a trigger from the enumerated
-- list" dan §4 J-3 menulis "(dari H-2)". Sampai hari ini daftar itu tidak ada,
-- jadi CHECK-nya hanya bisa memeriksa panjang array. Sekarang daftarnya ada —
-- dan membiarkan J-3 tetap bebas berarti membuat DUA daftar untuk satu hal,
-- kelas cacat yang O48 dan O51 sudah dua kali dibayar. Set-nya ditutup di §5b.
CREATE TABLE IF NOT EXISTS strategi_trigger_revisi (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    kode            varchar(32)     NOT NULL,
    -- Satu kolom ambang, bukan dua: unitnya ditentukan `kode` (persen untuk
    -- pencapaian, hari untuk stok). Dua kolom yang salah satunya selalu NULL
    -- memberi ruang untuk mengisi keduanya, dan tidak ada CHECK yang membuat
    -- "ambang_hari pada trigger persen" bisa dibaca sebagai kesalahan.
    ambang          numeric(12,2)   NULL,
    catatan         text            NULL,

    urutan          smallint        NOT NULL DEFAULT 0,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strtrg_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strtrg_kode CHECK (kode IN (
        'pencapaian_di_bawah_target', 'klien_ubah_lini_produk', 'stok_kosong',
        'budget_iklan_dipotong', 'kebijakan_platform_berubah', 'ganti_pic_klien',
        'lainnya')),
    -- Kesetaraan, bukan implikasi: ambang WAJIB untuk dua kode yang §4 tulis
    -- dengan "X", dan WAJIB NULL untuk lima sisanya. Arah kedua itu yang membuat
    -- "stok kosong >30" tidak bisa disimpan sebagai "ganti PIC klien >30".
    CONSTRAINT ck_strtrg_ambang CHECK (
        (kode IN ('pencapaian_di_bawah_target', 'stok_kosong')) = (ambang IS NOT NULL)),
    CONSTRAINT ck_strtrg_ambang_positif CHECK (ambang IS NULL OR ambang > 0),
    -- Persen: "<X% target" hanya bermakna sampai 100.
    CONSTRAINT ck_strtrg_ambang_persen CHECK (
        kode <> 'pencapaian_di_bawah_target' OR ambang <= 100),
    -- `lainnya` tanpa penjelasan adalah trigger yang tidak bisa dinyalakan
    -- siapa pun: §5 langkah 10 menuntut sistem tahu KAPAN ia terpicu.
    CONSTRAINT ck_strtrg_lainnya CHECK (
        kode <> 'lainnya' OR (catatan IS NOT NULL AND btrim(catatan) <> ''))
);

-- Satu kode dipilih sekali — kecuali `lainnya`, yang justru bisa beberapa karena
-- yang membedakan barisnya adalah catatannya, bukan kodenya.
CREATE UNIQUE INDEX IF NOT EXISTS uq_strtrg_kode
    ON strategi_trigger_revisi (strategi_id, kode) WHERE kode <> 'lainnya';
CREATE INDEX IF NOT EXISTS idx_strtrg_strategi ON strategi_trigger_revisi (strategi_id);
DROP TRIGGER IF EXISTS trg_strategi_trigger_revisi_updated_at ON strategi_trigger_revisi;
CREATE TRIGGER trg_strategi_trigger_revisi_updated_at
    BEFORE UPDATE ON strategi_trigger_revisi
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_trigger_revisi IS
  'M6A §4 H-2 — trigger revisi yang dipilih untuk klien ini (multi-enum + '
  'threshold). Tujuh kode ditranskripsi dari §4 H-2. Min 1 baris (W). Set yang '
  'SAMA dipakai strategi_version.trigger_revisi (J-3) lewat ck_strver_trigger_set '
  '— satu daftar, bukan dua. Tier §4.1: H-2 shareable.';
COMMENT ON COLUMN strategi_trigger_revisi.ambang IS
  'Ambang numerik untuk dua kode yang §4 tulis dengan "X": persen untuk '
  'pencapaian_di_bawah_target (<=100), HARI untuk stok_kosong. Unit ditentukan '
  'kode; wajib untuk kedua kode itu dan wajib NULL untuk lima kode lainnya.';

-- ---------------------------------------------------------------------------
-- 5b. J-3 ditutup ke set yang sama (Rule 13 "from the enumerated list")
-- ---------------------------------------------------------------------------
-- `strategi_version` append-only; ini penambahan CONSTRAINT, bukan mutasi baris,
-- jadi trigger `forbid_mutation` tidak tersentuh.
--
-- Yang CHECK ini TIDAK bisa lakukan, dan karena itu ditulis alih-alih
-- diasumsikan: memaksa J-3 ⊆ H-2 **Strategi ini** (bukan hanya ⊆ set global) —
-- itu perbandingan lintas baris, dan CHECK tidak boleh ber-subquery. Penegaknya
-- ada di domain (`openRevision`, MSG_TRIGGER_NOT_DECLARED). CHECK di sini adalah
-- lantainya: nol string karangan bisa masuk riwayat, apa pun jalur tulisnya.
ALTER TABLE strategi_version DROP CONSTRAINT IF EXISTS ck_strver_trigger_set;
ALTER TABLE strategi_version
    ADD CONSTRAINT ck_strver_trigger_set CHECK (
        trigger_revisi <@ '["pencapaian_di_bawah_target", "klien_ubah_lini_produk",
                            "stok_kosong", "budget_iklan_dipotong",
                            "kebijakan_platform_berubah", "ganti_pic_klien",
                            "lainnya"]'::jsonb);

COMMENT ON COLUMN strategi_version.trigger_revisi IS
  'M6A §4 J-3 — trigger yang terpicu, DARI H-2. Set tertutup identik dengan '
  'ck_strtrg_kode (A-09b); kalau salah satu dilebarkan, yang lain wajib ikut di '
  'commit yang SAMA. Subset per-Strategi ditegakkan domain, bukan CHECK.';

-- ===========================================================================
-- 6. G-3 / G-4 / I-3 — kolom header
-- ===========================================================================
ALTER TABLE strategi
    -- G-3 (W): frekuensi, format laporan, PIC. Tiga kolom, bukan tabel anak —
    -- kardinalitasnya tetap satu jadwal review klien per Strategi.
    ADD COLUMN IF NOT EXISTS review_klien_frekuensi    text  NULL,
    ADD COLUMN IF NOT EXISTS review_klien_format       text  NULL,
    ADD COLUMN IF NOT EXISTS review_klien_pic          text  NULL,
    -- G-4 (W): §4 hanya minta frekuensi. PIC-nya tidak ditanyakan karena
    -- reviewer internal sudah ditentukan struktur (SPV Account), bukan diketik.
    ADD COLUMN IF NOT EXISTS review_internal_frekuensi text  NULL,
    -- I-3 (W): multi-enum, pola D-6 apa adanya.
    ADD COLUMN IF NOT EXISTS metrik_laporan_klien      jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_review_isi;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_review_isi CHECK (
        (review_klien_frekuensi    IS NULL OR btrim(review_klien_frekuensi)    <> '')
    AND (review_klien_format       IS NULL OR btrim(review_klien_format)       <> '')
    AND (review_klien_pic          IS NULL OR btrim(review_klien_pic)          <> '')
    AND (review_internal_frekuensi IS NULL OR btrim(review_internal_frekuensi) <> ''));

-- I-3: array, dan keanggotaan set tertutup lewat containment — sama persis
-- dengan `ck_strategi_leading_indicator` (D-6), termasuk alasannya: CHECK tidak
-- boleh ber-subquery, dan containment memberi set tertutup tanpa JOIN di jalur
-- tulis.
--
-- ⚠️ Set = kosakata metrik D-4 (`ck_strtg_metric`) apa adanya, untuk alasan yang
-- SAMA dengan D-6/X-13: §4 I-3 menulis "Multi-enum" tanpa pernah menulis
-- daftarnya. Nol vocabulary dikarang. **Dibuka sebagai X-14** di
-- `docs/backlog/M6ABC_BACKLOG.md` — pertanyaannya: apakah laporan klien bulanan
-- memuat metrik yang BUKAN metrik target D-4. Membalikkannya murah selama belum
-- ada Strategi live yang memilihnya (satu ALTER + satu literal), dan ada test
-- yang meng-assert ketiga set (D-4, D-6, I-3) identik supaya ia tidak bisa
-- menyimpang diam-diam.
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_metrik_laporan;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_metrik_laporan CHECK (
        jsonb_typeof(metrik_laporan_klien) = 'array'
    AND metrik_laporan_klien <@ '["gmv", "pengunjung", "cr", "aov", "roas_min",
                                  "acos_maks", "sku_winner", "affiliate_aktif",
                                  "jam_live", "jumlah_video"]'::jsonb);

COMMENT ON COLUMN strategi.review_klien_frekuensi IS
  'M6A §4 G-3 — frekuensi review dengan klien. TEKS BEBAS: §4 menandai G-3 '
  '"Struct", bukan Enum, dan PRD tidak pernah menulis daftar frekuensi.';
COMMENT ON COLUMN strategi.review_klien_format IS
  'M6A §4 G-3 — format laporan yang dipakai di review klien.';
COMMENT ON COLUMN strategi.review_klien_pic IS
  'M6A §4 G-3 — PIC review dari sisi MEA.';
COMMENT ON COLUMN strategi.review_internal_frekuensi IS
  'M6A §4 G-4 — frekuensi review internal SPV. Teks bebas, alasan sama dengan G-3.';
COMMENT ON COLUMN strategi.metrik_laporan_klien IS
  'M6A §4 I-3 — metrik yang ditarik ke laporan klien bulanan. Set tertutup = '
  'kosakata metrik D-4 (ck_strtg_metric); PRD tidak menulis daftarnya sendiri '
  '(pertanyaan terbuka X-14, sekelas X-13/D-6). Min 1 di gerbang submit.';

-- ===========================================================================
-- 7. I-2 + I-4 — Divisi penerima Brief, urutan dispatch, catatan per divisi
-- ===========================================================================
-- Set divisi = `ALLOWED_DIVISIONS` di `packages/domain/src/account.ts`, yang
-- juga set `briefs.assigned_division`. Itu bukan pilihan gaya: I-2 menyebut
-- "divisi PENERIMA BRIEF", jadi set yang benar adalah set divisi yang bisa
-- menerima Brief — daftar kedua akan mengizinkan Strategi men-dispatch ke divisi
-- yang tidak punya papan Brief.
--
-- ⚠️ `Live Stream` IKUT, dan itu sengaja walau Rule 18 bilang MEA tidak menaruh
-- host internal. As-built `briefs.assigned_division` memang memuat Live Stream
-- (20260722055450 §9.4: "Live Stream briefs skip the task machine ... carry an
-- off-machine marker"), jadi Brief Live Stream ADA — ia berujung ke vendor
-- tracker, bukan ke mesin task. Mengeluarkannya dari I-2 akan membuat Strategi
-- tidak bisa menyatakan urutan dispatch untuk pekerjaan yang jelas-jelas
-- di-dispatch.
CREATE TABLE IF NOT EXISTS strategi_dispatch (
    id              bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)     NOT NULL,

    divisi          varchar(24)     NOT NULL,
    urutan          smallint        NOT NULL,
    -- I-4 (`O`): "catatan khusus untuk tiap divisi eksekusi". Ber-key divisi,
    -- key yang sama dengan I-2 => kolom di baris yang sama, bukan tabel kedua.
    catatan         text            NULL,

    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    created_by      varchar(64)     NOT NULL,

    CONSTRAINT fk_strdisp_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strdisp_divisi CHECK (divisi IN ('Creative', 'Ads', 'KOL', 'Live Stream')),
    CONSTRAINT ck_strdisp_urutan CHECK (urutan >= 1),
    CONSTRAINT ck_strdisp_catatan CHECK (catatan IS NULL OR btrim(catatan) <> '')
);

-- Satu divisi muncul sekali, dan satu posisi urutan dipakai sekali. Yang kedua
-- yang penting: "urutan dispatch" dengan dua divisi di posisi 1 bukan urutan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_strdisp_divisi
    ON strategi_dispatch (strategi_id, divisi);
CREATE UNIQUE INDEX IF NOT EXISTS uq_strdisp_urutan
    ON strategi_dispatch (strategi_id, urutan);
DROP TRIGGER IF EXISTS trg_strategi_dispatch_updated_at ON strategi_dispatch;
CREATE TRIGGER trg_strategi_dispatch_updated_at
    BEFORE UPDATE ON strategi_dispatch
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE strategi_dispatch IS
  'M6A §4 I-2 (divisi penerima Brief + urutan dispatch) + I-4 (catatan per '
  'divisi, opsional) — satu tabel karena keduanya ber-key divisi. Set divisi '
  'identik dengan briefs.assigned_division / ALLOWED_DIVISIONS. Min 1 baris (W).';

-- ===========================================================================
-- 8. RLS — lima tabel baru, pola `jwt_can_read_strategi` yang sama
-- ===========================================================================
-- Baca-saja untuk `authenticated`; seluruh tulis lewat service-role di domain,
-- persis tabel anak Strategi lainnya (A-03/A-07/A-08). Nol perubahan untuk
-- kolom baru di `strategi` dan `strategi_channel`: row-scope-nya sudah dipikul
-- policy tabel induknya.
--
-- Tier §4.1 untuk kolom-kolom ini semuanya **shareable** (E-2, G-*, H-2, I-2,
-- I-3) kecuali I-4 yang §4.1 tidak sebut sama sekali — dan "tidak disebut"
-- berarti masuk "default shareable" menurut baris terakhir tabel §4.1. Penegak
-- tier tetap A-10; ini catatan supaya A-10 tidak menebak.

-- strategi_ketergantungan_klien
REVOKE ALL ON public.strategi_ketergantungan_klien FROM anon;
REVOKE ALL ON public.strategi_ketergantungan_klien FROM authenticated;
GRANT SELECT ON public.strategi_ketergantungan_klien TO authenticated;
ALTER TABLE public.strategi_ketergantungan_klien ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategi_ketergantungan_klien_select ON public.strategi_ketergantungan_klien;
CREATE POLICY strategi_ketergantungan_klien_select ON public.strategi_ketergantungan_klien
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_fase
REVOKE ALL ON public.strategi_fase FROM anon;
REVOKE ALL ON public.strategi_fase FROM authenticated;
GRANT SELECT ON public.strategi_fase TO authenticated;
ALTER TABLE public.strategi_fase ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategi_fase_select ON public.strategi_fase;
CREATE POLICY strategi_fase_select ON public.strategi_fase
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_tanggal_besar
REVOKE ALL ON public.strategi_tanggal_besar FROM anon;
REVOKE ALL ON public.strategi_tanggal_besar FROM authenticated;
GRANT SELECT ON public.strategi_tanggal_besar TO authenticated;
ALTER TABLE public.strategi_tanggal_besar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategi_tanggal_besar_select ON public.strategi_tanggal_besar;
CREATE POLICY strategi_tanggal_besar_select ON public.strategi_tanggal_besar
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_trigger_revisi
REVOKE ALL ON public.strategi_trigger_revisi FROM anon;
REVOKE ALL ON public.strategi_trigger_revisi FROM authenticated;
GRANT SELECT ON public.strategi_trigger_revisi TO authenticated;
ALTER TABLE public.strategi_trigger_revisi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategi_trigger_revisi_select ON public.strategi_trigger_revisi;
CREATE POLICY strategi_trigger_revisi_select ON public.strategi_trigger_revisi
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));

-- strategi_dispatch
REVOKE ALL ON public.strategi_dispatch FROM anon;
REVOKE ALL ON public.strategi_dispatch FROM authenticated;
GRANT SELECT ON public.strategi_dispatch TO authenticated;
ALTER TABLE public.strategi_dispatch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategi_dispatch_select ON public.strategi_dispatch;
CREATE POLICY strategi_dispatch_select ON public.strategi_dispatch
    FOR SELECT TO authenticated
    USING (private.jwt_can_read_strategi(strategi_id));
