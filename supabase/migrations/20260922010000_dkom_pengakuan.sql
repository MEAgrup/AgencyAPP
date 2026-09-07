-- D-KOM — katalog menyatakan KAPAN pendapatan sebuah layanan diakui.
--
-- Diketok pemilik 2026-09-07 (Nerissa, COO), opsi (a): penanda KETIGA di
-- katalog, bukan mengeluarkan `Komisi` dari mesin accrual. Alasan lengkapnya di
-- `DECISIONS.md` 2026-09-07; ringkasnya: mengeluarkan satu jenis pendapatan dari
-- mesin berarti setiap laporan keuangan harus DIINGAT untuk ditambahi manual,
-- dan yang lupa mengingatnya adalah orang yang menutup buku, bulan-bulan sesudah
-- keputusan ini dilupakan.
--
-- KENAPA INI KOLOM DAN BUKAN TURUNAN DARI `durasi_bulan`. Sesudah pengisian
-- katalog 2026-09-07, `Komisi` dan `Jasa Pengajuan Shopee Mall` sama-sama
-- `durasi_bulan IS NULL` — DUA ARTI BERBEDA dengan satu nilai yang sama:
--
--   Jasa Pengajuan Shopee Mall  ->  sekali jadi, diakui penuh saat SELESAI
--   Komisi                      ->  angkanya baru diketahui BULAN DEPAN
--
-- Tidak ada aturan turunan yang bisa memisahkan keduanya, karena yang
-- membedakannya tidak pernah ditulis ke mana pun. Itu aturan kerja #4:
-- *ketiadaan yang diam tidak bisa dibedakan dari kerusakan* — sekelas `0` vs
-- `null`. Jadi ia ditulis, satu kali, sebagai kolom.
--
-- Kata pemilik tentang `Komisi`: "service pelengkap tambahan yang tidak bisa
-- di-track di awal karena bentuknya komisi dari hasil penjualan yang diketahui
-- di bulan depannya, maka dari itu dibuat bisa diisi sendiri oleh Sales." ⇒
-- NILAINYA diinput Sales per transaksi; yang ada di katalog hanya JADWALNYA.
--
-- Aman mendahului deploy kode: aditif, ber-DEFAULT yang sah untuk setiap baris
-- yang sudah ada, dan nol kolom yang di-rename atau dihapus (aturan urutan rilis
-- `HANDOFF_GELOMBANG_D_20260907.md` §7).

-- ---------------------------------------------------------------------------
-- 1. Kolom + kosakata
-- ---------------------------------------------------------------------------
--
-- DEFAULT `saat_selesai` dipilih karena dua alasan yang saling menguatkan:
--
--   * ia SAH untuk setiap nilai `durasi_bulan`, termasuk NULL — jadi ia tidak
--     bisa bertabrakan dengan CHECK di §3, dan layanan baru yang dibuat lewat
--     jalur mana pun (form, seed, migrasi, impor) selalu mendarat di baris yang
--     valid alih-alih gagal;
--   * ia sisi yang KELIHATAN kalau salah. Layanan berdurasi yang tertinggal
--     `saat_selesai` menumpuk seluruh pendapatannya di satu bulan — benjolan
--     yang langsung terlihat di laporan dan segera dilaporkan. Sebaliknya,
--     layanan sekali-jadi yang salah ditandai `per_periode` menyebar
--     pendapatannya diam-diam ke bulan-bulan yang tidak pernah ada. Ini logika
--     yang sama yang memilih DEFAULT `volume` untuk `qty_menambah` di migrasi
--     20260918010000, dan sengaja dibuat konsisten dengannya.

ALTER TABLE master_service_versions
    ADD COLUMN pengakuan varchar(20) NOT NULL DEFAULT 'saat_selesai';

ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_pengakuan
    CHECK (pengakuan IN ('per_periode', 'saat_selesai', 'bulan_berikutnya'));

