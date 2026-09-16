-- G2-01-KUADRAN-SKU langkah 2 · `pdt_benchmark` TikTok versi 2 — tambah `quad_klik`/
-- `quad_cvr` (klasifikasi kuadran SKU: Product Performance/Portfolio Produk).
--
-- `pdt_benchmark` immutable (trg_pdt_benchmark_frozen, Rule 25 — "aktif TIDAK PERNAH
-- dibalik", `versi=1` DILARANG di-UPDATE) — jadi dua kunci baru TIDAK bisa ditambahkan
-- ke baris versi 1 yang sudah ada (migrasi `20261030010000`). Satu-satunya jalur yang
-- sah: versi BARU (append-only), sama pola "kalibrasi baru = versi baru" yang sudah
-- didokumentasikan `COMMENT ON TABLE pdt_benchmark`. `aktif` dibaca `order by versi
-- desc limit 1` (Rule 23) — versi 2 otomatis jadi "aktif" begitu baris ini masuk,
-- TANPA menyentuh baris versi 1 sama sekali (`aktif` versi 1 tetap `true`, tidak pernah
-- dibalik, sesuai desain).
--
-- Delapan kunci PERTAMA disalin BYTE-PERSIS dari versi 1 (`20261030010000`) — bukan
-- rekalibrasi, murni menambah dua kunci yang belum pernah ada. `quad_klik`/`quad_cvr` =
-- PORT `REPORT_BENCH_V1` (`packages/core/src/report/bench.ts`) apa adanya, angka yang
-- SEDANG DIPAKAI produksi hari ini oleh `report_benchmark` versi 1 (mesin lama
-- `client_reports`) — porting nilai terverifikasi, bukan mengarang ambang baru. Dipakai
-- `pdt.klasifikasikanKuadranSkuTiktok` (`packages/core/src/pdt/kuadran.ts`, G2-01-
-- KUADRAN-SKU langkah 2) — benchmark mode SAJA (bukan percentile relatif mesin lama),
-- karena Rule 19 "pelacakan lintas bulan" butuh ambang STABIL supaya kuadran SKU bisa
-- dibandingkan antar periode (ambang relatif/percentile mesin lama recompute per
-- periode, tidak sebanding lintas bulan).

INSERT INTO pdt_benchmark (platform, versi, nilai, catatan, dibuat_oleh) VALUES
  ('tiktok', 2, jsonb_build_object(
      'roi_gmvmax',            jsonb_build_object('good', 8,      'warn', 4),
      'cpa_ratio',             jsonb_build_object('good', 0.10,   'warn', 0.20),
      'gmv_per_jam_live',      jsonb_build_object('good', 300000, 'warn', 150000),
      'sesi_live',             jsonb_build_object('good', 20,     'warn', 12),
      'gpm_video',             jsonb_build_object('good', 30000,  'warn', 10000),
      'pct_video_sales',       jsonb_build_object('good', 0.05,   'warn', 0.02),
      'cvr_toko',              jsonb_build_object('good', 0.015,  'warn', 0.008),
      'pct_kreator_produktif', jsonb_build_object('good', 0.20,   'warn', 0.10),
      'quad_klik',             jsonb_build_object('good', 150,    'warn', 25),
      'quad_cvr',              jsonb_build_object('good', 0.015,  'warn', 0.005)
   ), 'Versi 1 + quad_klik/quad_cvr (port REPORT_BENCH_V1 apa adanya) — G2-01-KUADRAN-SKU langkah 2, klasifikasi kuadran SKU.', 'SYSTEM');

-- Gerbang CI — nol perubahan struktural (satu baris seed baru di tabel yang sudah ada):
--   public base tables : 181 → 181 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru — pdt_benchmark berkunci alami)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
