'use client';

/**
 * A-13 / M6A §7 — "autosave every 20 seconds".
 *
 * Section A alone is sixteen fields and Section B is ~45 per channel; the PRD
 * asks for autosave because losing that to a closed tab is the difference
 * between a form AMs fill and a form AMs avoid.
 *
 * ## The three things this gets right, and why each one matters
 *
 * 1. **It saves on a quiet period, not on a wall clock.** The timer restarts on
 *    every keystroke, so a save lands 20s after the AM stops typing rather than
 *    mid-word. A fixed-interval save would race the AM's own edits and could
 *    persist a half-typed value as the last word on a field.
 *
 * 2. **It never overlaps itself.** While a save is in flight, a new change
 *    arms a follow-up instead of firing a second request. Two concurrent PUTs to
 *    the same section is a lost-update: the section endpoints replace the whole
 *    list, so the slower response wins and silently discards the newer edit.
 *
 * 3. **A failed autosave does not clear the dirty flag.** The next tick tries
 *    again, and the caller keeps showing "belum tersimpan". An autosave that
 *    swallows its own error is worse than no autosave: the AM reads the absence
 *    of an error as "saved".
 *
 * Autosave never SUBMITS. Submit is a state-machine transition with its own gate
 * (§5 step 5) and a human has to press it — Rule 12 makes approval a decision,
 * and a form that could submit itself would make "Diajukan" mean nothing.
 */

import { useCallback, useEffect, useRef } from 'react';

/** §7 says 20 seconds. Exported so the page can tell the AM what it does. */
export const AUTOSAVE_MS = 20_000;

export interface AutosaveOptions {
  /** Whether there is anything to save. Autosave is a no-op when false. */
  dirty: boolean;
  /** Whether saving is allowed at all (Draft-only; read-only roles never save). */
  enabled: boolean;
  /** The save itself. Must reject on failure — a resolved promise means saved. */
  save: () => Promise<void>;
  /** Quiet period before a save fires. Defaults to §7's 20s. */
  delayMs?: number;
}

/**
 * useAutosave arms a save `delayMs` after the last change.
 *
 * Returns `flush`, which saves immediately (used by the explicit "Simpan"
 * button and when the AM leaves a section — the pending timer is cancelled so
 * the two paths cannot both fire).
 */
export function useAutosave({ dirty, enabled, save, delayMs = AUTOSAVE_MS }: AutosaveOptions): {
  flush: () => Promise<void>;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  // Held in a ref so re-arming the timer does not depend on `save`'s identity —
  // otherwise every parent re-render would restart the quiet period and, on a
  // form that re-renders per keystroke, autosave would never fire at all.
  //
  // Updated in an effect, not during render: a ref written while rendering is
  // read by whatever ran before it in the same pass, which makes the value the
  // timer eventually calls depend on render ordering.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await saveRef.current();
    } finally {
      inFlight.current = false;
    }
  }, []);

  const flush = useCallback(async () => {
    cancel();
    await run();
  }, [cancel, run]);

  useEffect(() => {
    if (!dirty || !enabled) {
      cancel();
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      // Errors are intentionally not rethrown into the timer: the caller's
      // `save` is expected to record the failure itself and leave `dirty` set,
      // which is what arms the retry on the next change.
      void run().catch(() => undefined);
    }, delayMs);
    return cancel;
  }, [dirty, enabled, delayMs, cancel, run]);

  return { flush };
}
