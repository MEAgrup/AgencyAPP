/**
 * A-13c — the rule-bearing half of Section D (D-1/D-2/D-4 targets, D-8/D-9
 * assumptions), kept framework-free so it can be tested without a browser.
 *
 * The same split `strategi-sections.ts` uses, and for the same reason: what
 * decides whether the form works is not the JSX, it is (a) whether the target
 * key the form builds is byte-identical to the one the server builds, and (b)
 * whether the "which target has no assumption" answer the AM reads matches the
 * one Rule 8 will apply at submit. Both fail SILENTLY when they drift — the AM
 * sees a green panel and gets `[setiap target harus punya asumsi …]`.
 *
 * ## The one contract that must not drift: the target key
 *
 * `strategi_assumption.target_terkait` stores references as
 * `metric:channel:month_index`, built by `targetKey` in
 * `packages/domain/src/strategi.ts`. `saveAssumptions` REFUSES any key that does
 * not name a real `strategi_target` row (`MSG_ASSUMPTION_TARGET_UNKNOWN`), and
 * `checkCompleteness` computes Rule 8 coverage by set-membership over the same
 * string. So this format is a wire contract, not a local convention: it has to
 * be reproduced here to offer D-9 checkboxes for targets the AM just typed and
 * has not saved yet. `targetKey` below is that reproduction, and
 * `strategi-target.test.ts` pins the exact strings.
 *
 * ## Why a half-filled GMV cell is reported, not sent, and not dropped
 *
 * A GMV target row cannot exist half-written: `nilai_stretch` is NOT NULL and
 * `ck_strtg_stretch_gmv` requires `nilai_floor IS NOT NULL` alongside it. So a
 * cell with only one of the two typed has three possible fates, and two are bugs:
 *
 * - **Send it** ⇒ the whole section save fails `[data tidak lengkap …]` every
 *   20 seconds while the AM types their way across a 12-month grid, and the
 *   complete cells beside it never land either.
 * - **Drop it silently** ⇒ the O43 class the SESI10 handoff opened with: route
 *   answers 200, the number is gone on next load, nothing said so.
 * - **Skip it and SAY SO** ⇒ what `gmvCellsToBody` does. The complete cells
 *   save, and `incomplete` names every cell that did not, for the component to
 *   render. The submit gate still reports `D-2/{channel}` — this only decides
 *   what the AM is told between now and then.
 */

/** Same order and separator as `targetKey` in `packages/domain/src/strategi.ts`. */
export function targetKey(metric: string, channel: string, monthIndex: number): string {
  return `${metric}:${channel}:${monthIndex}`;
}

/**
 * One cell of the D-1/D-2 matrix: one channel, one month.
 *
 * Both figures are STRINGS, not numbers — they are money on the wire
 * (`numeric(18,2)`), and an empty box is `''`, which is a different answer from
 * `0`. Parsing them to numbers here would make "belum diisi" and "target nol"
 * the same state, which is exactly the distinction the submit gate reports on.
 */
export interface GmvCell {
  channel: string;
  /** 1-based, matching `ck_strtg_month CHECK (month_index BETWEEN 1 AND 36)`. */
  month_index: number;
  /** D-1 contract floor. `sumber_floor` is NOT sent — the server owns it (O57). */
  nilai_floor: string;
  /** D-2 stretch. Rule 7 (`stretch >= floor`) is the DB's CHECK, not ours. */
  nilai_stretch: string;
}

/** D-4 — a supporting-metric target. One row, any metric except the GMV matrix. */
export interface SupportTargetRow {
  channel: string;
  month_index: number;
  metric: string;
  nilai_stretch: string;
}

/** D-8 + D-9 as the form holds them. `target_terkait` is D-9. */
export interface AssumptionRow {
  kode: string;
  asumsi: string;
  pemilik: string;
  cara_verifikasi: string;
  target_terkait: string[];
}

/** What `PUT /strategi/{id}/targets` accepts, snake_case per the wire boundary. */
export interface TargetWireRow {
  channel: string;
  month_index: number;
  metric: string;
  nilai_floor: string | null;
  nilai_stretch: string;
}

interface TargetRowLike {
  channel: string;
  month_index: number;
  metric: string;
  nilai_floor: string | null;
  nilai_stretch: string;
}

const blank = (s: string): boolean => s.trim() === '';

/**
 * Builds the full channel × month grid, seeded from whatever is already saved.
 *
 * FULL, not sparse: §4 calls D-2 a "Currency matrix (bulan × channel)" and the
 * submit gate wants a GMV row for every contracted channel, so every cell is
 * rendered whether or not it has a value. A grid that only showed saved rows
 * would open empty on a fresh Strategi and give the AM nothing to type into.
 *
 * Months run 1…`durasi`, matching `ck_strtg_month` — NOT 0-based like
 * `strategi_baseline_bulan`. The two really do differ: a baseline month is an
 * offset into a past window, a target month is contract month M1.
 */
export function gmvGridOf(
  channels: readonly { channel: string }[],
  durasi: number,
  saved: readonly TargetRowLike[],
): GmvCell[] {
  const n = Number.isFinite(durasi) ? Math.max(0, Math.trunc(durasi)) : 0;
  const byKey = new Map<string, TargetRowLike>();
  for (const t of saved) {
    if (t.metric === 'gmv') byKey.set(targetKey('gmv', t.channel, t.month_index), t);
  }
  const out: GmvCell[] = [];
  for (const c of channels) {
    for (let m = 1; m <= n; m += 1) {
      const hit = byKey.get(targetKey('gmv', c.channel, m));
      out.push({
        channel: c.channel,
        month_index: m,
        nilai_floor: hit?.nilai_floor ?? '',
        nilai_stretch: hit?.nilai_stretch ?? '',
      });
    }
  }
  return out;
}

