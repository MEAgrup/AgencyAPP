-- CDPS — O58: "tidak ada" dibedakan dari "belum dijawab" (DECISIONS 2026-08-07).
--
-- ---------------------------------------------------------------------------
-- MASALAH YANG DITUTUP
-- ---------------------------------------------------------------------------
-- M6A Rule 5 dibangun justru untuk memisahkan keduanya — *"`0` is a valid
-- answer, blank is not"* — tapi Rule 5 hanya berbicara tentang ANGKA. Untuk
-- field `W` berbentuk DAFTAR, daftar kosong berarti dua hal yang berbeda:
--
--   * "tidak ada"     — klien memang tidak punya pantangan / MEA memproduksi
--                       semua aset / toko tidak ikut program apa pun. Ini
--                       JAWABAN.
--   * "belum diisi"   — AM belum sampai ke pertanyaan itu. Ini BUKAN jawaban.
--
-- Sampai sekarang keduanya tersimpan identik: nol baris. Konsekuensinya persis
-- yang dicatat O58 — seorang AM bisa mengajukan Strategi dengan A-11 (pantangan
-- klien) kosong tanpa pernah ditanya, dan tidak ada cara membedakan itu dari
-- "sudah dipertimbangkan, memang tidak ada". Kalau kemudian Creative memproduksi
-- konten yang melanggar pantangan legal klien, sistem tidak bisa menjawab
-- pertanyaan "apakah ini pernah ditanyakan".
--
-- Keputusan pemilik: pilihan (a) — checkbox eksplisit "tidak ada" per field.
--
-- ---------------------------------------------------------------------------
-- LIMA FIELD, BUKAN ENAM
-- ---------------------------------------------------------------------------
-- O58 menyebut "enam field", tapi menghitung B-3.5/B-4.5 yang SUDAH opsional
-- (`O`) dan karena itu tidak pernah digerbangi. Yang benar-benar terpengaruh —
-- `W`, berbentuk daftar, dan kosongnya sah — ada lima:
--
--   A-11 pantangan_klien   (strategi)          — klien tanpa larangan eksplisit
--   A-14 aset_dari_klien   (strategi)          — MEA memproduksi semuanya
--   B-5.3 tipe_kampanye    (strategi_channel)  — channel tidak beriklan
--   B-8.1 voucher_aktif    (strategi_channel)  — toko tanpa voucher berjalan
--   B-8.2 program_platform (strategi_channel)  — toko tidak ikut program
--
-- Yang SENGAJA tidak mendapat checkbox: A-5 (min 3 eksplisit), A-12 (klien tanpa
-- decision maker bukan jawaban), B-3.3 (E-3 memilih hero SKU dari sini),
-- B-9.1/B-9.2 (C-4 membandingkan terhadapnya). Untuk kelima itu daftar kosong
-- membuat aturan HILIR tidak punya bacaan, jadi "tidak ada" memang bukan jawaban
-- yang sah — memberi mereka checkbox akan memindahkan kegagalan dari gerbang
-- submit ke tempat yang jauh lebih sulit didiagnosis.
--
-- ---------------------------------------------------------------------------
-- DI MANA ATURANNYA DITEGAKKAN, DAN KENAPA TERBELAH
-- ---------------------------------------------------------------------------
-- Ada DUA aturan berbeda di sini, dan mereka hidup di lapisan berbeda karena
-- mereka berlaku di saat yang berbeda:
--
--   1. KONTRADIKSI (daftar terisi DAN "tidak ada" dicentang) tidak pernah sah,
--      di state mana pun, Draft sekalipun. Itu CHECK di bawah — state seperti
--      itu tidak boleh bisa DISIMPAN.
--
--   2. BELUM DIJAWAB (daftar kosong DAN checkbox tidak dicentang) sepenuhnya
--      sah selama Draft — begitulah rupa form yang setengah diisi. Ia hanya
--      salah pada SUBMIT. Itu gerbang di `checkCompleteness`, bukan CHECK; kalau
--      ditaruh di CHECK, AM tidak akan bisa menyimpan draft sama sekali.
--
-- Menaruh keduanya di satu tempat adalah cara paling cepat membuat salah satu
-- dari dua fitur itu rusak.

