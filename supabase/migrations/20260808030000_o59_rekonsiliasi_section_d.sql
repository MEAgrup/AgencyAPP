-- CDPS — O59: rekonsiliasi Section D antara repo dan live `CDPS SG`
--
-- Keputusan pemilik 2026-08-08: **O59 = (b), repo menang.**
--
-- ===========================================================================
-- APA YANG TERJADI, DAN KENAPA MIGRASI INI ADA
-- ===========================================================================
-- Sesi yang berkasnya HILANG menerapkan Section D versi lain ke live (tercatat
-- di riwayat live sebagai `20260808024726`, bernama `20260808020000_m6a_section_d`).
-- Repo tidak pernah memuat berkas itu, jadi repo dan live membangun Section D
-- dengan tiga perbedaan — dan yang ketiga tidak bisa dilihat gerbang mana pun:
--
-- | Hal          | Live (sesi hilang)                       | Repo (A-08)                        |
-- |--------------|------------------------------------------|------------------------------------|
-- | D-5          | tabel anak `strategi_definisi_berhasil`  | 3 kolom `definisi_berhasil_30/60/90` |
-- | D-6 CHECK    | 3 terpisah: `..._array`, `..._maks`,     | 1 gabungan:                        |
-- |              | `..._taksonomi`                          | `ck_strategi_leading_indicator`    |
-- | D-7 CHECK    | `ck_strategi_sanggahan`                  | `ck_strategi_sanggahan_utuh`       |
-- | event v4     | `strategi_sanggahan_target` (polos)      | `m6a.strategi.sanggahan_target`    |
-- | jumlah tabel | **77**                                   | **76**                             |
--
-- ⚠️ **Perbedaan nama event adalah yang paling berbahaya**, dan ia lolos semua
-- gerbang: keduanya "1 event di versi 4", jadi `COUNT(notif_events) = 34` dan
-- `SUM(event_count) = 34` **cocok di kedua sisi**. Gerbang berbasis HITUNGAN
-- tidak bisa melihat nama yang berbeda. Konsekuensinya konkret: `raiseSanggahan`
-- memanggil `notify_emit('m6a.strategi.sanggahan_target', …)`, dan di live
-- `notify_emit` akan `RAISE EXCEPTION 'notification: unknown event %'` —
-- sanggahan target GAGAL TOTAL di produksi, bukan sekadar tidak menotifikasi.
-- Itu ditemukan hanya karena nama-nama dibandingkan satu per satu, bukan
-- hitungannya.
--
-- Kenapa (b) aman: seluruh Section D live **kosong** saat keputusan diambil —
-- `strategi` 0, `strategi_target` 0, `strategi_assumption` 0,
-- `strategi_definisi_berhasil` 0. Membongkar tabel kosong tidak kehilangan
-- apa pun. Guard di §1 menegakkan premis itu alih-alih memercayainya.
--
-- Kenapa bentuk repo yang menang, bukan bentuk live: bentuk repo sudah
-- di-review, diuji (895 test domain), dan alasan tiap keputusannya tertulis.
-- Bentuk live datang dari sesi yang berkasnya hilang — **tidak ada seorang pun
-- yang bisa menjelaskan kenapa D-5 di sana tabel anak**, dan menyimpan bentuk
-- yang tak ada penjelasannya berarti mewarisi keputusan yang tidak pernah
-- diambil siapa pun.
--
-- ===========================================================================
-- IDEMPOTEN DI KEDUA SISI — ini bukan gaya, ini syaratnya
-- ===========================================================================
-- Migrasi ini harus menghasilkan keadaan yang SAMA saat dijalankan atas:
--   * DB kosong (lokal/CI) yang baru saja menerima 20260808000000 + 010000
--     ⇒ semua langkah di bawah adalah no-op;
--   * live, yang memuat bentuk sesi hilang ⇒ semua langkah bekerja.
-- Karena itu setiap perintah `IF EXISTS` / `ON CONFLICT`, dan nol perintah
-- bergantung pada urutan penerapan.

