-- O75 (docs/DECISIONS.md, Open) — Service tidak punya satu pun jalur untuk
-- SELESAI. Edge `[In Execution] → Done` ADA di `sm_edges`
-- (`20260723055732_statemachine.sql:317`, `require_lead=false`) tapi NOL
-- pemanggil di seluruh `packages/domain` — tidak ada Service yang pernah bisa
-- mencapai terminal.
--
-- Keputusan pemilik 2026-09-18: Account/AM sendiri boleh MENGAJUKAN penutupan
-- Service-nya; Director yang MENYETUJUI. Syarat minimal: seluruh Brief aktif
-- (belum dibatalkan) milik Service itu sudah `[Approved]`.
--
-- Pola: DUA-LANGKAH, meniru T-2b Hold Service PERSIS
-- (`20260814080000_t2b_hold_twostep.sql`) — edge langsung `[In Execution] →
-- Done` DICABUT, digantikan:
--   [In Execution]        → [Closure Requested]  (Account/AM mengajukan; require_lead=false)
--   [Closure Requested]   → Done                 (Director menyetujui;      require_lead=true)
--   [Closure Requested]   → [In Execution]        (Director menolak;         require_lead=true)
-- `require_lead=true` hanya gerbang SQL generik (director OR lead level MANA
-- PUN) — gerbang SIAPA yang sesungguhnya (Director SAJA, bukan "Head of
-- Account atau Director" seperti Hold) tetap di domain (`client.ts`
-- `canApproveClosure`), sama pola `canApproveHold` tapi lebih sempit sesuai
-- ketokan pemilik ("perlu approval Director").
--
-- `[Closure Requested]` DIANGGAP AKTIF (Service belum selesai) sampai Director
-- menyetujui — sama semangat `[Hold Requested]`.

DELETE FROM sm_edges
 WHERE machine = 'service' AND from_state = '[In Execution]' AND to_state = 'Done';

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('service', '[In Execution]',      '[Closure Requested]', false),  -- Account/AM mengajukan
    ('service', '[Closure Requested]', 'Done',                true),   -- Director menyetujui
    ('service', '[Closure Requested]', '[In Execution]',      true);   -- Director menolak

-- Katalog notifikasi v19 (+3 event): 76 → 79.
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (19,
     'O75 Service Closure two-step — 3 event (service_closure_requested, service_closed, service_closure_rejected)',
     3,
     'docs/DECISIONS.md 2026-09-18 (O75 — Service selesai, Account/AM mengajukan + Director menyetujui)');

-- 'explicit' (bukan 'leadsOfDivision' seperti Hold) untuk KETIGA event —
-- approver-nya Director, layered role yang tidak resolvable lewat divisi
-- (sama pola `pdt.purge.guard_exceeded` v18). Caller (`client.ts`) memasok
-- `finance.directorIds()` untuk event pertama, owning AM untuk dua lainnya.
INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('service_closure_requested', 'Account/AM mengajukan penutupan Service — ke Director', 'explicit', 19),
    ('service_closed',            'Penutupan Service disetujui Director — ke AM pemilik',   'explicit', 19),
    ('service_closure_rejected',  'Penutupan Service ditolak Director — ke AM pemilik',     'explicit', 19);

-- Gerbang CI — nol tabel baru, nol mesin baru (`service` sudah ada):
--   public base tables : 183 → 183
--   sm_machines        : 35 → 35
--   notif_events       : 76 → 79
