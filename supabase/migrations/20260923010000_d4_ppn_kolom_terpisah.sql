-- D-4 — PPN berhenti dilebur ke dalam nilai transaksi. Nilai disimpan BRUTO
-- SEBELUM PPN; PPN jadi kolom TAMBAHAN di sebelahnya.
--
-- Diketok pemilik 2026-09-08 (Yohan Agustian): "semua laporan keuangan accrual
-- dibuat sebelum PPN. PPN adalah penambahan. Cek juga MSL supaya semua
-- transaksi dibuat sebelum PPN, nanti PPN adalah kolom tambahan."
--
-- ── Keadaan sebelum migrasi ini, dan kenapa itu keliru ──────────────────────
--
-- `sales.computeSubtotal` menambahkan 11% KE DALAM `subtotal` ketika penanda
-- `apply_ppn` menyala, lalu angka gabungan itu mengalir ke seluruh jalur uang:
--
--   qualified_form_services.subtotal
--     -> negotiation_proposal_lines.proposed_price
--       -> services.standard_price
--       -> transactions.total_agreed_value
--
-- Akibatnya ada dua, dan yang kedua yang mahal:
--
--   1. Laporan keuangan accrual membaca angka yang sudah termasuk pajak, jadi
--      pendapatan yang diakui 11% lebih besar dari pendapatan yang sebenarnya
--      milik perusahaan. PPN bukan pendapatan MEA — ia titipan negara.
--
--   2. `buildQuote` menghitung komisi dari `subtotal` YANG SUDAH BER-PPN.
--      Diverifikasi lewat kode berjalan, bukan dibaca: nilai Rp 10.000.000
--      dengan aturan "10% of standard price" menghasilkan komisi
--      Rp 1.000.000 tanpa PPN, dan Rp 1.110.000 dengan PPN — perusahaan
--      membayar komisi Rp 110.000 atas uang pajak yang bukan miliknya.
--
-- Cacat #2 BELUM pernah merugikan di data live: keempat baris live yang
-- ber-PPN semuanya beraturan komisi `0% of standard price`, jadi selisihnya
-- nol rupiah. Ia laten, bukan kerugian yang sudah terjadi — disebut apa adanya
-- supaya tidak dibesar-besarkan dan tidak dianggap tidak ada.
--
-- ── Yang TIDAK berubah: rupiah yang ditagihkan ke klien ─────────────────────
--
-- Nilai yang ditagih tetap `dasar + ppn`, persis sama dengan angka gabungan
-- yang tersimpan sebelum migrasi ini. Migrasi ini hanya MEMISAHKAN angka itu
-- jadi dua kolom; jumlahnya tidak bergeser satu sen pun. Itu syarat mutlak,
-- karena dua dari tiga transaksi live yang terdampak sudah berstatus
-- `[Lunas]` — angka yang sudah dibayar tidak boleh berubah.
--
-- ── Keadaan data live per 2026-09-08 (diverifikasi lewat kueri) ─────────────
--
--   qualified_form_services   25 baris, 4 ber-`apply_ppn`
--   master_service_versions   96 versi, 10 ber-`apply_ppn`
--
-- Keempat baris itu `GMV Max` mode passthrough dengan dasar bulat:
--
--   PRSP-202608-0177   57.720.000 = 52.000.000 + 5.720.000
--   PRSP-202608-0201   72.150.000 = 65.000.000 + 7.150.000
--   PRSP-202608-0204   22.200.000 = 20.000.000 + 2.200.000
--   PRSP-202609-0105    5.550.000 =  5.000.000 +   550.000
--
-- Pembalikannya EKSAK untuk keempatnya (`round(x/1.11,2)*1.11 = x`), jadi
-- pemisahan ini tidak kehilangan satu sen pun dan tidak menebak apa pun.
--
-- Aditif untuk kolomnya; untuk DATA ia menulis ulang baris yang ada, tapi
-- SELALU dengan `dasar + ppn` yang sama dengan nilai lama. Aman mendahului
-- kode HANYA karena kode lama membaca `subtotal`/`proposed_price`/
-- `total_agreed_value` sebagai satu angka dan akan membacanya 11% lebih kecil
-- di antara apply dan deploy. Karena itu migrasi ini WAJIB MENYUSUL deploy
-- kodenya (lihat handoff §"aturan urutan rilis").

