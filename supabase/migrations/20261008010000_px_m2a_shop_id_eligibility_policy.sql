-- ============================================================================
-- PX-M2a — Shop ID Gate & Eligibility Policy (Product Exchange, sisi MEA
-- Agency/CDPS). Sumber: docs/prd/CDPS_ProductExchange_M1_M2.md v1.0 §4,
-- Surat Tugas PX-M2a §2–§5.
--
-- KONTEKS. Product Exchange mempertemukan klien seller MEA Agency dengan
-- kreator MCN MEA. PRD §4 aslinya menyandarkan gerbang "SKU boleh diproses"
-- pada modul consent (`px_consents`, ledger izin klien). Modul itu DIHAPUS
-- oleh ketokan pemilik 2026-09-12 (lihat docs/DECISIONS.md tanggal yang sama)
-- — consent klien untuk TAP/SAP sudah otomatis tercatat di platform TikTok/
-- Shopee saat campaign dibuat di sana, dan CDPS tidak punya jalur untuk
-- melihat rekaman itu (bukan di `campaigns`, bukan di `ad_campaigns`, nol
-- layanan TAP/SAP di Master Service List — diverifikasi langsung ke live
-- sebelum modul dihapus, bukan diasumsikan).
--
-- GERBANGNYA PINDAH KE `client_platforms.shop_id`: shop_id terisi = toko itu
-- punya agency plan TAP/SAP = SKU-nya boleh diproses Product Exchange M3.
-- Itu membuat kolom data memikul arti kebijakan — makanya komentar kolom di
-- bawah menyatakan ARTINYA, bukan cuma tipenya, dan makanya "nol riwayat"
-- (client_platforms bukan append-only) dicatat sadar sebagai konsekuensi di
-- DECISIONS.md, bukan didiamkan.
--
-- SCOPE MIGRASI INI (PX-M2a — lihat Surat Tugas §2 untuk pembagian lengkap):
--   1. `client_platforms.shop_id` + index.
--   2. `px_eligibility_policy` — tabel kalibrasi berversi (ambang penjualan,
--      basis pengukuran, window, commission floor, syarat stok, platform
--      cakupan). Pembacanya (evaluasi kelayakan SKU, Flow D PRD) BELUM ada —
--      itu PX-M2b bersama M3 (`px_sku`), yang PRD-nya sendiri melarang versi
--      sementara. Bentuknya sudah dikunci ketokan CEO (D-01 ambang
--      Rp 200 juta per SKU, D-02 tanpa commission floor di Phase 1) sehingga
--      mencatatnya sekarang lebih murah daripada merekonstruksinya nanti.
--
-- TIDAK dikerjakan di sini: `px_consents` (dihapus), `px_sku`/`px_sku_volume`/
-- `px_sku_eligibility` (milik M3/PX-M2b), fungsi evaluasi kelayakan (Flow D).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. client_platforms.shop_id — gerbang kelayakan Product Exchange.
--
--    Nullable: toko lama belum punya shop_id dan itu TIDAK BOLEH memblokir
--    operasi berjalan (klien tetap bisa dilayani MEA Agency tanpa pernah
--    ikut Product Exchange). Preseden ALTER di tabel ini:
--    `20260912010000_r3_tahap_funnel.sql` (`tahap_fokus`).
--
--    Konteks operasional (Anty, Head of Account, 2026-09-12): AM sudah
--    punya akses ke semua klien MEA, jadi mengisi Shop ID bukan hambatan
--    teknis — hambatannya SOP (apakah AM tahu mengisinya adalah pernyataan).
-- ---------------------------------------------------------------------------
ALTER TABLE client_platforms ADD COLUMN shop_id text NULL;

CREATE INDEX idx_client_platforms_shop_id ON client_platforms (shop_id);

COMMENT ON COLUMN client_platforms.shop_id IS
  'Shop ID platform. TERISI = toko ini punya agency plan TAP/SAP ⇒ SKU-nya boleh diproses '
  'Product Exchange M3 (ketokan pemilik 2026-09-12, menggantikan modul consent px_consents). '
  'Bukan sekadar kelengkapan data toko — mengisinya adalah pernyataan. NULL = belum ikut '
  'Product Exchange (bukan kegagalan — mayoritas toko tidak wajib ikut). Nol riwayat: '
  'client_platforms bukan tabel append-only, jadi kalau Shop ID dihapus tidak ada jejak '
  'kapan/atas dasar apa toko itu pernah boleh diproses — buktinya ditarik dari platform '
  'TikTok/Shopee, bukan dari CDPS (docs/DECISIONS.md 2026-09-12).';

-- Aturan "1 klien = 1 toko aktif per platform" DITEGAKKAN DI DOMAIN
-- (packages/domain/src/client.ts addPlatform), BUKAN di sini: live punya 2
-- pasang baris kembar hari ini (CLI-202608-0010/TikTok Shop id 13+14,
-- CLI-202609-0002/Shopee id 16+17) dan Postgres tidak punya UNIQUE
-- "NOT VALID" (itu hanya berlaku untuk CHECK/FK). Ketokan pemilik: "kunci
-- sekarang, bersihkan kemudian" — lihat docs/DECISIONS.md 2026-09-12 untuk
-- tiket pemasangan `CREATE UNIQUE INDEX ... WHERE active` setelah baris
-- kembar itu dibersihkan (butuh konfirmasi manusia dulu, bukan dihapus di
-- sini).

