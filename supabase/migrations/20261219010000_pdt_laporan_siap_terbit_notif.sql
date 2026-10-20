-- CDPS — P7: notifikasi "Laporan PDT siap diterbitkan". Katalog v22.
-- Rujukan: docs/DECISIONS.md 2026-10-19 "P7 — notifikasi Laporan PDT siap
-- terbit" (penambahan event disetujui pemilik, Yohan).
--
-- Gejala: tim Ads (PDT-ADS-BANTU-AM) membuat Laporan PDT dan menekan "Kirim";
-- kiriman lahir `[Draf]` dan klien belum melihat apa pun sampai AM pemilik atau
-- Lead Account menekan Terbitkan (`canTerbitkanLaporan`). Tidak ada yang memberi
-- tahu keduanya, sehingga draf menumpuk tanpa diterbitkan.
--
-- ---------------------------------------------------------------------------
-- SATU EVENT, DAN KE SIAPA
-- ---------------------------------------------------------------------------
--   pdt.laporan.siap_terbit   Kiriman Laporan PDT baru berstatus [Draf]. Ke AM
--       pemilik klien (`clients.assigned_am_id`, dipasok `kirimLaporanPdt`
--       sebagai explicit) + lead Account (di-resolve dari division 'Account').
--       Resolver `explicitOrLeads`. Aktor dikecualikan dan penerima di-dedup
--       oleh `notify_emit` yang sudah ada — nol mekanisme baru.
--
-- Nol tabel/kolom/mesin/prefix baru. Gate hitung notif_events 83 → 84
-- dinaikkan di .github/workflows/ci.yml + scripts/db-rebuild.sh bersama
-- migrasi ini. Invariant O55 (SUM(event_count) = COUNT(notif_events)) tetap
-- dijaga.

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (22,
     'P7 — 1 event (pdt.laporan.siap_terbit): Laporan PDT dikirim sebagai [Draf] dan menunggu Terbitkan — ke AM pemilik klien + lead Account (aktor dikecualikan).',
     1,
     'docs/DECISIONS.md 2026-10-19 (P7 — notifikasi Laporan PDT siap terbit, disetujui Yohan)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('pdt.laporan.siap_terbit',
     'Laporan PDT dikirim [Draf] dan menunggu Terbitkan — ke AM pemilik klien + lead Account',
     'explicitOrLeads',
     22);
