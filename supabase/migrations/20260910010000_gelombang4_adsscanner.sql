-- ============================================================================
-- Gelombang 4 (TikTok Ads Scanner) — AS-01..AS-04: prefix registry + schema
-- for `adsscanner_run` (ASR-) and the versioned category benchmark
-- (`adsscanner_benchmark`).
--
-- Sumber: docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md §7,
-- docs/design/TIKTOK_ADS_SCANNER.html (judul asli "MEA SKU Triage — Panel
-- Advertiser"), docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md (AS-01..AS-04),
-- docs/DECISIONS.md (O67 PORT PENUH, O69 tabel CDPS baru).
--
-- KENAPA INI ADA. Engine murninya sudah mendarat lebih dulu
-- (`packages/core/src/adsscanner/tiktok/`, payload
-- `cdps.adsscanner.tiktok.v1`) TANPA satu pun migrasi/domain/rute — O67
-- sengaja menunda lapisan penyimpanannya karena alat aslinya menyimpan
-- portofolio multi-klien di `localStorage` browser, dan memindahkan itu ke
-- CDPS adalah keputusan arsitektur, bukan detail port. **O69 menjawabnya:**
-- portofolio jadi TABEL CDPS BARU yang mencerminkan pola `screening_run`,
-- BUKAN dipetakan ke `clients`/`client_reports`.
--
-- KENAPA BUKAN `client_reports`. Tiga alasan yang berdiri sendiri:
--  1. `client_reports` adalah **laporan yang dibaca KLIEN** — ia punya
--     lapisan publikasi (`client_report_publikasi`), insight editable
--     (`client_report_insight`), dan permukaan Client Portal. Ads Scanner
--     adalah **alat kerja internal divisi Ads**: keluarannya daftar SKU
--     mana yang di-scale/dimatikan beserta realokasi budget — angka yang
--     TIDAK BOLEH sampai ke klien tanpa seorang pun merancangnya. Menaruhnya
--     di `client_reports` berarti satu kelalaian gerbang publikasi = strategi
--     bidding internal terkirim ke klien.
--  2. Kadensnya beda: laporan klien bulanan/mingguan per KLIEN; scan ini
--     MINGGUAN per klien tapi dibaca sebagai PORTOFOLIO lintas klien (satu
--     advertiser memegang banyak toko — itulah `state.clients` di alat asli).
--     Read pattern-nya "baris terakhir tiap klien yang saya pegang", yang
--     `client_reports` tidak pernah punya.
--  3. `client_reports.payload_schema` sudah dikunci CHECK ke dua nilai
--     (`cdps.report.tiktok.v1`, `cdps.report.shopee.v1`) oleh
--     `20260909010000`, dan kolom benchmark-nya sudah dua (TikTok + Shopee)
--     dengan CHECK "tepat satu terisi". Menambah mesin ketiga di sana
--     berarti kolom benchmark KETIGA dan CHECK tiga cabang, untuk baris yang
--     tidak berbagi satu pun konsumen dengan dua yang lain.
--
-- SCOPE MIGRASI INI: schema + prefix registry + benchmark versi 1. Domain
-- layer & rute menyusul dalam commit yang sama (beda dari `20260908050000`
-- yang sengaja schema-only), jadi policy tulis TETAP nol di sini: tulisan
-- lewat service-role dari `packages/domain/src/adsscanner.ts`, pola sama
-- `screening_run`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prefix registry: entity_prefix 39 → 40 (ASR). WAJIB tetap identik dengan
--    `PREFIXES` di packages/core/src/ident.ts (M6A §7, ident.registry.test.ts
--    memeriksa DUA arah) — dinaikkan bersama di commit yang SAMA, sesuai
--    peringatan near-miss PR #170 (satu gerbang diperbarui, satunya lupa).
--
--    SATU prefix, bukan dua: berbeda dari Gelombang 3 (SCR + ADL), Gelombang
--    4 hanya punya satu entitas ber-ID — RUN-nya. Benchmark-nya berkunci
--    `versi integer` (pola sama `report_benchmark`/`report_benchmark_shopee`,
--    bukan entitas ber-prefix).
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('ASR', 'Ads Scanner run (TikTok Ads Scanner)', 'Gelombang 4 (TikTok Ads Scanner)');

-- ---------------------------------------------------------------------------
-- 2. adsscanner_benchmark — tabel kategori→benchmark BERVERSI.
--
--    Cermin `ADSSCANNER_BENCH_V1` (packages/core/src/adsscanner/tiktok/bench.ts):
--    `{kategori: {roi, tr, gpm}}`, 34 kategori Level-3 TikTok Shop.
--
--    KENAPA TABEL SENDIRI, BUKAN BARIS DI `report_benchmark`: bentuk
--    `report_benchmark.nilai` adalah `{kunci: {good, warn}}` (ambang dua-sisi
--    per metrik) — bentuk di sini adalah PETA KATEGORI ke tiga target, dan
--    `report_benchmark.versi` adalah PK yang dirujuk
--    `client_reports.benchmark_versi`. Alasan identik dengan yang sudah
--    dicatat `20260909010000` untuk `report_benchmark_shopee`; pola yang sama
--    diulang, bukan pola baru.
--
--    Append-only: kalibrasi baru = versi baru. `roi`/`tr`/`gpm` boleh `null`
--    per kategori — itu "belum diukur" yang sungguhan (mis. Gaming &
--    Consoles tidak punya data ROI/TR sama sekali), BUKAN nol; skor wajib
--    mengeluarkan komponennya dari perhitungan, bukan memakai `?? 0`.
-- ---------------------------------------------------------------------------
CREATE TABLE adsscanner_benchmark (
    versi        integer      NOT NULL PRIMARY KEY,
    -- {kategori: {roi: number|null, tr: number|null, gpm: number|null}} —
    -- `gpm` dalam USD (dikonversi ke Rupiah saat skoring pakai cfg.usdRate).
    nilai        jsonb        NOT NULL,
    aktif        boolean      NOT NULL DEFAULT true,
    catatan      text         NULL,
    dibuat_pada  timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_adsscanner_benchmark_versi CHECK (versi >= 1),
    CONSTRAINT ck_adsscanner_benchmark_nilai_shape CHECK (jsonb_typeof(nilai) = 'object')
);

COMMENT ON TABLE adsscanner_benchmark IS
  'Benchmark kategori TikTok Ads Scanner (BENCHMARKS dari MEA SKU Triage — Panel Advertiser) berversi, Director-only. Append-only: kalibrasi baru = versi baru. Setiap adsscanner_run menyimpan benchmark_versi yang dipakainya, supaya skor/bucket/realokasi bisa dihitung ulang (aturan rumah #4).';

-- Versi 1 = konstanta `ADSSCANNER_BENCH_V1` apa adanya. Sumber komentar alat:
-- "sheet benchmark MEA. ROI update 31 Des 2025, TR & GPM update 26 Apr 2026."
INSERT INTO adsscanner_benchmark (versi, nilai, catatan, dibuat_oleh) VALUES
    (1, '{
      "Audio & Camera": {"roi": 8.04, "tr": 0.05, "gpm": 3.26},
      "Automotive & Motorcycle": {"roi": 5.75, "tr": 0.03, "gpm": 1.65},
      "Beauty & Personal Care": {"roi": 3.82, "tr": 0.13, "gpm": 1.63},
      "Books & Magazine": {"roi": 3.63, "tr": 0.12, "gpm": 1.05},
      "Computers & Office Equipment": {"roi": 7.64, "tr": 0.04, "gpm": 4.35},
      "Fashion Accessories": {"roi": 4, "tr": 0.06, "gpm": 2.41},
      "Food & Beverages": {"roi": 4.71, "tr": 0.06, "gpm": 1.45},
      "Furniture": {"roi": 10.22, "tr": 0.03, "gpm": 4.82},
      "Handphone (Devices)": {"roi": 50.43, "tr": 0.01, "gpm": 3.02},
      "Health": {"roi": 3.26, "tr": 0.12, "gpm": 2.33},
      "Home Appliances": {"roi": 15.62, "tr": 0.05, "gpm": 3.95},
      "Home Care Essentials": {"roi": null, "tr": 0.07, "gpm": 1.74},
      "Home Improvement": {"roi": 7.87, "tr": 0.05, "gpm": 2.91},
      "Home Supplies": {"roi": 3.73, "tr": 0.07, "gpm": 2.06},
      "Jewellery Accessories & Derivatives": {"roi": 78.21, "tr": 0.01, "gpm": 4.8},
      "Kids'' Fashion": {"roi": 6, "tr": 0.03, "gpm": 3.2},
      "Kitchenware": {"roi": 7.97, "tr": 0.04, "gpm": 2.833},
      "Luggage & Bags": {"roi": 8.58, "tr": 0.05, "gpm": 2.28},
      "Menswear & Underwear": {"roi": 5.77, "tr": 0.04, "gpm": 1.66},
      "Mom & Babies": {"roi": 5.31, "tr": 0.06, "gpm": 2.25},
      "Muslim Fashion": {"roi": 9.16, "tr": 0.03, "gpm": 3.86},
      "Pet Supplies": {"roi": 3.95, "tr": 0.07, "gpm": 1.32},
      "Shoes": {"roi": 7.21, "tr": 0.06, "gpm": 1.59},
      "Sports & Outdoor Equipment": {"roi": 8.15, "tr": 0.04, "gpm": 2.38},
      "Sportswear": {"roi": null, "tr": 0.04, "gpm": 1.68},
      "Stationery": {"roi": 11.3, "tr": 0.03, "gpm": 1.6},
      "Textiles & Soft Furnishings": {"roi": 7.71, "tr": 0.04, "gpm": 3.79},
      "Tools & Hardware": {"roi": 3.36, "tr": 0.06, "gpm": 2.64},
      "Toys & Hobbies": {"roi": 7.8, "tr": 0.04, "gpm": 1.93},
      "Wearable & Accessories": {"roi": 7.36, "tr": 0.08, "gpm": 1.55},
      "Womenswear & Underwear": {"roi": 7.27, "tr": 0.04, "gpm": 3.21},
      "Gaming & Consoles": {"roi": null, "tr": null, "gpm": 0.86},
      "Telecommunication": {"roi": null, "tr": null, "gpm": 0.51},
      "Music & Collectibles": {"roi": null, "tr": null, "gpm": 1.36}
     }'::jsonb, 'Port BENCHMARKS MEA SKU Triage — Panel Advertiser v1 apa adanya (34 kategori).', 'SYSTEM');

CREATE OR REPLACE FUNCTION adsscanner_benchmark_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'adsscanner_benchmark: append-only — kalibrasi baru = versi baru, versi lama immutable (aturan rumah #4)';
END;
$$;
CREATE TRIGGER trg_adsscanner_benchmark_frozen BEFORE UPDATE OR DELETE ON adsscanner_benchmark
    FOR EACH ROW EXECUTE FUNCTION adsscanner_benchmark_frozen();

REVOKE ALL ON public.adsscanner_benchmark FROM anon;
REVOKE ALL ON public.adsscanner_benchmark FROM authenticated;
ALTER TABLE public.adsscanner_benchmark ENABLE ROW LEVEL SECURITY;
-- NOL policy (default-deny) — sama seperti report_benchmark/report_benchmark_shopee:
-- benchmark dibaca HANYA lewat service-role saat menskor.

-- ---------------------------------------------------------------------------
-- 3. adsscanner_run (ASR-) — satu baris per SCAN mingguan satu klien.
--
--    Bentuknya sengaja mencerminkan `screening_run` (O69 "mirror pola
--    screening_run"): input yang menggerakkan hasil jadi KOLOM nyata (bisa
--    di-query/di-filter, dan CHECK-nya ditegakkan DB), hasil hitungan jadi
--    `payload` jsonb BEKU, provenance berkas jadi `sumber_berkas` jsonb.
--
--    BEKU SELURUH BARIS (bukan cuma payload), pola persis `screening_run`:
--    tidak ada konsep "edit satu scan" di alat aslinya — input berubah
--    berarti scan BARU, bukan baris lama yang dimutasi. Trigger
--    `forbid_mutation` pada UPDATE dan DELETE adalah dinding kedua; bentuk
--    modul domain yang INSERT-only adalah dinding pertama (aturan rumah #3).
--
--    `konfigurasi` jsonb, BUKAN 11 kolom: `AdsScannerConfig` punya 11 field
--    ambang yang boleh disetel AM per klien (gateScale/gateConsider/
--    gateYellow/testBudgetDaily/scaleStepPct/minAov/blacklist/category/
--    usdRate/winnerPctl/mode) dan `blacklist` sendiri adalah ARRAY id produk.
--    Yang dinaikkan jadi kolom nyata hanyalah tiga yang di-query atau
--    di-CHECK: `kategori` (memilih baris benchmark — wajib ada supaya bisa
--    di-JOIN/di-agregat per kategori), `mode` (weekly vs newclient — beda
--    keluaran, di-CHECK), dan `minggu_mulai` (kunci portofolio "scan minggu
--    ini", di-index). Sisanya tetap di `konfigurasi` — sama seperti
--    `screening_run` menaikkan `target_roas`/`faktor_cr_iklan` tapi tidak
--    setiap ambang R04.
--
--    `minggu_mulai` = tanggal yang DIISI AM ("export ini minggu yang mana"),
--    sudah di-Monday-align oleh engine (`weekStartMonday`) sebelum ditulis —
--    data entry, BUKAN bacaan jam. `generated_at` di dalam payload berasal
--    dari jam SERVER (modul tz WIB), bukan `new Date()` browser (fix wajib
--    §4 plan §7).
--
--    `sumber_berkas` mengikuti pola RAB-04 yang dipakai baseline/report/
--    screening_run: parse terjadi di browser, server TIDAK pernah melihat
--    atau menyimpan binernya — hanya provenance
--    `{nama_berkas, sha256, ukuran_bytes, peran}` per berkas. `peran` di sini
--    adalah salah satu dari 4 slot yang dikenali engine
--    (analitik/ads/video/adslive) plus `video_kind` untuk slot video (kreator
--    vs toko — `classifyVideoKind` bisa ambigu dan AM boleh menukarnya, jadi
--    pilihan finalnya ikut tercatat sebagai provenance). Supabase Storage
--    tetap belum dipasang (plan §9) — ini provenance, bukan file store.
-- ---------------------------------------------------------------------------
CREATE TABLE adsscanner_run (
    id              varchar(32)   NOT NULL PRIMARY KEY,   -- ASR-YYYYMM-NNNN
    client_id       varchar(32)   NOT NULL,
    kategori        varchar(120)  NOT NULL,                -- kategori Level-3 TikTok Shop; memilih baris benchmark
    mode            varchar(16)   NOT NULL,                -- 'weekly' | 'newclient' (cfg.mode)
    minggu_mulai    date          NULL,                    -- Senin minggu data (diisi AM, sudah di-align engine)
    konfigurasi     jsonb         NOT NULL,                -- AdsScannerConfig lengkap (11 field, termasuk blacklist)
    benchmark_versi integer       NOT NULL,
    payload_schema  varchar(48)   NOT NULL DEFAULT 'cdps.adsscanner.tiktok.v1',
    payload         jsonb         NOT NULL,                -- hasil hitung: ringkasan/sku/orphan/realokasi/angles/winners
    sumber_berkas   jsonb         NOT NULL,                -- [{nama_berkas, sha256, ukuran_bytes, peran, video_kind?}]
    created_at      timestamptz   NOT NULL DEFAULT now(),
    created_by      varchar(64)   NOT NULL,
    CONSTRAINT fk_asr_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT fk_asr_benchmark FOREIGN KEY (benchmark_versi) REFERENCES adsscanner_benchmark (versi),
    CONSTRAINT ck_asr_mode CHECK (mode IN ('weekly', 'newclient')),
    CONSTRAINT ck_asr_payload_schema CHECK (payload_schema = 'cdps.adsscanner.tiktok.v1'),
    CONSTRAINT ck_asr_payload_shape CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT ck_asr_konfigurasi_shape CHECK (jsonb_typeof(konfigurasi) = 'object'),
    CONSTRAINT ck_asr_sumber_shape CHECK (jsonb_typeof(sumber_berkas) = 'array')
);

-- Dua index, dua read pattern yang benar-benar ada:
--  - per klien, terbaru dulu (halaman satu klien);
--  - portofolio lintas klien per minggu (read pattern yang JADI alasan O69
--    memilih tabel sendiri — `state.clients` alat asli).
CREATE INDEX idx_asr_client ON adsscanner_run (client_id, created_at DESC);
CREATE INDEX idx_asr_minggu ON adsscanner_run (minggu_mulai DESC, client_id);

CREATE TRIGGER trg_adsscanner_run_frozen BEFORE UPDATE ON adsscanner_run
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_adsscanner_run_no_delete BEFORE DELETE ON adsscanner_run
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE adsscanner_run IS
  'Gelombang 4 — satu baris per SCAN TikTok Ads Scanner (per klien, per minggu). '
  'Baris beku (trigger UPDATE+DELETE): angka dihitung packages/core/src/adsscanner/tiktok/, '
  'tidak pernah diedit — input berubah = scan baru. Alat kerja INTERNAL divisi Ads, '
  'sengaja BUKAN client_reports (tidak punya permukaan Client Portal).';

-- ---------------------------------------------------------------------------
-- 4. RLS — predikat IDENTIK `screening_run` (pola ad_campaigns/
--    ads_weekly_reports): read-all (Director/OD), pemilik baris
--    (`created_by`), pemilik klien (`jwt_owns_client`), atau lead divisi Ads
--    (division-wide read, CLAUDE.md rule #6). `canReadAdsScan` di
--    `packages/domain/src/adsscanner.ts` mencerminkan predikat ini PERSIS —
--    dibaca dari sini, bukan ditebak ulang.
--
--    Nol policy INSERT/UPDATE/DELETE dengan sengaja: tulisan lewat
--    service-role dari modul domain, yang menggerbangi lewat
--    `ads.canManageCampaign` (Ads staff/lead atau Director).
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.adsscanner_run FROM anon;
REVOKE ALL ON public.adsscanner_run FROM authenticated;
GRANT SELECT ON public.adsscanner_run TO authenticated;
ALTER TABLE public.adsscanner_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY adsscanner_run_select ON public.adsscanner_run FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR created_by = public.jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Ads'));
