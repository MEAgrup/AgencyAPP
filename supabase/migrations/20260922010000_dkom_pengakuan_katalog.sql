-- D-KOM — katalog menyatakan KAPAN pendapatan sebuah layanan diakui.
--
-- Diketok pemilik 2026-09-07 (Nerissa, COO), opsi (a): penanda KETIGA di
-- katalog, bukan mengeluarkan `Komisi` dari mesin accrual. Alasannya di
-- `DECISIONS.md` 2026-09-07 — mengeluarkan satu jenis pendapatan dari mesin
-- berarti setiap laporan keuangan harus DIINGAT untuk ditambahi manual, dan itu
-- bentuk kesalahan yang tidak kelihatan sampai ada yang menutup buku tanpa
-- mengingatnya.
--
-- KENAPA KOLOM INI TIDAK BISA DITURUNKAN DARI `durasi_bulan`:
-- sesudah pengisian katalog 2026-09-07 (migrasi 20260919010000), `Komisi` dan
-- `Jasa Pengajuan Shopee Mall` sama-sama `durasi_bulan = NULL` — dua ARTI
-- berbeda dengan satu NILAI yang sama:
--
--   Jasa Pengajuan Shopee Mall  -> sekali jadi, diakui PENUH saat selesai
--   Komisi                      -> angkanya baru diketahui BULAN DEPAN
--
-- Tidak ada aturan turunan yang bisa memisahkan keduanya. Itu aturan rumah #4
-- ("ketiadaan yang diam tidak bisa dibedakan dari kerusakan"), sekelas `0` vs
-- `null`. Karena itu artinya disimpan, bukan ditebak ulang tiap kali dibaca.
--
-- Kata pemilik tentang `Komisi`: "service pelengkap tambahan yang tidak bisa
-- di-track di awal karena bentuknya komisi dari hasil penjualan yang diketahui
-- di bulan depannya, maka dari itu dibuat bisa diisi sendiri oleh Sales."
-- ⇒ NILAI rupiahnya diinput Sales per transaksi; yang disimpan di katalog
-- hanyalah KAPAN mesin boleh mengakuinya.
--
-- Aman mendahului kode: ADITIF (kolom baru + backfill), nol rename, nol drop.

-- ---------------------------------------------------------------------------
-- 1. Kolom
-- ---------------------------------------------------------------------------
--
-- Ditambahkan NULLABLE dulu, diisi, baru dikunci NOT NULL — supaya tidak ada
-- satu baris pun yang sempat memakai default sebagai "jawaban". Nilai setiap
-- baris yang sudah ada ditulis eksplisit di §2 dari data hari ini.

ALTER TABLE master_service_versions
    ADD COLUMN pengakuan varchar(20);

