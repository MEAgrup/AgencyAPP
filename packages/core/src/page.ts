/**
 * Keyset ("cursor") pagination over the house list ordering `created_at desc,
 * id desc` (P2 §6, docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md).
 *
 * Why keyset and not OFFSET: the six list reads this serves are the ones the
 * perf diagnosis found unbounded, and they are all ordered `created_at desc,
 * id desc` — the exact composite indexes P1 added. OFFSET makes the database
 * walk and discard every skipped row, so page 50 costs 50 pages of work; a
 * keyset predicate seeks straight into the index and costs the same on page 50
 * as on page 1. It is also stable under concurrent inserts: a lead registered
 * while the user is on page 3 cannot shift page 4 and duplicate a row, because
 * the cursor names a POSITION in the ordering, not a count of rows skipped.
 *
 * The SQL side is one row-value comparison, which matches the index directly:
 *
 *     and (created_at, id) < (${cursor.createdAt}, ${cursor.id})   -- desc, desc
 *
 * (Postgres compares row values lexicographically, so this is exactly "strictly
 * after the cursor row in `created_at desc, id desc` order". Both columns are
 * NOT NULL on every table this serves — a NULL either side would make the
 * comparison NULL, i.e. silently drop rows, so a new caller must check that.)
 *
 * The cursor is OPAQUE on the wire (base64url of the two key parts). That is
 * deliberate: the sort key stays an implementation detail, so it can change
 * later without breaking a stored/bookmarked cursor's shape. It carries no
 * secret and needs no signature — a tampered cursor can only start the page at
 * a different position, and RLS still decides which rows exist for the actor.
 *
 * ZERO new BI strings (same discipline as the C-tickets): a malformed cursor or
 * limit is a malformed request parameter, which is exactly what the house
 * default `bi.INCOMPLETE_DATA` already says.
 */

import * as bi from './bi';

/** Rows per page when the caller does not ask for a specific size. */
export const DEFAULT_LIMIT = 100;

/**
 * Hard ceiling on one page. A caller asking for more is clamped, not refused —
 * the point is to bound the query, and refusing would only push the caller into
 * retrying with a smaller number. Anything genuinely bulk (the Leads CSV
 * export) has its own explicit cap and does not page.
 */
export const MAX_LIMIT = 500;

/** PageCursorError — a cursor the server did not mint (400 via http.ts's name table). */
export class PageCursorError extends Error {
  constructor(message = bi.INCOMPLETE_DATA) {
    super(message);
    this.name = 'PageCursorError';
  }
}

/** The decoded position of the last row of the previous page. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

/** One page request: an already-clamped size and an optional position to resume from. */
export interface PageRequest {
  limit: number;
  cursor: Cursor | null;
}

/** One page of results plus the cursor that fetches the next one (null = last page). */
export interface Page<T> {
  rows: T[];
  nextCursor: string | null;
}

/**
 * clampLimit turns a raw `?limit=` parameter into a usable page size. Anything
 * absent, unparseable, zero or negative falls back to DEFAULT_LIMIT rather than
 * throwing — a junk limit is not worth failing a read over, and an unbounded
 * read is the very thing this module exists to prevent. Values above MAX_LIMIT
 * are clamped down.
 */
export function clampLimit(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') {
    return DEFAULT_LIMIT;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(n, MAX_LIMIT);
}

const CURSOR_SEP = '|';

/** encodeCursor mints the opaque cursor naming one row's position in the ordering. */
export function encodeCursor(createdAt: Date, id: string): string {
  const iso = createdAt.toISOString();
  return Buffer.from(`${iso}${CURSOR_SEP}${id}`, 'utf8').toString('base64url');
}

/**
 * decodeCursor parses a cursor this server minted. Every malformed shape —
 * bad base64, missing separator, unparseable timestamp, empty id — throws
 * PageCursorError rather than silently returning "start from the beginning",
 * which would quietly serve page 1 forever while the user clicks "next".
 */
export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new PageCursorError();
  }
  const sep = decoded.indexOf(CURSOR_SEP);
  if (sep <= 0) {
    throw new PageCursorError();
  }
  // The id itself never contains the separator (house IDs are
  // PREFIX-YYYYMM-NNNN), so splitting on the FIRST separator is unambiguous
  // even though an ISO timestamp contains none either.
  const iso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const createdAt = new Date(iso);
  if (id === '' || Number.isNaN(createdAt.getTime())) {
    throw new PageCursorError();
  }
  return { createdAt, id };
}

