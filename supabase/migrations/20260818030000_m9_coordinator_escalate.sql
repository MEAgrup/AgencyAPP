-- CDPS — M9 (KOL) B2: Coordinator boleh mengeskalasi Booking
-- (keputusan pemilik 2026-08-18, DECISIONS.md — Wave 2 gap audit Kelas B2).
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- M9 §10.1 memberi KOL Coordinator hak "escalate when needed", tapi edge
-- [QC Review] → [Escalated - Creator Unresponsive] didaftarkan `require_lead =
-- true` (statemachine baseline), sehingga sm_transition menolak Coordinator
-- (staff) walau gate domain mengizinkannya. Coordinator yang paling dekat
-- dengan kreator justru tak bisa menaikkan masalah — bertentangan dengan §10.1.
--
-- Pemilik memutuskan: Coordinator mengeskalasi ke SPV (KOL Team Leader); SPV
-- yang di bawah M9-OA-6 dapat membawanya ke Director. Otoritas kini dipikul
-- gate domain `canExecute` (Coordinator tertugas / KOL Lead / Director) —
-- backstop `require_lead` di edge ini dilepas agar tidak memblok Coordinator.
--
--   [QC Review] → [Escalated - Creator Unresponsive]:  require_lead true → false
--
-- Edge drop tetap `require_lead = true`: eskalasi adalah aksi Coordinator, drop
-- tetap KEPUTUSAN lead. Tier eskalasi (SPV vs Director) dicatat immutable di
-- audit_log (baris `escalated`) supaya eskalasi + resolusinya bisa direview.
--
-- Nol tabel/mesin/event/prefix baru — `sm_edges` tidak dihitung gate.

UPDATE sm_edges
   SET require_lead = false
 WHERE machine = 'creator_booking'
   AND from_state = '[QC Review]'
   AND to_state = '[Escalated - Creator Unresponsive]';
