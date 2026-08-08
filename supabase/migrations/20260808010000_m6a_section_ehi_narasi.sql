-- CDPS — Module 6A A-09a: field NARASI Section E & H — E-1, E-13, H-3, H-4
--
-- ===========================================================================
-- KENAPA A-09 DIPOTONG, DAN DI MANA POTONGANNYA
-- ===========================================================================
-- A-09 sebagaimana ditulis backlog = "Section E/F/G/H/I/J". Dibaca terhadap
-- as-built, sebagian besarnya SUDAH ADA sejak A-03 dan yang tersisa tidak
-- merata:
--
--   E-3…E-11  -> `strategi_pillar` (enum `jenis` sudah memuat sku/harga/iklan/
--                konten/affiliate/live/retensi/operasional/tidak_dikerjakan)
--   F-1…F-6   -> `strategi_resource`  ·  F-7 -> `strategi.toleransi_over_persen`
--   H-1       -> `strategi_risk`      ·  G-0 -> `strategi.tanggal_mulai_siklus`
--   J-1/J-2   -> kolom header         ·  J-3 -> `strategi_version`
--   I-1, J-4  -> TURUNAN, tidak pernah disimpan
--
-- Yang benar-benar belum ada: E-1, E-2, E-12, E-13 · G-1, G-2, G-3, G-4 ·
-- H-2, H-3, H-4 · I-2, I-3, I-4. Itu ~4 tabel anak + ~14 kolom header — dua kali
-- ukuran A-08, dan enam seksi yang mendarat separuh lebih buruk daripada dua
-- seksi yang mendarat utuh (pelajaran O43/O48: satu fitur setengah jadi
-- menciptakan versi kedua dari aturan yang sama).
--
-- Migrasi ini mengambil potongan yang PALING tidak saling bergantung: **empat
-- field narasi di header**. Keempatnya `Long text`, nol tabel anak, nol relasi
-- baru — jadi ia tidak bisa mendahului keputusan bentuk untuk G-1/G-2/I-4 yang
-- memang butuh tabel anak.
--
--   E-1  growth thesis        — 1 paragraf, dan ia adalah TESIS yang seluruh
--                               Section E lain menuruni; tanpa ia, `strategi_pillar`
--                               berisi taktik tanpa alasan
--   E-13 urutan eksekusi      — KENAPA pilar A didahulukan dari pilar B.
--                               `strategi_pillar.urutan` menyimpan urutannya;
--                               ia tidak pernah menyimpan alasannya
--   H-3  skenario mundur      — fallback kalau strategi utama gagal di fase 1
--   H-4  kondisi stop/scope   — kapan MEA menyarankan berhenti
--
-- Sisa A-09 (E-2, E-12, G-1…G-4, H-2, I-2…I-4) = tiket **A-09b**, dicatat di
-- `docs/backlog/M6ABC_BACKLOG.md`.
--
-- ===========================================================================
-- TIER VISIBILITAS — dan kenapa ia ditulis di sini walau belum bisa ditegakkan
-- ===========================================================================
-- §4.1 memisahkan keempatnya ke DUA tier, dan pembagiannya tidak intuitif:
--
--   E-1, E-13, H-3  -> **default shareable** (§4.1 menyebut "E-1→E-3" dan
--                      "H-2, H-3" eksplisit di daftar shareable)
--   H-4             -> **HARD-INTERNAL, never shareable** (§4.1 mendaftarkannya
--                      bersama A-10, D-7, F-5, F-7, J-2, J-3)
--
-- Penegaknya (`STRG_FIELD_VISIBILITY` + konstanta `packages/core`) adalah A-10
-- dan belum ada. Yang bisa dilakukan migrasi ini: menandai tier-nya di COMMENT
-- kolom supaya A-10 tidak perlu menebak, dan TIDAK memasukkan H-4 ke jalur
-- shareable mana pun. Tautan klien `/s/{token}` (A-11) juga belum ada, jadi
-- belum ada permukaan yang bisa membocorkannya — tapi jangan baca itu sebagai
-- "tier sudah ditegakkan".
--
-- Gerbang jumlah tabel tetap **76**: nol tabel baru.
-- ===========================================================================

