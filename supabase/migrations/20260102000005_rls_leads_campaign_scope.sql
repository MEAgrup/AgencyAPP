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
-- ============================================================================

-- Kepemilikan campaign asal lead. SECURITY DEFINER supaya subquery ke
-- `campaigns` tidak ikut ter-filter RLS tabel itu (pola sama dgn jwt_owns_lead).
CREATE OR REPLACE FUNCTION public.jwt_owns_lead_campaign(p_lead_id text) RETURNS boolean
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

REVOKE EXECUTE ON FUNCTION public.jwt_owns_lead_campaign(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.jwt_owns_lead_campaign(text) TO authenticated;

-- Ganti policy SELECT `leads` dengan versi ber-arm kelima.
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND origin_division = jwt_division())
       OR jwt_owns_lead(id)
       OR jwt_owns_lead_campaign(id));

COMMENT ON FUNCTION public.jwt_owns_lead_campaign(text) IS
  'O37: lead berasal dari campaign milik pemanggil (paritas arm own-campaign di Go canReadLead).';