-- ---------------------------------------------------------------------------
-- 1. Section A — dua kolom di `strategi`
-- ---------------------------------------------------------------------------
ALTER TABLE strategi
    ADD COLUMN pantangan_klien_tidak_ada boolean NOT NULL DEFAULT false,
    ADD COLUMN aset_dari_klien_tidak_ada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN strategi.pantangan_klien_tidak_ada IS
    'A-11 (O58): AM menyatakan klien TIDAK punya pantangan. Berbeda dari daftar kosong, yang berarti belum dijawab.';
COMMENT ON COLUMN strategi.aset_dari_klien_tidak_ada IS
    'A-14 (O58): AM menyatakan klien TIDAK menyediakan aset apa pun. Berbeda dari daftar kosong.';

-- DEFAULT false aman untuk baris yang sudah ada: sebelum migrasi ini setiap
-- daftar kosong berarti "belum dijawab", dan false adalah persis bacaan itu.
-- Tidak ada Strategi produksi yang tiba-tiba mengklaim "tidak ada".

ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_pantangan_tidak_ada CHECK (
        NOT (pantangan_klien_tidak_ada
             AND jsonb_array_length(COALESCE(pantangan_klien, '[]'::jsonb)) > 0)
    ),
    ADD CONSTRAINT ck_strategi_aset_tidak_ada CHECK (
        NOT (aset_dari_klien_tidak_ada
             AND jsonb_array_length(COALESCE(aset_dari_klien, '[]'::jsonb)) > 0)
    );

-- ---------------------------------------------------------------------------
-- 2. Section B — tiga kolom di `strategi_channel`
-- ---------------------------------------------------------------------------
ALTER TABLE strategi_channel
    ADD COLUMN tipe_kampanye_tidak_ada    boolean NOT NULL DEFAULT false,
    ADD COLUMN voucher_aktif_tidak_ada    boolean NOT NULL DEFAULT false,
    ADD COLUMN program_platform_tidak_ada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN strategi_channel.tipe_kampanye_tidak_ada IS
    'B-5.3 (O58): channel ini TIDAK menjalankan kampanye iklan. Berbeda dari daftar kosong.';
COMMENT ON COLUMN strategi_channel.voucher_aktif_tidak_ada IS
    'B-8.1 (O58): toko TIDAK menjalankan voucher/promo di channel ini. Berbeda dari daftar kosong.';
COMMENT ON COLUMN strategi_channel.program_platform_tidak_ada IS
    'B-8.2 (O58): toko TIDAK mengikuti program platform apa pun. Berbeda dari daftar kosong.';

ALTER TABLE strategi_channel
    ADD CONSTRAINT ck_strch_tipe_kampanye_tidak_ada CHECK (
        NOT (tipe_kampanye_tidak_ada
             AND jsonb_array_length(COALESCE(tipe_kampanye, '[]'::jsonb)) > 0)
    ),
    ADD CONSTRAINT ck_strch_voucher_tidak_ada CHECK (
        NOT (voucher_aktif_tidak_ada
             AND jsonb_array_length(COALESCE(voucher_aktif, '[]'::jsonb)) > 0)
    ),
    ADD CONSTRAINT ck_strch_program_tidak_ada CHECK (
        NOT (program_platform_tidak_ada
             AND jsonb_array_length(COALESCE(program_platform, '[]'::jsonb)) > 0)
    );

-- ---------------------------------------------------------------------------
-- 3. Konsistensi angka pendamping — B-5 dan B-8
-- ---------------------------------------------------------------------------
-- Sebelum O58, gerbang B-5/B-8 bersandar pada angka pendampingnya
-- (`jumlah_kampanye_aktif`, `beban_promo_persen`) karena `0`-nya sah dan karena
-- itu membuktikan pertanyaannya sudah dijawab. Angka itu TETAP digerbangi — dua
-- jalur bukti yang berbeda, dan keduanya murah.
--
-- Tapi begitu checkbox ada, satu kombinasi menjadi omong kosong yang bisa
-- disimpan: "tidak ada kampanye" dicentang sementara `jumlah_kampanye_aktif`
-- lebih dari nol. CHECK di bawah menutupnya. NULL sengaja dibiarkan lolos —
-- draft yang belum mengisi angkanya masih harus bisa disimpan.
ALTER TABLE strategi_channel
    ADD CONSTRAINT ck_strch_kampanye_nol_konsisten CHECK (
        NOT (tipe_kampanye_tidak_ada AND COALESCE(jumlah_kampanye_aktif, 0) > 0)
    );
