-- T-1 (O9): per-INDIVIDUAL-staff monthly targets.
--
-- Keputusan pemilik 2026-08-14: target normalisasi bisa diisi per-staff, bukan
-- hanya per role-type. Skema lama hanya membawa (role_type, component,
-- period_start). Kita tambah dimensi staff dengan sentinel yang persis mengikuti
-- pola period_start '0001-01-01':
--
--   staff_id = '*'  → "role default": berlaku untuk SEMUA staff role itu, kecuali
--                     ada baris staff-spesifik yang menimpanya.
--
-- Sentinel dipakai (bukan NULL) karena kolom PK Postgres wajib NOT NULL — sama
-- alasannya kenapa period default memakai '0001-01-01', bukan NULL.
--
-- Presedensi resolusi (paling spesifik menang), dihitung di
-- performance.ts::targetsForRole:
--   staff-exact + period-exact
--     > staff-exact + period-default
--       > role-default + period-exact
--         > role-default + period-default
-- Artinya: staff mengalahkan periode. Target khusus seorang Advertiser untuk
-- "semua periode" menang atas target role untuk bulan tertentu.

ALTER TABLE perf_period_targets
    ADD COLUMN staff_id varchar(64) NOT NULL DEFAULT '*';  -- '*' = role default (semua staff role)

-- Ganti PK agar staff jadi bagian identitas baris. Baris seed lama otomatis
-- ber-staff_id '*' (role default) lewat DEFAULT di atas.
ALTER TABLE perf_period_targets DROP CONSTRAINT perf_period_targets_pkey;
ALTER TABLE perf_period_targets
    ADD CONSTRAINT perf_period_targets_pkey
    PRIMARY KEY (role_type, component, staff_id, period_start);
