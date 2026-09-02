-- Fix: `GET /api/v1/briefs/{id}/stage` (M16 Tahapan Produksi) 500s with
-- "permission denied for table hari_libur" for every division/AM viewer.
--
-- ROOT CAUSE. `working_days_between` (`20260813000000_kelola_klien_sla.sql`)
-- was built for Kelola Klien SLA, always invoked through the privileged `db()`
-- connection (`interview.getKelolaKlienTimeline`'s route uses `db()`, not
-- `readAsActor`) — so `hari_libur` was deliberately locked to "default-deny
-- total ... dibaca hanya lewat route service-role" (that migration's own
-- comment), no GRANT to `authenticated`/`anon`, RLS enabled with zero policies.
--
-- M16's Brief stage lead time (`leadtime.computeStageLeadTime`, added
-- 2026-08-29/30) reused the same SQL helper (`packages/domain/src/leadtime.ts`
-- `workingDays`) but is called from `stage.getStageOverview` through
-- `readAsActor` (`apps/api/.../briefs/[id]/stage/route.ts`) — i.e. under the
-- RLS-scoped `authenticated` role, for the first time. `working_days_between`
-- is a plain SECURITY INVOKER function, so it ran with the CALLER's
-- privileges and hit the `hari_libur` lockout — confirmed in production
-- (Vercel runtime errors, route=/api/v1/briefs/[id]/stage, code 42501,
-- hint "GRANT SELECT ON public.hari_libur TO authenticated").
--
-- FIX. Same class as O52 (`20260807150000_o52_brief_owner_am.sql`): make the
-- narrow computed helper SECURITY DEFINER rather than widening the GRANT on
-- the raw table. `working_days_between` only ever returns an integer count —
-- never a `hari_libur` row — so letting every authenticated caller reach the
-- FUNCTION (already PUBLIC-executable; unchanged here) does not expose the
-- calendar itself, which stays exactly as locked down as the original design
-- intended (no GRANT on `hari_libur`, RLS enabled, zero policies, table only
-- ever read from inside this function's SECURITY DEFINER body).
CREATE OR REPLACE FUNCTION public.working_days_between(d_from date, d_to date)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN d_from IS NULL OR d_to IS NULL OR d_to <= d_from THEN 0
        ELSE (
            SELECT count(*)::int
              FROM generate_series(d_from + 1, d_to, interval '1 day') AS g(d)
             WHERE extract(isodow FROM g.d) < 6          -- 1..5 = Sen..Jum
               AND NOT EXISTS (SELECT 1 FROM hari_libur h WHERE h.tanggal = g.d::date)
        )
    END
$$;

COMMENT ON FUNCTION public.working_days_between(date, date) IS
  'Hari kerja Sen-Jum minus hari_libur. SECURITY DEFINER sejak 2026-09-07 (lihat '
  'migrasi ini) supaya caller RLS-scoped (readAsActor, mis. M16 brief stage lead '
  'time) tetap bisa memanggilnya walau hari_libur sendiri tetap default-deny untuk '
  'authenticated/anon (kalender hanya boleh dibaca lewat fungsi terhitung ini).';
