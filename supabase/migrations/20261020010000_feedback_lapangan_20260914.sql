-- ============================================================================
-- Feedback lapangan 2026-09-14 — F-2 (rate-limit login) + F-4 (catatan nego
-- wajib). Satu migrasi untuk seluruh rencana (keputusan pemilik 2026-09-14,
-- docs/handoff/HANDOFF_FEEDBACK_LAPANGAN_20260914.md §3): F-2/F-4/F-5/F-6
-- semestinya menumpang satu berkas — F-5 ternyata NOL migrasi (koreksi di
-- bawah) dan F-6 menunggu jawaban pemilik (CDPS bukan HRIS, docs/DECISIONS.md),
-- jadi berkas ini hanya membawa F-2 + F-4.
--
-- GERBANG CI (angka ABSOLUT, dinaikkan di scripts/db-rebuild.sh DAN
-- .github/workflows/ci.yml pada commit yang SAMA dengan berkas ini):
--   tabel public     175 → 175  TETAP — nol tabel baru (F-2 ALTER tabel lama,
--                                F-4 ALTER dua tabel lama, F-5 nol tabel sama
--                                sekali, lihat koreksi di bawah)
--   entity_prefix     44 →  44  TETAP — nol prefix baru (alasan_nego dan
--                                harga_standar adalah KOLOM di entitas
--                                NEG- yang sudah ada, bukan entitas baru)
--   sm_machines       35 →  35  TETAP — nol mesin baru
--   notif_events      74 →  75  +1 — m5.installment.amount_mismatch (F-5, di
--                                bawah; nol tabel, murni event dari data yang
--                                sudah ada sejak wave 1)
--
-- KOREKSI F-5 (installment_receipts) — TIDAK dibangun. Diagnosis handoff
-- (§2 F-5) melewatkan `payment_verifications`
-- (20260722053923_wave1_money_path.sql): tabel itu SUDAH append-only,
-- SUDAH menyimpan `amount` yang benar-benar diterima (bukan `installments.amount`
-- yang rencana), dan layar Finance (`finance/transactions/[id]/page.tsx`,
-- field "Jumlah Diterima") SUDAH bebas mengetik nominal berapa pun, sudah
-- ditampilkan berdampingan dengan `amount_verified` di kolom sebelahnya.
-- Membangun `installment_receipts` akan menjadi dua sumber kebenaran untuk
-- angka yang sama — persis yang PDT G3 dihindari (lihat handoff §5). Yang
-- benar-benar hilang: notifikasi. Ditambahkan di sini SEBAGAI EVENT SAJA
-- (`m5.installment.amount_mismatch`, catalog v17, packages/core/src/notification.ts),
-- diemisikan dari `finance.ts verifyPayment()` — nol tabel baru. Lihat
-- docs/DECISIONS.md 2026-09-14 (F-5) untuk detail koreksi.
--
-- F-6 (Daily Activity karyawan) TIDAK disentuh sama sekali — menunggu jawaban
-- pemilik (CDPS bukan HRIS; kalau yang dimaksud "keluaran kerja" itu milik
-- CDPS/M14, kalau "absensi" itu milik HRIS dan tiketnya batal).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. F-2 — bucket rate-limit login: per email+IP (bukan IP saja), dan hanya
--    percobaan GAGAL yang mengonsumsi budget (bukan setiap percobaan yang
--    dicek, termasuk yang berhasil).
--
--    Tabel ini "internal murni" sejak lahir (RLS on, zero policy, zero grant
--    ke anon/authenticated di luar SECURITY DEFINER) — kolom baru tidak
--    mengubah itu. Baris lama semuanya sudah lewat jendela 15 menit (migrasi
--    aslinya 2026-09-06), jadi TRUNCATE aman: tidak ada percobaan yang sedang
--    "diingat" kehilangan makna, dan constraint email NOT NULL tidak perlu
--    backfill tebakan.
-- ----------------------------------------------------------------------------
TRUNCATE TABLE login_rate_limit_attempts;
ALTER TABLE login_rate_limit_attempts ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE login_rate_limit_attempts ALTER COLUMN email DROP DEFAULT;

DROP INDEX IF EXISTS idx_login_rate_limit_ip_time;
CREATE INDEX idx_login_rate_limit_email_ip_time
  ON login_rate_limit_attempts (email, ip_address, attempted_at);

-- Fungsi lama menghitung DAN mencatat dalam satu langkah, dipanggil SEBELUM
-- passwordGrant — jadi setiap login yang BERHASIL juga tercatat sebagai satu
-- percobaan. Diganti dua fungsi: satu baca-saja (dipanggil sebelum
-- passwordGrant, membendung brute-force sebelum bcrypt berjalan tanpa
-- mengonsumsi budget), satu penulis (dipanggil HANYA saat passwordGrant
-- gagal). Lihat packages/domain/src/auth.ts `assertLoginNotRateLimited` /
-- `recordFailedLoginAttempt`.
DROP FUNCTION IF EXISTS public.check_login_rate_limit(text, int, int);