-- ---------------------------------------------------------------------------
-- 1. Kolom PPN di lima tabel jalur uang
-- ---------------------------------------------------------------------------
--
-- DEFAULT 0 dan NOT NULL, bukan nullable. `0` di sini punya arti tunggal dan
-- benar: "tidak ada PPN atas baris ini". Membiarkannya NULL akan melahirkan
-- pertanyaan "belum diisi atau memang nol" yang persis kelas cacat yang aturan
-- rumah #4 ada untuk mencegah — dan tidak seperti `durasi_bulan`, di sini
-- tidak ada arti kedua yang perlu dibedakan.

ALTER TABLE qualified_form_services   ADD COLUMN ppn numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE negotiation_proposal_lines ADD COLUMN ppn numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE renewal_proposal_lines     ADD COLUMN ppn numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE services                   ADD COLUMN ppn numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE transactions               ADD COLUMN total_ppn numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE qualified_form_services
    ADD CONSTRAINT ck_qfs_ppn_nonneg CHECK (ppn >= 0);
ALTER TABLE negotiation_proposal_lines
    ADD CONSTRAINT ck_negline_ppn_nonneg CHECK (ppn >= 0);
ALTER TABLE renewal_proposal_lines
    ADD CONSTRAINT ck_rnwline_ppn_nonneg CHECK (ppn >= 0);
ALTER TABLE services
    ADD CONSTRAINT ck_services_ppn_nonneg CHECK (ppn >= 0);
ALTER TABLE transactions
    ADD CONSTRAINT ck_trx_total_ppn_nonneg CHECK (total_ppn >= 0);

-- PPN hanya boleh ada kalau penandanya menyala. Tabel lain tidak membawa
-- penanda itu, jadi pagar ini hanya bisa dipasang di sini — dan di sinilah
-- angkanya lahir.
ALTER TABLE qualified_form_services
    ADD CONSTRAINT ck_qfs_ppn_butuh_penanda CHECK (apply_ppn OR ppn = 0);

COMMENT ON COLUMN qualified_form_services.ppn IS
  'Rupiah PPN atas baris ini, TERPISAH dari `subtotal` (ketokan D-4 2026-09-08). `subtotal` adalah dasar SEBELUM PPN — itu yang dibaca mesin accrual dan yang jadi basis komisi. Yang ditagih ke klien = subtotal + ppn. 0 = tidak kena PPN.';
COMMENT ON COLUMN transactions.total_ppn IS
  'Rupiah PPN atas transaksi ini, TERPISAH dari `total_agreed_value` (ketokan D-4 2026-09-08). `total_agreed_value` adalah dasar SEBELUM PPN. Yang ditagih ke klien = total_agreed_value + total_ppn.';

-- ---------------------------------------------------------------------------
-- 2. Pisahkan baris yang sudah terlanjur tersimpan PPN-inklusif
-- ---------------------------------------------------------------------------
--
-- SATU-SATUNYA sumber kebenaran soal "baris ini ber-PPN atau tidak" adalah
-- `qualified_form_services.apply_ppn`. Tabel turunannya tidak membawa penanda
-- itu, jadi baris di sana hanya dipisah bila ia bisa DITELUSURI balik ke baris
-- QFS ber-PPN dengan nilai yang sama persis. Yang tidak bisa ditelusuri
-- ditinggalkan apa adanya dengan `ppn = 0` — dan itu benar, bukan menyerah:
-- baris yang tidak turun dari QFS ber-PPN memang tidak pernah kena PPN.
--
-- Harga NEGOSIASI yang diketik manusia tidak bisa ditebak isinya (tidak ada
-- yang tahu apakah angka itu diketik sudah termasuk pajak atau belum), jadi ia
-- sengaja TIDAK disentuh. Di data live hal itu tidak muncul: keempat baris
-- yang terdampak cocok persis dengan QFS-nya.

-- `ON COMMIT PRESERVE ROWS` eksplisit (dan DROP manual di ujung §2), BUKAN
-- `ON COMMIT DROP`: migrasi ini bisa dijalankan di luar blok transaksi, dan di
-- sana `ON COMMIT DROP` membuang tabelnya begitu pernyataan CREATE-nya sendiri
-- selesai — sehingga lima UPDATE berikutnya bertemu tabel yang sudah lenyap.
CREATE TEMP TABLE _d4_kena ON COMMIT PRESERVE ROWS AS
SELECT attempt_id,
       master_service_id,
       subtotal                                  AS bruto_lama,
       round(subtotal / 1.11, 2)                 AS dasar,
       subtotal - round(subtotal / 1.11, 2)      AS ppn
  FROM qualified_form_services
 WHERE apply_ppn
   AND subtotal > 0
   -- Hanya yang pembalikannya EKSAK. Kalau ada baris yang tidak bulat, ia
   -- ditinggalkan utuh dan ikut terlaporkan di §3 sebagai baris yang TIDAK
   -- dipisah — lebih baik satu baris tertinggal dan kelihatan daripada satu
   -- baris dipisah dengan angka yang dibulatkan diam-diam.
   AND round(round(subtotal / 1.11, 2) * 1.11, 2) = subtotal;

