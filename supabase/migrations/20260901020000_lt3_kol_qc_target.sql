-- CDPS M16 — LT-3 DIPUTUSKAN (pemilik, 2026-08-29): "14 hari kerja hanya untuk
-- follow up memastikan video di post, sisanya buat sesuai standar".
--
-- Jadi jendela 14 hk itu BUKAN per-tahap untuk keduanya, dan BUKAN pula satu
-- jendela gabungan: ia milik `Follow up Video Creator` SAJA (tahap #7 —
-- menunggu creator benar-benar memposting videonya, satu-satunya tahap KOL yang
-- durasinya ditentukan pihak luar). `QC & Approval Video Creator` (tahap #8)
-- kembali ke STANDAR QC internal CDPS = 1 hari kerja, sama dengan setiap
-- checkpoint QC lain di seluruh pipeline (`QC internal` dan `QC Account
-- Service` Creative, keduanya 1 hk).
--
-- Ini menutup kecurigaan yang dicatat di seed aslinya sendiri
-- (20260830020000): "14 hk untuk QC internal terasa longgar dibanding QC lain
-- yang semuanya 1 hk" — memang longgar, dan pemilik mengonfirmasi angka itu
-- tidak pernah dimaksudkan untuk QC.
--
-- SATU nilai data, persis seperti yang diperkirakan DECISIONS.md LT-3 ("gantinya
-- cukup satu angka di seed `stage_definition` — bukan perubahan desain, nol
-- migrasi struktural"). Nol tabel/mesin/prefix/event/edge baru; gate TETAP
-- (tabel 128, entity_prefix 36, sm_machines 29, notif_events 65).
--
-- Efek pada lead time yang SUDAH tercatat: nol baris riwayat disentuh.
-- `target_hari_kerja` hanya dibaca saat MENGHITUNG status SLA sebuah tahap
-- (leadtime.ts computeStageLeadTime, dihitung ulang setiap dibaca dari
-- audit_log — aturan rumah #4), jadi Brief yang tahap QC-nya sudah lewat
-- 1 hk akan tampil `[terlambat]` mulai sekarang. Itu memang maksudnya:
-- targetnya yang salah, bukan datanya. Override per-Brief tetap tersedia di
-- `brief_stage_sla` untuk kasus yang sah butuh kelonggaran.
UPDATE stage_definition
   SET target_hari_kerja = 1
 WHERE pipeline_code = 'KOL_DEFAULT'
   AND stage_code = 'QC & Approval Video Creator';
