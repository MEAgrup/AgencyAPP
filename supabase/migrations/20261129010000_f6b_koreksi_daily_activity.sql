-- ============================================================================
-- F-6b (interview lapangan 2026-09-22, disampaikan Handa Anthy) — "koreksi
-- berantai" untuk Aktivitas Harian.
--
-- KENAPA. F-6 (2026-09-14, DECISIONS.md) mengunci `daily_activities`
-- APPEND-ONLY: "salah catat → catat ulang, bukan edit" — trigger
-- `forbid_mutation()` menolak UPDATE/DELETE (house rule #3, non-negotiable).
-- Feedback lapangan sesudahnya: staff butuh mengoreksi entri yang salah input
-- atau me-reschedule jadwal yang sudah tercatat. Meng-UPDATE baris lama akan
-- melanggar trigger yang sudah aktif DAN konvensi immutable itu sendiri —
-- bukan pilihan. Ditanyakan ke pemilik (AskUserQuestion, 2026-09-22): jawaban
-- "koreksi berantai" di bawah.
--
-- YANG DIBANGUN, BUKAN UPDATE: kolom self-referencing nullable `koreksi_dari`.
-- "Edit" di UI = INSERT baris BARU yang menunjuk ke baris lama lewat kolom
-- ini; baris lama tidak pernah disentuh (trigger `forbid_mutation` TETAP, nol
-- pengecualian, nol kolom yang di-UPDATE). Baris lama tampak "Dikoreksi" di UI
-- lewat `dikoreksiOleh` — computed di `dailyactivity.list` (correlated
-- subquery), BUKAN kolom fisik tersimpan (house rule #4: field terhitung
-- read-only, selalu diturunkan, tidak pernah disimpan terpisah).
--
-- RANTAI, BUKAN POHON: `idx_dact_koreksi_dari_unik` (partial unique index)
-- memastikan satu baris hanya boleh dikoreksi SEKALI secara langsung — untuk
-- mengoreksi lagi, koreksi versi TERBARU (ujung rantai), bukan versi asli.
-- Domain layer (`dailyactivity.log`) menegakkan aturan yang sama (baris yang
-- sudah dikoreksi ditolak `DailyActivityConflictError`, bukan membuat cabang
-- baru yang membingungkan "versi mana yang benar"); index ini adalah pagar
-- terakhir di DB kalau dua permintaan lomba pada baris yang sama.
--
-- Nol tabel baru, nol prefix baru, nol mesin/status baru (masih log, bukan
-- lifecycle — F-6 tidak berubah), nol event notifikasi baru. RLS
-- (`daily_activities_select`, migrasi 20261021010000) tidak berubah — baris
-- koreksi adalah baris `daily_activities` biasa, tunduk pada predikat yang
-- sama seperti baris lain.
-- ============================================================================

ALTER TABLE daily_activities
    ADD COLUMN koreksi_dari varchar(32) NULL REFERENCES daily_activities (id);

-- Partial unique: `koreksi_dari` boleh NULL berkali-kali (baris asli, atau
-- ujung rantai yang belum dikoreksi), tapi satu id boleh muncul sebagai target
-- HANYA SEKALI — itulah yang membuatnya rantai, bukan pohon.
CREATE UNIQUE INDEX idx_dact_koreksi_dari_unik ON daily_activities (koreksi_dari)
    WHERE koreksi_dari IS NOT NULL;

COMMENT ON COLUMN daily_activities.koreksi_dari IS
  'F-6b — id baris yang DIKOREKSI oleh baris ini (rantai, bukan pohon; '
  '`idx_dact_koreksi_dari_unik` memastikan satu baris hanya dikoreksi sekali '
  'secara langsung). NULL berarti entri asli (belum pernah jadi koreksi apa '
  'pun). daily_activities TETAP append-only — baris lama tidak pernah '
  'di-UPDATE; trigger forbid_mutation tidak berubah.';
