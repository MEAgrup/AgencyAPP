-- =============================================================================
-- M6D — Rekap Hasil Mingguan: FREEZE-AS-OF-CLOSE (RAB Wave-2 gap audit, Kelas A1)
-- =============================================================================
-- Defect: `wrr_aggregate` ran exactly ONCE per recap — inside `wrr_monday_job`
-- at week-open (Terjadwal→Terbuka), when the recap window is the week just
-- STARTING and `audit_log` holds no production for it yet. Nothing re-ran the
-- aggregator afterward (neither `getRecapDetail`, `closeRecap`, nor the daily
-- reminder tick), so both close paths — AM `closeRecap` and the Monday-job
-- force-close (→Ditutup Otomatis) — froze the empty week-open numbers, defeating
-- the module's purpose and feeding empty rollups into M6B PE-3/PE-8 and the H-1
-- health summary. STATE_MACHINES §15 states the auto figures are "dibekukan
-- as-of penutupan" — this makes that literally true.
--
-- Fix: one trigger on `weekly_result_recap` that re-runs `wrr_aggregate` at the
-- moment status enters a closed state (`Ditutup` OR `Ditutup Otomatis`). It sits
-- in ONE place and therefore covers BOTH close paths without rewriting the
-- ~100-line `wrr_monday_job`. `wrr_aggregate` is idempotent and preserves
-- `sengketa` + manual rows, so re-running it at close only refreshes the
-- read-only `otomatis` figures from the now-complete audit_log window.
--
-- Dispute-safety: re-running the aggregator at close must NOT overwrite a figure
-- the AM has disputed (`sengketa` filed) — RM Rule 7, "dispute never mutates the
-- figure". The two write primitives are therefore hardened to skip disputed rows
-- (`sengketa IS NULL`). At week-open no dispute exists yet, so this is a no-op on
-- the open path; it only bites when re-aggregation happens after a dispute (i.e.
-- at close). `wrr__upsert_metrik` already guarded `sumber='otomatis'` (manual rows
-- untouched); `wrr__upsert_divisi` had no guard at all.
--
-- NO new table / machine / prefix / notification event — trigger + functions
-- only. Table/machine gates unchanged.
-- =============================================================================

-- --- dispute-safe write primitives (add `sengketa IS NULL` to the upsert guard)
CREATE OR REPLACE FUNCTION wrr__upsert_metrik(p_recap text, p_metrik text, p_nilai numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  INSERT INTO wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
  VALUES (p_recap, p_metrik, 'otomatis', p_nilai, 'SYSTEM')
  ON CONFLICT (recap_id, metrik) DO UPDATE
    SET nilai = EXCLUDED.nilai, updated_at = now()
    WHERE wrr_metrik.sumber = 'otomatis' AND wrr_metrik.sengketa IS NULL
$$;

CREATE OR REPLACE FUNCTION wrr__upsert_divisi(p_recap text, p_divisi text, p_jumlah integer, p_rincian jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  INSERT INTO wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
  VALUES (p_recap, p_divisi, p_jumlah, p_rincian, 'SYSTEM')
  ON CONFLICT (recap_id, divisi) DO UPDATE
    SET jumlah_produksi = EXCLUDED.jumlah_produksi,
        rincian         = EXCLUDED.rincian,
        updated_at      = now()
    WHERE wrr_divisi.sengketa IS NULL
$$;

CREATE OR REPLACE FUNCTION wrr_reaggregate_on_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Freeze-as-of-close: refresh the read-only auto figures from the now-complete
  -- audit_log window at the instant the recap closes, so the frozen snapshot
  -- reflects the week's real production instead of the empty week-open aggregate.
  -- Idempotent; wrr_aggregate preserves sengketa + manual rows.
  PERFORM wrr_aggregate(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION wrr_reaggregate_on_close() IS
  'M6D — re-run wrr_aggregate when a recap enters Ditutup/Ditutup Otomatis so the '
  'frozen auto figures reflect the week''s real production (freeze-as-of-close, '
  'STATE_MACHINES §15). Covers both the AM closeRecap and the Monday-job '
  'force-close paths in one place.';

DROP TRIGGER IF EXISTS trg_wrr_reaggregate_on_close ON weekly_result_recap;
CREATE TRIGGER trg_wrr_reaggregate_on_close
  AFTER UPDATE OF status ON weekly_result_recap
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('Ditutup', 'Ditutup Otomatis'))
  EXECUTE FUNCTION wrr_reaggregate_on_close();
