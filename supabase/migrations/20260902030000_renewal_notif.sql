-- CDPS — R-03 (Kinerja Sales): NOTIFIKASI RENEWAL/CROSS-SELL (katalog v13).
--
-- R-04 UI ("Perpanjangan / Cross Sell" di Client Record) butuh dua event yang
-- SAMA PERSIS PERANNYA dengan `m0.negotiation.pending_approval`/`.decision`
-- (M0 §5) yang sudah ada — renewal.ts memang meniru mesin negosiasi itu
-- (`docs/STATE_MACHINES.md` §20), jadi notifikasinya juga.
--
-- ---------------------------------------------------------------------------
-- DUA EVENT, DAN KE SIAPA
-- ---------------------------------------------------------------------------
--   m0.renewal.pending_approval   Baris custom diajukan/di-resubmit renewal —
--       ke lead/SPV divisi Sales (resolver `leadsOfDivision`, sama seperti
--       negosiasi — Sales PIC tunggal tidak menyetujui penawarannya sendiri).
--   m0.renewal.decision           Sales Lead/Director memutuskan (approve/
--       reject) — ke pengaju (`renewal_requests.proposed_by`, resolver
--       `explicit`).
--
-- Jalur no-nego (semua baris harga standar) tidak mengemit apa pun — sama
-- seperti negosiasi, karena Auto Approved tidak pernah menunggu siapa pun.
--
-- Gate hitung notif_events 65 → 67 dinaikkan di .github/workflows/ci.yml +
-- scripts/db-rebuild.sh bersama migrasi ini. Nol mesin/tabel/prefix baru ⇒
-- gate 30 mesin/133 tabel/37 prefix TETAP. Invariant O55 (SUM(event_count) =
-- COUNT(notif_events)) tetap dijaga — JANGAN hardcode 67.

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (13,
     'R-03 (Kinerja Sales) — 2 event renewal/cross-sell (m0.renewal.pending_approval → Sales Head/SPV saat baris custom menunggu persetujuan; m0.renewal.decision → pengaju saat diputuskan)',
     2,
     'docs/DECISIONS.md 2026-08-29 (Kinerja Sales #5)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m0.renewal.pending_approval',
     'Proposal renewal/cross-sell dengan baris custom menunggu persetujuan — ke lead/SPV Sales',
     'leadsOfDivision',
     13),
    ('m0.renewal.decision',
     'Keputusan (approve/reject) atas proposal renewal/cross-sell — ke pengaju',
     'explicit',
     13);
