-- A2-MODEL-BISNIS-6 — samakan kosakata A-2 Strategi dengan Interview B1-4.
--
-- ## Masalah
--
-- `PREFILL_MAPPING` (packages/core/src/interview.ts) sudah memetakan
-- `B1-4 → A-2` sejak RAB-09, tapi kedua ujungnya bicara kosakata berbeda:
--
--   Interview B1-4 (MODEL_BISNIS, 6 nilai):
--     produsen · brand_owner · importir_langsung · distributor_resmi
--     · reseller · dropship
--
--   Strategi A-2 (ck_strategi_model_bisnis, 4 nilai — migrasi
--   20260806065000_m6a_section_a.sql baris 98-100):
--     produsen · brand_owner · distributor · reseller
--
-- Akibatnya jawaban Interview tidak pernah bisa disalin ke A-2 tanpa
-- pemetaan yang MENGHILANGKAN informasi: `importir_langsung` dan
-- `distributor_resmi` dua-duanya harus dipaksa jadi `distributor`, dan
-- `dropship` tidak punya padanan sama sekali. AM akhirnya mengetik ulang
-- A-2 secara manual — persis yang dilaporkan pemilik saat menguji
-- CLI-202609-0021 ("A-2/A-4 SEHARUSNYA SUDAH TERISI DARI INTERVIEW").
--
-- ## Keputusan pemilik (Yohan, ketokan 2026-09-20)
--
-- Dari tiga pilihan yang diajukan (petakan 6→4, tambah opsi jadi 6, atau
-- tampilkan read-only), pemilik memilih **tambah opsi jadi 6** supaya
-- pemetaannya 1:1 dan tidak ada informasi yang hilang. Lihat
-- docs/DECISIONS.md 2026-09-20 "A2-MODEL-BISNIS-6".
--
-- ## Kenapa kolomnya ikut dilebarkan
--
-- `model_bisnis` lahir `varchar(16)`. Dua nilai baru panjangnya **17
-- karakter** (`importir_langsung`, `distributor_resmi`), jadi CHECK saja
-- tidak cukup — INSERT-nya akan mati di batas tipe sebelum CHECK sempat
-- dievaluasi. Dilebarkan ke `varchar(24)` supaya ada ruang untuk nilai
-- Interview berikutnya tanpa migrasi tipe lagi.
--
-- ## Kenapa tidak ada backfill
--
-- Tidak ada baris yang perlu diubah: keempat nilai lama tetap sah dan
-- artinya tidak bergeser. `distributor` yang sudah tersimpan TIDAK
-- dipetakan ulang jadi `distributor_resmi` — itu tebakan atas jawaban AM
-- yang tidak pernah ditanyakan, dan aturan rumah #3 melarang menulis
-- ulang riwayat. Baris lama tetap `distributor`; hanya isian BARU yang
-- memakai kosakata penuh.

ALTER TABLE strategi
    ALTER COLUMN model_bisnis TYPE varchar(24);

ALTER TABLE strategi
    DROP CONSTRAINT ck_strategi_model_bisnis;

ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_model_bisnis CHECK (
        model_bisnis IS NULL
     OR model_bisnis IN (
            'produsen',
            'brand_owner',
            'importir_langsung',
            'distributor_resmi',
            'distributor',
            'reseller',
            'dropship'));

COMMENT ON COLUMN strategi.model_bisnis IS
    'A-2 model bisnis. Kosakata sama dengan Interview B1-4 (MODEL_BISNIS) '
    'sejak A2-MODEL-BISNIS-6 supaya prefill B1-4→A-2 tidak kehilangan '
    'informasi. `distributor` adalah nilai WARISAN dari kosakata 4-nilai '
    'lama — tetap sah supaya baris lama tidak perlu ditulis ulang, tapi '
    'tidak ditawarkan lagi di form baru (pilih distributor_resmi atau '
    'importir_langsung).';
