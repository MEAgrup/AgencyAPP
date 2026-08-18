-- CDPS — M8 Ads: NOTIFIKASI ESKALASI ROAS UNDERPERFORMING (katalog v11).
--
-- Permintaan pemilik 2026-08-18 (handoff Wave 2 gap audit SESI42 §2.2, C4):
-- *"saya setuju membuka satu event katalog notifikasi"*. Menutup gap C4 — M8 §8
-- Rule 4 / M8-OA-5 mengharuskan eskalasi saat ROAS < target **2 periode berturut**,
-- tapi kode (dan oracle Go `ads.go:168-172`) hanya **menyalakan flag pasif**
-- `escalationFlagged` di read; TAK PERNAH memberi tahu siapa pun. AM & SPV Ads
-- tidak tahu sebuah campaign sudah dua periode di bawah target.
--
-- ---------------------------------------------------------------------------
-- SATU EVENT, DAN KE SIAPA
-- ---------------------------------------------------------------------------
--   m8.ads.roas_underperforming   ROAS di bawah target 2 periode berturut.
--       Ke AM pemilik klien (eksplisit) + lead/SPV divisi Ads (lewat `division`).
--       Resolver `explicitOrLeads` (aturan katalog: eksplisit DAN lead/SPV → gabungan).
--       AM perlu tahu untuk konteks klien; SPV Ads perlu tahu untuk mengarahkan
--       optimasi. Bukan ke staff Ads pengisi metric — mereka yang memicunya.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN & RANJAU
-- ---------------------------------------------------------------------------
--  * **DIEMIT DARI DOMAIN, BUKAN JOB.** Pemicunya sebuah aksi (metric entry baru
--    di `ads.logMetricEntry`), bukan lewatnya waktu — seperti `penugasan_dibatalkan`.
--    Diemit dalam transaksi yang sama dengan insert metric entry (atomic).
--  * **IDEMPOTEN TANPA KOLOM PENANDA.** Streak = jumlah periode berturut terakhir
--    di bawah target, diturunkan dari `metric_entries` (immutable). Emit HANYA saat
--    streak menjadi **tepat 2** akibat entry yang baru masuk. Entry ke-3 (streak 3)
--    tak mengemit lagi; periode bagus mereset streak ke 0, lalu dua entry buruk
--    berikutnya memicu episode baru (streak 2 lagi) → emit lagi. Karena setiap
--    kenaikan streak melewati sebuah `logMetricEntry`, "tepat 2" tak pernah
--    terlewat maupun ganda — nol kolom, nol tabel.
--  * **Hanya target ROAS.** `parseRoasTarget` mengembalikan null untuk target
--    non-ROAS (Spend cap / tanpa keyword ROAS) ⇒ streak 0 ⇒ tak pernah mengemit.
--    Sesuai §8 Rule 4 yang spesifik ke ROAS.
--
-- Gate hitung notif_events 57 → 58 dinaikkan di .github/workflows/ci.yml +
-- scripts/db-rebuild.sh bersama migrasi ini (satu commit). Nol mesin/tabel/prefix
-- baru (nol kolom pun) ⇒ gate 23 mesin TETAP. Invariant O55 (SUM(event_count) =
-- COUNT(notif_events)) tetap dijaga — JANGAN hardcode 58.

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (11,
     'M8 Ads eskalasi ROAS underperforming — 1 event (m8.ads.roas_underperforming: ROAS < target 2 periode berturut → AM pemilik + SPV Ads)',
     1,
     'docs/DECISIONS.md 2026-08-18 (C4 — pemilik setuju membuka satu event katalog)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m8.ads.roas_underperforming',
     'ROAS di bawah target 2 periode berturut (§8 Rule 4 / M8-OA-5) — ke AM pemilik + SPV Ads',
     'explicitOrLeads',
     11);
