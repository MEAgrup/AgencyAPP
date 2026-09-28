-- T-2d: Void Service jadi DUA-LANGKAH (staff mengajukan, Head of Account
-- "Anthy" menyetujui/menolak), dan `[On Hold]` kini bisa diajukan void.
--
-- Keputusan pemilik 2026-09-28 (`docs/DECISIONS.md`, "VOID-DUA-LANGKAH
-- DIPUTUS"): "yg bisa void service Account Head (Anthy), bisa diajukan oleh
-- staff tapi persetujuan akhir harus dari anthy"; "Service yg hold, bisa di
-- void" — `[On Hold]` ditambah sebagai origin void yang sah (sebelumnya TIDAK
-- ADA edge `[On Hold]` → Voided sama sekali).
--
-- Mesin service: state baru `[Void Requested]` (non-terminal). Edge langsung
-- `[In Execution] → [Cancelled — Service Voided]` DICABUT — untuk INI SATU
-- origin saja; edge Voided dari `[Awaiting Onboarding]`/`[Strategy Approved]`/
-- `[Briefed]` (tiga state pra-eksekusi) TIDAK disentuh, `voidService` lama
-- tetap berlaku instan untuk ketiganya (owner tidak menyebutnya). Digantikan
-- jalur dua-langkah:
--   [In Execution]    → [Void Requested]  (staff mengajukan; require_lead=false)
--   [On Hold]         → [Void Requested]  (staff mengajukan; require_lead=false, BARU)
--   [Void Requested]  → [Cancelled — Service Voided]  (Head/Director menyetujui; require_lead=true)
--   [Void Requested]  → [In Execution]    (tolak, kembali ke origin In Execution; require_lead=true)
--   [Void Requested]  → [On Hold]         (tolak, kembali ke origin On Hold; require_lead=true)
-- DUA edge tolak terpisah (bukan satu edge generik) karena `[Void Requested]`
-- menerima dari DUA origin berbeda — `approveVoid`/`rejectVoid` (client.ts)
-- memulihkan origin yang benar dengan membaca baris `audit_log`
-- `service_void_requested` TERAKHIR milik Service itu (`before_json.status`),
-- pola yang SUDAH dipakai codebase ini (`pendingHoldRequests`'s LATERAL join
-- baca `after_json->>'reason'`; Paket V `salesperf.loadVoidTimestamps` baca
-- `after_json->>'status'`), bukan mekanisme baru. Gerbang SIAPA tetap di
-- domain (client.ts::canRequestVoid/canApproveVoid, meniru
-- canRequestHold/canApproveHold PERSIS). Cascade ke Brief anak
-- (skippedApprovedBriefs) kini terjadi HANYA saat approve (transisi nyata ke
-- Voided), bukan saat request — diekstrak ke helper bersama `cascadeVoidBriefs`
-- yang dipakai baik `voidService` lama maupun `approveVoid` baru.
--
-- `[Void Requested]` non-terminal — TIDAK masuk `sm_terminal_states`, sama
-- perlakuan `[Hold Requested]`/`[On Hold]`/`[Closure Requested]` yang juga
-- tidak pernah didaftarkan di sana (lihat 20260814030000/20260814080000/
-- 20261118010000 — tidak satu pun menyentuh sm_terminal_states). `services`
-- tidak punya CHECK atas kolom `status` (varchar(48) bebas), jadi tidak ada
-- constraint lain yang perlu diperbarui.

-- --- Cabut edge instan lama untuk [In Execution] SAJA, pasang jalur dua-langkah ---
DELETE FROM sm_edges
 WHERE machine = 'service' AND from_state = '[In Execution]' AND to_state = '[Cancelled — Service Voided]';

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('service', '[In Execution]',   '[Void Requested]',              false), -- staff mengajukan
    ('service', '[On Hold]',        '[Void Requested]',              false), -- staff mengajukan (BARU)
    ('service', '[Void Requested]', '[Cancelled — Service Voided]',  true),  -- Head/Director menyetujui
    ('service', '[Void Requested]', '[In Execution]',                true),  -- tolak → origin In Execution
    ('service', '[Void Requested]', '[On Hold]',                     true);  -- tolak → origin On Hold

-- --- Katalog notifikasi v20 (+3 event): 79 → 82 -----------------------------
-- Registrasi lewat SATU baris notif_catalog_versions (event_count: 3). Invariant
-- O55 menghitung SUM(event_count) = COUNT(notif_events) — JANGAN hardcode 82.
-- Gate hitung notif_events 79 → 82 di .github/workflows/ci.yml + scripts/
-- db-rebuild.sh dinaikkan bersama migrasi ini (satu commit).
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (20,
     'T-2d Void Service two-step — 3 event (service_void_requested, service_voided, service_void_rejected)',
     3,
     'docs/DECISIONS.md 2026-09-28 (VOID-DUA-LANGKAH DIPUTUS)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('service_void_requested', 'Staff mengajukan Void Service — ke Head of Account',        'leadsOfDivision', 20),
    ('service_voided',         'Void Service disetujui Head of Account — ke AM pemilik',    'explicit',        20),
    ('service_void_rejected',  'Void Service ditolak Head of Account — ke AM pemilik',      'explicit',        20);

-- Gerbang CI — nol tabel baru, nol mesin baru (`service` sudah ada):
--   sm_machines  : 36 → 36
--   notif_events : 79 → 82
