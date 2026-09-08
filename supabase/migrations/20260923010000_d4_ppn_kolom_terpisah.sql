-- D-4 — SELURUH harga disimpan NON-PPN. PPN jadi PILIHAN SALES per invoice,
-- bukan sifat layanan di katalog.
--
-- Diketok pemilik 2026-09-08 (Yohan Agustian), dua kalimat:
--
--   "semua laporan keuangan accrual dibuat sebelum PPN. PPN adalah penambahan.
--    Cek juga MSL supaya semua transaksi dibuat sebelum PPN, nanti PPN adalah
--    kolom tambahan."
--
--   "untuk memudahkan buat semua harga non ppn, negosiasi maupun non nego.
--    Berlaku untuk semua master service list. Nanti sales klik tombol include
--    ppn, harga akan otomatis bertambah 11% di invoice."
--
-- Kalimat kedua yang menentukan BENTUKNYA, dan ia mengoreksi tebakan pertama
-- yang wajar tapi salah: PPN BUKAN sifat sebuah layanan. Layanan yang sama bisa
-- ditagih ber-PPN ke satu klien dan tidak ke klien lain — yang menentukan
-- adalah keputusan pada INVOICE-nya, dan Sales yang menekannya. Karena itu
-- penandanya hidup di `transactions`, satu per invoice, bukan per baris layanan
-- dan bukan di katalog.
--
-- ── Keadaan sebelum migrasi ini, dan dua cacat yang lahir darinya ───────────
--
-- `sales.computeSubtotal` menambahkan 11% KE DALAM `subtotal` ketika penanda
-- KATALOG `apply_ppn` menyala, lalu angka gabungan itu mengalir ke seluruh
-- jalur uang:
--
--   qualified_form_services.subtotal
--     -> negotiation_proposal_lines.proposed_price
--       -> services.standard_price
--       -> transactions.total_agreed_value
--
--   1. Laporan accrual membaca angka yang sudah termasuk pajak, jadi pendapatan
--      yang diakui 11% lebih besar dari yang benar-benar milik perusahaan. PPN
--      titipan negara, bukan pendapatan.
--
--   2. `buildQuote` menghitung KOMISI dari `subtotal` YANG SUDAH BER-PPN.
--      Diverifikasi lewat kode berjalan, bukan dibaca: Rp 10.000.000 dengan
--      aturan "10% of standard price" menghasilkan komisi Rp 1.110.000, bukan
--      Rp 1.000.000 — komisi atas uang pajak.
--
-- Cacat #2 BELUM pernah merugikan di data live: keempat baris live yang ber-PPN
-- semuanya beraturan komisi `0% of standard price`, jadi selisihnya nol rupiah.
-- Laten, bukan kerugian yang sudah terjadi — disebut apa adanya supaya tidak
-- dibesar-besarkan dan tidak dianggap tidak ada.
--
-- ── Yang TIDAK berubah: rupiah yang ditagihkan ke klien ─────────────────────
--
-- Nilai yang ditagih tetap `total_agreed_value + total_ppn`, persis sama dengan
-- angka gabungan yang tersimpan sebelum migrasi ini. Migrasi ini hanya
-- MEMISAHKAN angka itu jadi dua kolom; jumlahnya tidak bergeser satu sen pun.
-- Itu syarat mutlak, karena dua dari tiga transaksi yang dipisah sudah berstatus
-- `[Lunas]` — angka yang sudah dibayar tidak boleh berubah.
--
-- ── Keadaan data live per 2026-09-08 (diverifikasi lewat kueri, read-only) ──
--
-- Empat baris `qualified_form_services` ber-`apply_ppn`, semuanya `GMV Max`
-- mode passthrough dengan dasar bulat:
--
--   PRSP-202608-0177   57.720.000 = 52.000.000 + 5.720.000   -> TRX-202608-0008 [Lunas]
--   PRSP-202608-0201   72.150.000 = 65.000.000 + 7.150.000   -> TRX-202608-0010 [Lunas]
--   PRSP-202608-0204   22.200.000 = 20.000.000 + 2.200.000   -> TRX-202608-0009
--   PRSP-202609-0105    5.550.000 =  5.000.000 +   550.000   -> TRX-202609-0002, TIDAK disentuh
--
-- Pembalikannya EKSAK untuk keempatnya (`round(x/1.11,2)*1.11 = x`), jadi
-- pemisahan ini tidak kehilangan satu sen pun dan tidak menebak apa pun.
--
-- ── Kenapa TRX-202609-0002 sengaja TIDAK disentuh ───────────────────────────
--
-- Baris QFS-nya dipisah seperti tiga yang lain, tapi TRANSAKSInya tidak. Total
-- transaksi itu 23.575.000 sementara baris ber-PPN-nya hanya 5.550.000; sisanya
-- Rp 18.025.000 datang dari baris lain yang tidak bisa diatribusikan, dan
-- klien itu tidak punya baris `services` yang cocok dengan nilai QFS-nya sama
-- sekali.
--
-- Kalau ia tetap dipisah, hasilnya `total_ppn` 550.000 atas dasar 23.025.000 —
-- yaitu 2,4%, bukan 11%. Di model LAMA angka itu masuk akal (pajak per baris);
-- di model BARU, yang menaruh PPN di INVOICE, ia tidak punya arti sama sekali.
-- Baris seperti itu akan terlihat sah di setiap layar dan tidak akan pernah
-- bisa dijelaskan oleh siapa pun yang membacanya nanti.
--
-- Jadi ia ditinggalkan UTUH, dengan `include_ppn = false` dan `total_ppn = 0`:
-- nilai yang tercatat = nilai yang ditagih = nilai yang dibayar, dan ketiganya
-- tetap benar. Yang hilang hanya keterangan bahwa sebagian kecilnya dulu pajak
-- — dan itu masih terbaca di `qualified_form_services.apply_ppn` yang sengaja
-- tidak di-drop. Ditemukan lewat uji-kering, bukan lewat membaca kode.
--
-- ⛔ WAJIB MENYUSUL DEPLOY KODENYA, tidak boleh mendahului. Migrasi ini menulis
-- ulang `subtotal`/`proposed_price`/`standard_price`/`total_agreed_value` jadi
-- 11% lebih kecil dan memindahkan selisihnya ke `total_ppn`. Kode LAMA membaca
-- kolom-kolom itu sebagai satu angka utuh, jadi di antara apply dan deploy
-- setiap halaman uang akan menampilkan dan menagih 11% lebih kecil dari yang
-- benar, TANPA error di mana pun. Ini kelas yang sama dengan migrasi 186.

