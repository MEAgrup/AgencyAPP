-- R-03 (Kinerja Sales — Renewal) — `services.transaction_id`.
--
-- KENAPA. `finance.commissionAchievement` menghitung "total komisi deal" dari
-- `select ... from services where client_id = trx.client_id` — benar SELAMA
-- satu klien hanya pernah punya SATU transaksi (hari ini). Begitu R-03
-- membuka closing KEDUA (renewal/cross-sell) pada klien yang sama, query itu
-- akan mencampur Service closing PERTAMA dengan Service closing KEDUA ke
-- dalam satu angka komisi — dua transaksi berbeda saling mencemari
-- perhitungan komisi satu sama lain. `services` tidak pernah punya kolom
-- yang menjawab "Service ini lahir dari transaksi yang mana" (hanya
-- `client_id`, dan `contract_id` yang nullable/opsional sejak O57) — jadi
-- baris ini menambahkannya.
--
-- NULLABLE, SENGAJA — bukan NOT NULL. Puluhan fixture test di seluruh repo
-- (Account/Ads/Board/Campaign/Creative/Health/KOL/Plan/Recap/Req/Stage/
-- Strategi/Task, 23 berkas) meng-insert `services` mentah untuk keperluan
-- FITUR MEREKA SENDIRI (Brief butuh Service sebagai induk, dst) — mereka
-- tidak pernah memanggil `commissionAchievement` dan tidak peduli kolom ini.
-- Memaksa NOT NULL akan merusak ke-23 fixture itu tanpa manfaat sama sekali,
-- padahal hanya SATU titik INSERT produksi (`sales.ts::close`, nanti juga
-- `renewal.ts::closeRenewal`) yang benar-benar perlu mengisinya — dan
-- keduanya SELALU mengisi karena Service selalu lahir bersama Transaction
-- dalam transaksi DB yang sama. Baris lama (backfill di bawah) tetap terisi
-- demi komisi transaksi PRODUKSI existing tetap benar; fixture BARU yang
-- tidak mengisinya sengaja dibiarkan NULL — `commissionAchievement`
-- menyaring persis by transaction_id, jadi baris NULL itu (bukan komisi
-- siapa pun) tidak pernah ikut terhitung, bukan tersembunyi jadi salah.
--
-- `client_id` DIPERTAHANKAN — dipakai luas untuk pandangan PORTOFOLIO klien
-- (Client Health M13, antrean Service Account, dst: "semua layanan klien
-- ini", lintas transaksi, benar seperti itu). Hanya `commissionAchievement`
-- yang perlu presisi per-transaksi.

ALTER TABLE services ADD COLUMN transaction_id varchar(32) NULL;

UPDATE services s
   SET transaction_id = c.transaction_id
  FROM clients c
 WHERE c.id = s.client_id;

ALTER TABLE services
    ADD CONSTRAINT fk_services_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id);

CREATE INDEX idx_services_transaction ON services (transaction_id);

COMMENT ON COLUMN services.transaction_id IS
  'R-03 — transaksi (closing) yang melahirkan Service ini. NULLABLE by design '
  '(lihat header migrasi) — dipakai finance.commissionAchievement untuk '
  'memisah komisi antar closing pada klien yang sama (renewal/cross-sell). '
  'client_id dipertahankan untuk pandangan portofolio (Health/Account), '
  'lintas transaksi.';