-- ---------------------------------------------------------------------------
-- 2. Pemetaan awal — DITURUNKAN DARI DATA HARI INI, bukan ditebak
-- ---------------------------------------------------------------------------
--
--   durasi_bulan IS NOT NULL  ->  'per_periode'       (42 layanan aktif di live)
--   durasi_bulan IS NULL      ->  'saat_selesai'      (38, sudah lewat DEFAULT)
--   name = 'Komisi'           ->  'bulan_berikutnya'  (1, mengalahkan dua di atas)
--
-- Dijalankan atas SELURUH rantai versi, bukan hanya versi terkini. Versi lama
-- ikut punya kolom ini begitu ia ditambahkan, dan satu-satunya nilai yang runtut
-- dengan `durasi_bulan` yang benar-benar dibawa baris itu adalah nilai yang
-- diturunkan dari baris itu sendiri. Menyentuh versi terkini saja akan
-- meninggalkan versi lama pada DEFAULT yang bertentangan dengan durasinya
-- sendiri — dan versi lama itulah yang dibaca ulang oleh snapshot Closing lama
-- (`services.master_version_no`, aturan rumah #3/#4).
--
-- CATATAN POLA (aturan kerja #7): auditnya diturunkan dari `UPDATE ...
-- RETURNING`, jadi ia mencatat PERSIS baris yang berubah. Migrasi 188 menyaring
-- auditnya dengan predikat atas NILAI BARU dan mencatat 44 layanan untuk 16 yang
-- berubah — permanen, karena `audit_log` menolak DELETE.

WITH diubah AS (
    UPDATE master_service_versions
       SET pengakuan = 'per_periode'
     WHERE durasi_bulan IS NOT NULL
       AND name <> 'Komisi'
       AND pengakuan IS DISTINCT FROM 'per_periode'
    RETURNING service_id, version_no, name, durasi_bulan, pengakuan
)
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'master_service', service_id, 'SYSTEM', 'ketokan_pengakuan',
       jsonb_build_object('pengakuan', 'saat_selesai',
                          'catatan', 'DEFAULT kolom baru migrasi 20260922010000'),
       jsonb_build_object('version_no', version_no,
                          'name', name,
                          'durasi_bulan', durasi_bulan,
                          'pengakuan', pengakuan,
                          'dasar', 'durasi_bulan IS NOT NULL'),
       'SYSTEM'
  FROM diubah;

-- `Komisi` sesudahnya, supaya ia mengalahkan aturan di atas apa pun durasinya —
-- hari ini durasinya NULL, tapi aturan pemiliknya tentang KOMISI, bukan tentang
-- ada-tidaknya durasi, dan urutan ini yang membuatnya tetap benar kalau suatu
-- hari `Komisi` diberi durasi.
WITH diubah AS (
    UPDATE master_service_versions
       SET pengakuan = 'bulan_berikutnya'
     WHERE name = 'Komisi'
       AND pengakuan IS DISTINCT FROM 'bulan_berikutnya'
    RETURNING service_id, version_no, name, durasi_bulan, pengakuan
)
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'master_service', service_id, 'SYSTEM', 'ketokan_pengakuan',
       jsonb_build_object('pengakuan', 'saat_selesai',
                          'catatan', 'DEFAULT kolom baru migrasi 20260922010000'),
       jsonb_build_object('version_no', version_no,
                          'name', name,
                          'durasi_bulan', durasi_bulan,
                          'pengakuan', pengakuan,
                          'dasar', 'ketokan pemilik D-KOM 2026-09-07: komisi diketahui bulan depan'),
       'SYSTEM'
  FROM diubah;

-- ---------------------------------------------------------------------------
-- 3. Invariant — `per_periode` menuntut periode yang benar-benar ada
-- ---------------------------------------------------------------------------
--
-- "Diakui rata sepanjang `durasi_bulan`" tidak punya arti apa pun kalau
-- `durasi_bulan` NULL: tidak ada yang bisa dibagi rata. Kombinasi itu BUKAN
-- "belum diisi" — ia tidak bisa dieksekusi, jadi DB yang menolaknya, sama
-- seperti `ck_msv_qty_durasi_butuh_durasi_bulan` menolak `qty_menambah =
-- 'durasi'` tanpa durasi.
--
-- Arahnya SENGAJA satu arah. Kebalikannya (layanan berdurasi WAJIB
-- `per_periode`) bukan invariant: layanan 1 bulan yang pendapatannya baru diakui
-- saat pekerjaannya kelar adalah kombinasi yang sah dan dipakai. Menegakkannya
-- dua arah berarti mengarang aturan yang tidak pernah diketok pemilik.
ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_pengakuan_periode_butuh_durasi_bulan
    CHECK (pengakuan <> 'per_periode' OR durasi_bulan IS NOT NULL);

COMMENT ON COLUMN master_service_versions.pengakuan IS
  'KAPAN pendapatan layanan ini diakui mesin accrual Gelombang D (ketokan D-KOM 2026-09-07, opsi a). ''per_periode'' = diakui rata sepanjang durasi_bulan (mis. GMV MAX MEA PRO, Store Management) — menuntut durasi_bulan NOT NULL. ''saat_selesai'' = diakui PENUH saat status layanan selesai (mis. Jasa Pengajuan Shopee Mall, Nano KOL). ''bulan_berikutnya'' = diakui SATU BULAN sesudah penjualan yang melahirkannya, karena angkanya baru diketahui bulan depan (Komisi; NILAInya diinput Sales per transaksi, katalog hanya memegang jadwalnya). SENGAJA bukan turunan dari durasi_bulan: Komisi dan Jasa Pengajuan Shopee Mall sama-sama durasi_bulan NULL dengan arti berbeda.';