-- ---------------------------------------------------------------------------
-- 1. Penanda PPN hidup di INVOICE, satu per transaksi
-- ---------------------------------------------------------------------------

ALTER TABLE transactions
    ADD COLUMN include_ppn boolean       NOT NULL DEFAULT false,
    ADD COLUMN total_ppn   numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE transactions
    ADD CONSTRAINT ck_trx_total_ppn_nonneg CHECK (total_ppn >= 0);

-- Tidak boleh ada rupiah PPN pada invoice yang penandanya mati. Tanpa pagar ini
-- "PPN Rp 0" dan "PPN tidak dipilih" bisa berbeda diam-diam di dua kolom yang
-- seharusnya sepakat.
ALTER TABLE transactions
    ADD CONSTRAINT ck_trx_ppn_butuh_penanda CHECK (include_ppn OR total_ppn = 0);

COMMENT ON COLUMN transactions.include_ppn IS
  'Apakah Sales menekan "Include PPN" untuk invoice ini (ketokan D-4 2026-09-08). PPN adalah keputusan per INVOICE, bukan sifat layanan: layanan yang sama bisa ditagih ber-PPN ke satu klien dan tidak ke klien lain.';
COMMENT ON COLUMN transactions.total_ppn IS
  'Rupiah PPN invoice ini, TERPISAH dari `total_agreed_value` yang selalu NON-PPN. Yang ditagih ke klien = total_agreed_value + total_ppn. DIBEKUKAN di sini, bukan dihitung ulang dari tarif hari ini — tarif PPN berubah lewat undang-undang, dan invoice lama harus tetap menyebut pajak yang benar-benar ditagihkan waktu itu.';

