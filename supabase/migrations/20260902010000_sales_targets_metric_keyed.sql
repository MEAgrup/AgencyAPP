-- ============================================================================
-- Kinerja Sales — `sales_targets` menjadi metric-keyed, mengikuti contoh OKR
-- konkret dari pemilik (chat 2026-08-29, KS-4): "closing ratio 35% dari
-- qualified leads", "30 klien dengan minimal kontrak Rp10jt/kuartal", "closing
-- minimal 3 klien dari scouting/kuartal". Skema S-02 (satu angka `target_omzet`
-- per bulan/tahun) tidak bisa merepresentasikan tiga OKR itu sama sekali —
-- bukan angka Rupiah semua, dua di antaranya berjenjang KUARTAL, dan dua
-- butuh PARAMETER ambang (mis. "minimal Rp10jt").
--
-- POLA: persis `20260814020000_t1_per_staff_targets.sql` (perf_period_targets
-- menambah dimensi `staff_id` ke PK yang sudah live) — ADD COLUMN dulu, lalu
-- ganti PK, sehingga baris `omzet` yang sudah ada (dari setTarget manapun yang
-- sudah dipanggil) otomatis dapat `metric_key='omzet'` lewat DEFAULT, nol
-- migrasi data manual.
--
-- KATALOG METRIK (daftar TERTUTUP, CHECK constraint DB — bukan hanya TS,
-- sama alasannya `activity_type`/`period_kind`): menambah metrik baru berarti
-- migrasi baru + baris di `salesperf.METRIC_KEYS`, bukan string bebas dari
-- pemanggil.
--   'omzet'                       — target_value = Rupiah. metric_param NULL.
--   'closing_ratio_qualified_pct' — target_value = persen (mis. 35).
--                                   closedSuccess ÷ qualified — BERBEDA dari
--                                   `closingRatePct` yang sudah ada di View 1
--                                   (closedSuccess ÷ (closedSuccess+closedLost)).
--   'klien_count_min_kontrak'     — target_value = jumlah klien. metric_param
--                                   = ambang nilai kontrak minimum (Rupiah) —
--                                   "30 klien DENGAN MINIMAL kontrak Rp10jt".
--   'scouting_closing_count'      — target_value = jumlah closing dari lead
--                                   bersumber Scouting. metric_param NULL.
--
-- `target_value` TETAP `numeric(15,2)` untuk ketiganya (bukan Rupiah semua) —
-- sama seperti `perf_period_targets.target_value` yang juga menyimpan angka
-- non-Rupiah (jumlah unit/jam) di kolom yang sama; makna satuan ditentukan
-- `metric_key`, dibaca ulang di `salesperf.ts`/UI, TIDAK pernah dari nilai
-- mentahnya sendiri.
-- ============================================================================

-- Renamed alongside the metric-key column: `target_omzet` holding a percentage
-- or a headcount (for the other three metrics) would be an outright wrong
-- name, and this table has no other callers yet (S-02 shipped one day
-- earlier in the same stream, nol data produksi).
ALTER TABLE sales_targets RENAME COLUMN target_omzet TO target_value;

ALTER TABLE sales_targets
    ADD COLUMN metric_key   varchar(32)   NOT NULL DEFAULT 'omzet',
    ADD COLUMN metric_param numeric(15,2) NULL;

ALTER TABLE sales_targets DROP CONSTRAINT sales_targets_pkey;
ALTER TABLE sales_targets
    ADD CONSTRAINT sales_targets_pkey PRIMARY KEY (salesperson_id, period_start, period_kind, metric_key);

-- Kuartal: pemilik menyebut dua dari tiga OKR contoh berjenjang "/kuartal",
-- bukan bulanan. `period_start` untuk kuartal = tanggal 1 bulan PERTAMA
-- kuartal itu (mis. Q3 2026 = '2026-07-01'), pola yang sama dengan 'tahun'
-- (1 Jan) — kuncinya tetap satu tanggal, bukan pasangan awal/akhir.
ALTER TABLE sales_targets DROP CONSTRAINT ck_sales_targets_period_kind;
ALTER TABLE sales_targets
    ADD CONSTRAINT ck_sales_targets_period_kind CHECK (period_kind IN ('bulan', 'kuartal', 'tahun'));

ALTER TABLE sales_targets
    ADD CONSTRAINT ck_sales_targets_metric_key CHECK (metric_key IN (
        'omzet', 'closing_ratio_qualified_pct', 'klien_count_min_kontrak', 'scouting_closing_count'
    )),
    -- metric_param wajib ADA hanya untuk klien_count_min_kontrak (ambang nilai
    -- kontrak), dan wajib KOSONG untuk tiga lainnya — mencegah ambang yang
    -- diisi tapi tidak pernah dibaca (atau lupa diisi untuk metrik yang butuh).
    ADD CONSTRAINT ck_sales_targets_metric_param CHECK (
        (metric_key = 'klien_count_min_kontrak' AND metric_param IS NOT NULL)
        OR (metric_key <> 'klien_count_min_kontrak' AND metric_param IS NULL)
    ),
    ADD CONSTRAINT ck_sales_targets_metric_param_nonneg CHECK (metric_param IS NULL OR metric_param >= 0);

COMMENT ON COLUMN sales_targets.metric_key IS
  'Katalog tertutup — lihat salesperf.METRIC_KEYS. Menambah metrik = migrasi baru + baris TS, bukan string bebas.';
COMMENT ON COLUMN sales_targets.metric_param IS
  'Parameter ambang, HANYA untuk klien_count_min_kontrak (nilai kontrak minimum, Rupiah). NULL untuk metrik lain.';