/** parseRequest builds a PageRequest from the raw query parameters of a route. */
export function parseRequest(limitRaw: string | null | undefined, cursorRaw: string | null | undefined): PageRequest {
  return {
    limit: clampLimit(limitRaw),
    cursor: cursorRaw === null || cursorRaw === undefined || cursorRaw === '' ? null : decodeCursor(cursorRaw),
  };
}

/**
 * fromOverfetch turns a `limit + 1` result set into one page. Asking for one
 * row more than the page size is how "is there a next page?" is answered
 * without a second COUNT query over the whole table: if the extra row came
 * back, there is more, and the extra row is dropped from the page.
 */
export function fromOverfetch<T>(
  fetched: readonly T[],
  limit: number,
  keyOf: (row: T) => Cursor,
): Page<T> {
  const hasMore = fetched.length > limit;
  const rows = hasMore ? fetched.slice(0, limit) : [...fetched];
  if (!hasMore || rows.length === 0) {
    return { rows, nextCursor: null };
  }
  const last = keyOf(rows[rows.length - 1]);
  return { rows, nextCursor: encodeCursor(last.createdAt, last.id) };
}

/** overfetch is the row count to ask the database for, given a page size. */
export function overfetch(limit: number): number {
  return limit + 1;
}

/**
 * The "no cursor" position: a timestamp later than any row can carry, so the
 * row comparison `(created_at, id) < (at, id)` is simply TRUE for every real
 * row and the same fixed SQL serves both the first page and a resumed one.
 *
 * A sentinel rather than a NULL bind on purpose — postgres.js cannot infer a
 * bind's type in an `IS NULL`-only context (the same reason `salesperf.gather`
 * uses `''` sentinels), and a literal `'infinity'` STRING bind is rejected
 * outright by its timestamptz serializer. A far-future Date is a normal bind
 * that needs no cast and no branch. Postgres timestamptz reaches 294276 AD, so
 * year 9999 is comfortably representable and comfortably unreachable.
 */
export const NO_CURSOR_AT = new Date('9999-12-31T23:59:59.999Z');

/**
 * The id half of the "no cursor" position. Only ever compared when
 * `created_at` ties with NO_CURSOR_AT exactly — which no real row does — so its
 * value is irrelevant; '' is the house's empty sentinel.
 */
export const NO_CURSOR_ID = '';

/** The three values a keyset query binds: where to resume, and how many rows to ask for. */
export interface SqlBounds {
  /** Bind into `(created_at, id) < (${at}, ${id})`. */
  at: Date;
  id: string;
  /** Bind into `limit ${limit}::bigint`. NULL means unbounded (`LIMIT NULL` = no limit). */
  limit: number | null;
}

/**
 * sqlBounds turns an optional PageRequest into the binds a keyset query needs.
 * An ABSENT request means "unbounded" — every row, no cursor — which is what
 * the internal (non-request-path) callers want: a dashboard aggregating over
 * every campaign must not silently see only the first page. Only callers that
 * pass a request get bounded.
 */
export function sqlBounds(req: PageRequest | null | undefined): SqlBounds {
  if (req === null || req === undefined) {
    return { at: NO_CURSOR_AT, id: NO_CURSOR_ID, limit: null };
  }
  return {
    at: req.cursor?.createdAt ?? NO_CURSOR_AT,
    id: req.cursor?.id ?? NO_CURSOR_ID,
    limit: overfetch(req.limit),
  };
}

/**
 * paginate finishes a keyset read: hand it the fetched rows (already
 * over-fetched via `sqlBounds().limit`) and it returns the page. With no
 * request it returns everything and no cursor — there is no "next page" when
 * the caller already has every row.
 */
export function paginate<T>(
  fetched: readonly T[],
  req: PageRequest | null | undefined,
  keyOf: (row: T) => Cursor,
): Page<T> {
  if (req === null || req === undefined) {
    return { rows: [...fetched], nextCursor: null };
  }
  return fromOverfetch(fetched, req.limit, keyOf);
}
