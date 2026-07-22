-- Foundation objects for the Supabase Postgres port — dieksekusi SEBELUM semua
-- port skema (timestamp paling awal). Konvensi per docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §B.
--
-- Berisi fungsi reusable yang dipakai lintas migrasi port:
--   - set_updated_at()   : pengganti MySQL `ON UPDATE CURRENT_TIMESTAMP` (§A.2)
--   - forbid_mutation()  : pengganti MySQL `SIGNAL SQLSTATE '45000'` immutability guard (§B.3)
--   - wib_date(ts)       : civil-date WIB (UTC+7 fixed, tanpa DST) — DECISIONS O20
--   - wib_period(ts)     : bucket bulan WIB 'YYYYMM' untuk house-ID PREFIX-YYYYMM-NNNN

-- Reusable BEFORE UPDATE trigger: set NEW.updated_at := now().
-- Padanan Postgres untuk `... ON UPDATE CURRENT_TIMESTAMP` MySQL yang tidak punya
-- equivalent native (§A.2). Satu fungsi dipasang ke tiap tabel yang butuh, bukan
-- diduplikasi per tabel.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Reusable immutability guard: port dari MySQL `SIGNAL SQLSTATE '45000'` (§B.3).
-- Dipasang sebagai BEFORE UPDATE / BEFORE DELETE trigger pada tabel append-only
-- (audit_log, notifications no-delete, snapshot-tabel). Satu fungsi generik dipakai
-- semua trigger supaya pesan konsisten.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only/immutable: % forbidden', TG_TABLE_NAME, TG_OP;
END;
$$;

-- wib_date: civil-date (kalender WIB) dari sebuah instant. WIB = UTC+7 fixed, tanpa
-- DST (DECISIONS O20). Memakai idiom fixed-offset `+ interval '7 hours'`, BUKAN
-- `AT TIME ZONE 'Asia/Jakarta'` (yang bergantung tzdata OS & DST-aware) — konsisten
-- alasan asli memilih time.FixedZone di Go (§A.3/§B.7). AT TIME ZONE 'UTC' hanya
-- dipakai untuk mengambil wall-clock UTC absolut sebelum digeser 7 jam.
CREATE OR REPLACE FUNCTION wib_date(ts timestamptz) RETURNS date
LANGUAGE sql STABLE AS
$$ SELECT ((ts AT TIME ZONE 'UTC') + interval '7 hours')::date $$;

-- wib_period: bucket bulan kalender WIB sebagai 'YYYYMM' — sumber periode house-ID
-- PREFIX-YYYYMM-NNNN (§B.1). Idiom fixed-offset yang sama dengan wib_date.
CREATE OR REPLACE FUNCTION wib_period(ts timestamptz) RETURNS char(6)
LANGUAGE sql STABLE AS
$$ SELECT to_char((ts AT TIME ZONE 'UTC') + interval '7 hours', 'YYYYMM')::char(6) $$;
