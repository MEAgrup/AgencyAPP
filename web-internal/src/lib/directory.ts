'use client';

// Data layer for the assignable-employee directory (GET /employees/assignable).
//
// One endpoint serves every assignment door; the caller passes the division and
// level ITS door validates, so the dropdown offers exactly what the server will
// accept (see packages/domain/src/directory.ts — the SQL predicate mirrors
// `validateAMCandidate` / `validatePicForDivision` / `validateCreativeStaff` /
// `validateKolStaff`).
//
// The pure logic (label + search) lives in `lib/employee-picker.ts` so it can be
// unit-tested; this file only fetches.

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AssignableEmployee } from '@/lib/types';

/** Level every assignment door accepts today — a single accountable PIC/AM. */
export const LEVEL_STAFF = 'staff';

/**
 * GET /employees/assignable[?division=&level=] → {data: AssignableEmployee[]}.
 * Ordered by the server (division → staff first → nama); never re-sorted here,
 * so the dropdown looks the same on every load.
 */
export function listAssignableEmployees(
  division?: string,
  level?: string,
): Promise<{ data: AssignableEmployee[] }> {
  const qs = new URLSearchParams();
  if (division) qs.set('division', division);
  if (level) qs.set('level', level);
  const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
  return api.get<{ data: AssignableEmployee[] }>(`/employees/assignable${suffix}`);
}

/**
 * Loads the directory for one door. Shared by nine call sites, so the loading /
 * error / re-fetch-on-division-change plumbing exists once.
 *
 * `enabled` is for the pages that only render an assignment control for some
 * roles: an actor who cannot assign should not fire the request at all (the
 * server would answer 403 and the page would show an error for a control it is
 * not even displaying).
 *
 * A failed load is surfaced by the picker rather than swallowed: an empty
 * dropdown with no explanation is the same dead end as the free-text box it
 * replaced.
 */
export function useAssignableEmployees(
  division: string | undefined,
  level: string | undefined,
  enabled = true,
): {
  employees: AssignableEmployee[] | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [employees, setEmployees] = useState<AssignableEmployee[] | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await listAssignableEmployees(division, level);
      setEmployees(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setEmployees(null);
    } finally {
      setLoading(false);
    }
  }, [division, level, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { employees, loading, error, reload };
}
