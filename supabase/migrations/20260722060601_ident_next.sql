-- Penambahan native Postgres (bukan port skema) — konversi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §B.1
-- Ditulis SETELAH semua migrasi port (timestamp 20260102...) karena bergantung pada
-- tabel id_sequences (port 20260722053824_init) dan fungsi wib_period (20260722052710_pg_foundation).

-- ident_next — generator house-ID PREFIX-YYYYMM-NNNN.
--
-- Port dari backend/internal/core/ident/ident.go (fungsi ident.Next). Kode Go asli
-- memakai satu atomic upsert MySQL:
--   INSERT ... VALUES (?, ?, LAST_INSERT_ID(1), 'SYSTEM')
--   ON DUPLICATE KEY UPDATE next_n = LAST_INSERT_ID(next_n + 1)
-- yang mengambil exclusive row-lock pada baris (prefix, period) sampai transaksi
-- commit/rollback. Sifat yang WAJIB dipertahankan (identik semantik Go):
--   - nilai pertama untuk (prefix, period) baru = 1;
--   - gap-free / tanpa duplikat di bawah concurrency (kontender serialize di row-lock);
--   - tidak ada konsumsi nomor saat rollback (increment yang di-rollback dikembalikan
--     ke committer berikutnya).
--
-- Padanan Postgres: INSERT ... ON CONFLICT (prefix, period) DO UPDATE ... RETURNING.
-- Upsert Postgres selalu mengunci baris target (setara SELECT ... FOR UPDATE), jadi
-- properti gap-free/rollback-safe dipertahankan by construction selama fungsi
-- dipanggil DI DALAM transaksi yang sama dengan insert entity (§B.1).
--
-- Nama kolom disesuaikan dengan skema hasil port 0001 (id_sequences):
--   prefix varchar(16), period char(6), next_n integer, created_by varchar(64).
--
-- Periode bucket memakai WIB fixed-offset (wib_period → `+ interval '7 hours'`),
-- BUKAN AT TIME ZONE 'Asia/Jakarta' (DECISIONS O20). Validasi field wajib + pesan
-- BI [...] tetap tanggung jawab kode aplikasi; fungsi ini TIDAK memvalidasi bisnis
-- dan hanya dipanggil setelah validasi lolos (persis pola ident.Next dipanggil
-- setelah Validate()).
CREATE OR REPLACE FUNCTION ident_next(p_prefix text, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_period char(6) := wib_period(p_at);
    v_n      integer;
BEGIN
    INSERT INTO id_sequences (prefix, period, next_n, created_by)
    VALUES (p_prefix, v_period, 1, 'SYSTEM')
    ON CONFLICT (prefix, period)
    DO UPDATE SET next_n = id_sequences.next_n + 1
    RETURNING next_n INTO v_n;

    RETURN p_prefix || '-' || v_period || '-' || lpad(v_n::text, 4, '0');
END;
$$;
