-- L1 (Revisi Sales/Creative/Performa) — state `[Unrespon]` pada mesin
-- `prospect_attempt`: lead yang didaftarkan tapi tidak digerakkan sales
-- (didiamkan 3 hari di `New Lead`/`Contacted`) menua otomatis, lalu ditutup
-- `Not Qualified` otomatis setelah 14 hari didiamkan di `[Unrespon]`.
-- Jam dihitung dari perubahan status TERAKHIR (audit log), bukan tanggal
-- daftar — lihat job `leads_unrespon_tick` (20260911020000_m1_unrespon_tick.sql).
--
-- DEVIASI PRD dicatat di docs/DECISIONS.md §Open REV-1/REV-2 (M1-OA-7 sudah
-- memutuskan penuaan lead = FLAG, bukan status — ini status untuk jam yang
-- berbeda, attempt yang sudah diklaim sales; M1 §2/§9.3 tidak menyebut status
-- ini, mengikuti preseden bracket `[Deleted]` 2026-07-29).
--
-- Bentuk & konvensi: `20260729162101_lead_delete_request.sql` (state bracket
-- non-PRD) dan `sm_edges` seed di `20260723055732_statemachine.sql:265-290`
-- (kolom sama, primary key (machine, from_state, to_state)).
--
-- Lima edge:
--   New Lead/Contacted -> [Unrespon]        require_lead=true  (penuaan digerakkan
--                                            sistem/Head, bukan pintu kabur sales)
--   [Unrespon] -> Contacted                 require_lead=false (jalan pulang — sales
--                                            hidupkan lagi sendiri)
--   [Unrespon] -> Not Qualified             require_lead=false (kaki 14 hari, juga
--                                            tutup manual lebih awal)
--   [Unrespon] -> [Closed - Kalah Kompetisi] require_lead=false — WAJIB: tanpa edge
--     ini, leads.resolveWin (packages/domain/src/leads.ts) gagal menutup attempt
--     saudara yang menua ke [Unrespon] saat lead lain di Pool yang sama closing,
--     dan MELEMPAR di dalam transaksi Closing M0 → seluruh closing rollback.
--     require_lead=false karena resolveWin memanggil dari SYSTEM_ACTOR
--     (director:true, employeeId 'SYSTEM'), sama seperti keempat edge
--     `-> [Closed - Kalah Kompetisi]` yang sudah ada.
--
-- Tidak ada edge [Unrespon] -> Qualified: M0 §4 hanya lewat submit Qualified
-- Form dari Contacted. Jalur hidup lagi = [Unrespon] -> Contacted -> form ->
-- Qualified.
--
-- [Unrespon] TIDAK didaftarkan ke sm_terminal_states (ia punya edge keluar).
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('prospect_attempt', 'New Lead',   '[Unrespon]', true),
    ('prospect_attempt', 'Contacted',  '[Unrespon]', true),
    ('prospect_attempt', '[Unrespon]', 'Contacted', false),
    ('prospect_attempt', '[Unrespon]', 'Not Qualified', false),
    ('prospect_attempt', '[Unrespon]', '[Closed - Kalah Kompetisi]', false);