-- `IF NOT EXISTS` / drop-then-add: sama alasannya dengan `20260808000000` —
-- berkas ini juga belum ada di riwayat live, jadi ia harus konvergen, bukan
-- mengasumsikan kolomnya belum ada (O59).
ALTER TABLE strategi
    -- E-1. NULLable seperti seluruh field Section A/B/D: §7 minta autosave 20
    -- detik dan §5 langkah 5 minta hitungan kekurangan yang hidup, dan keduanya
    -- menuntut keadaan setengah-terisi bisa DISIMPAN. Kewajiban (`W`) ditegakkan
    -- gerbang submit `checkCompleteness`, bukan NOT NULL — pola A-05/A-06/A-08.
    ADD COLUMN IF NOT EXISTS growth_thesis          text NULL,
    -- E-13.
    ADD COLUMN IF NOT EXISTS urutan_eksekusi_alasan text NULL,
    -- H-3.
    ADD COLUMN IF NOT EXISTS skenario_mundur        text NULL,
    -- H-4. `O` (opsional) di §4 — dan HARD-INTERNAL di §4.1.
    ADD COLUMN IF NOT EXISTS kondisi_stop_scope     text NULL;

-- Terisi berarti terisi: sebuah tesis berisi " " lolos "tidak null" dan gagal
-- setiap gunanya. Pola yang sama dipakai `ck_strategi_definisi_berhasil_isi`
-- (A-08), jadi "kosong" dan "belum dijawab" tetap satu keadaan, bukan dua.
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_narasi_ehi_isi;
ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_narasi_ehi_isi CHECK (
        (growth_thesis          IS NULL OR btrim(growth_thesis)          <> '')
    AND (urutan_eksekusi_alasan IS NULL OR btrim(urutan_eksekusi_alasan) <> '')
    AND (skenario_mundur        IS NULL OR btrim(skenario_mundur)        <> '')
    AND (kondisi_stop_scope     IS NULL OR btrim(kondisi_stop_scope)     <> ''));

COMMENT ON COLUMN strategi.growth_thesis IS
  'M6A §4 E-1 — growth thesis, 1 paragraf ("tumbuh dengan cara X, karena Y, '
  'yang paling menentukan Z"). Tier §4.1: DEFAULT SHAREABLE. Wajib di gerbang '
  'submit, bukan NOT NULL.';

COMMENT ON COLUMN strategi.urutan_eksekusi_alasan IS
  'M6A §4 E-13 — kenapa pilar A didahulukan dari pilar B. Tier §4.1: DEFAULT '
  'SHAREABLE. Urutannya sendiri ada di strategi_pillar.urutan; ini alasannya.';

COMMENT ON COLUMN strategi.skenario_mundur IS
  'M6A §4 H-3 — skenario mundur (fallback) jika strategi utama gagal di fase 1. '
  'Tier §4.1: DEFAULT SHAREABLE (§4.1 menyebut "H-2, H-3" di daftar shareable).';

COMMENT ON COLUMN strategi.kondisi_stop_scope IS
  'M6A §4 H-4 — kondisi yang membuat MEA menyarankan stop/ubah scope. '
  '⚠️ Tier §4.1: HARD-INTERNAL, NEVER SHAREABLE — sederet dengan A-10, D-7, '
  'F-5, F-7, J-2, J-3. Penegaknya A-10 (STRG_FIELD_VISIBILITY), belum ada: '
  'jangan serialisasi ke /s/{token} (A-11). Opsional di §4, jadi TIDAK digerbangi.';

-- ===========================================================================
-- RLS — nol perubahan, dan itu disengaja
-- ===========================================================================
-- Empat KOLOM pada `strategi`; `strategi_select` sudah memikul row-scope-nya.
-- Yang RLS tidak bisa lakukan, dan karena itu ditulis alih-alih diasumsikan:
-- memisahkan H-4 (hard-internal) dari tiga kolom lain di baris yang SAMA. Itu
-- scope KOLOM, dan pemiliknya A-10. Sampai A-10 mendarat, setiap aktor yang
-- lolos `strategi_select` (AM pemilik, lead Account, OD/Direksi) melihat H-4 —
-- ketiganya internal, jadi nol kebocoran ke luar, bukan tier yang ditegakkan.