-- ---------------------------------------------------------------------------
-- 2. `apply_ppn` di katalog & snapshot: DEPRECATED, tidak lagi menentukan apa pun
-- ---------------------------------------------------------------------------
--
-- Ketokan "berlaku untuk SEMUA master service list" membuat penanda per-layanan
-- ini kehilangan pekerjaannya: seluruh harga MSL kini non-PPN tanpa kecuali.
--
-- Kolomnya TIDAK di-drop di sini. Menghapus kolom adalah migrasi yang harus
-- MENYUSUL deploy kode yang berhenti membacanya, dan migrasi ini sendiri sudah
-- harus menyusul deploy. Menumpuk dua ketergantungan urutan dalam satu berkas
-- berarti satu kesalahan urutan menjatuhkan keduanya. Ia juga masih dibutuhkan
-- SATU KALI di §3 di bawah: ia satu-satunya keterangan yang tersisa tentang
-- baris live mana yang terlanjur tersimpan ber-PPN.

COMMENT ON COLUMN master_service_versions.apply_ppn IS
  'DEPRECATED sejak ketokan D-4 2026-09-08 — TIDAK dibaca lagi oleh jalur harga mana pun. Seluruh harga MSL kini NON-PPN; PPN dipilih Sales per invoice (transactions.include_ppn). Disimpan sementara sebagai riwayat; drop-nya migrasi tersendiri sesudah kode yang berhenti membacanya ter-deploy.';
COMMENT ON COLUMN qualified_form_services.apply_ppn IS
  'DEPRECATED sejak ketokan D-4 2026-09-08 — lihat master_service_versions.apply_ppn. Nilainya masih dipakai SEKALI, oleh migrasi ini, untuk mengenali baris lama yang terlanjur tersimpan ber-PPN.';

-- ---------------------------------------------------------------------------
-- 3. Pisahkan baris yang sudah terlanjur tersimpan PPN-inklusif
-- ---------------------------------------------------------------------------
--
-- SATU-SATUNYA sumber kebenaran soal "baris ini ber-PPN atau tidak" adalah
-- `qualified_form_services.apply_ppn`. Tabel turunannya tidak membawa penanda
-- itu, jadi baris di sana hanya dipisah bila ia bisa DITELUSURI balik ke baris
-- QFS ber-PPN dengan nilai yang sama persis. Yang tidak bisa ditelusuri
-- ditinggalkan apa adanya — dan itu benar, bukan menyerah: baris yang tidak
-- turun dari QFS ber-PPN memang tidak pernah kena PPN.

-- `ON COMMIT PRESERVE ROWS` eksplisit (dan DROP manual di ujung §3), BUKAN
-- `ON COMMIT DROP`: migrasi ini bisa dijalankan di luar blok transaksi, dan di
-- sana `ON COMMIT DROP` membuang tabelnya begitu pernyataan CREATE-nya sendiri
-- selesai — sehingga UPDATE berikutnya bertemu tabel yang sudah lenyap.
CREATE TEMP TABLE _d4_kena ON COMMIT PRESERVE ROWS AS
SELECT attempt_id,
       master_service_id,
       subtotal                                  AS bruto_lama,
       round(subtotal / 1.11, 2)                 AS dasar,
       subtotal - round(subtotal / 1.11, 2)      AS ppn
  FROM qualified_form_services
 WHERE apply_ppn
   AND subtotal > 0
   -- Hanya yang pembalikannya EKSAK. Baris yang tidak bulat ditinggalkan utuh:
   -- lebih baik satu baris tertinggal dan kelihatan (penandanya masih menyala,
   -- nilainya masih gabungan) daripada satu baris dipisah dengan angka yang
   -- dibulatkan diam-diam.
   AND round(round(subtotal / 1.11, 2) * 1.11, 2) = subtotal;

-- 3a. qualified_form_services — sumbernya.
UPDATE qualified_form_services q
   SET subtotal = k.dasar
  FROM _d4_kena k
 WHERE q.attempt_id = k.attempt_id
   AND q.master_service_id = k.master_service_id;

-- 3b. negotiation_proposal_lines — hanya yang nilainya masih persis sama dengan
--     bruto lama QFS-nya (artinya ia jalur STANDARD, bukan harga negosiasi yang
--     diketik manusia dan tidak bisa ditebak isinya).
UPDATE negotiation_proposal_lines n
   SET proposed_price = k.dasar
  FROM _d4_kena k
 WHERE n.master_service_id = k.master_service_id
   AND n.proposed_price = k.bruto_lama;

-- 3c. renewal_proposal_lines — aturan yang sama.
UPDATE renewal_proposal_lines r
   SET proposed_price = k.dasar
  FROM _d4_kena k
 WHERE r.master_service_id = k.master_service_id
   AND r.proposed_price = k.bruto_lama;

