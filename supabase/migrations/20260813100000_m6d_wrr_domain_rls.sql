-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-09: RLS untuk jalur baca lead
-- divisi (O48) + jalur tulis narasi/catatan divisi (RM-A6/RM-D/RM-D6).
--
-- Domain `recap.ts` D-09 menambah reads (getRecapDetail / listRecapsForClient /
-- getPlanRekapRollup), writes (catatan pembuka RM-A6, narasi RM-D + RM-C9,
-- metrik manual RM-C, Sengketa Angka RM-B6/RM-C + notif SPV, catatan divisi
-- RM-D6, tutup dengan belt kelengkapan metrik, buka-kembali Head). Tulisan
-- API lewat db() (service-role, RLS bypass, digerbang canWrite* di TS + belt
-- trigger) — kebijakan di bawah adalah DINDING KEDUA (jalur readAsActor + uji
-- withClaims), menjaga disiplin "TS ≡ RLS" (sama seperti D-03/D-04 wrr_metrik).
--
-- ---------------------------------------------------------------------------
-- 1. O48 — ARM BACA LEAD DIVISI (RM-D6). Melebarkan SELECT: lead sebuah divisi
--    boleh membaca rekap klien yang divisinya SENTUH minggu ini (punya baris
--    wrr_divisi). Ini pelebaran baca per-tabel ⇒ butuh entri DECISIONS (O48,
--    2026-08-13). D-01 sengaja menundanya ("mulai sempit, lebarkan saat fitur
--    membutuhkannya"); RM-D6 (catatan divisi wajib) adalah fitur itu — lead
--    divisi harus bisa MELIHAT rekap untuk mengisi catatan yang ia berutang.
--    Cermin TS: `canReadRecap` arm `touchedDivisions.some(isLead)`.
-- ---------------------------------------------------------------------------
ALTER POLICY weekly_result_recap_select ON public.weekly_result_recap
    USING (jwt_can_read_all()
           OR public.jwt_owns_client_am(client_id)
           OR (jwt_is_lead() AND jwt_division() = 'Account')
           OR (jwt_is_lead() AND EXISTS (
                 SELECT 1 FROM public.wrr_divisi d
                  WHERE d.recap_id = id AND d.divisi = jwt_division())));

-- Anak mengikuti induk lewat helper — perlebar helper yang sama (dipakai policy
-- SELECT wrr_divisi/wrr_metrik/wrr_catatan/wrr_catatan_divisi dari D-01).
CREATE OR REPLACE FUNCTION private.jwt_can_read_recap(p_recap_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.weekly_result_recap w
     WHERE w.id = p_recap_id
       AND (public.jwt_can_read_all()
            OR public.jwt_owns_client_am(w.client_id)
            OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
            OR (public.jwt_is_lead() AND EXISTS (
                  SELECT 1 FROM public.wrr_divisi d
                   WHERE d.recap_id = w.id AND d.divisi = public.jwt_division()))))
$$;

-- ---------------------------------------------------------------------------
-- 2. wrr_catatan — tulis narasi RM-D + RM-A6-adjacent + RM-C9 (AM pemilik).
--    Braces = private.jwt_can_write_recap (kembar canWriteRecap, invariant D-03).
-- ---------------------------------------------------------------------------
GRANT INSERT, UPDATE ON public.wrr_catatan TO authenticated;
CREATE POLICY wrr_catatan_insert ON public.wrr_catatan FOR INSERT TO authenticated
    WITH CHECK (private.jwt_can_write_recap(recap_id));
CREATE POLICY wrr_catatan_update ON public.wrr_catatan FOR UPDATE TO authenticated
    USING (private.jwt_can_write_recap(recap_id))
    WITH CHECK (private.jwt_can_write_recap(recap_id));

-- ---------------------------------------------------------------------------
-- 3. wrr_catatan_divisi — tulis catatan divisi RM-D6 (lead divisi yang sentuh,
--    atau lead Account/Direktur sebagai override). INSERT saja — append-only
--    guard D-05 sudah menolak UPDATE/DELETE. Divisi wajib benar-benar menyentuh
--    klien (punya baris wrr_divisi). Cermin TS `canWriteRecapDivisiNote` +
--    cek touched di `addRecapCatatanDivisi`.
-- ---------------------------------------------------------------------------
GRANT INSERT ON public.wrr_catatan_divisi TO authenticated;
CREATE POLICY wrr_catatan_divisi_insert ON public.wrr_catatan_divisi FOR INSERT TO authenticated
    WITH CHECK (
        public.jwt_is_lead()
        AND (public.jwt_division() = wrr_catatan_divisi.divisi OR public.jwt_division() = 'Account')
        AND EXISTS (SELECT 1 FROM public.wrr_divisi d
                     WHERE d.recap_id = wrr_catatan_divisi.recap_id
                       AND d.divisi   = wrr_catatan_divisi.divisi));

-- Nol tabel/mesin/prefix/event baru → gate 112/33/21/48 TETAP. Migrasi lewat
-- supabase/migrations/** + apply_migration — JANGAN `psql -f` (O38). DB lokal
-- rebuild HANYA lewat scripts/db-rebuild.sh.
