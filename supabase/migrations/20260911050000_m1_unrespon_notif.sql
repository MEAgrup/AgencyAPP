-- L2 (Revisi Sales/Creative/Performa) — NOTIFIKASI lead aging (katalog v14).
--
-- Deliberately its own migration, separate from L1's sm_edges (state) and
-- from L3's job (SQL function that emits these). If the owner ever decides
-- "no notification for this", the fix is deleting this one file — not
-- surgery on the state machine or the tick job.
--
-- ---------------------------------------------------------------------------
-- DUA EVENT, DAN KE SIAPA
-- ---------------------------------------------------------------------------
--   m1.attempt.unrespon           Attempt menua ke [Unrespon] (3 hari diam
--       sejak transisi status terakhir) — ke pemilik attempt (resolver
--       'explicit', owner_employee_id). A lead being pulled off a
--       salesperson's desk by the SYSTEM, silently, is exactly the kind of
--       thing that erodes trust in the system.
--   m1.attempt.auto_not_qualified  Attempt auto Not Qualified setelah 14
--       hari diam di [Unrespon] — ke pemilik attempt (resolver 'explicit').
--
-- Emitter: job harian `leads_unrespon_tick`
-- (20260911020000_m1_unrespon_tick.sql), lewat notify_emit dalam transaksi
-- yang sama dengan sm_transition-nya.
--
-- Gate hitung notif_events 67 → 69 dinaikkan di .github/workflows/ci.yml +
-- scripts/db-rebuild.sh bersama migrasi ini. Nol mesin/tabel/prefix baru ⇒
-- gate 145 tabel/40 prefix/31 mesin TETAP. Invariant O55 (SUM(event_count) =
-- COUNT(notif_events)) tetap dijaga — JANGAN hardcode 69.

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (14,
     'Revisi Sales/Creative/Performa L2 — 2 event lead aging otomatis (m1.attempt.unrespon → pemilik attempt saat New Lead/Contacted menua 3 hari diam; m1.attempt.auto_not_qualified → pemilik attempt saat [Unrespon] menua 14 hari, auto Not Qualified). Emitter: job harian leads_unrespon_tick.',
     2,
     'docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md L1/L2 (permintaan Nerissa, COO, 2026-09-04)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m1.attempt.unrespon',
     'Attempt menua ke [Unrespon] setelah 3 hari diam — ke pemilik attempt',
     'explicit',
     14),
    ('m1.attempt.auto_not_qualified',
     'Attempt auto Not Qualified setelah 14 hari diam di [Unrespon] — ke pemilik attempt',
     'explicit',
     14);
