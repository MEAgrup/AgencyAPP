-- ===========================================================================
-- R3 — laporan klien dibaca per TAHAP perjalanan pembeli
--      (Awareness → Consideration → Conversion)
-- ===========================================================================
--
-- MASALAH. `client_reports.payload` menyusun laporan per SUMBER DATA: `kpi`,
-- `kanal`, `iklan`, `live`, `video`, `produk`, `afiliasi`, `tokopedia`,
-- `ads_manager`. Susunan itu benar untuk MEA yang tahu tiap berkas datang dari
-- mana, tapi ia tidak bisa menjawab pertanyaan yang dibawa klien: "toko saya
-- sudah sampai mana?"
--
-- Klien masuk ke MEA dengan tahap bisnis berbeda. Toko yang baru sebulan wajar
-- berat di Awareness dan TIDAK adil dinilai dari Conversion — sementara laporan
-- per-sumber menampilkan CVR merah di halaman pertama tanpa konteks bahwa
-- bulan ini uangnya memang sengaja tidak diarahkan ke sana.
--
-- Deviasi tercatat dari PRD M13 (yang tidak menyebut tahap funnel sama sekali):
-- lihat docs/DECISIONS.md 2026-09-05.
--
-- BENTUK YANG DIPILIH. Dua kolom, nol tabel baru:
--
--   1. `client_platforms.tahap_fokus` — tahap yang SEDANG dikejar untuk toko
--      itu. Ditetapkan MANUAL oleh AM (keputusan pemilik 2026-09-05), bukan
--      dihitung mesin: usia toko, isi brief, dan kesepakatan bulan berjalan
--      tidak terbaca dari satu pun export TikTok. Konsekuensinya diterima sadar
--      — dua AM bisa menilai klien serupa berbeda.
--
--   2. `client_report_insight.tahap_narasi` — prosa per tahap ("apa yang
--      berhasil", "peluang yang kami lihat"). Itu SARAN, jadi tempatnya di
--      tabel revisi append-only bersama narasi lain, BUKAN di `payload` yang
--      beku. Angka tahap tetap turunan murni dari metrik yang sudah dihitung
--      dan tidak punya satu pun jalur input manual (aturan rumah #4).
--
-- MENGAPA `tahap_fokus` DI `client_platforms`, BUKAN DI `client_reports`.
-- Tahap adalah sifat TOKO yang berjalan lintas periode, bukan sifat satu
-- laporan; menaruhnya di laporan berarti AM mengetiknya ulang tiap bulan dan
-- tidak ada satu tempat pun yang menjawab "toko ini sekarang di tahap apa".
-- Nilainya DI-STEMPEL ke `payload.tahap.fokus` saat laporan dibuat, jadi
-- laporan lama tidak berubah artinya ketika AM memindahkan tahap bulan depan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tahap fokus per toko
--
--    SENGAJA TANPA DEFAULT. Default diam-diam berarti setiap klien yang sudah
--    ada tiba-tiba "fokus Awareness" tanpa seorang pun memutuskannya — dan
--    laporan akan memasang lencana fokus atas nama AM yang tidak pernah
--    memilihnya. NULL = belum ditetapkan, dan itu keadaan yang sah: laporan
--    tetap terbit dengan ketiga tahap ditampilkan setara, tanpa lencana.
-- ---------------------------------------------------------------------------
ALTER TABLE client_platforms ADD COLUMN tahap_fokus varchar(16) NULL;

ALTER TABLE client_platforms ADD CONSTRAINT ck_cp_tahap_fokus
    CHECK (tahap_fokus IS NULL OR tahap_fokus IN ('awareness', 'consideration', 'conversion'));

COMMENT ON COLUMN client_platforms.tahap_fokus IS
  'R3 — tahap perjalanan pembeli yang sedang dikejar untuk toko ini '
  '(awareness | consideration | conversion). DITETAPKAN MANUAL oleh AM, tidak '
  'dihitung mesin: konteks yang menentukannya (usia toko, brief, kesepakatan '
  'bulan berjalan) tidak ada di export mana pun. NULL = belum ditetapkan; '
  'laporan tetap terbit tanpa lencana fokus. Nilainya distempel ke '
  'payload.tahap.fokus saat laporan dibuat, jadi laporan lama tidak ikut '
  'berubah saat tahapnya dipindahkan.';

-- ---------------------------------------------------------------------------
-- 2. Narasi per tahap — ikut ke tabel revisi, bukan ke payload
--
--    `DEFAULT '[]'` aman untuk baris yang sudah ada: trigger append-only
--    melarang UPDATE/DELETE *baris*, bukan DDL, dan setiap revisi lama memang
--    lahir sebelum tahap ada — array kosong adalah kebenarannya, bukan
--    tambalan. Renderer melewati blok narasi tahap saat arraynya kosong.
--
--    Bentuk isi: [{tahap, judul, teks}] dengan `tahap` salah satu dari tiga
--    kunci. Bentuknya divalidasi di `insight-edit.ts` (pesan BI); CHECK di sini
--    hanya menjaga hal yang tidak boleh lolos ke renderer dalam keadaan apa pun
--    — sebuah objek/skalar yang akan dirender jadi `[object Object]` di laporan
--    yang dibaca klien (alasan sama dengan ck_cri_bentuk_json di C1).
-- ---------------------------------------------------------------------------
ALTER TABLE client_report_insight ADD COLUMN tahap_narasi jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE client_report_insight ADD CONSTRAINT ck_cri_tahap_narasi
    CHECK (jsonb_typeof(tahap_narasi) = 'array');

COMMENT ON COLUMN client_report_insight.tahap_narasi IS
  'R3 — prosa per tahap funnel: [{tahap,judul,teks}]. Ikut revisi append-only '
  'karena ia SARAN; angka tahap tetap turunan payload yang beku dan tidak '
  'punya jalur input manual. Array kosong = revisi lahir sebelum R3, atau AM '
  'belum menulis narasi tahap — renderer melewati bloknya.';
