-- G4-03 lanjutan · aksi 6 khusus Shopee: afiliasi/KOL Shopee aktif
-- (`docs/backlog/PDT_BACKLOG.md` G4-03, `docs/DECISIONS.md`
-- G4-03-KATALOG-KESIAPAN). Nol tabel/kolom baru — `pdt_usulan_katalog`
-- (G1-01) sudah punya seluruh kolom yang dibutuhkan.
--
-- Kenapa aksi ini (dan bukan aksi 1/7/2 yang juga "SIAP" datanya): divisi
-- Brief-nya bersih. `pdt_usulan_katalog.divisi_tujuan` dibaca Flow C langkah 3
-- ("usulan diteruskan ke Plan → Brief divisi") dan `briefs.assigned_division`
-- (migrasi `20260722055450`) hanya menerima 'Creative'/'Ads'/'KOL'/'Live
-- Stream'. Afiliasi/KOL Shopee memetakan bersih ke 'KOL' (beda dari cancel
-- rate/GMV toko/chat response — ketiganya metrik kesehatan/layanan toko tanpa
-- divisi Brief yang jujur, pemilik memilih opsi (c) "read-only dulu, TIDAK
-- menulis pdt_usulan" untuk ketiganya — dicatat `docs/DECISIONS.md`
-- G4-03-DIVISI-STORE-OPS RESOLVED, nol perubahan skema untuk keputusan itu).
--
-- Ambang: "aktif" = `gmv > 0` (definisi DIKETOK sesi 40, Q3). Target/ambang
-- COUNT tidak pernah punya sumber terverifikasi (`report/shopee/bench.ts` nol
-- kunci kreator) — pemilik memilih pemicu paling konservatif: HANYA nol
-- kreator aktif (floor alami, bukan angka dikarang), `target_nilai` = 1
-- (keluar dari nol, bukan ambisi jumlah buatan). Mesin baca
-- `pdt_fact_creator_period` langsung (COUNT baris `gmv > 0` per
-- client_platform_id+periode, lihat `packages/domain/src/pdt-verdict.ts`) —
-- nol benchmark dikonsumsi, beda dari SHP-ROAS/SHP-ACOS.
INSERT INTO pdt_usulan_katalog (kode, platform_berlaku, kondisi, metrik_kunci, satuan, target_formula, divisi_tujuan) VALUES
  ('SHP-KREATOR-AKTIF', ARRAY['shopee'],
   '{"tipe":"ambang_fakta","pemicu":[{"metrik":"kreatorAktifShopee","ambang":{"nilai":0},"banding":"sama_dengan"}]}'::jsonb,
   'kreatorAktifShopee', 'hitungan', '{"tipe":"tetap","nilai":1}'::jsonb, 'KOL');

-- Gerbang CI — nol perubahan struktural (satu baris seed ke tabel yang sudah ada):
--   public base tables : 183 → 183 (nol tabel baru)
--   entity_prefix      : 45 → 45  (nol prefix baru)
--   sm_machines        : 35 → 35  (nol lifecycle baru)
--   notif_events       : 76 → 76  (nol event notifikasi baru)
