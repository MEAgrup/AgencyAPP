-- T-2b + T-2c: Hold Service jadi DUA-LANGKAH + notifikasi (katalog v8).
--
-- Keputusan pemilik 2026-08-14: (T-2b) hold dua-langkah — AM MENGAJUKAN, Head of
-- Account MENYETUJUI/MENOLAK (bukan single-gate seperti versi T-2 awal); (T-2c)
-- notifikasi hold ditambahkan sekarang.
--
-- Mesin service: state baru `[Hold Requested]` (non-terminal). Edge langsung
-- `[In Execution] → [On Hold]` (dari migrasi T-2 20260814030000) DICABUT — hold
-- kini WAJIB lewat `[Hold Requested]`:
--   [In Execution]   → [Hold Requested]  (AM mengajukan; require_lead=false)
--   [Hold Requested] → [On Hold]         (Head menyetujui; require_lead=true)
--   [Hold Requested] → [In Execution]    (Head menolak;    require_lead=true)
--   [On Hold]        → [In Execution]    (resume; tetap dari T-2)
-- Gerbang SIAPA tetap di domain (client.ts). `[Hold Requested]` DIANGGAP AKTIF
-- (bukan [On Hold]) — klien tetap dibuka rekap sampai hold disetujui.

-- --- Cabut edge single-gate lama, pasang jalur dua-langkah ------------------
DELETE FROM sm_edges
 WHERE machine = 'service' AND from_state = '[In Execution]' AND to_state = '[On Hold]';

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('service', '[In Execution]',   '[Hold Requested]', false),  -- AM mengajukan
    ('service', '[Hold Requested]', '[On Hold]',        true),   -- Head menyetujui
    ('service', '[Hold Requested]', '[In Execution]',   true);   -- Head menolak

-- --- T-2c: katalog notifikasi v8 (+4 event) --------------------------------
-- Registrasi lewat SATU baris notif_catalog_versions (event_count: 4). Invariant
-- O55 menghitung SUM(event_count) = COUNT(notif_events) — JANGAN hardcode 52.
-- Gate hitung notif_events 48 → 52 di .github/workflows/ci.yml + scripts/
-- db-rebuild.sh dinaikkan bersama migrasi ini (satu commit).
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (8,
     'T-2c Hold Service two-step — 4 event (service_hold_requested, service_held, service_hold_rejected, service_resumed)',
     4,
     'docs/DECISIONS.md 2026-08-14 (T-2b/T-2c — hold dua-langkah + notif)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('service_hold_requested', 'AM mengajukan Hold Service — ke Head of Account',                'leadsOfDivision', 8),
    ('service_held',           'Hold Service disetujui Head of Account — ke AM pemilik',         'explicit',        8),
    ('service_hold_rejected',  'Hold Service ditolak Head of Account — ke AM pemilik',           'explicit',        8),
    ('service_resumed',        'Service dilanjutkan dari On Hold — ke AM pemilik',               'explicit',        8);
