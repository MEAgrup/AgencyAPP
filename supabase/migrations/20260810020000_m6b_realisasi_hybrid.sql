-- CDPS — Module 6B / backlog B-06: realisasi hybrid (Section P-E, Rule 10/11).
--
-- The shape of `plan_actual` landed with B-01 (`sumber ∈ manual/otomatis`,
-- `ck_plan_actual_manual_bukti`, `ck_plan_actual_sengketa`). What B-06 adds is
-- the one guardrail B-01 deferred, and the PRD frames as a **frozen invariant**:
--
--   §8 / Rule 10 — "An AM cannot overwrite an auto metric; they can file a
--   `Sengketa Angka` note against it." PLAN_ACTUAL `otomatis` rows are
--   "UPDATE-blocked at the DB level for AM roles (belt and braces with RLS —
--   TS predicate and RLS must not diverge)."
--
-- ===========================================================================
-- The rule, and where each half lives
-- ===========================================================================
-- ONE authorization rule, expressed in three places that MUST agree
-- (`packages/domain/src/plan.reals.test.ts` asserts they do not diverge — the
-- same invariant class as `reads_rls.test.ts`):
--
--   * `otomatis` rows are written ONLY by the system (execution modules / the
--     B-09 job, running service-role with NO JWT actor). No authenticated human
--     — AM or SPV — may INSERT one or overwrite one's value. This is stricter
--     than the PRD's literal "AM cannot overwrite" (silent on SPV) and is a
--     deliberate, logged deviation: the PRD gives no manual-override path for
--     anyone, and house rule #4 forbids typing an auto field by hand at all
--     (auto fields are recomputable from the event log, never user-entered). A
--     wrong auto number is challenged (`Sengketa Angka`) and corrected by a
--     re-sync from the source module, not overtyped. (DECISIONS 2026-08-10.)
--   * The ONE column an authenticated AM may change on an `otomatis` row is
--     `sengketa` (PE-6) — the dispute note itself.
--   * `manual` rows (GMV, PE-1) are the AM's to write, scoped to Plans they own.
--
-- Belt (fires on EVERY connection, incl. the BYPASSRLS owner/service-role write
-- path where RLS never engages): trigger `guard_plan_actual_no_manual_auto`.
-- It distinguishes system from human by the PRESENCE of a JWT actor
-- (`jwt_employee_id()` — NULL under service-role, set under `withClaims`), so a
-- system ingestion is waved through and only a real authenticated actor is
-- gated.
--
-- Braces: RLS `WITH CHECK` — an authenticated writer may only produce `manual`
-- rows, and only on Plans they may write (`private.jwt_can_write_plan`). Latent
-- on the normal service-role write path, but the second wall the invariant
-- demands.
--
-- No new table / machine / event / prefix — the shape already exists, so every
-- structural gate (89 tables · 17 machines · 34 events · 31 prefix) is
-- unchanged. Post-close amendments (Rule 11) are recorded in `audit_log`
-- (append-only, already the source of the "visible on the period view"
-- history), NOT a new column — so B-06 adds no storage. (DECISIONS 2026-08-10.)

-- ===========================================================================
-- 1. Write-scope helper — mirrors `canWritePlan` (owning AM OR Account lead).
--    SECURITY DEFINER so the join to `plan`/`clients` is not itself RLS-filtered
--    (same reason as `private.jwt_can_read_plan`, B-01). It is the WRITE twin of
--    that READ helper: read scope adds OD/Director (read-all); write scope does
--    NOT (Role Matrix: OD is read-only), so this is a distinct function, not an
--    alias.
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.jwt_can_write_plan(p_plan_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
      FROM public.plan p
      JOIN public.clients c ON c.id = p.client_id
     WHERE p.id = p_plan_id
       AND ( (public.jwt_is_lead() AND public.jwt_division() = 'Account')
             OR c.assigned_am_id = public.jwt_employee_id() )
  )
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_can_write_plan(text) FROM anon;

-- ===========================================================================
-- 2. The DB-level block (belt) — a trigger, because it must fire even for the
--    BYPASSRLS owner/service-role connection that all domain writes use.
--
--    `jwt_employee_id()` is the system-vs-human signal: NULL when no JWT claims
--    are published (the service-role write path / the B-09 job / raw owner
--    inserts), non-NULL under `withClaims`. A NULL actor is the trusted system
--    ingestion and is waved through; a real actor is gated.
-- ===========================================================================
CREATE OR REPLACE FUNCTION guard_plan_actual_no_manual_auto()
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
  -- (PE-6). Its value and identity are the source module's, not the AM's.
  IF OLD.sumber = 'otomatis' THEN
    IF NEW.nilai         IS DISTINCT FROM OLD.nilai
       OR NEW.sumber        IS DISTINCT FROM OLD.sumber
       OR NEW.channel       IS DISTINCT FROM OLD.channel
       OR NEW.metric        IS DISTINCT FROM OLD.metric
       OR NEW.file_bukti    IS DISTINCT FROM OLD.file_bukti
       OR NEW.tanggal_ambil IS DISTINCT FROM OLD.tanggal_ambil THEN
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

CREATE TRIGGER trg_plan_actual_no_manual_auto
    BEFORE INSERT OR UPDATE ON plan_actual
    FOR EACH ROW EXECUTE FUNCTION guard_plan_actual_no_manual_auto();

COMMENT ON FUNCTION guard_plan_actual_no_manual_auto() IS
  'M6B Rule 10 (belt) — a JWT-identified actor may not insert/overwrite an '
  'otomatis plan_actual metric; only the sengketa note may change on it. A NULL '
  'JWT actor is the system ingestion (B-09) and is allowed. Paired with the RLS '
  'WITH CHECK (braces) and the TS write path — the three must not diverge.';

-- ===========================================================================
-- 3. RLS write policies (braces). The baseline (20260723064438) revoked ALL and
--    granted only SELECT to `authenticated`; B-06 opens INSERT/UPDATE, fenced by
--    WITH CHECK to owned Plans and `manual` rows. Latent on the service-role
--    write path (BYPASSRLS), but the invariant demands the second wall.
-- ===========================================================================
GRANT INSERT, UPDATE ON public.plan_actual TO authenticated;

-- INSERT: only a `manual` row, only on a Plan the actor may write. (Under RLS
-- the caller is always JWT-identified, so `sumber='otomatis'` never passes here;
-- the trigger is what stops the service-role path.)
CREATE POLICY plan_actual_insert ON public.plan_actual FOR INSERT TO authenticated
WITH CHECK (private.jwt_can_write_plan(plan_id) AND sumber = 'manual');

-- UPDATE: scoped to owned Plans on both ends. The column-level rule (an auto
-- row's value is immutable, only its sengketa may move) is the trigger's — RLS
-- WITH CHECK cannot compare OLD to NEW, so scope is its half of the wall.
CREATE POLICY plan_actual_update ON public.plan_actual FOR UPDATE TO authenticated
USING (private.jwt_can_write_plan(plan_id))
WITH CHECK (private.jwt_can_write_plan(plan_id));