-- ---------------------------------------------------------------------------
-- 2. px_eligibility_policy — kalibrasi kelayakan SKU Product Exchange,
--    BERVERSI. Cermin HURUF PER HURUF `adsscanner_benchmark`
--    (`20260910010000_gelombang4_adsscanner.sql`): `versi integer PK` ·
--    `nilai jsonb` · `aktif boolean default true` · `catatan text` ·
--    `dibuat_pada timestamptz` · `dibuat_oleh varchar(64)` · CHECK
--    `versi >= 1` · trigger `_frozen()` per-tabel · REVOKE + RLS nol policy
--    (default-deny) · seed versi 1 di migrasi yang sama.
--
--    `nilai` = {sales_threshold_idr, threshold_basis, threshold_window_days,
--    commission_floor_pct, require_stock_in, platforms} — ambang penjualan,
--    basis pengukuran (per_sku), window hari, commission floor (NULL =
--    tanpa floor, ketokan CEO D-02 Phase 1), syarat stok masuk, dan daftar
--    platform yang tercakup.
--
--    KONTRADIKSI PRD SUDAH DIPUTUS (Rule 9 melarang UPDATE via trigger beku,
--    tapi Flow C langkah 3 minta membalik `aktif` versi lama — UPDATE yang
--    trigernya sendiri tolak; Rule 10 UNIQUE (aktif) WHERE aktif=true ikut
--    mustahil). Yang diambil, mengikuti preseden `adsscanner_benchmark`
--    (`packages/domain/src/adsscanner.ts:356,541`): `aktif` TIDAK PERNAH
--    dibalik. Versi aktif = `versi` TERTINGGI yang `aktif = true`
--    (`where aktif = true order by versi desc limit 1`). Nol partial unique
--    index. Kolom `aktif` tetap ada supaya sebuah versi bisa LAHIR non-aktif
--    (draft/rollback) — itu sendiri menjawab Flow C tanpa UPDATE sama
--    sekali. Lihat docs/DECISIONS.md 2026-09-12 untuk entri deviasi lengkap.
--
--    Nol prefix, nol mesin, nol event katalog — lihat komentar gerbang CI di
--    scripts/db-rebuild.sh dan .github/workflows/ci.yml untuk alasannya.
-- ---------------------------------------------------------------------------
CREATE TABLE px_eligibility_policy (
    versi        integer      NOT NULL PRIMARY KEY,
    -- {sales_threshold_idr, threshold_basis, threshold_window_days,
    --  commission_floor_pct, require_stock_in, platforms}
    nilai        jsonb        NOT NULL,
    aktif        boolean      NOT NULL DEFAULT true,
    catatan      text         NULL,
    dibuat_pada  timestamptz  NOT NULL DEFAULT now(),
    dibuat_oleh  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_px_eligibility_policy_versi CHECK (versi >= 1),
    CONSTRAINT ck_px_eligibility_policy_nilai_shape CHECK (jsonb_typeof(nilai) = 'object')
);

COMMENT ON TABLE px_eligibility_policy IS
  'Kalibrasi kelayakan SKU Product Exchange (PX-M2a), berversi, Director-only. '
  'Append-only: kalibrasi baru = versi baru, aktif TIDAK PERNAH dibalik (lihat komentar '
  'di atas) — versi aktif = versi tertinggi yang aktif=true. Pembaca (evaluasi kelayakan '
  'SKU, Flow D PRD) belum ada — lahir di PX-M2b bersama M3 (px_sku).';

INSERT INTO px_eligibility_policy (versi, nilai, catatan, dibuat_oleh) VALUES
    (1, '{
      "sales_threshold_idr": 200000000,
      "threshold_basis": "per_sku",
      "threshold_window_days": 30,
      "commission_floor_pct": null,
      "require_stock_in": true,
      "platforms": ["tiktok"]
     }'::jsonb,
     'Seed versi 1 — persis PRD-product-exchange-M1-M2.md v1.0 §4.5. Ambang Rp 200 juta per '
     'SKU (D-01) dan tanpa commission floor di Phase 1 (D-02), keduanya ketokan CEO.',
     'SYSTEM');

CREATE OR REPLACE FUNCTION px_eligibility_policy_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'px_eligibility_policy: append-only — kalibrasi baru = versi baru, versi lama immutable dan aktif tidak pernah dibalik (aturan rumah #4, docs/DECISIONS.md 2026-09-12)';
END;
$$;
CREATE TRIGGER trg_px_eligibility_policy_frozen BEFORE UPDATE OR DELETE ON px_eligibility_policy
    FOR EACH ROW EXECUTE FUNCTION px_eligibility_policy_frozen();

REVOKE ALL ON public.px_eligibility_policy FROM anon;
REVOKE ALL ON public.px_eligibility_policy FROM authenticated;
ALTER TABLE public.px_eligibility_policy ENABLE ROW LEVEL SECURITY;
-- NOL policy (default-deny) — sama seperti adsscanner_benchmark/report_benchmark:
-- kalibrasi dibaca/ditulis HANYA lewat service-role, gerbang Director-nya di domain
-- (packages/domain/src/productexchange.ts canKelolaPolicy).
