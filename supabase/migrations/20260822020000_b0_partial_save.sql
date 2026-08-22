-- CDPS — M6A Section B: izinkan channel row DRAFT tersimpan setengah jalan.
--
-- ## Kenapa (owner QA 2026-08-22, DECISIONS.md)
-- Section B satu channel memuat puluhan field (identitas toko, jendela baseline,
-- 6 grup metrik B-2…B-9, kompetitor). AM tidak selalu bisa mengisinya 100% dalam
-- satu duduk — data platform diambil bertahap. Sampai sekarang autosave GAGAL
-- total begitu satu field wajib kosong: empat CHECK di `strategi_channel`
-- memaksa identitas + kelengkapan Rule 4/5/5a ADA SAAT ROW DISIMPAN, bukan saat
-- Strategi diajukan. Akibatnya pekerjaan yang sudah diisi ikut hilang dan AM
-- melihat `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`
-- padahal ia baru mau menyimpan sebagian.
--
-- Keputusan pemilik: perlakukan `Draft`/`Draft Revisi` sebagai scratchpad.
-- Kelengkapan Rule 3/4/5/5a tetap WAJIB — tapi ditegakkan di GERBANG SUBMIT
-- (`checkCompleteness` di dalam transaksi `submitStrategi`), persis pola yang
-- SUDAH dipakai setiap field Section A/B/C lain: bentuk divalidasi saat simpan,
-- kelengkapan dihitung & dilaporkan saat ajukan (§5 langkah 5). Sebuah channel
-- setengah-isi tidak akan pernah lolos ke reviewer, dan setelah `Aktif`
-- Section A–I terkunci (isEditable=false) sehingga tak bisa dibuat tak lengkap
-- lagi — jadi melepas gerbang "saat istirahat" ini tidak melonggarkan apa pun
-- yang benar-benar sampai ke produksi.
--
-- ## Yang diubah (hanya MELONGGARKAN gerbang kelengkapan — bentuk TETAP dijaga)
--   DROP empat CHECK kelengkapan:
--     * ck_strch_toko        — nama_toko & url_toko wajib non-kosong
--     * ck_strch_belum_aktif — Belum Aktif wajib target_tanggal_live
--     * ck_strch_eksisting   — Eksisting wajib jendela + sumber lengkap
--     * ck_strch_alasan_pendek — jendela <3 bulan wajib alasan
--   Keempatnya kini dilaporkan `checkCompleteness` sebagai kekurangan
--   B-0.3 / B-0.5 / B-0.6 / B-0.8 per channel (muncul di panel "Kekurangan"
--   sebagai penanda bagian yang belum terisi untuk tim AM).
--
-- ## Yang TIDAK diubah (tetap CHECK — ini BENTUK, bukan kelengkapan)
--   ck_strch_channel, ck_strch_channel_lain, ck_strch_status,
--   ck_strch_periode_range (1–6), ck_strch_periode_tanggal (akhir >= mulai),
--   ck_strch_prasyarat_array. Kolom nama_toko/url_toko tetap NOT NULL: draft
--   setengah-isi menyimpan string kosong '' (bukan NULL), dan `checkCompleteness`
--   yang menolak '' saat submit.

ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_toko;
ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_belum_aktif;
ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_eksisting;
ALTER TABLE strategi_channel DROP CONSTRAINT IF EXISTS ck_strch_alasan_pendek;

COMMENT ON TABLE strategi_channel IS
  'M6A Section B-0. DRAFT boleh setengah-isi (owner QA 2026-08-22): kelengkapan '
  'Rule 3/4/5/5a ditegakkan di gerbang submit (checkCompleteness), bukan CHECK '
  'saat row disimpan. Yang tersisa sebagai CHECK hanyalah BENTUK (enum channel/'
  'status, rentang periode 1–6, urutan tanggal).';