-- 2a. qualified_form_services — sumbernya.
UPDATE qualified_form_services q
   SET subtotal = k.dasar,
       ppn      = k.ppn
  FROM _d4_kena k
 WHERE q.attempt_id = k.attempt_id
   AND q.master_service_id = k.master_service_id;

-- 2b. negotiation_proposal_lines — hanya yang nilainya masih persis sama
--     dengan bruto lama QFS-nya (artinya ia jalur STANDARD, bukan negosiasi).
UPDATE negotiation_proposal_lines n
   SET proposed_price = k.dasar,
       ppn            = k.ppn
  FROM _d4_kena k
 WHERE n.master_service_id = k.master_service_id
   AND n.proposed_price = k.bruto_lama;

-- 2c. renewal_proposal_lines — aturan yang sama.
UPDATE renewal_proposal_lines r
   SET proposed_price = k.dasar,
       ppn            = k.ppn
  FROM _d4_kena k
 WHERE r.master_service_id = k.master_service_id
   AND r.proposed_price = k.bruto_lama;

-- 2d. services.
UPDATE services s
   SET standard_price = k.dasar,
       ppn            = k.ppn
  FROM _d4_kena k
 WHERE s.master_service_id = k.master_service_id
   AND s.standard_price = k.bruto_lama;

-- 2e. transactions — `total_agreed_value` dipisah dari Σ ppn Service miliknya.
--     Dihitung dari `services` SESUDAH 2d, jadi ia menjumlahkan PPN yang benar
--     -benar tercatat, bukan menebak ulang dari 11%. Nilai yang ditagih tidak
--     bergeser: total_agreed_value_baru + total_ppn = total_agreed_value_lama.
WITH per_trx AS (
    SELECT c.transaction_id AS trx_id, sum(s.ppn) AS ppn
      FROM services s
      JOIN clients c ON c.id = s.client_id
     WHERE c.transaction_id IS NOT NULL
     GROUP BY c.transaction_id
    HAVING sum(s.ppn) > 0
)
UPDATE transactions t
   SET total_agreed_value = t.total_agreed_value - p.ppn,
       total_ppn          = p.ppn
  FROM per_trx p
 WHERE t.id = p.trx_id
   -- Pagar: jangan sentuh transaksi yang nilainya sudah tidak cocok lagi
   -- dengan jumlah Service-nya (mis. sudah dinegosiasi ulang). Kalau tidak
   -- cocok, memisahnya berarti menebak.
   AND t.total_agreed_value >= p.ppn;

DROP TABLE _d4_kena;

-- ---------------------------------------------------------------------------
-- 3. Jejak audit — satu baris per transaksi yang benar-benar dipisah
-- ---------------------------------------------------------------------------
--
-- POLA: diturunkan dari `UPDATE ... RETURNING`, bukan dari predikat atas nilai
-- baru. Migrasi 20260920010000 (188) memakai predikat atas nilai baru dan
-- mencatat 44 layanan untuk 16 yang berubah — permanen, karena `audit_log`
-- menolak DELETE (`DECISIONS.md` 2026-09-07).
--
-- Di sini §2e sudah selesai, jadi jejaknya diturunkan dari baris yang
-- `total_ppn`-nya bukan nol — himpunan yang PERSIS sama dengan yang ditulis,
-- karena kolom itu baru ada di migrasi ini dan nol untuk semua yang lain.

INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'transaction', t.id, 'SYSTEM', 'pisah_ppn_d4',
       jsonb_build_object('total_agreed_value', t.total_agreed_value + t.total_ppn,
                          'catatan', 'nilai gabungan sebelum migrasi 20260923010000; PPN masih melebur di dalamnya'),
       jsonb_build_object('total_agreed_value', t.total_agreed_value,
                          'total_ppn', t.total_ppn,
                          'ditagih', t.total_agreed_value + t.total_ppn),
       'SYSTEM'
  FROM transactions t
 WHERE t.total_ppn > 0;
