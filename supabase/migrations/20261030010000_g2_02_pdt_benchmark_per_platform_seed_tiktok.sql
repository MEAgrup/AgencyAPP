-- G2-02 · `pdt_benchmark` — versi PER PLATFORM (keputusan pemilik, AskUserQuestion sesi ini)
-- + seed versi 1 TikTok. Lihat docs/DECISIONS.md untuk penjelasan lengkap.
--
-- Kenapa per platform, bukan satu versi global bersama (dua opsi diajukan
-- eksplisit ke pemilik): TikTok dan Shopee punya dimensi/bobot skor BERBEDA
-- (report/skor.ts vs report/shopee/skor.ts) dan akan dikalibrasi ulang di
-- WAKTU BERBEDA oleh orang yang sama (Director) tanpa hubungan satu sama
-- lain — menyatukan keduanya di satu nomor versi berarti merekalibrasi
-- Shopee MEMAKSA bump nomor versi TikTok juga (padahal TikTok tidak berubah
-- sama sekali), dan laporan TikTok yang belum terkirim akan tercatat memakai
-- "benchmark_versi baru" walau angka TikTok-nya identik —ongkos ketertelusuran
-- tanpa alasan. `versi PER PLATFORM` (PK majemuk) menghindari ini: rekalibrasi
-- satu platform hanya menaikkan nomor versi platform itu.
--
-- `pdt_benchmark` MASIH NOL BARIS di produksi (dicatat berkali-kali sesi ini,
-- G1-01 sengaja tidak menyeed) — mengubah PK sekarang aman, nol backfill.
--
-- Constraint desain: PRIMARY KEY (platform, versi) untuk kunci lookup alami
-- ("versi aktif TERTINGGI milik platform X"), DITAMBAH UNIQUE(versi) supaya
-- `pdt_laporan_kiriman.benchmark_versi` (FK ke `pdt_benchmark.versi` SAJA,
-- sudah ada sejak G1-01) tetap valid TANPA perlu kolom `platform` baru di
-- `pdt_laporan_kiriman` — nomor versi sekadar counter append-only lintas
-- platform (TikTok bisa punya versi 1, 3, 5, ...; Shopee 2, 4, 6, ..., tidak
-- masalah, tidak pernah dibaca sebagai urutan), bukan berkelanjutan per
-- platform. Menghindari ripple skema ke tabel lain untuk keputusan yang
-- murni tentang `pdt_benchmark` sendiri.
--
-- Seed versi 1 TikTok = PORT `REPORT_BENCH_V1` (packages/core/src/report/bench.ts)
-- APA ADANYA — delapan dari sebelas kunci, PERSIS `PdtBenchmarkTiktok`
-- (packages/core/src/pdt/skor.ts): `ctr_ads`/`quad_klik`/`quad_cvr` DIKECUALIKAN
-- (dipakai klasifikasi kuadran SKU itu sendiri, di luar cakupan `computeSkorTiktok`
-- — lihat docblock `skor.ts`). Angka-angka ini SEDANG DIPAKAI produksi hari ini
-- oleh `report_benchmark` versi 1 (mesin lama `client_reports`) — porting nilai
-- terverifikasi, bukan mengarang ambang baru.

ALTER TABLE pdt_benchmark
  ADD COLUMN platform varchar(16) NOT NULL DEFAULT 'tiktok';
ALTER TABLE pdt_benchmark
  ALTER COLUMN platform DROP DEFAULT;

ALTER TABLE pdt_benchmark
  ADD CONSTRAINT ck_pdt_benchmark_platform CHECK (platform IN ('tiktok', 'shopee', 'meta'));

-- pdt_laporan_kiriman.benchmark_versi FK bergantung pada indeks PK lama
-- (pdt_benchmark_pkey atas `versi` saja) — putuskan dulu, sambungkan lagi ke
-- UNIQUE(versi) baru di bawah setelah PK lama diganti PK majemuk.
ALTER TABLE pdt_laporan_kiriman DROP CONSTRAINT pdt_laporan_kiriman_benchmark_versi_fkey;

ALTER TABLE pdt_benchmark DROP CONSTRAINT pdt_benchmark_pkey;
ALTER TABLE pdt_benchmark ADD CONSTRAINT pdt_benchmark_pkey PRIMARY KEY (platform, versi);
ALTER TABLE pdt_benchmark ADD CONSTRAINT uq_pdt_benchmark_versi UNIQUE (versi);

ALTER TABLE pdt_laporan_kiriman
  ADD CONSTRAINT pdt_laporan_kiriman_benchmark_versi_fkey
  FOREIGN KEY (benchmark_versi) REFERENCES pdt_benchmark (versi);

COMMENT ON TABLE pdt_benchmark IS
  'Benchmark skor dimensi PDT, berversi PER PLATFORM (PK majemuk platform+versi; UNIQUE(versi) '
  'terpisah menjaga pdt_laporan_kiriman.benchmark_versi tetap FK tunggal ke versi), Director-only '
  '(pdt.canKelolaBenchmark). Append-only: kalibrasi baru = versi baru, aktif TIDAK PERNAH dibalik '
  '— preseden adsscanner_benchmark/px_eligibility_policy huruf per huruf. Versi aktif dibaca '
  'where platform=X and aktif=true order by versi desc limit 1 (Rule 23). Ganti versi ⇒ laporan '
  'BELUM terkirim platform itu ikut versi baru otomatis; yang sudah terkirim (pdt_laporan_kiriman) '
  'tetap memakai benchmark_versi saat pengiriman.';

-- Versi 1 TikTok = REPORT_BENCH_V1 apa adanya (delapan kunci PdtBenchmarkTiktok).
INSERT INTO pdt_benchmark (platform, versi, nilai, catatan, dibuat_oleh) VALUES
  ('tiktok', 1, jsonb_build_object(
      'roi_gmvmax',            jsonb_build_object('good', 8,      'warn', 4),
      'cpa_ratio',             jsonb_build_object('good', 0.10,   'warn', 0.20),
      'gmv_per_jam_live',      jsonb_build_object('good', 300000, 'warn', 150000),
      'sesi_live',             jsonb_build_object('good', 20,     'warn', 12),
      'gpm_video',             jsonb_build_object('good', 30000,  'warn', 10000),
      'pct_video_sales',       jsonb_build_object('good', 0.05,   'warn', 0.02),
      'cvr_toko',              jsonb_build_object('good', 0.015,  'warn', 0.008),
      'pct_kreator_produktif', jsonb_build_object('good', 0.20,   'warn', 0.10)
   ), 'Port REPORT_BENCH_V1 (report/bench.ts) apa adanya — delapan kunci yang dipakai computeSkorTiktok.', 'SYSTEM');

-- Gerbang CI — nol perubahan (ALTER tabel yang sudah ada + satu baris seed):
--   public base tables : 176 → 176 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru — pdt_benchmark berkunci alami)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