-- ---------------------------------------------------------------------------
-- 2. Pemetaan awal — DITURUNKAN DARI DATA, bukan ditebak
-- ---------------------------------------------------------------------------
--
--   durasi_bulan IS NOT NULL  -> 'per_periode'       (42 layanan aktif)
--   durasi_bulan IS NULL      -> 'saat_selesai'      (38 layanan aktif)
--   name = 'Komisi'           -> 'bulan_berikutnya'  (1, mengalahkan keduanya)
--
-- Backfill ini menyentuh SELURUH baris tabel (termasuk versi lama yang tidak
-- aktif), bukan hanya versi terkini yang aktif. Versi lama tetap dibaca oleh
-- `msl.effectiveAt` untuk kontrak yang mem-pin versi itu (aturan rumah #3),
-- jadi meninggalkannya NULL berarti mesin accrual bertemu lubang justru pada
-- kontrak yang paling lama berjalan.

UPDATE master_service_versions
   SET pengakuan = CASE
         WHEN name = 'Komisi'          THEN 'bulan_berikutnya'
         WHEN durasi_bulan IS NOT NULL THEN 'per_periode'
         ELSE                               'saat_selesai'
       END;

ALTER TABLE master_service_versions
    ALTER COLUMN pengakuan SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Pagar
-- ---------------------------------------------------------------------------

ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_pengakuan
    CHECK (pengakuan IN ('per_periode', 'saat_selesai', 'bulan_berikutnya'));

-- `per_periode` berarti "sebar rata sepanjang durasi_bulan". Tanpa durasi_bulan
-- tidak ada yang bisa disebari — kombinasi itu bukan "belum diisi", ia tidak
-- punya arti sama sekali, jadi DB yang menolaknya. Pola dan alasannya sama
-- dengan `ck_msv_qty_durasi_butuh_durasi_bulan` (migrasi 20260918010000).
ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_per_periode_butuh_durasi_bulan
    CHECK (pengakuan <> 'per_periode' OR durasi_bulan IS NOT NULL);

-- Default dipasang SESUDAH backfill, jadi ia tidak pernah menjawab untuk satu
-- baris pun yang sudah ada. Ia hanya jaring untuk penulis di luar
-- `msl.createService`/`updateService` (seed, perbaikan manual).
--
-- 'saat_selesai' dipilih sebagai sisi yang AMAN, dengan alasan yang sama
-- dengan default 'volume' pada `qty_menambah`: salah menandai layanan berdurasi
-- sebagai `saat_selesai` menumpuk pendapatannya di satu bulan — lonjakan yang
-- KELIHATAN, terbatas, dan ketahuan cepat. Sebaliknya, `per_periode` yang
-- keliru menyebar pendapatan diam-diam sepanjang periode, dan yang diam tidak
-- ketahuan. Ia juga satu-satunya dari tiga nilai yang tidak pernah bertabrakan
-- dengan `ck_msv_per_periode_butuh_durasi_bulan`.
ALTER TABLE master_service_versions
    ALTER COLUMN pengakuan SET DEFAULT 'saat_selesai';

COMMENT ON COLUMN master_service_versions.pengakuan IS
  'KAPAN pendapatan layanan ini diakui mesin accrual Gelombang D (ketokan D-KOM 2026-09-07, opsi a). ''per_periode'' = disebar rata sepanjang durasi_bulan (butuh durasi_bulan). ''saat_selesai'' = diakui PENUH saat status layanan selesai — layanan sekali jadi. ''bulan_berikutnya'' = diakui satu bulan SESUDAH penjualan yang melahirkannya, karena angkanya baru diketahui bulan depan (Komisi; nilai rupiahnya diinput Sales per transaksi, bukan dihitung mesin dari katalog). TIDAK bisa diturunkan dari durasi_bulan: Komisi dan Jasa Pengajuan Shopee Mall sama-sama durasi_bulan NULL dengan arti berbeda.';

-- ---------------------------------------------------------------------------
-- 4. Jejak audit
-- ---------------------------------------------------------------------------
--
-- POLA: diturunkan dari baris yang benar-benar ditulis, BUKAN dari predikat
-- atas nilai baru. Migrasi 20260920010000 (188) memakai predikat atas nilai
-- baru dan mencatat 44 layanan untuk 16 yang berubah — permanen, karena
-- `audit_log` menolak DELETE (`DECISIONS.md` 2026-09-07). Di sini `terkini`
-- dihitung dari versi aktif terkini SESUDAH backfill dan setiap barisnya memang
-- berubah (kolomnya baru ada di migrasi ini, jadi seluruhnya berubah dari
-- "tidak ada" ke sebuah nilai) — tidak bisa lebih, tidak bisa kurang.

WITH terkini AS (
    SELECT DISTINCT ON (service_id)
           service_id, name, durasi_bulan, pengakuan, active
      FROM master_service_versions
     ORDER BY service_id, version_no DESC
)
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'master_service', service_id, 'SYSTEM', 'ketokan_pengakuan',
       jsonb_build_object('catatan', 'kolom pengakuan belum ada sebelum migrasi 20260922010000'),
       jsonb_build_object('name', name,
                          'durasi_bulan', durasi_bulan,
                          'pengakuan', pengakuan),
       'SYSTEM'
  FROM terkini
 WHERE active;
