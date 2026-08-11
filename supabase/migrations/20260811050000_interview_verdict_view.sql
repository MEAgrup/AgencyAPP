-- CDPS — Modul Interview: view aditif "verdict + prasyarat saja" untuk Sales
-- (langkah 6, spec §Permissions).
--
-- ---------------------------------------------------------------------------
-- KENAPA VIEW, BUKAN MELONGGARKAN RLS TABEL
-- ---------------------------------------------------------------------------
-- Tabel Interview (migrasi 20260811030000) memberi Sales **default-deny total**:
-- Blok C (skor/verdict/breakdown), Blok B sensitif, jawaban — Sales tak melihat
-- apa pun. Itu benar dan tidak boleh dikendurkan. Tapi spec §Permissions memberi
-- Sales SATU hal: verdict + status prasyarat kliennya (konteks "apakah yang saya
-- closing lolos kualifikasi"), TANPA skor, breakdown, margin, atau jawaban.
--
-- Cara yang benar (gotcha handoff §4): sebuah VIEW ADITIF yang mengekspos HANYA
-- dua kolom sinyal, dengan scope-nya sendiri — BUKAN policy baru di tabel dan
-- BUKAN pelonggaran policy lama. View ini:
--   * berjalan sebagai owner (security_invoker=false, default) ⇒ RLS tabel dasar
--     di-BYPASS di dalam view; maka WHERE-nya SATU-SATUNYA gerbang baris.
--   * `security_barrier=true` ⇒ predikat pemanggil tak bisa di-push-down melewati
--     filter (tak ada kebocoran lewat fungsi bocor).
--   * discope oleh helper jwt_* yang SAMA dengan policy tabel + cabang Sales:
--     Account read-all / Account lead / assigned AM (lewat view interview),
--     DITAMBAH Sales lead (semua) & sales closing (miliknya). Mencerminkan
--     kepemilikan sales.ts (divisi Sales: lead lihat semua, staff lihat sendiri).
--
-- Nol tabel dasar baru (view ≠ BASE TABLE ⇒ gate "tabel public"=103 tak berubah),
-- nol mesin/event/prefix. Tak ada policy tabel yang disentuh.

CREATE OR REPLACE VIEW public.interview_verdict
    WITH (security_barrier = true) AS
SELECT
    k.interview_id,
    i.client_id,
    i.contract_id,
    i.sales_closing_id,
    k.verdict_kualifikasi,
    k.prasyarat_status
FROM public.interview_kualifikasi k
JOIN public.interview i ON i.id = k.interview_id
WHERE public.jwt_can_read_all()
   OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
   OR public.jwt_owns_interview_am(k.interview_id)
   OR (public.jwt_is_lead() AND public.jwt_division() = 'Sales')
   OR (i.sales_closing_id IS NOT NULL AND i.sales_closing_id = public.jwt_employee_id());

COMMENT ON VIEW public.interview_verdict IS
  'View aditif verdict+prasyarat (spec §Permissions). Mengekspos HANYA verdict & prasyarat_status — bukan skor/breakdown/jawaban. Scope: Account read-all/lead/assigned-AM + Sales lead/closing. BUKAN pelonggaran RLS tabel Interview.';

-- authenticated hanya SELECT view; tak ada hak tabel dasar yang bertambah.
GRANT SELECT ON public.interview_verdict TO authenticated;
