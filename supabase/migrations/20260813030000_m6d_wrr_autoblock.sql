-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-03 part B: AUTO-METRIC UPDATE-BLOCK.
--
-- The PRD frames this as a **frozen invariant**, identical in shape to M6B
-- `plan_actual` (Rule 10 / B-06):
--
--   §4 Rule 5 / §9 field-notes — "Auto figures in `WRR_DIVISI` / `WRR_METRIK`
--   are UPDATE-blocked at the DB level for JWT (AM) roles, mirrored in RLS
--   `WITH CHECK` — TS predicate and RLS must not diverge."
--
-- ONE authorization rule expressed in three places that MUST agree
-- (`packages/domain/src/recap.reals.test.ts` asserts they do not diverge — the
-- same invariant class as M6B `plan.reals.test.ts`):
--
--   * `otomatis` figures are written ONLY by the system — the D-03 aggregation
--     function / the D-06 Monday job, running service-role with NO JWT actor.
--     No authenticated human (AM or SPV) may INSERT one or overwrite its value.
--     This is house rule #4 (auto fields are recomputable from the source
--     modules, never user-typed): a wrong auto number is challenged
--     (`Sengketa Angka`) and corrected by a re-sync from the owning module, not
--     overtyped. Stricter than the PRD's literal "AM cannot" (silent on SPV) and
--     the same deliberate, logged deviation M6B took (DECISIONS 2026-08-10 /
--     2026-08-13).
--   * The ONE thing an authenticated actor may move on an auto row is the
--     `Sengketa Angka` note (`wrr_metrik.sengketa` RM-C / `wrr_divisi.sengketa`
--     RM-B6) — the dispute itself.
--   * The `manual` fallback rows of `wrr_metrik` (RM-C3/C4/C5 organik) are the
--     owning AM's to write, scoped to recaps they own. Their conditional
--     evidence CHECK (`file_bukti` + `tanggal_ambil` NOT NULL when
--     `sumber = 'manual'`, RM-C7) stays a D-04 concern — D-01 assigned it there;
--     this ticket only stands up the auto-block wall, exactly as B-06 opened the
--     `plan_actual` write path while B-01 owned its manual-bukti CHECK.
--
-- Belt (fires on EVERY connection, incl. the BYPASSRLS owner/service-role write
-- path where RLS never engages): the `guard_wrr_*_no_manual_auto` triggers. They
-- distinguish system from human by the PRESENCE of a JWT actor
-- (`jwt_employee_id()` — NULL under service-role, set under `withClaims`), so a
-- system ingestion is waved through and only a real authenticated actor is gated.
--
-- Braces: RLS `WITH CHECK` — an authenticated writer may only produce `manual`
-- `wrr_metrik` rows (never `otomatis`) and only on recaps they may write
-- (`private.jwt_can_write_recap`); `wrr_divisi` gets UPDATE only (the sengketa
-- note), never INSERT, because a division production row is always system-born.
--
-- No new table / machine / event / prefix — the shape already exists (D-01), so
-- every structural gate (112 tables · 21 machines · 44 events · 33 prefix) is
-- unchanged. Migrasi lewat supabase/migrations/** + apply_migration — JANGAN
-- `psql -f` (O38). DB lokal rebuild HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- 1. Write-scope helper — mirrors `canWriteRecap` (owning AM OR Account lead;
--    Director covered by jwt_is_lead). WRITE twin of `private.jwt_can_read_recap`
--    (D-01): read scope adds OD/Director (read-all), write scope does NOT (Role
--    Matrix §9: OD is read-only), so this is a distinct function. SECURITY
--    DEFINER so the join to weekly_result_recap/clients is not itself
--    RLS-filtered (same reason as jwt_can_write_plan, M6B B-06).
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.jwt_can_write_recap(p_recap_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
      FROM public.weekly_result_recap w
      JOIN public.clients c ON c.id = w.client_id
     WHERE w.id = p_recap_id
       AND ( (public.jwt_is_lead() AND public.jwt_division() = 'Account')
             OR c.assigned_am_id = public.jwt_employee_id() )
  )
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_can_write_recap(text) FROM anon;

-- ===========================================================================
-- 2a. `wrr_metrik` block (belt) — mirror of guard_plan_actual_no_manual_auto.
--     A JWT actor may not insert an `otomatis` row nor overwrite its value; only
--     the `sengketa` note may change on it. A NULL actor is the system
--     aggregation (D-03/D-06) and is waved through.
-- ===========================================================================
CREATE OR REPLACE FUNCTION guard_wrr_metrik_no_manual_auto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor text := public.jwt_employee_id();
BEGIN
  -- System / service-role ingestion (no JWT actor): auto metrics are its job.
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.sumber = 'otomatis' THEN
      RAISE EXCEPTION '[metrik otomatis hanya diisi sistem, tidak dapat diinput manual]';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. An existing `otomatis` row may change ONLY its `sengketa` note
  -- (RM-C). Its value, key, evidence and delta baseline are the source
  -- module's, not the AM's.
  IF OLD.sumber = 'otomatis' THEN
    IF NEW.nilai             IS DISTINCT FROM OLD.nilai
       OR NEW.sumber            IS DISTINCT FROM OLD.sumber
       OR NEW.metrik            IS DISTINCT FROM OLD.metrik
       OR NEW.file_bukti        IS DISTINCT FROM OLD.file_bukti
       OR NEW.tanggal_ambil     IS DISTINCT FROM OLD.tanggal_ambil
       OR NEW.nilai_minggu_lalu IS DISTINCT FROM OLD.nilai_minggu_lalu THEN
      RAISE EXCEPTION '[metrik otomatis tidak dapat diubah — ajukan Sengketa Angka jika angkanya keliru]';
    END IF;
  END IF;
  -- And a manual row may never be hand-promoted into an auto one.
  IF NEW.sumber = 'otomatis' AND OLD.sumber <> 'otomatis' THEN
    RAISE EXCEPTION '[metrik otomatis hanya diisi sistem, tidak dapat diinput manual]';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wrr_metrik_no_manual_auto
    BEFORE INSERT OR UPDATE ON wrr_metrik
    FOR EACH ROW EXECUTE FUNCTION guard_wrr_metrik_no_manual_auto();

COMMENT ON FUNCTION guard_wrr_metrik_no_manual_auto() IS
  'M6D §4 Rule 5 (belt) — a JWT-identified actor may not insert/overwrite an '
  'otomatis wrr_metrik figure; only the sengketa note may change on it. A NULL '
  'JWT actor is the system aggregation (D-03/D-06) and is allowed. Paired with '
  'the RLS WITH CHECK (braces) and the TS write path — the three must not diverge.';

-- ===========================================================================
-- 2b. `wrr_divisi` block (belt) — production counts per division. There is no
--     `sumber` column: EVERY row is system-born (RM-B, "auto, read-only"). A JWT
--     actor may never insert one, and may only move its `sengketa` note (RM-B6).
-- ===========================================================================
CREATE OR REPLACE FUNCTION guard_wrr_divisi_no_manual_auto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor text := public.jwt_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION '[angka produksi divisi otomatis, tidak dapat diinput manual]';
  END IF;

  -- UPDATE: only the sengketa note (RM-B6) may move; the counts and their
  -- breakdown are the owning execution module's.
  IF NEW.recap_id        IS DISTINCT FROM OLD.recap_id
     OR NEW.divisi          IS DISTINCT FROM OLD.divisi
     OR NEW.jumlah_produksi IS DISTINCT FROM OLD.jumlah_produksi
     OR NEW.rincian         IS DISTINCT FROM OLD.rincian THEN
    RAISE EXCEPTION '[angka produksi divisi otomatis tidak dapat diubah — ajukan Sengketa Angka jika angkanya keliru]';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wrr_divisi_no_manual_auto
    BEFORE INSERT OR UPDATE ON wrr_divisi
    FOR EACH ROW EXECUTE FUNCTION guard_wrr_divisi_no_manual_auto();

COMMENT ON FUNCTION guard_wrr_divisi_no_manual_auto() IS
  'M6D RM-B (belt) — production counts are system-born; a JWT actor may never '
  'insert a wrr_divisi row and may only move its sengketa note (RM-B6). A NULL '
  'JWT actor is the system aggregation (D-03/D-06). Braces = RLS WITH CHECK.';

-- ===========================================================================
-- 3. RLS write policies (braces). D-01 enabled RLS + granted only SELECT; D-03
--    opens the write path, fenced by WITH CHECK to owned recaps. Latent on the
--    service-role write path (BYPASSRLS), but the invariant demands the second
--    wall.
-- ===========================================================================

-- wrr_metrik: INSERT only a `manual` row, only on a recap the actor may write.
-- (Under RLS the caller is always JWT-identified, so `sumber='otomatis'` never
-- passes here; the trigger is what stops the service-role path.) UPDATE scoped
-- to owned recaps on both ends — the column-level auto-immutability is the
-- trigger's half (RLS WITH CHECK cannot compare OLD to NEW).
GRANT INSERT, UPDATE ON public.wrr_metrik TO authenticated;
CREATE POLICY wrr_metrik_insert ON public.wrr_metrik FOR INSERT TO authenticated
WITH CHECK (private.jwt_can_write_recap(recap_id) AND sumber = 'manual');
CREATE POLICY wrr_metrik_update ON public.wrr_metrik FOR UPDATE TO authenticated
USING (private.jwt_can_write_recap(recap_id))
WITH CHECK (private.jwt_can_write_recap(recap_id));

-- wrr_divisi: UPDATE only (the sengketa note) — never INSERT, because a
-- division production row is always system-born. Scoped to owned recaps.
GRANT UPDATE ON public.wrr_divisi TO authenticated;
CREATE POLICY wrr_divisi_update ON public.wrr_divisi FOR UPDATE TO authenticated
USING (private.jwt_can_write_recap(recap_id))
WITH CHECK (private.jwt_can_write_recap(recap_id));