/** D-4 rows as the form holds them — sparse, because D-4 is per metric the AM chose. */
export function supportRowsOf(saved: readonly TargetRowLike[]): SupportTargetRow[] {
  return saved
    .filter((t) => t.metric !== 'gmv')
    .map((t) => ({
      channel: t.channel,
      month_index: t.month_index,
      metric: t.metric,
      nilai_stretch: t.nilai_stretch,
    }));
}

/**
 * Splits the grid into rows that can be saved and cells that cannot.
 *
 * See the module note: a GMV cell needs BOTH figures or it is not a row the DB
 * can hold. `incomplete` is the list the component must render — dropping it
 * would be the silent-loss bug this ticket exists to stop repeating.
 */
export function gmvCellsToBody(cells: readonly GmvCell[]): {
  rows: TargetWireRow[];
  incomplete: GmvCell[];
} {
  const rows: TargetWireRow[] = [];
  const incomplete: GmvCell[] = [];
  for (const c of cells) {
    const floor = c.nilai_floor.trim();
    const stretch = c.nilai_stretch.trim();
    if (floor === '' && stretch === '') continue; // untouched, not half-typed
    if (floor === '' || stretch === '') {
      incomplete.push(c);
      continue;
    }
    rows.push({
      channel: c.channel,
      month_index: c.month_index,
      metric: 'gmv',
      nilai_floor: floor,
      nilai_stretch: stretch,
    });
  }
  return { rows, incomplete };
}

/**
 * D-4 rows for the wire. `nilai_floor` is always null — `ck_strtg_floor_gmv_only`
 * refuses a floor on any other metric, and D-1 is a contract figure that only
 * exists for GMV.
 */
export function supportRowsToBody(rows: readonly SupportTargetRow[]): TargetWireRow[] {
  return rows
    .filter((r) => !blank(r.channel) && !blank(r.metric) && !blank(r.nilai_stretch))
    .map((r) => ({
      channel: r.channel.trim(),
      month_index: r.month_index,
      metric: r.metric.trim(),
      nilai_floor: null,
      nilai_stretch: r.nilai_stretch.trim(),
    }));
}

/**
 * Every GMV target the D-9 picker may offer — i.e. the cells that will actually
 * exist after this save.
 *
 * Derived from the DRAFT, not from `detail.targets`, because the AM types the
 * matrix and the assumptions in the same section and the same save. Offering
 * only saved targets would make D-9 unusable on a fresh Strategi: the checkbox
 * list would be empty until after the first save, and the AM would have no way
 * to know why.
 */
export function offerableTargetKeys(cells: readonly GmvCell[]): string[] {
  return gmvCellsToBody(cells).rows.map((r) => targetKey('gmv', r.channel, r.month_index));
}

/**
 * Rule 8, computed the way `checkCompleteness` computes it: the GMV targets no
 * assumption names.
 *
 * Returned in grid order rather than as a Set so the component can list them —
 * "minimal 3 asumsi" is not the failure the AM hits second, "Mei belum ditutup"
 * is, and a count cannot say which month.
 */
export function uncoveredTargetKeys(
  cells: readonly GmvCell[],
  assumptions: readonly AssumptionRow[],
): string[] {
  const covered = new Set(assumptions.flatMap((a) => a.target_terkait));
  return offerableTargetKeys(cells).filter((k) => !covered.has(k));
}

/**
 * Drops D-9 references to targets that no longer exist, and de-duplicates.
 *
 * Necessary because the two halves of Section D move independently: the AM ties
 * an assumption to M7, then shortens the contract or clears that cell, and the
 * reference is now dangling. `saveAssumptions` refuses the WHOLE call for one
 * dangling key (`MSG_ASSUMPTION_TARGET_UNKNOWN`), so without this the AM would
 * be locked out of saving Section D by a checkbox they can no longer see.
 *
 * Silent on purpose, and this is the one place in this file where silence is
 * right: the target is visibly gone from the matrix directly above, so the
 * reference to it is not information the AM has lost — it is a checkbox that
 * stopped existing when they removed the thing it pointed at.
 */
export function pruneTargetTerkait(
  assumptions: readonly AssumptionRow[],
  known: readonly string[],
): AssumptionRow[] {
  const ok = new Set(known);
  return assumptions.map((a) => ({
    ...a,
    target_terkait: [...new Set(a.target_terkait.filter((k) => ok.has(k)))],
  }));
}

/**
 * D-8 rows for the wire, dropping rows the AM added and never filled.
 *
 * A row is kept when ANY of its four required parts is typed: it is then a real
 * attempt, and the server's `[data tidak lengkap …]` is the correct answer to
 * it. A row where all four are blank is the empty row `RepeatList` just added —
 * sending that would make "clicked Tambah" indistinguishable from "wrote half an
 * assumption", and the AM would be blocked from saving by a box they had not
 * started typing in.
 */
export function assumptionsToBody(rows: readonly AssumptionRow[]): AssumptionRow[] {
  return rows.filter(
    (a) =>
      !blank(a.kode) || !blank(a.asumsi) || !blank(a.pemilik) || !blank(a.cara_verifikasi),
  );
}

/** Splits `metric:channel:monthIndex` back apart for display. Channels never contain `:`. */
export function readTargetKey(key: string): { metric: string; channel: string; month: number } | null {
  const first = key.indexOf(':');
  const last = key.lastIndexOf(':');
  if (first < 0 || last <= first) return null;
  const month = Number(key.slice(last + 1));
  if (!Number.isInteger(month)) return null;
  return { metric: key.slice(0, first), channel: key.slice(first + 1, last), month };
}