CREATE OR REPLACE FUNCTION public.login_rate_limit_check(
  p_ip_address      text,
  p_email           text,
  p_max_attempts    int,
  p_window_minutes  int
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.login_rate_limit_attempts
   WHERE ip_address = p_ip_address
     AND email = p_email
     AND attempted_at >= now() - make_interval(mins => p_window_minutes);
  RETURN v_count < p_max_attempts;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.login_rate_limit_check(text, text, int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_rate_limit_check(text, text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.login_rate_limit_record_failure(
  p_ip_address      text,
  p_email           text,
  p_window_minutes  int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  -- Bersihkan baris kedaluwarsa milik kunci INI SAJA — pembersihan tetap
  -- terjadi (sama seperti fungsi lama), hanya dipindah ke sisi tulis karena
  -- sisi baca sekarang harus benar-benar tanpa efek samping.
  DELETE FROM public.login_rate_limit_attempts
   WHERE ip_address = p_ip_address
     AND email = p_email
     AND attempted_at < now() - make_interval(mins => p_window_minutes);

  INSERT INTO public.login_rate_limit_attempts (ip_address, email) VALUES (p_ip_address, p_email);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.login_rate_limit_record_failure(text, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_rate_limit_record_failure(text, text, int) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. F-4 — catatan nego wajib + harga standar dibekukan per baris.
--
--    `alasan_nego` di level proposal (satu alasan per versi, bukan per baris
--    — itu yang ditulis sales saat mengajukan). `harga_standar` di level baris
--    (setiap jasa punya harga standarnya sendiri). Keduanya NULLABLE di
--    kolom: kewajiban "wajib untuk versi ber-custom-terms" ditegakkan di
--    `writeProposal` (packages/domain/src/sales.ts), bukan di CHECK constraint
--    — engine sudah tahu, per versi, apakah versi itu customTerms atau
--    bukan, sedangkan CHECK di DB tidak punya konteks itu tanpa duplikasi
--    logika (rule 2: transisi/tulis dijaga di satu tempat).
-- ----------------------------------------------------------------------------
ALTER TABLE negotiation_proposals ADD COLUMN alasan_nego varchar(500) NULL;
ALTER TABLE negotiation_proposal_lines ADD COLUMN harga_standar numeric(15,2) NULL;

-- Backfill baris LAMA — dari snapshot Qualified Form pada attempt+jasa+platform
-- yang SAMA (yang juga menyimpan `master_version_no`-nya sendiri), BUKAN
-- ditebak dari katalog hari ini. Baris yang tidak match (jasa ditambah saat
-- negosiasi, tidak pernah ada di Qualified) TETAP NULL — house rule anti-
-- halusinasi: tidak ada angka yang tidak bisa direkonstruksi dari log.
UPDATE negotiation_proposal_lines npl
   SET harga_standar = qfs.subtotal
  FROM negotiation_proposals np, qualified_form_services qfs
 WHERE npl.proposal_id = np.id
   AND qfs.attempt_id = np.attempt_id
   AND qfs.master_service_id = npl.master_service_id
   AND qfs.platform = npl.platform
   AND npl.harga_standar IS NULL;

COMMENT ON COLUMN negotiation_proposals.alasan_nego IS
  'F-4 (feedback lapangan 2026-09-14) — alasan sales mengajukan harga custom '
  '(harga awal/harga nego/kenapa). Wajib diisi saat versi ini customTerms '
  '(ditegakkan di writeProposal, bukan di sini) — lihat DECISIONS.md.';
COMMENT ON COLUMN negotiation_proposal_lines.harga_standar IS
  'F-4 — harga MSL yang dibekukan SAAT versi ini ditulis, independen dari '
  'harga yang benar-benar dinegosiasikan (proposed_price). NULL untuk baris '
  'lama yang tidak match snapshot Qualified Form manapun (tidak ditebak) atau '
  'baris custom yang katalognya sudah tidak bisa dihitung ulang (jasa '
  'diarsipkan) — lihat writeProposal.';

-- ----------------------------------------------------------------------------
-- 3. F-5 (koreksi) — NOL tabel baru. Satu event notifikasi: termin settle
--    dengan total diterima (Σ payment_verifications) ≠ rencana
--    (installments.amount). Emitter: packages/domain/src/finance.ts
--    verifyPayment(). Deskripsi/resolver di sini WAJIB sama persis dengan
--    packages/core/src/notification.ts CATALOG (notif_catalog.reals.test.ts).
-- ----------------------------------------------------------------------------
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (17,
     'Feedback lapangan 2026-09-14 (F-5) — 1 event: m5.installment.amount_mismatch '
     '(termin settle dengan total diterima ≠ rencana, dari payment_verifications '
     'yang sudah ada sejak wave 1) → Sales PIC + lead Finance, sebelum rekap '
     'bulanan.',
     1,
     'docs/DECISIONS.md 2026-09-14 (F-5, koreksi diagnosis handoff)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m5.installment.amount_mismatch',
     'Termin settle dengan total diterima ≠ rencana — ke Sales PIC + lead Finance',
     'explicitOrLeads',
     17);