-- 3d. services.
UPDATE services s
   SET standard_price = k.dasar
  FROM _d4_kena k
 WHERE s.master_service_id = k.master_service_id
   AND s.standard_price = k.bruto_lama;

-- 3e. transactions — HANYA yang bisa dipertanggungjawabkan.
--
-- Dua pagar, dan keduanya menolak baris yang terlihat "hampir benar":
--
--   (i)  PPN-nya dijumlahkan dari `services` yang BENAR-BENAR cocok di §3d,
--        bukan dari klien lewat lead. Menelusuri lewat klien terasa lebih
--        lengkap dan justru itu masalahnya: ia menyapu transaksi yang memuat
--        baris LAIN yang tidak ber-PPN, dan memisahkan transaksi seperti itu
--        berarti menebak komposisinya.
--
--   (ii) Hasil pisahnya WAJIB memenuhi arti baru penandanya: `total_ppn` harus
--        persis 11% dari dasarnya. Model baru menaruh PPN di INVOICE, jadi
--        invoice bertanda PPN yang pajaknya bukan 11% dari dasarnya adalah
--        baris yang tidak punya arti di model ini — lebih baik ia tidak
--        disentuh dan tetap terbaca sebagai warisan, daripada dipisah menjadi
--        sesuatu yang terlihat sah tapi tidak pernah bisa dijelaskan.
--
-- Diverifikasi uji-kering ke live 2026-09-08 (read-only): TIGA transaksi lolos
-- keduanya (TRX-202608-0008/-0009/-0010, masing-masing 11% tepat), dan SATU
-- sengaja tidak lolos — TRX-202609-0002, yang totalnya 23.575.000 sementara
-- baris ber-PPN-nya hanya 5.550.000; sisanya Rp 18.025.000 dari baris lain yang
-- tidak bisa diatribusikan. Ia ditinggalkan UTUH: nilai yang tercatat = nilai
-- yang ditagih = nilai yang dibayar, dan itu tetap benar.
WITH per_trx AS (
    SELECT c.transaction_id AS trx_id, sum(k.ppn) AS ppn
      FROM _d4_kena k
      JOIN services s ON s.master_service_id = k.master_service_id
                     AND s.standard_price   = k.dasar   -- sudah ditulis §3d
      JOIN clients c  ON c.id = s.client_id
     WHERE c.transaction_id IS NOT NULL
     GROUP BY c.transaction_id
    HAVING sum(k.ppn) > 0
)
UPDATE transactions t
   SET total_agreed_value = t.total_agreed_value - p.ppn,
       total_ppn          = p.ppn,
       include_ppn        = true
  FROM per_trx p
 WHERE t.id = p.trx_id
   AND t.total_agreed_value >= p.ppn
   -- Pagar (ii): 11% tepat atas dasarnya, dibulatkan sama seperti
   -- `money.percentOf` (half-up ke rupiah penuh).
   AND round((t.total_agreed_value - p.ppn) * 0.11, 0) = p.ppn;

DROP TABLE _d4_kena;

-- ---------------------------------------------------------------------------
-- 4. Jejak audit — satu baris per transaksi yang benar-benar dipisah
-- ---------------------------------------------------------------------------
--
-- POLA: diturunkan dari baris yang benar-benar ditulis, BUKAN dari predikat
-- atas nilai baru. Migrasi 20260920010000 (188) memakai predikat atas nilai
-- baru dan mencatat 44 layanan untuk 16 yang berubah — permanen, karena
-- `audit_log` menolak DELETE (`DECISIONS.md` 2026-09-07). Di sini himpunannya
-- `total_ppn > 0`, yang PERSIS sama dengan yang ditulis di §3e: kolomnya baru
-- ada di migrasi ini dan nol untuk semua baris lain.

INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'transaction', t.id, 'SYSTEM', 'pisah_ppn_d4',
       jsonb_build_object('total_agreed_value', t.total_agreed_value + t.total_ppn,
                          'catatan', 'nilai gabungan sebelum migrasi 20260923010000; PPN masih melebur di dalamnya'),
       jsonb_build_object('total_agreed_value', t.total_agreed_value,
                          'total_ppn', t.total_ppn,
                          'include_ppn', t.include_ppn,
                          'ditagih', t.total_agreed_value + t.total_ppn),
       'SYSTEM'
  FROM transactions t
 WHERE t.total_ppn > 0;
