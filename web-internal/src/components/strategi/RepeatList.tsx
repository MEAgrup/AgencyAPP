'use client';

/**
 * A-13 — the repeatable-struct editor Sections C, E, G, H and I all need.
 *
 * §4 marks eight fields "Repeatable struct" (C-5, C-7, E-12, G-1, G-2, H-1,
 * I-2 …). Writing eight bespoke list editors would produce eight slightly
 * different answers to "what does the remove button do to a row the AM is
 * halfway through typing", so the behaviour lives here once.
 *
 * ## Two decisions that are easy to get wrong
 *
 * **Rows are keyed by a stable local id, never by array index.** React reuses
 * DOM by key; with index keys, removing row 2 of 4 makes row 3's input keep row
 * 2's DOM node — the AM sees the text they just deleted reappear one row up,
 * and the value that is actually submitted is not the one on screen. This is
 * the single most common bug in list editors and it is invisible in a snapshot
 * test.
 *
 * **The minimum is shown, not enforced.** G-1 needs two phases and H-1 needs
 * one risk, but the remove button never refuses: the AM may legitimately be
 * mid-edit with one row while they retype the others. The submit gate reports
 * the shortfall (§5 step 5) and the server refuses the submit — the same split
 * every other required field uses, and the reason `checkCompleteness` returns a
 * list instead of a first error.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface RepeatListProps<T> {
  /** Section label, e.g. "G-1 · Fase kerja". */
  label: string;
  /** What the AM is answering, in their words. Rendered under the label. */
  hint?: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  /** A blank row. Called when the AM adds one. */
  blank: () => T;
  /** Renders one row's fields. `set` merges a patch into that row. */
  children: (row: T, set: (patch: Partial<T>) => void, index: number) => ReactNode;
  disabled?: boolean;
  /** Shown as guidance only — never enforced here. See the module note. */
  min?: number;
  /**
   * A ceiling the server actually enforces (B-3.3 top-5 SKU, B-9.1 kompetitor).
   * Unlike `min` this DOES hide the add button: the minimum is a shortfall the
   * AM is on their way to fixing, while a row past the maximum is a guaranteed
   * rejection — offering the button would only produce it.
   */
  max?: number;
  addLabel?: string;
  /** Shown when there are no rows at all. */
  empty?: string;
}

/**
 * Local identity for rows. Kept OUTSIDE the row data so it never reaches the
 * wire: these ids exist for React, and a `_key` leaking into a PUT body would
 * be a field the server has to ignore — or worse, silently store.
 */
interface Keyed<T> {
  key: string | number;
  row: T;
}

export default function RepeatList<T>({
  label,
  hint,
  rows,
  onChange,
  blank,
  children,
  disabled = false,
  min,
  max,
  addLabel = 'Tambah baris',
  empty = 'Belum ada baris.',
}: RepeatListProps<T>) {
  // Seeded from the incoming rows, then maintained by the handlers below.
  // Re-deriving keys from `rows` on every render would defeat the whole point:
  // the keys have to survive the array changing.
  const [keys, setKeys] = useState<number[]>(() => rows.map((_, i) => i));
  const nextKey = useRef(rows.length);

  // The parent replaces the whole list after every save (each section endpoint
  // returns a fresh StrategiDetail). Reconciling in an effect rather than during
  // render is not a lint concession: a render that both reads and writes this
  // state produces a different key list depending on when it runs.
  useEffect(() => {
    setKeys((prev) => {
      if (prev.length === rows.length) return prev;
      const grown = prev.slice(0, rows.length);
      while (grown.length < rows.length) {
        grown.push(nextKey.current);
        nextKey.current += 1;
      }
      return grown;
    });
  }, [rows.length]);

  // For the one render between an external growth and the effect above, the
  // extra rows get a `pending-` key. It is a STRING, so it cannot collide with
  // the numeric counter, and when the real key arrives that row remounts —
  // which is correct for a row that just came from the server.
  const keyed: Keyed<T>[] = rows.map((row, i) => ({
    key: i < keys.length ? keys[i] : `pending-${i}`,
    row,
  }));

  const setAt = useCallback(
    (index: number, patch: Partial<T>) => {
      onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    },
    [rows, onChange],
  );

  const add = useCallback(() => {
    setKeys((k) => {
      const key = nextKey.current;
      nextKey.current += 1;
      return [...k, key];
    });
    onChange([...rows, blank()]);
  }, [rows, onChange, blank]);

  const removeAt = useCallback(
    (index: number) => {
      setKeys((k) => k.filter((_, i) => i !== index));
      onChange(rows.filter((_, i) => i !== index));
    },
    [rows, onChange],
  );

  const kurang = min !== undefined && rows.length < min;
  const penuh = max !== undefined && rows.length >= max;

  return (
    <div className="field" style={{ display: 'block' }}>
      <label style={{ fontWeight: 600 }}>{label}</label>
      {hint ? (
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          {hint}
        </p>
      ) : null}

      {keyed.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          {empty}
        </p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {keyed.map(({ key, row }, i) => (
            <div
              key={key}
              style={{
                border: '1px solid var(--border, #e2e2e2)',
                borderRadius: 6,
                padding: 10,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                {children(row, (patch) => setAt(i, patch), i)}
              </div>
              {!disabled && (
                <button
                  type="button"
                  className="btn btnGhost btnSm"
                  onClick={() => removeAt(i)}
                  aria-label={`Hapus baris ${i + 1}`}
                >
                  Hapus
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {kurang && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Minimal {min} baris untuk bisa diajukan — sekarang {rows.length}.
        </p>
      )}

      {penuh && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Maksimal {max} baris — hapus salah satu dulu untuk menambah yang lain.
        </p>
      )}

      {!disabled && !penuh && (
        <button type="button" className="btn btnSecondary btnSm" style={{ marginTop: 8 }} onClick={add}>
          {addLabel}
        </button>
      )}
    </div>
  );
}
