-- ===========================================================================
-- M6B / backlog B-05 — weekly distribution is DERIVED, and its quota must
-- balance (PRD M6B Rule 7 / P1).
--
-- B-01 gave `plan_row_week` its shape (one row per work-row × week) and noted
-- the sum rule lands here. This migration is that rule, enforced in the DB, not
-- just TS (house convention: "penegakan aturan ada di DB"):
--
--   A `plan_row` either has NO weekly rows yet (before activation splits it) OR
--   its weekly quotas sum EXACTLY to the monthly quota. Never a silent partial —
--   a re-drag that leaves the weeks short of the month is the whole failure Rule
--   7's "weekly total must always equal the monthly quota" exists to stop.
--
-- The check is a DEFERRABLE INITIALLY DEFERRED constraint trigger so a multi-row
-- distribution (insert 4-6 weeks, or delete-then-reinsert on a re-drag) is only
-- judged once, at COMMIT, on its final state — the intermediate rows are never a
-- valid-but-unbalanced snapshot the trigger would wrongly reject.
--
-- The rejection names the row id and the delta (not a generic "constraint
-- violated"), because the caller re-dragging a distribution needs to know WHICH
-- row is off and BY HOW MUCH.
-- ===========================================================================

CREATE OR REPLACE FUNCTION check_plan_row_week_sum()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_row_id bigint;
    v_kuota  numeric(18,2);
    v_sum    numeric(18,2);
    v_cnt    integer;
BEGIN
    -- The affected work-row: NEW.id when fired by a plan_row quota change,
    -- otherwise the (old or new) parent of the weekly row.
    IF TG_TABLE_NAME = 'plan_row' THEN
        v_row_id := NEW.id;
    ELSE
        v_row_id := COALESCE(NEW.plan_row_id, OLD.plan_row_id);
    END IF;

    -- The parent may have been cascade-deleted by the time this deferred check
    -- runs (deleting a plan_row removes its weeks). Nothing to balance then.
    SELECT kuota INTO v_kuota FROM plan_row WHERE id = v_row_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(kuota), 0), COUNT(*) INTO v_sum, v_cnt
      FROM plan_row_week WHERE plan_row_id = v_row_id;

    -- No weeks yet = not distributed = valid. Weeks present = must balance.
    IF v_cnt > 0 AND v_sum <> v_kuota THEN
        RAISE EXCEPTION
          '[distribusi mingguan baris % tidak sama dengan kuota bulanan: selisih %]',
          v_row_id, (v_kuota - v_sum);
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION check_plan_row_week_sum() IS
  'M6B Rule 7 — a plan_row has zero weekly rows or weekly quotas summing exactly '
  'to its monthly quota. Deferred constraint trigger; checks at commit.';

-- Fires on any change to the weekly rows …
CREATE CONSTRAINT TRIGGER trg_plan_row_week_sum
    AFTER INSERT OR UPDATE OR DELETE ON plan_row_week
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_plan_row_week_sum();

-- … and on a monthly-quota change to the parent, which would unbalance existing
-- weeks (the quota can move even after weeks are laid down).
CREATE CONSTRAINT TRIGGER trg_plan_row_kuota_week_sum
    AFTER UPDATE OF kuota ON plan_row
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_plan_row_week_sum();
