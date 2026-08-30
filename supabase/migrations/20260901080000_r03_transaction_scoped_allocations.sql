-- R-03 (Kinerja Sales — Renewal) — `client_sales_allocations` menjadi
-- PER-TRANSAKSI, bukan per-klien.
--
-- KENAPA. Keputusan pemilik 2026-08-30 (`docs/DECISIONS.md`): kredit alokasi
-- pada perpanjangan mengikuti SIAPA YANG MEMPROSES closing perpanjangan itu,
-- bukan otomatis sales pemilik closing pertama. Skema lama menyimpan SATU set
-- alokasi per klien (`UNIQUE (client_id, salesperson_id)`) karena sampai hari
-- ini satu klien memang hanya pernah punya SATU closing. Begitu R-03 membuka
-- pintu closing KEDUA (renewal/cross-sell) pada klien yang sama, closing
-- kedua itu perlu baris alokasinya SENDIRI — kalau tidak, sistem tidak
-- punya tempat mencatat "closing renewal ini kreditnya Andi, closing lama
-- tetap Budi", dan `finance.commissionAchievement` akan mencampur keduanya.
--
-- BENTUK. `client_id` DIPERTAHANKAN (bukan dihapus) — dipakai gate
-- kepemilikan co-sales (`finance.ts` cek "apakah aktor anggota alokasi klien
-- ini", lintas transaksi, tanpa peduli transaksi mana) dan tampilan "semua
-- sales yang pernah dikreditkan di klien ini" (`sales.getClient`). Yang
-- BARU adalah `transaction_id`: kunci unik pindah dari (client_id,
-- salesperson_id) ke (transaction_id, salesperson_id) — closing yang
-- berbeda boleh mengkredit salesperson yang sama, closing yang SAMA tetap
-- tidak boleh mengkredit satu salesperson dua kali (invariant asli tetap
-- utuh, hanya lingkupnya yang berubah dari klien ke transaksi).
--
-- Backfill: transaction_id setiap baris existing diisi dari
-- `clients.transaction_id` (klien itu, hari ini, tepat SATU closing).

ALTER TABLE client_sales_allocations ADD COLUMN transaction_id varchar(32) NULL;

UPDATE client_sales_allocations csa
   SET transaction_id = c.transaction_id
  FROM clients c
 WHERE c.id = csa.client_id;

-- Sabuk pengaman: kalau satu baris pun gagal terisi (klien tanpa
-- transaction_id, seharusnya mustahil — alokasi hanya lahir bersama closing),
-- migrasi berhenti di sini dengan pesan yang menyebut sebabnya.
DO $$
DECLARE v_yatim integer;
BEGIN
    SELECT count(*) INTO v_yatim FROM client_sales_allocations WHERE transaction_id IS NULL;
    IF v_yatim > 0 THEN
        RAISE EXCEPTION 'R-03 backfill: % baris client_sales_allocations tidak mendapat transaction_id', v_yatim;
    END IF;
END;
$$;

ALTER TABLE client_sales_allocations ALTER COLUMN transaction_id SET NOT NULL;
ALTER TABLE client_sales_allocations
    ADD CONSTRAINT fk_alloc_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id);

ALTER TABLE client_sales_allocations DROP CONSTRAINT uq_alloc;
ALTER TABLE client_sales_allocations
    ADD CONSTRAINT uq_alloc_transaction UNIQUE (transaction_id, salesperson_id);

CREATE INDEX idx_alloc_transaction ON client_sales_allocations (transaction_id);

COMMENT ON COLUMN client_sales_allocations.transaction_id IS
  'R-03 — alokasi kini per TRANSAKSI (closing), bukan per klien. client_id '
  'dipertahankan untuk query lintas-transaksi (co-sales gate, tampilan riwayat).';
COMMENT ON COLUMN client_sales_allocations.client_id IS
  'Dipertahankan pasca R-03 murni untuk query lintas-transaksi — sumber '
  'kebenaran nilai alokasi tetap per (transaction_id, salesperson_id).';
