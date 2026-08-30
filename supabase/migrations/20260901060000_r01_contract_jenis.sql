-- Kinerja Sales — R-01: `contracts.jenis` (Baru / Perpanjangan / Cross Sell).
--
-- KENAPA. RENCANA_KINERJA_SALES.md §4: `sales.close()` selalu mencetak `CLI-`
-- baru — menjual lagi ke klien yang sudah ada hari ini menghasilkan klien
-- DUPLIKAT, karena tidak ada cara menandai bahwa suatu kesepakatan adalah
-- lanjutan dari klien yang sudah ada. `contracts` (O57) sudah tepat sebagai
-- rumahnya: kesepakatan kedua pada `CLI-` yang sama = perpanjangan; `SVC-` baru
-- di luar cakupan kontrak berjalan = cross-sell. Kolom ini HANYA
-- mengklasifikasikan kontrak yang sudah ada — pintu untuk MEMBUAT kontrak
-- perpanjangan dari Client Record (R-03/R-04) sengaja BELUM dibangun (garis
-- stop §6: `canWriteContract` masih Account-only, dan setiap kontrak baru
-- mewajibkan siklus Strategi/Plan — mesin yang sedang diperbaiki paralel).
-- Deviasi PRD M0 §6 dicatat di docs/DECISIONS.md.
--
-- BENTUK. Diklasifikasikan SEKALI di titik pembuatan kontrak (bukan angka
-- turunan yang berubah-ubah setiap kali dibaca) — house rule #3: kontrak yang
-- sudah dibuat tidak berubah jenisnya sendiri. `contract_sebelumnya_id`
-- menautkan rantai perpanjangan (nullable — hanya terisi kalau jenis =
-- perpanjangan); FK ke `contracts(id)` sendiri (self-referencing), bukan
-- komposit dengan client_id karena baris induk & anak SELALU klien yang sama
-- (ditegakkan CHECK di bawah lewat subquery TIDAK bisa — jadi ditegakkan di
-- domain saat R-03 membangun pintunya; di sini murni skema).
--
-- Nol prefix baru (CTR- sudah terdaftar), nol perubahan FK ke tabel lain,
-- tidak menyentuh `strategi`/`services`. Backfill: semua kontrak existing
-- (hasil migrasi O57, semuanya lahir dari jalur "kontrak pertama sebuah
-- klien") diberi `'baru'` lewat DEFAULT — tidak ada baris yang perlu
-- diklasifikasi ulang secara eksplisit karena tabel ini baru berisi data sejak
-- 20260807120000 dan belum ada jalur produksi yang membuat 'perpanjangan'.

ALTER TABLE contracts
    ADD COLUMN jenis varchar(16) NOT NULL DEFAULT 'baru',
    ADD COLUMN contract_sebelumnya_id varchar(32) NULL;

ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_jenis CHECK (jenis IN ('baru', 'perpanjangan', 'cross_sell'));

ALTER TABLE contracts
    ADD CONSTRAINT fk_contracts_sebelumnya
    FOREIGN KEY (contract_sebelumnya_id) REFERENCES contracts (id);

-- contract_sebelumnya_id hanya sah menyertai jenis='perpanjangan' — sebuah
-- kontrak 'baru'/'cross_sell' tidak boleh diam-diam menaut ke rantai
-- perpanjangan (itu akan membuat R-02's read-model salah menghitung rantai).
ALTER TABLE contracts
    ADD CONSTRAINT ck_contracts_sebelumnya_shape CHECK (
        (jenis = 'perpanjangan') OR (contract_sebelumnya_id IS NULL));

CREATE INDEX idx_contracts_sebelumnya ON contracts (contract_sebelumnya_id);

COMMENT ON COLUMN contracts.jenis IS
  'R-01 (Kinerja Sales) — diklasifikasikan SEKALI saat kontrak dibuat: baru | '
  'perpanjangan | cross_sell. Default baru (setiap kontrak hari ini adalah '
  'kontrak pertama kliennya — pintu perpanjangan/cross-sell dari Client '
  'Record belum dibangun, R-03 garis stop).';
COMMENT ON COLUMN contracts.contract_sebelumnya_id IS
  'R-01 — rantai perpanjangan. NULL kecuali jenis=perpanjangan. Diisi hanya '
  'oleh pintu R-03 (belum dibangun); nol baris terisi sampai saat itu.';
