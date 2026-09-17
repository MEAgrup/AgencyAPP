-- G4-03 Tahap 1 · mesin verdict PDT + DUA aksi khusus Shopee (ROAS, ACoS) —
-- docs/backlog/PDT_BACKLOG.md G4-03, docs/prd/CDPS_PDT_Pusat_Data_Toko.md
-- §3.6 Rule 26-32 (Flow C). Nol tabel/kolom baru — `pdt_benchmark`
-- (platform='shopee' sudah didukung CHECK sejak G2-02, migrasi
-- `20261030010000`) dan `pdt_usulan_katalog` (G1-01) sudah punya seluruh
-- kolom yang dibutuhkan.
--
-- Kenapa HANYA dua dari delapan aksi yang diketok sesi 39 (bukan 1,3,7,8
-- seperti "SIAP" di `docs/DECISIONS.md` G4-03-KATALOG-KESIAPAN): riset
-- implementasi (sebelum satu baris kode ditulis) menemukan bahwa
-- `pdt_usulan_katalog.divisi_tujuan` — dibaca Flow C langkah 3 ("usulan
-- diteruskan ke Plan → Brief divisi") — HANYA punya EMPAT nilai yang
-- benar-benar bisa menerima Brief: `briefs.assigned_division`
-- (migrasi `20260722055450`) membatasi 'Creative'/'Ads'/'KOL'/'Live Stream'.
-- ROAS dan ACoS (aksi 8 dan 3) memetakan bersih ke 'Ads' — preseden identik
-- katalog G4-01 (D1-D5, aksi ROAS lama, semuanya 'Ads'). Cancel rate (aksi 1)
-- dan GMV pesanan selesai (aksi 7) TIDAK punya divisi Brief yang jujur:
-- keduanya metrik operasional toko, bukan deliverable Creative/Ads/KOL/Live
-- Stream — mengarang salah satu dari empat akan salah kaprah routing brief.
-- Dicatat sebagai `docs/DECISIONS.md` §Open baris G4-03-DIVISI-STORE-OPS,
-- TIDAK ditebak di sini. Afiliasi aktif (aksi 6) baru dijawab DEFINISI-nya
-- (Q3 sesi ini, "aktif = gmv > 0") tapi belum TARGET/ambang count-nya — juga
-- ditunda. GMV/jam live (aksi 5) menunggu parser durasi (Q2: "bangun parser
-- dulu"). Chat (2) dan diskon/flash sale (4) tetap butuh writer fakta baru.
--
-- Ambang: PORT apa adanya dari `report_benchmark_shopee` versi 1
-- (`packages/core/src/report/shopee/bench.ts` `REPORT_BENCH_SHOPEE_V1`,
-- terverifikasi identik tabel live oleh audit G4-03-KATALOG-KESIAPAN) — HANYA
-- dua kunci yang benar-benar dikonsumsi mesin verdict baru
-- (`packages/core/src/pdt/verdict.ts`): `roas_good`/`acos_good`. `roas_warn`/
-- `acos_warn`/kunci lain TIDAK diport — nol konsumen hari ini (preseden
-- `20261030010000` yang juga hanya memport delapan dari sebelas kunci TikTok
-- yang punya konsumen).
-- `versi` UNIQUE lintas platform (`uq_pdt_benchmark_versi`, G2-02) — TikTok sudah
-- memakai 1 dan 2 (`20261030010000`/`20261104010000`), jadi baris Shopee PERTAMA
-- ini otomatis versi 3, BUKAN 1 (nomor versi bukan penanda "versi pertama platform
-- ini" — pembacanya selalu `where platform=X and aktif=true order by versi desc
-- limit 1`, jadi nomor absolutnya tidak pernah dibaca sebagai urutan per platform).
INSERT INTO pdt_benchmark (platform, versi, nilai, catatan, dibuat_oleh) VALUES
  ('shopee', 3, jsonb_build_object(
      'roas_good', 4,
      'acos_good', 0.25
   ),
   'Port REPORT_BENCH_SHOPEE_V1.health (report/shopee/bench.ts) — dua kunci yang dipakai mesin verdict G4-03 Tahap 1 (roas_good, acos_good). Baris pertama Shopee di pdt_benchmark; versi 3 karena uq_pdt_benchmark_versi lintas platform (TikTok sudah pakai 1-2).',
   'SYSTEM');

-- Katalog dua aksi baru. `kondisi` di sini kosakata BARU (metrik pdt_fact_*
-- langsung — `roasShopee`/`acosShopee`, Σgmv/Σbiaya `pdt_fact_ads` seluruh
-- sumber Shopee untuk client_platform_id + periode), BUKAN `MetrikKunci`
-- payload lama (`copilot.ts`) — mesin baru (`pdt-verdict.ts`) tidak memanggil
-- `gabungKatalogDb`/`evaluasiPemicu` lama sama sekali, jadi bentrok kosakata
-- tidak masalah (kolom `kondisi` sekadar jsonb, CHECK hanya menuntut objek).
-- `target_formula` di sini `{"tipe":"benchmark_good"}` — arti: target_nilai =
-- ambang `_good` yang sama dipakai sebagai pemicu (bukan `pct_dari_sekarang`
-- ambisi buatan) — SATU-SATUNYA kunci yang mesin verdict baca, TIDAK dipakai
-- katalog lama.
INSERT INTO pdt_usulan_katalog (kode, platform_berlaku, kondisi, metrik_kunci, satuan, target_formula, divisi_tujuan) VALUES
  ('SHP-ROAS', ARRAY['shopee'],
   '{"tipe":"ambang_fakta","pemicu":[{"metrik":"roasShopee","ambang":{"benchmark":"roas_good"},"banding":"kurang"}]}'::jsonb,
   'roasShopee', 'rasio', '{"tipe":"benchmark_good","kunci":"roas_good"}'::jsonb, 'Ads'),
  ('SHP-ACOS', ARRAY['shopee'],
   '{"tipe":"ambang_fakta","pemicu":[{"metrik":"acosShopee","ambang":{"benchmark":"acos_good"},"banding":"lebih"}]}'::jsonb,
   'acosShopee', 'persen', '{"tipe":"benchmark_good","kunci":"acos_good"}'::jsonb, 'Ads');

COMMENT ON TABLE pdt_usulan_katalog IS
  'Katalog aksi usulan (pengganti AM Co-Pilot HTML). 20 aksi asli (G4-01) dari packages/core/src/copilot.ts '
  'KATALOG (kondisi berkosakata MetrikKunci/payload baseline). Dua aksi Shopee baru (G4-03 Tahap 1, migrasi ini) '
  'berkosakata BEDA — kondisi.tipe=''ambang_fakta'' dibaca packages/core/src/pdt/verdict.ts langsung dari '
  'pdt_fact_ads, bukan payload riset_awal_analisa. Sisa ≥4 aksi khusus Shopee (Rule 30) menyusul G4-03 lanjutan.';

-- Gerbang CI — nol perubahan struktural (dua baris seed ke tabel yang sudah ada):
--   public base tables : 182 → 182 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
