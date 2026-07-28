-- ============================================================================
-- O37 (opsi (c)) — paritas `leads_select` dengan Go `canReadLead`.
--
-- Temuan: policy baseline (20260102000003) memberi baca lead lewat empat arm —
-- can_read_all / created_by sendiri / lead se-divisi / pemegang attempt
-- (jwt_owns_lead). Go `module1_leads/reads.go` punya SATU arm lagi yang belum
-- terwakili: **Marketing staff boleh membaca lead yang berasal dari campaign
-- yang DIA miliki** (`campaigns.owner_employee_id`), walau bukan dia yang
-- meng-create lead-nya.
--
-- Tanpa arm ini, mengaktifkan RLS di jalur baca (readAsActor) akan LEBIH KETAT
-- dari sistem Go yang sudah lolos UAT W1/W3 — Marketing staff kehilangan lead
-- dari campaign sendiri. Migrasi ini menutup gap itu supaya RLS = predikat Go,
-- bukan menambah/mengurangi akses di luar PRD.
--
-- Sifat: hanya MEMPERLUAS baca pada arm yang memang sudah ada di sistem lama;
-- tidak menyentuh policy tulis (tetap default-deny; tulis lewat RPC).
--
-- ---------------------------------------------------------------------------
-- REVISI C-03 (DECISIONS O38 opsi A) — schema `private`, bukan `public`.
--
-- Versi pertama migrasi ini (dulu bernomor …0005) membuat `jwt_owns_lead_campaign`
-- di `public` dan menulis `jwt_owns_lead(id)` TANPA kualifikasi schema. Itu benar
-- terhadap repo saat itu, tetapi SALAH terhadap produksi: migrasi live
-- `harden_secdef_helpers_to_private_schema` (kini di-back-port sebagai
-- 20260102000008) sudah memindahkan `jwt_owns_*` ke schema `private`. Apply-nya
-- ke `CDPS SG` gagal dengan:
--
--     ERROR: function jwt_owns_lead(character varying) does not exist
--
-- Dua koreksi di bawah:
--   1. Policy memanggil `private.jwt_owns_lead` (lokasi sebenarnya).
--   2. Helper baru dibuat di `private` juga — bukan `public` — supaya tidak
--      menghidupkan kembali advisor lint 0029 (SECURITY DEFINER yang bisa
--      dipanggil `authenticated` lewat `/rest/v1/rpc`) yang baru saja ditutup
--      remediasi 2026-07-27. Konsisten dengan keempat helper sekerabatnya.
-- ============================================================================

-- Kepemilikan campaign asal lead. SECURITY DEFINER supaya subquery ke
-- `campaigns` tidak ikut ter-filter RLS tabel itu (pola sama dgn jwt_owns_lead).
-- Ditempatkan di `private`: schema itu tidak diekspos PostgREST, jadi tak ada
-- permukaan RPC — tetapi `authenticated` tetap butuh EXECUTE agar policy bisa
-- dievaluasi.
CREATE OR REPLACE FUNCTION private.jwt_owns_lead_campaign(p_lead_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads l
      JOIN public.campaigns c ON c.id = l.origin_campaign_id
     WHERE l.id = p_lead_id
       AND c.owner_employee_id = public.jwt_employee_id()
  )
$$;

REVOKE EXECUTE ON FUNCTION private.jwt_owns_lead_campaign(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.jwt_owns_lead_campaign(text) TO authenticated;

-- Ganti policy SELECT `leads` dengan versi ber-arm kelima.
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND origin_division = jwt_division())
       OR private.jwt_owns_lead(id)
       OR private.jwt_owns_lead_campaign(id));

COMMENT ON FUNCTION private.jwt_owns_lead_campaign(text) IS
  'O37: lead berasal dari campaign milik pemanggil (paritas arm own-campaign di Go canReadLead).';
