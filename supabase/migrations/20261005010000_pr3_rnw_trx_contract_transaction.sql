-- CDPS — PR3-RNW-TRX: tautan EKSPLISIT kontrak → transaksi.
--
-- Ketokan pemilik 2026-09-11 (docs/DECISIONS.md): "Hitung semua transaksi
-- penjualan" — setiap transaksi yang lahir dari closing ATAU perpanjangan
-- dihitung TEPAT SEKALI di Kinerja Sales dan Laporan Penjualan, ada baris
-- Kontrak atau tidak.
--
-- APA YANG SALAH SEBELUM INI
-- ---------------------------------------------------------------------------
-- Satu-satunya uang yang pernah terhitung untuk seorang klien adalah uang
-- closing PERTAMANYA, lewat `clients.transaction_id` — satu kolom, satu nilai,
-- ditulis sekali oleh `sales.close()` dan sengaja tidak pernah dipindahkan oleh
-- `renewal.eksekusi` (FS-4 menolak pemindahan diam-diam kepemilikan komisi).
-- Dan bahkan uang itu hanya terhitung kalau kliennya kebetulan punya baris
-- `contracts`, karena `salesperf.loadDealFacts` memagari himpunannya dengan
-- `exists (contracts)` — pagar yang diwarisi dari join `clients ⋈ contracts`
-- yang lama, bukan yang pernah dipilih siapa pun.
--
-- Diukur di `CDPS SG` sebelum migrasi ini, bukan diperkirakan:
--
--     omzet terlapor          Rp 151.075.000   (9 dari 25 klien)
--     penjualan sebenarnya    Rp 516.307.615   (26 transaksi)
--
-- 71% penjualan tidak kelihatan — Rp 359.232.615 karena 16 klien tidak punya
-- baris Kontrak sama sekali, dan Rp 6.000.000 karena perpanjangan pertama
-- (`RNW-202608-0001`, dieksekusi 2026-08-31) melahirkan `TRX-202608-0011` yang
-- tidak bisa ditemukan oleh siapa pun. Tanpa satu galat pun di mana pun.
--
-- KENAPA KOLOMNYA TETAP DIBUTUHKAN KALAU OMZET DIHITUNG PER TRANSAKSI
-- ---------------------------------------------------------------------------
-- Omzet memang tidak perlu kontrak: ia dijumlahkan langsung dari
-- `transactions`. Yang butuh tautan ini adalah **komisi**.
--
-- `finance.commissionAchievement` menghitung komisi satu transaksi sebagai Σ
-- komisi SELURUH Service kliennya. Selama satu klien = satu transaksi itu
-- benar. Begitu klien punya dua transaksi (closing + perpanjangan), menjumlahkan
-- keduanya melipatgandakan komisi yang sama — persis kelas bug yang ditutup
-- 2026-09-11 untuk omzet, sekarang di kolom sebelahnya.
--
-- Dengan `contracts.transaction_id`, setiap Service bisa dipetakan ke TEPAT SATU
-- transaksi: lewat kontraknya kalau ia punya, dan ke transaksi closing pertama
-- kliennya (`clients.transaction_id`) kalau tidak. Σ komisi seluruh transaksi
-- seorang klien tetap PERSIS sama dengan Σ komisi seluruh Service-nya — jadi
-- untuk setiap klien satu-transaksi (yakni setiap kasus yang selama ini benar)
-- angkanya tidak bergerak satu rupiah pun.
--
-- KENAPA FK-nya KOMPOSIT
-- ---------------------------------------------------------------------------
-- Pola yang sama dengan `services`/`strategi` di O57: satu deklarasi membuat
-- "kontrak klien A membawa transaksi klien B" mustahil disimpan, tanpa trigger.
-- `transactions` karena itu mendapat UNIQUE (id, client_id) sebagai targetnya.
--
-- Indeks unik parsial menjaga arah sebaliknya: satu transaksi tidak boleh
-- dipakai dua kontrak. Nilai NULL tidak dibatasi — kontrak hasil pengelompokan
-- AM (`contract.createContract`) memang tidak lahir dari transaksi mana pun.
-- ===========================================================================

