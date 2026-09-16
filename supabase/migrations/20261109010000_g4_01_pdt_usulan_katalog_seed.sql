-- G4-01 · Katalog usulan pindah kode → DB (docs/backlog/PDT_BACKLOG.md G4-01,
-- docs/prd/CDPS_PDT_Pusat_Data_Toko.md §3.6 Rule 26-32).
--
-- `pdt_usulan_katalog` (struktur lahir G1-01, migrasi 20261011010000, NOL seed
-- "supaya G1 tidak mendahului G4") diisi di sini dengan 20 aksi yang HARI INI
-- hidup sebagai array TypeScript hardcoded `packages/core/src/copilot.ts`
-- `KATALOG` (dipindah dari tool HTML lama `am-copilot.html` — lihat docblock
-- kepala `copilot.ts`). Terjemahan HURUF PER HURUF dari `KATALOG`, bukan
-- ditebak — setiap baris di bawah dicocokkan manual ke entri `KATALOG` yang
-- sepadan (lihat `docs/DECISIONS.md` G4-01 untuk tabel terjemahan lengkap).
--
-- Batas SENGAJA: HANYA kolom yang mewakili LOGIKA KEPUTUSAN (platform_berlaku,
-- kondisi = syarat pemicu, aktif) yang benar-benar dikonsumsi engine
-- (`copilot.gabungKatalogDb`) di sesi ini. `metrik_kunci`/`satuan`/
-- `target_formula`/`divisi_tujuan` diisi BENAR (memenuhi kolom NOT NULL sesuai
-- makna aslinya, bukan nilai isian) tapi BELUM dikonsumsi — target hitung
-- (±% skala ambisi per minggu) tetap dihitung `copilot.skalaAmbisi(kat.minggu)`
-- dari metadata kode (TIDAK berubah sesi ini); `target_formula.ambisi_persen`
-- di sini murni MENCATAT nilai `skalaAmbisi` saat ini sebagai dokumentasi/
-- kesiapan untuk G4-02/G4-03 menjadikannya admin-tunable, bukan sumber
-- kebenaran yang sudah dibaca. Nama/deskripsi/jembatan/arah/minggu/
-- fieldIdBukti/quickWin/pilar TETAP di kode (`copilot.ts` `AKSI_BY_KODE`) —
-- Rule 5 aturan rumah ("jangan mengarang atau mengubah label BI") lebih
-- selaras dengan label yang di-review lewat PR, bukan diketik bebas admin UI;
-- skema `pdt_usulan_katalog` sendiri (kolom tetap `kode/platform_berlaku/
-- kondisi/metrik_kunci/satuan/target_formula/divisi_tujuan/aktif`, PRD §6.3)
-- TIDAK punya kolom nama/deskripsi — sinyal desain yang sama, bukan kelalaian.
--
-- `platform_berlaku` SELURUHNYA `{tiktok,shopee,meta}` untuk 20 baris ini —
-- `copilot.bacaMetrik` (kode SAAT INI) membaca jalur kunci BERSAMA lintas
-- platform, NOL cabang per platform (dokblock fungsi itu sendiri: "aturan B2
-- §6.5 #1 ... tidak ada cabang per platform"); metrik yang sebuah platform tak
-- punya jadi `null` dan pemicunya tidak menyala — SUDAH gerbang yang cukup.
-- Mempersempit `platform_berlaku` sekarang berarti MENGARANG pembatasan yang
-- tidak ada di perilaku produksi hari ini. ≥6 aksi KHUSUS Shopee (Rule 30,
-- baris BARU dengan `kondisi` yang membaca sumber Shopee-spesifik seperti
-- `pdt_fact_shop_daily` basis `dibuat`) menyusul G4-03 — di luar cakupan
-- migrasi ini.
--
-- `kondisi` — dua bentuk (CHECK mewajibkan objek, bukan array telanjang):
--   {"tipe":"ambang","pemicu":[{metrik,ambang:{benchmark}|{nilai,nama},banding}]}
--     — AND seluruh pemicu, cermin PERSIS `Pemicu[]`/`evaluasiPemicu` kode.
--   {"tipe":"kehadiran_bukti","sumber":"..."} — HANYA V3, dipicu ADANYA bukti
--     (video top_video), bukan ambang; `evaluasiPemicu` kode menge-hardcode
--     `kode==='V3'` jadi isi `kondisi` V3 di sini murni dokumentasi niat.
INSERT INTO pdt_usulan_katalog (kode, platform_berlaku, kondisi, metrik_kunci, satuan, target_formula, divisi_tujuan) VALUES
  ('V1', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"videoSalesToko","ambang":{"benchmark":"vidSalesToko"},"banding":"kurang"}]}'::jsonb,
   'videoSalesToko', 'views', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'Creative'),
  ('V2', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"videoPostToko","ambang":{"benchmark":"vidPostToko"},"banding":"kurang"}]}'::jsonb,
   'videoPostToko', 'hitungan', '{"tipe":"pct_dari_sekarang","ambisi_persen":30}'::jsonb, 'Creative'),
  ('V3', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"kehadiran_bukti","sumber":"video.top_video"}'::jsonb,
   'videoSalesToko', 'persen', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'Creative'),
  ('V4', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"gpmToko","ambang":{"benchmark":"gpmToko"},"banding":"kurang"}]}'::jsonb,
   'gpmToko', 'views', '{"tipe":"pct_dari_sekarang","ambisi_persen":30}'::jsonb, 'Creative'),
  ('V5', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"crToko","ambang":{"benchmark":"cr"},"banding":"kurang"}]}'::jsonb,
   'crToko', 'persen', '{"tipe":"pct_dari_sekarang","ambisi_persen":15}'::jsonb, 'Creative'),
  ('V6', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"skuSales","ambang":{"benchmark":"skuSales"},"banding":"kurang"}]}'::jsonb,
   'skuSales', 'persen', '{"tipe":"pct_dari_sekarang","ambisi_persen":30}'::jsonb, 'Creative'),
  ('L1', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"liveJam","ambang":{"benchmark":"liveJam"},"banding":"kurang"}]}'::jsonb,
   'liveJam', 'jam', '{"tipe":"pct_dari_sekarang","ambisi_persen":30}'::jsonb, 'Live Stream'),
  ('L2', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"liveGmvJam","ambang":{"benchmark":"liveGmvJam"},"banding":"kurang"}]}'::jsonb,
   'liveGmvJam', 'rupiah', '{"tipe":"pct_dari_sekarang","ambisi_persen":30}'::jsonb, 'Live Stream'),
  ('L3', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"liveCtor","ambang":{"benchmark":"liveCtor"},"banding":"kurang"}]}'::jsonb,
   'liveCtor', 'rupiah', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'Live Stream'),
  ('L4', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"liveSesi","ambang":{"benchmark":"liveSesi"},"banding":"kurang"}]}'::jsonb,
   'liveSesi', 'rupiah', '{"tipe":"pct_dari_sekarang","ambisi_persen":15}'::jsonb, 'Live Stream'),
  ('A1', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"krSales","ambang":{"benchmark":"krSales"},"banding":"kurang"}]}'::jsonb,
   'krSales', 'hitungan', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'KOL'),
  ('A2', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"kreatorBelumPosting","ambang":{"nilai":0,"nama":"ada kreator terdaftar yang belum posting"},"banding":"lebih"}]}'::jsonb,
   'kreatorBelumPosting', 'hitungan', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'KOL'),
  ('A3', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"krKonsen","ambang":{"benchmark":"krKonsen"},"banding":"lebih"}]}'::jsonb,
   'krKonsen', 'persen', '{"tipe":"pct_dari_sekarang","ambisi_persen":40}'::jsonb, 'KOL'),
  ('A4', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"sampelTerkirim","ambang":{"nilai":0,"nama":"belum ada sampel terkirim"},"banding":"samaDengan"}]}'::jsonb,
   'krSales', 'hitungan', '{"tipe":"pct_dari_sekarang","ambisi_persen":30}'::jsonb, 'KOL'),
  ('A5', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"videoSalesAff","ambang":{"benchmark":"vidSalesAff"},"banding":"kurang"}]}'::jsonb,
   'videoSalesAff', 'rupiah', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'KOL'),
  ('D1', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"roas","ambang":{"benchmark":"roas"},"banding":"kurang"}]}'::jsonb,
   'roas', 'persen', '{"tipe":"pct_dari_sekarang","ambisi_persen":15}'::jsonb, 'Ads'),
  ('D2', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"roas","ambang":{"benchmark":"roas"},"banding":"kurang"}]}'::jsonb,
   'roas', 'rupiah', '{"tipe":"pct_dari_sekarang","ambisi_persen":15}'::jsonb, 'Ads'),
  ('D3', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"roas","ambang":{"benchmark":"roas"},"banding":"kurang"}]}'::jsonb,
   'roas', 'rasio', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'Ads'),
  ('D4', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"adsDep","ambang":{"benchmark":"adsDep"},"banding":"lebih"}]}'::jsonb,
   'roas', 'rasio', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'Ads'),
  ('D5', ARRAY['tiktok','shopee','meta'],
   '{"tipe":"ambang","pemicu":[{"metrik":"roas","ambang":{"benchmark":"roas"},"banding":"minimal"},{"metrik":"adsDep","ambang":{"benchmark":"adsDep"},"banding":"kurang"}]}'::jsonb,
   'roas', 'rasio', '{"tipe":"pct_dari_sekarang","ambisi_persen":25}'::jsonb, 'Ads');

COMMENT ON TABLE pdt_usulan_katalog IS
  'Katalog aksi usulan (pengganti AM Co-Pilot HTML). 20 aksi asli (G4-01, migrasi ini) '
  'diterjemahkan dari packages/core/src/copilot.ts KATALOG — nama/deskripsi/jembatan/arah/'
  'minggu/fieldIdBukti/quickWin/pilar TETAP di kode (Rule 5, label BI di-review lewat PR). '
  '≥6 aksi khusus Shopee (Rule 30) menyusul G4-03.';