-- ===========================================================================
-- 1. GUARD — tolak berjalan kalau premisnya sudah tidak benar
-- ===========================================================================
-- Keputusan (b) sah HANYA karena tabelnya kosong. Kalau seseorang mengisi
-- `strategi_definisi_berhasil` antara keputusan dan penerapan, migrasi ini
-- WAJIB berhenti, bukan menghapus jawaban AM. Lebih baik merah di deploy
-- daripada hilang di produksi.
DO $$
DECLARE n bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'strategi_definisi_berhasil') THEN
        EXECUTE 'SELECT count(*) FROM public.strategi_definisi_berhasil' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION
              'O59: strategi_definisi_berhasil memuat % baris — keputusan (b) diambil atas premis TABEL KOSONG. Berhenti. Pindahkan datanya ke definisi_berhasil_30/60/90 lebih dulu, lalu jalankan ulang.', n;
        END IF;
    END IF;
END;
$$;

-- ===========================================================================
-- 2. D-5 — bongkar tabel anak live; kolomnya sudah dipasang 20260808000000
-- ===========================================================================
-- `IF EXISTS` karena di lokal/CI tabel ini tidak pernah ada. Efek gerbang:
-- live 77 → **76**, lokal 76 → **76**. Keduanya mendarat di angka yang sama,
-- dan itulah definisi "tidak ada drift" di sini.
DROP TABLE IF EXISTS public.strategi_definisi_berhasil;

-- ===========================================================================
-- 3. Nama CHECK — buang nama versi live, sisakan nama repo
-- ===========================================================================
-- Ketiga CHECK D-6 live secara SEMANTIK sama dengan satu CHECK repo, jadi ini
-- bukan perubahan aturan — hanya penyatuan nama. Tapi nama ikut menentukan
-- sidik jari struktural, dan tanpa langkah ini repo ≡ live tidak akan pernah
-- bisa dibuktikan. `20260808000000` sudah memasang nama repo-nya (drop-then-add),
-- jadi yang tersisa di sini hanya membuang yang lama.
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_leading_array;
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_leading_maks;
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_leading_taksonomi;
-- D-7: nama live `ck_strategi_sanggahan` → nama repo `ck_strategi_sanggahan_utuh`.
-- (`ck_strategi_sanggahan_nonneg` kebetulan bernama sama di kedua sisi.)
ALTER TABLE strategi DROP CONSTRAINT IF EXISTS ck_strategi_sanggahan;

-- ===========================================================================
-- 4. Event katalog v4 — satukan ke nama bertitik
-- ===========================================================================
-- Baris v1 dibekukan trigger; v4 tidak, jadi menyentuhnya di sini sah. Nama
-- bertitik yang menang, dan alasannya tertulis di `20260808000000` §(1): aturan
-- penamaan v2 memakai gaya polos `strategi_*` JUSTRU karena PRD menuliskannya.
-- PRD tidak pernah menulis event sanggahan, jadi ia mengikuti konvensi rumah
-- `mN.entitas.aksi` — persis alasan `m6.client.assigned` (O53) bertitik.
--
-- ⚠️ DUA cabang, dan ini ditemukan saat penerapan pertama GAGAL, bukan saat
-- menulis: `20260808000000` sudah meng-INSERT nama bertitik (ON CONFLICT-nya
-- menjaga baris v4 registry, bukan baris event, dan nama bertitik memang belum
-- ada di live). Jadi sesudah migrasi itu, live memuat **kedua** nama — dan
-- `UPDATE … SET event_type = <bertitik>` menabrak PK.
--   * kalau nama bertitik sudah ada  ⇒ HAPUS yang polos (satu event, satu baris);
--   * kalau belum ada                ⇒ RENAME yang polos.
-- Keduanya mendarat di keadaan yang sama, dan keduanya harus ada karena urutan
-- penerapan berbeda antara live (sudah lewat 20260808000000) dan DB kosong.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM notif_events WHERE event_type = 'm6a.strategi.sanggahan_target') THEN
        DELETE FROM notif_events WHERE event_type = 'strategi_sanggahan_target';
    ELSE
        UPDATE notif_events
           SET event_type  = 'm6a.strategi.sanggahan_target',
               description = 'AM mengajukan Sanggahan Target (D-7, advisory) — ke SPV Account + Head of Sales',
               resolver    = 'explicitOrLeads'
         WHERE event_type = 'strategi_sanggahan_target';
    END IF;
