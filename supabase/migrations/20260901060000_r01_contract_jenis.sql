-- Kinerja Sales — R-01: `contracts.jenis` (Baru / Perpanjangan / Cross Sell).
--
-- KENAPA. RENCANA_KINERJA_SALES.md §4: `sales.close()` selalu mencetak `CLI-`
-- baru — menjual lagi ke klien yang sudah ada hari ini menghasilkan klien
-- DUPLIKAT, karena tidak ada cara menandai bahwa suatu kesepakatan adalah
-- lanjutan dari klien yang sudah ada. `contracts` (O57) sudah tepat sebagai
-- rumahnya: kesepakatan kedua pada `CLI-` yang sama = perpanjangan; `SVC-` baru
-- di luar cakupan kontrak berjalan = cross-sell. Deviasi PRD M0 §6 dicatat di
-- docs/DECISIONS.md.
--
-- BENTUK. Diklasifikasikan SEKALI di titik pembuatan kontrak (bukan angka
-- turunan yang berubah-ubah setiap kali dibaca) — house rule #3: kontrak yang
-- sudah dibuat tidak berubah jenisnya sendiri. `contract_sebelumnya_id`
-- menautkan rantai perpanjangan (nullable — hanya terisi kalau jenis =
-- perpanjangan); FK ke `contracts(id)` sendiri (self-referencing), bukan
-- komposit dengan client_id karena baris induk & anak SELALU klien yang sama
-- (ditegakkan CHECK di bawah lewat subquery TIDAK bisa — jadi ditegakkan di
-- domain oleh `renewal.ts`, yang membangun pintunya di R-03; di sini murni
-- skema). `transaction_id` menaut kontrak ke closing yang MELAHIRKANNYA —
-- dipakai `salesperf.ts` untuk mengklasifikasikan SATU closing (bukan
-- seluruh klien) sebagai baru/perpanjangan/cross-sell; NULL untuk kontrak
-- yang dibuat lewat jalur Account biasa (`contract.ts`, tidak terikat satu
-- closing tertentu).
--
-- Nol prefix baru (CTR- sudah terdaftar), nol perubahan FK ke tabel lain di
-- luar `transactions`, tidak menyentuh `strategi`/`services`. Backfill: semua
-- kontrak existing (hasil migrasi O57, semuanya lahir dari jalur "kontrak
-- pertama sebuah klien") diberi `'baru'` lewat DEFAULT, `transaction_id`
-- tetap NULL (kontrak Account biasa, tidak lahir dari satu closing R-03).

ALTER TABLE contracts
    ADD COLUMN jenis varchar(16) NOT NULL DEFAULT 'baru',
    ADD COLUMN contract_sebelumnya_id varchar(32) NULL,
    ADD COLUMN transaction_id varchar(32) NULL;

ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_jenis CHECK (jenis IN ('baru', 'perpanjangan', 'cross_sell'));

ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_sebelumnya
    FOREIGN KEY (contract_sebelumnya_id) REFERENCES contracts (id);

ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_transaction
    FOREIGN KEY (transaction_id) REFERENCES transactions (id);

-- contract_sebelumnya_id hanya sah menyertai jenis='perpanjangan' — sebuah
-- kontrak 'baru'/'cross_sell' tidak boleh diam-diam menaut ke rantai
-- perpanjangan (itu akan membuat R-02's read-model salah menghitung rantai).
ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_sebelumnya_shape CHECK (
        (jenis = 'perpanjangan') OR (contract_sebelumnya_id IS NULL));

CREATE INDEX idx_contracts_sebelumnya ON contracts (contract_sebelumnya_id);
CREATE INDEX idx_contracts_transaction ON contracts (transaction_id);

COMMENT ON COLUMN contracts.jenis IS
  'R-01 (Kinerja Sales) — diklasifikasikan SEKALI saat kontrak dibuat: baru | '
  'perpanjangan | cross_sell.';
COMMENT ON COLUMN contracts.contract_sebelumnya_id IS
  'R-01 — rantai perpanjangan. NULL kecuali jenis=perpanjangan. Diisi oleh '
  'pintu R-03 (renewal.ts::closeRenewal).';
COMMENT ON COLUMN contracts.transaction_id IS
  'R-01/R-03 — closing yang melahirkan kontrak ini (renewal.ts::closeRenewal). '
  'NULL untuk kontrak dari jalur Account biasa (contract.ts), yang tidak '
  'terikat satu closing tertentu. Dipakai salesperf.ts untuk mengklasifikasi '
  'SATU closing, bukan seluruh riwayat klien.';