-- ===========================================================================
-- 1. Target FK komposit
-- ===========================================================================
ALTER TABLE transactions
    ADD CONSTRAINT uq_transactions_id_client UNIQUE (id, client_id);

-- ===========================================================================
-- 2. `contracts.transaction_id`
-- ===========================================================================
ALTER TABLE contracts ADD COLUMN transaction_id varchar(32) NULL;

-- `ON DELETE SET NULL (transaction_id)`, dan itu BUKAN pelonggaran konvensi
-- "tidak ada ON DELETE CASCADE untuk entity teraudit" (Sprint 0). CASCADE
-- menghancurkan baris teraudit; SET NULL hanya melepas TAUTAN, dan produksi
-- tidak punya jalur hapus transaksi sama sekali — jalur uang immutable. Yang
-- dicegahnya nyata: tanpa ini setiap pembersihan fixture yang menghapus
-- `transactions` sebelum `contracts` gagal dengan pelanggaran FK, dan kegagalan
-- itu membatalkan sisa pembersihannya sehingga berkas tes BERIKUTNYA memerah
-- karena data yang tertinggal — satu ranjau untuk setiap tes sesudah hari ini.
--
-- 🔴 DAFTAR KOLOMNYA WAJIB ADA, dan ini sudah ditabrak sekali. Pada FK KOMPOSIT,
-- `ON DELETE SET NULL` tanpa daftar kolom menge-null-kan SELURUH kolom FK —
-- termasuk `client_id`, yang NOT NULL. Akibatnya bukan galat yang jujur di
-- tempat kejadian, melainkan `null value in column "client_id"` yang muncul jauh
-- dari sebabnya dan merobohkan 34 berkas tes. Daftar kolom (PG 15+) membatasinya
-- ke tautan yang memang boleh lepas.
ALTER TABLE contracts ADD CONSTRAINT fk_contracts_transaction
    FOREIGN KEY (transaction_id, client_id) REFERENCES transactions (id, client_id)
    ON DELETE SET NULL (transaction_id);

CREATE UNIQUE INDEX uq_contracts_transaction
    ON contracts (transaction_id) WHERE transaction_id IS NOT NULL;

COMMENT ON COLUMN contracts.transaction_id IS
  'PR3-RNW-TRX — transaksi yang lahir bersama kesepakatan ini (sales.close() '
  'atau renewal.eksekusi). NULL = kontrak hasil pengelompokan AM, yang memang '
  'tidak lahir dari transaksi. Dipakai memetakan Service → deal supaya komisi '
  'klien ber-banyak-transaksi tidak terhitung berulang.';

-- ===========================================================================
-- 3. Backfill — DUA tahap, dan urutannya menentukan
-- ===========================================================================
-- Tahap A lebih dulu justru supaya tahap B tidak bisa merebut kontraknya:
-- kontrak perpanjangan SUDAH punya transaksinya sendiri, tercatat eksplisit di
-- `renewal_requests` sejak migrasi 20260902020000. Itu fakta, bukan tebakan.
UPDATE contracts c
   SET transaction_id = rr.transaction_id
  FROM renewal_requests rr
 WHERE rr.contract_id = c.id
   AND rr.transaction_id IS NOT NULL
   AND c.transaction_id IS NULL;

-- Tahap B — kontrak yang TERSISA. `clients.transaction_id` adalah transaksi
-- closing pertama klien, dan kontrak yang lahir bersamanya adalah yang PALING
-- AWAL. Dibatasi ke satu baris per klien lewat DISTINCT ON supaya indeks unik
-- parsial di atas tidak bisa dilanggar, dan `NOT EXISTS` menjaga transaksi yang
-- sudah diklaim tahap A tidak dipasang dua kali.
WITH kandidat AS (
    SELECT DISTINCT ON (c.client_id) c.id AS contract_id, cl.transaction_id
      FROM contracts c
      JOIN clients cl ON cl.id = c.client_id
     WHERE c.transaction_id IS NULL
       AND cl.transaction_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM contracts x WHERE x.transaction_id = cl.transaction_id)
     ORDER BY c.client_id, c.created_at, c.id
)
UPDATE contracts c
   SET transaction_id = k.transaction_id
  FROM kandidat k
 WHERE c.id = k.contract_id;
