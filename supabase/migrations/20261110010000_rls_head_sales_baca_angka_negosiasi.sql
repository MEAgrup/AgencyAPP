-- ============================================================================
-- Feedback lapangan 2026-09-16 (pemilik) — "ketika 1 orang sales mengajukan
-- negosiasi, di bagian Sales Head TIDAK MUNCUL nominal negosiasi dan angkanya.
-- Padahal ini poin penting untuk menerima / menolak negosiasi."
--
-- SEBAB. Ini BUKAN cacat UI. `S-01` (`20260901010000`) memberi Head/SPV Sales
-- arm "Lead/SPV = division-wide" (CLAUDE.md #6) untuk EMPAT tabel — termasuk
-- `prospect_attempts` — tapi TIDAK untuk tabel ANAK yang justru memuat angka
-- dan alasan yang diputuskan:
--
--   negotiation_proposals        `jwt_can_read_all() OR me IN (proposed_by, created_by)`
--   negotiation_proposal_lines   `jwt_can_read_all() OR created_by = me`
--   qualified_forms              `… OR private.jwt_owns_lead(lead_id)`  (= "saya pemilik attempt-nya")
--   qualified_form_services      `jwt_can_read_all() OR created_by = me`
--   prospect_attempt_nq_reasons  `jwt_can_read_all() OR created_by = me`
--
-- Akibatnya, pada `/persetujuan` dan `/sales/{id}` yang dibaca lewat
-- `readAsActor` (RLS aktif): kartu INDUK-nya terlihat (dari `prospect_attempts`),
-- tetapi `GET /attempts/{id}` mengembalikan `proposals: []` dan
-- `qualified_form: null` — HIJAU, 200, TANPA error. Yang dilihat Head persis
-- seperti laporan pemilik: `VERSI PROPOSAL —`, `SELISIH TOTAL: Buka rincian`,
-- rincian dibuka tapi hampa, dan `Alasan negosiasi` (kolom
-- `negotiation_proposals.alasan_nego`, F-4 `20261020010000`) tidak pernah
-- muncul walau sales WAJIB mengisinya.
--
-- Ini kelas cacat yang SAMA yang dicatat `20260901010000` sendiri ("hijau,
-- tanpa error, angka salah") dan `20260806050000` sebelumnya — hanya satu
-- lapis lebih dalam: di sana yang terlewat tabel induk, di sini anak-anaknya.
--
-- YANG LEBIH BERBAHAYA DARIPADA LAYAR KOSONG. Jalur TULIS keputusan tidak lewat
-- RLS: `decideNegotiation` memanggil `sm_transition` (SECURITY DEFINER, gate
-- role di dalam fungsi). Jadi tombol "Setujui negosiasi" TETAP BEKERJA untuk
-- Head — sistem membiarkannya mengunci harga yang tidak pernah bisa ia lihat.
-- Itu yang membuat ini diperlakukan sebagai cacat, bukan permintaan fitur.
--
-- INVARIAN YANG DIPASANG. "Siapa pun yang boleh melihat ATTEMPT harus boleh
-- melihat angka & alasan yang menempel padanya." Persis invarian yang
-- `20260806050000` pasang untuk `prospect_activities` ("attempt dan effort-nya
-- tidak boleh pernah beda jawaban untuk aktor yang sama").
--
-- CARANYA — SATU predikat, bukan lima salinan. `private.jwt_can_read_attempt()`
-- adalah CERMIN `prospect_attempts_select` (definisi TERAKHIR: `20260901010000`,
-- bukan baseline). Kelima policy di bawah memanggilnya; tidak satu pun menyalin
-- predikatnya. Kalau arm attempt berubah nanti, ia berubah di SATU tempat dan
-- kelimanya ikut — tidak ada versi kedua dari aturan yang sama.
--
-- SECURITY DEFINER dipakai dengan alasan yang sama seperti `jwt_owns_lead`
-- (baseline §2): subquery ke tabel induk tidak boleh ikut ter-filter RLS tabel
-- itu, atau kita mendapat under-expose berlapis. Otorisasinya TIDAK diserahkan
-- ke RLS pemanggil — predikatnya dievaluasi EKSPLISIT di dalam fungsi.
-- Helper dipanggil BER-SKEMA `private.` (jebakan `20260727072443`/`20260729031525`).
--
-- SIFAT: MEMPERLUAS SELECT saja — setiap arm lama dipertahankan VERBATIM, satu
-- arm ditambahkan. NOL policy tulis disentuh (tetap default-deny; tulis lewat
-- RPC). Bukan hak baru: ini menepati janji CLAUDE.md #6 yang sudah berlaku
-- untuk induknya sejak `20260901010000`.
--
-- LEDGER O48/O60. Kelima policy ini ada di `expected` §42 `rls_checks.sql`.
-- Sesudah migrasi ini semuanya memanggil helper `private.*` yang `prosrc`-nya
-- memuat KEDUA `jwt_is_lead` dan `jwt_division`, jadi detektor O60 melihat
-- arm-nya dan ledger MENYUSUT — kelima baris DIHAPUS dari `expected` di commit
-- yang SAMA, sesuai §ATURAN daftar itu.
--
-- Dicatat `docs/DECISIONS.md` 2026-09-17.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. private.jwt_can_read_attempt() — cermin `prospect_attempts_select`.
--
--    Ditempatkan di `private`: schema itu tidak diekspos PostgREST (nol
--    permukaan RPC), tapi `authenticated` tetap butuh EXECUTE agar policy bisa
--    dievaluasi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.jwt_can_read_attempt(p_attempt_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
      FROM public.prospect_attempts pa
     WHERE pa.id = p_attempt_id
       AND (public.jwt_can_read_all()
            OR public.jwt_employee_id() IN (pa.owner_employee_id, pa.created_by)
            OR private.jwt_owns_lead(pa.lead_id)
            -- Lead/SPV = division-wide (CLAUDE.md #6) — arm yang S-01 berikan
            -- ke induknya dan yang seluruh migrasi ini ada untuk mengalirkan.
            OR (public.jwt_is_lead() AND EXISTS (
                  SELECT 1 FROM public.leads l
                   WHERE l.id = pa.lead_id
                     AND l.origin_division = public.jwt_division())))
  )
$$;

REVOKE EXECUTE ON FUNCTION private.jwt_can_read_attempt(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION private.jwt_can_read_attempt(text) TO authenticated;

COMMENT ON FUNCTION private.jwt_can_read_attempt(text) IS
  'Feedback 2026-09-16: cermin prospect_attempts_select (definisi 20260901010000). Satu-satunya sumber predikat "boleh baca attempt ini" untuk tabel anak M0 — jangan disalin, panggil.';

-- ---------------------------------------------------------------------------
-- 2. private.proposal_attempt_id() — resolusi induk untuk tabel cucu.
--
--    `negotiation_proposal_lines` hanya memegang `proposal_id`, jadi ia butuh
--    satu lompatan untuk sampai ke attempt. Fungsi ini SENGAJA hanya melakukan
--    lookup (nol aturan otorisasi di dalamnya): keputusannya tetap milik
--    `jwt_can_read_attempt`, yang dipanggil LANGSUNG di predikat policy —
--    sehingga detektor ledger §42 melihat arm-nya, dan tidak ada tempat kedua
--    yang bisa menyimpang.
--    SECURITY DEFINER: lookup induk tidak boleh ikut ter-filter RLS
--    `negotiation_proposals`, atau baris anak hilang justru saat policy induknya
--    sedang dievaluasi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.proposal_attempt_id(p_proposal_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT np.attempt_id FROM public.negotiation_proposals np WHERE np.id = p_proposal_id
$$;

REVOKE EXECUTE ON FUNCTION private.proposal_attempt_id(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION private.proposal_attempt_id(text) TO authenticated;

COMMENT ON FUNCTION private.proposal_attempt_id(text) IS
  'Feedback 2026-09-16: lookup induk (proposal -> attempt) untuk negotiation_proposal_lines. Lookup MURNI — otorisasinya ada di private.jwt_can_read_attempt.';

-- ---------------------------------------------------------------------------
-- 3. negotiation_proposals — versi, alasan_nego, decision_note.
--
--    Ini baris yang memuat ALASAN pengajuan (`alasan_nego`, F-4) dan catatan
--    keputusan tiap versi. Arm lama (pengaju/penulis) dipertahankan verbatim.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS negotiation_proposals_select ON public.negotiation_proposals;
CREATE POLICY negotiation_proposals_select ON public.negotiation_proposals FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (proposed_by, created_by)
       OR private.jwt_can_read_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- 4. negotiation_proposal_lines — NOMINAL-nya: proposed_price, harga_standar,
--    commission_rule, payment_terms. Tanpa ini "Selisih total" tidak pernah
--    bisa dihitung dan tabel "harga standar -> harga diajukan" kosong.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS negotiation_proposal_lines_select ON public.negotiation_proposal_lines;
CREATE POLICY negotiation_proposal_lines_select ON public.negotiation_proposal_lines FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_can_read_attempt(private.proposal_attempt_id(proposal_id)));

-- ---------------------------------------------------------------------------
-- 5. qualified_forms — konteks keputusan (toko, kategori, platform, GMV
--    baseline, target GMV, marketing budget) yang dirender di atas tabel harga.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS qualified_forms_select ON public.qualified_forms;
CREATE POLICY qualified_forms_select ON public.qualified_forms FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_lead(lead_id)
       OR private.jwt_can_read_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- 6. qualified_form_services — snapshot harga standar saat Qualified. Dipakai
--    `buildComparison` sebagai pembanding untuk versi proposal LAMA (sebelum
--    F-4 menambahkan `harga_standar` per baris), jadi tanpa ini perbandingan
--    proposal lama jatuh ke katalog hidup — yang sudah bisa keliru.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS qualified_form_services_select ON public.qualified_form_services;
CREATE POLICY qualified_form_services_select ON public.qualified_form_services FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_can_read_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- 7. prospect_attempt_nq_reasons — alasan Not Qualified, anak dari attempt yang
--    sama dan dikembalikan endpoint yang sama (`GET /attempts/{id}`
--    `nq_reasons`). Ikut ditutup di sini dengan sengaja: membiarkannya berarti
--    Head yang sekarang bisa membaca angka negosiasi tetap buta saat menelaah
--    kenapa sebuah prospek digugurkan — separuh layar yang sama, cacat yang
--    sama persis.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS prospect_attempt_nq_reasons_select ON public.prospect_attempt_nq_reasons;
CREATE POLICY prospect_attempt_nq_reasons_select ON public.prospect_attempt_nq_reasons FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_can_read_attempt(attempt_id));

COMMENT ON POLICY negotiation_proposals_select ON public.negotiation_proposals IS
  'Feedback 2026-09-16: Head/SPV Sales membaca versi + alasan_nego negosiasi se-divisi — dikembarkan dengan prospect_attempts_select lewat private.jwt_can_read_attempt.';
COMMENT ON POLICY negotiation_proposal_lines_select ON public.negotiation_proposal_lines IS
  'Feedback 2026-09-16: Head/SPV Sales membaca NOMINAL (proposed_price/harga_standar) negosiasi se-divisi — tanpa ini tombol Setujui/Tolak diklik tanpa angka.';
COMMENT ON POLICY qualified_forms_select ON public.qualified_forms IS
  'Feedback 2026-09-16: Head/SPV Sales membaca snapshot Qualified se-divisi (konteks keputusan negosiasi).';
COMMENT ON POLICY qualified_form_services_select ON public.qualified_form_services IS
  'Feedback 2026-09-16: Head/SPV Sales membaca baris layanan snapshot Qualified se-divisi (pembanding harga standar versi lama).';
COMMENT ON POLICY prospect_attempt_nq_reasons_select ON public.prospect_attempt_nq_reasons IS
  'Feedback 2026-09-16: Head/SPV Sales membaca alasan Not Qualified se-divisi — anak dari attempt yang sama, endpoint yang sama.';
