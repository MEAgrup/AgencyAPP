-- ============================================================================
-- PX-M3-02 DIJAWAB — px_eligibility_policy versi 3: price_segment_bands
-- SUNGGUHAN (bukan placeholder), diberikan langsung oleh pemilik 2026-09-16
-- (docs/DECISIONS.md, entri hari yang sama).
--
-- Band (batas atas INKLUSIF, hitungPriceSegment @cdps/core):
--   < Rp 180.000        -> 'low'      ("Murah")
--   Rp 180.001-800.000   -> 'entry'    ("Entry/mid-low")
--   Rp 800.001-3.600.000 -> 'sweet'    ("Sweet spot")
--   Rp 3.600.001-8.000.000 -> 'high'   ("High-ticket")
--   > Rp 8.000.000       -> 'premium' ("Premium")
--
-- Kode segmen ('low'/'entry'/'sweet'/'high'/'premium') BUKAN dipilih bebas —
-- itu PERSIS lima nilai `price_segment_t` yang sudah live di sisi MCN sejak
-- awal (`mcnapp` migrasi 0001_init_schema.sql: `create type price_segment_t
-- as enum ('low','entry','sweet','high','premium')`), dan ambang Rp-nya
-- PERSIS `app_config.segments.price_bounds` yang sudah live di sana sejak
-- 0005_phase2_tools.sql (`{"low":180000,"entry":800000,"sweet":3600000,
-- "high":8000000}`, PRD M5 §2.1.1). Bukan kebetulan — pemilik mengonfirmasi
-- taksonomi yang MEMANG sudah dipakai MCN, bukan angka baru. Memakai kode
-- lain (mis. label BI "Murah"/"Sweet spot" apa adanya) akan membuat
-- price_segment CDPS TIDAK PERNAH cocok dengan price_segment yang dikirim
-- MCN lewat px_coverage_snapshot — persis risiko silent-fail yang dicatat
-- M3-02 (docs/DECISIONS.md §Open). price_segment tetap TEXT di sisi CDPS
-- (bukan enum Postgres, PX-M3-02 interim decision 2026-09-16) — hanya
-- ISINYA yang sekarang nilai final, bukan tipenya.
--
-- Append-only (aturan rumah #4/CLAUDE.md): versi 1/2 tetap riwayat tak
-- tersentuh. Field lain (sales_threshold_idr/threshold_basis/
-- threshold_window_days/commission_floor_pct/require_stock_in/platforms)
-- disalin PERSIS dari versi 2 (20261101010000) — SATU-SATUNYA yang berubah
-- adalah price_segment_bands. Lahir aktif=true (default createEligibilityPolicy,
-- dicerminkan di sini): activeEligibilityPolicy selalu resolve ke versi
-- tertinggi ber-aktif=true, jadi versi 2 otomatis berhenti dipakai tanpa
-- baris itu sendiri disentuh.
--
-- Nol migrasi skema — px_eligibility_policy/px_sku_eligibility/
-- px_coverage_snapshot semua sudah ada (20261101010000). Nol pemanggil aktif
-- hari ini (PX-M3-AKTIVASI-1/2 masih ditunda menunggu PDT G1 verified >=10
-- klien, docs/backlog/PX_M3_BACKLOG.md) — versi baru ini hanya memastikan
-- KETIKA aktivasi terjadi nanti, band yang dipakai sudah benar sejak hari
-- pertama, bukan placeholder low<=100rb/mid<=500rb/high yang lahir M3-B.
-- ============================================================================

INSERT INTO px_eligibility_policy (versi, nilai, catatan, dibuat_oleh) VALUES
    (3, '{
      "sales_threshold_idr": 200000000,
      "threshold_basis": "per_sku",
      "threshold_window_days": 30,
      "commission_floor_pct": null,
      "require_stock_in": true,
      "platforms": ["tiktok", "shopee"],
      "price_segment_bands": [
        {"segment": "low", "max_idr": 180000},
        {"segment": "entry", "max_idr": 800000},
        {"segment": "sweet", "max_idr": 3600000},
        {"segment": "high", "max_idr": 8000000},
        {"segment": "premium", "max_idr": null}
      ]
     }'::jsonb,
     'PX-M3-02 DIJAWAB (2026-09-16): price_segment_bands sungguhan dari pemilik, '
     'PERSIS app_config.segments.price_bounds yang sudah live sisi MCN (mcnapp '
     '0005_phase2_tools.sql) dan lima kode price_segment_t (mcnapp 0001_init_schema.sql). '
     'Menggantikan placeholder low<=100rb/mid<=500rb/high versi 2 (20261101010000, PX-M3-06). '
     'Field lain tak berubah dari versi 2.',
     'SYSTEM');