END;
$$;

-- Baris notifikasi yang sudah terkirim memakai nama lama TIDAK diubah: mereka
-- catatan sejarah, dan `notifications.event_type` tidak ber-FK ke katalog.
-- Jumlahnya nol saat migrasi ini ditulis (Section D live kosong), tapi kalaupun
-- ada, mengubahnya berarti menulis ulang riwayat — dilarang aturan rumah #3.

-- Deskripsi + rujukan keputusan baris v4 disatukan juga, supaya registry tidak
-- memberi dua cerita berbeda tentang amandemen yang sama.
UPDATE notif_catalog_versions
   SET description  = 'M6A §4 D-7 — sanggahan target memberi tahu SPV Account + Head of Sales: 1 event Strategi',
       decision_ref = 'docs/DECISIONS.md 2026-08-08 (A-08 — §4 vs §7 D12; O59 rekonsiliasi)'
 WHERE version = 4;

-- ===========================================================================
-- 5. Tegakkan hasilnya — jangan cuma harapkan
-- ===========================================================================
-- Gerbang di `ci.yml`/`db-rebuild.sh` menghitung tabel dan event. Yang TIDAK
-- bisa mereka lihat adalah nama, dan nama itulah yang O59 salahkan. Jadi
-- diperiksa di sini, di dalam transaksi migrasi yang sama.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='strategi_definisi_berhasil') THEN
        RAISE EXCEPTION 'O59: strategi_definisi_berhasil masih ada sesudah rekonsiliasi';
    END IF;

    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='strategi'
           AND column_name IN ('definisi_berhasil_30','definisi_berhasil_60','definisi_berhasil_90')) <> 3 THEN
        RAISE EXCEPTION 'O59: ketiga kolom D-5 tidak lengkap';
    END IF;

    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='strategi'
           AND column_name IN ('growth_thesis','urutan_eksekusi_alasan','skenario_mundur','kondisi_stop_scope')) <> 4 THEN
        RAISE EXCEPTION 'O59: keempat kolom narasi A-09a tidak lengkap';
    END IF;

    -- Nama event v4 — inilah asersi yang gerbang hitungan tidak bisa lakukan.
    IF NOT EXISTS (SELECT 1 FROM notif_events
                    WHERE event_type = 'm6a.strategi.sanggahan_target' AND catalog_version = 4) THEN
        RAISE EXCEPTION 'O59: event v4 bertitik tidak ada';
    END IF;
    IF EXISTS (SELECT 1 FROM notif_events WHERE event_type = 'strategi_sanggahan_target') THEN
        RAISE EXCEPTION 'O59: nama event v4 versi live masih ada — dua nama untuk satu event';
    END IF;

    -- Nama CHECK versi live sudah tidak boleh ada lagi.
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'public.strategi'::regclass
                  AND conname IN ('ck_strategi_leading_array','ck_strategi_leading_maks',
                                  'ck_strategi_leading_taksonomi','ck_strategi_sanggahan')) THEN
        RAISE EXCEPTION 'O59: nama CHECK versi live masih tersisa';
    END IF;

    -- Dan nama repo-nya HARUS ada — kalau tidak, §3 baru saja membuang penjaga
    -- tanpa penggantinya.
    IF (SELECT count(*) FROM pg_constraint
         WHERE conrelid = 'public.strategi'::regclass
           AND conname IN ('ck_strategi_leading_indicator','ck_strategi_sanggahan_utuh',
                           'ck_strategi_sanggahan_nonneg','ck_strategi_definisi_berhasil_isi',
                           'ck_strategi_narasi_ehi_isi')) <> 5 THEN
        RAISE EXCEPTION 'O59: CHECK bentuk repo tidak lengkap sesudah rekonsiliasi';
    END IF;
END;
$$;
