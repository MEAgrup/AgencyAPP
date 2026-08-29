-- ============================================================================
-- R-01 (docs/handoff/RENCANA_KINERJA_SALES.md §4/§6) — `contracts.jenis`
-- (baru | perpanjangan | cross_sell) + `contract_sebelumnya_id` (rantai
-- perpanjangan). Additive only: NOL prefix baru (`CTR-` sudah terdaftar), NOL
-- perubahan FK ke `strategi`/`services`, tidak menyentuh mesin apa pun (Contract
-- sengaja tidak punya state machine — lihat contract.ts header).
--
-- KENAPA. `sales.close()` selalu mencetak `CLI-` baru setiap closing — menjual
-- lagi ke klien yang sudah ada hari ini akan menghasilkan klien duplikat. Arah
-- (a) yang disetujui pemilik: perpanjangan = `CTR-` KEDUA pada `CLI-` yang sama,
-- cross-sell = `SVC-` baru di luar cakupan kontrak berjalan. Kolom ini adalah
-- KLASIFIKASI kontrak (dicatat sekali di titik pembuatan, bukan angka turunan
-- yang berubah-ubah) — `salesperf.ts` (R-02) membacanya untuk mengisi kolom
-- Baru/Perpanjangan/Cross Sell dashboard Kinerja Sales.
--
-- GARIS STOP (§6): migrasi ini HANYA membuka read-model. Pintu penulisan
-- (R-03 — Sales boleh membuat `CTR-` kedua lewat Client Record) BELUM dibangun;
-- `canWriteContract` (contract.ts:141) TIDAK disentuh di sini. Semua kontrak
-- yang ada hari ini di-backfill sebagai 'baru' (mereka memang kontrak pertama
-- setiap kliennya — belum ada jalur penulisan perpanjangan sama sekali).
-- ============================================================================

ALTER TABLE contracts
    ADD COLUMN jenis varchar(16) NOT NULL DEFAULT 'baru',
    ADD COLUMN contract_sebelumnya_id varchar(32) NULL;

ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_jenis CHECK (jenis IN ('baru', 'perpanjangan', 'cross_sell')),
    ADD CONSTRAINT fk_contracts_sebelumnya FOREIGN KEY (contract_sebelumnya_id) REFERENCES contracts (id);

-- Backfill eksplisit (bukan hanya mengandalkan DEFAULT): setiap kontrak yang
-- ada hari ini LAHIR dari sales.close() — belum ada jalur R-03 yang bisa
-- menghasilkan 'perpanjangan'/'cross_sell', jadi 'baru' adalah fakta, bukan
-- tebakan.
UPDATE contracts SET jenis = 'baru' WHERE jenis IS NULL OR jenis = '';

CREATE INDEX idx_contracts_sebelumnya ON contracts (contract_sebelumnya_id) WHERE contract_sebelumnya_id IS NOT NULL;

COMMENT ON COLUMN contracts.jenis IS
  'R-01 (Kinerja Sales): baru | perpanjangan | cross_sell — dicatat sekali saat kontrak dibuat, dibaca salesperf.ts.';
COMMENT ON COLUMN contracts.contract_sebelumnya_id IS
  'R-01: rantai perpanjangan — CTR- sebelumnya pada CLI- yang sama. NULL untuk kontrak jenis baru.';
