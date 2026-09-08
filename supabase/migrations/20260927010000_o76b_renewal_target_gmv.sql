-- ============================================================================
-- O76 lanjutan — saat PERPANJANGAN (R-03), anchor floor GMV di-refresh dari
-- angka yang disepakati ulang, bukan diwarisi diam-diam.
--
-- Keputusan pemilik 2026-09-08: "jadikan field di form renewal, default = angka
-- lama."
--
-- ## Kenapa ini perlu ada bersamaan dengan O76, bukan nanti
--
-- O76 menjadikan `clients.target_gmv` sebagai ANCHOR floor GMV M6A. Tapi angka
-- itu diisi Sales SEKALI, di form Qualified, saat klien pertama kali ditutup.
-- Sementara `renewal.executeRenewal` mencetak `CTR-` baru, `SVC-` baru, dan
-- `TRX-` baru — dan **tidak menyentuh `clients.target_gmv` sama sekali**
-- (diperiksa: enam langkahnya menulis contracts, services, transactions,
-- installments, client_sales_allocations, dan clients.sales_pic_id — bukan
-- target_gmv).
--
-- Akibatnya, tanpa migrasi ini: kontrak tahun kedua dengan janji GMV baru akan
-- diukur terhadap angka yang disepakati setahun sebelumnya. Anchor yang basi
-- lebih buruk daripada tidak ada anchor, karena ia tetap terlihat sah.
--
-- ## Kenapa kolomnya di `renewal_requests`, bukan langsung tulis `clients`
--
-- Karena angka ini DIUSULKAN saat proposal dibuat dan baru BERLAKU saat
-- eksekusi — dua momen berbeda, dan di antaranya ada keputusan Sales Head
-- (`decideRenewal`). Menulis `clients.target_gmv` di momen proposal berarti
-- sebuah usulan yang belum disetujui sudah menggeser anchor yang mengukur
-- Strategi yang sedang berjalan.
--
-- Jadi: diusulkan di sini, dipindahkan ke `clients` oleh `executeRenewal` dalam
-- transaksi yang sama dengan `CTR-`/`SVC-`/`TRX-`-nya, dengan baris audit
-- before→after pada entitas `client` (aturan rumah #3). NULL = penyaji tidak
-- mengubah target; anchor lama tetap berlaku, dan itu berbeda dari "target
-- barunya nol".
--
-- Aditif: 1 kolom + 1 CHECK. Nol tabel/prefix/mesin/event baru ⇒ gate
-- 146/40/31/76 TETAP.
-- ============================================================================

ALTER TABLE renewal_requests
    ADD COLUMN target_gmv_baru numeric(15,2) NULL;

-- `numeric(15,2)` menyamai `clients.target_gmv` persis, bukan `(18,2)` yang
-- dipakai `strategi.client_target_gmv`: kolom ini adalah CALON isi kolom itu,
-- jadi ia harus tidak bisa memuat angka yang tujuannya tidak bisa memuat.
ALTER TABLE renewal_requests
    ADD CONSTRAINT ck_rnw_target_gmv_baru_nonneg
        CHECK (target_gmv_baru IS NULL OR target_gmv_baru >= 0);

COMMENT ON COLUMN renewal_requests.target_gmv_baru IS
  'O76 (2026-09-08) — target GMV yang disepakati ULANG untuk periode '
  'perpanjangan ini. Diusulkan saat proposal, dipindahkan ke `clients.target_gmv` '
  'oleh executeRenewal (audit before->after). NULL = tidak diubah, anchor lama '
  'tetap berlaku — berbeda dari nol.';
