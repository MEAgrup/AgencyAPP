import { describe, expect, it } from 'vitest';
import * as bi from './bi';
import {
  clampLimit,
  DEFAULT_LIMIT,
  decodeCursor,
  encodeCursor,
  fromOverfetch,
  MAX_LIMIT,
  NO_CURSOR_AT,
  NO_CURSOR_ID,
  overfetch,
  PageCursorError,
  paginate,
  parseRequest,
  sqlBounds,
} from './page';

const AT = new Date('2026-09-04T03:15:00.000Z');

describe('clampLimit', () => {
  it('falls back to the default for absent, empty, junk, zero and negative input', () => {
    for (const raw of [null, undefined, '', 'abc', '0', '-5', '1.5', 0, -1, 2.5]) {
      expect(clampLimit(raw as string | number | null | undefined)).toBe(DEFAULT_LIMIT);
    }
  });

  it('accepts a sane explicit size and clamps anything above the ceiling', () => {
    expect(clampLimit('25')).toBe(25);
    expect(clampLimit(25)).toBe(25);
    expect(clampLimit(MAX_LIMIT)).toBe(MAX_LIMIT);
    expect(clampLimit(MAX_LIMIT + 1)).toBe(MAX_LIMIT);
    expect(clampLimit('999999')).toBe(MAX_LIMIT);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips the position exactly, to the millisecond', () => {
    const c = decodeCursor(encodeCursor(AT, 'LEAD-202609-0042'));
    expect(c.id).toBe('LEAD-202609-0042');
    expect(c.createdAt.toISOString()).toBe(AT.toISOString());
  });

  it('is opaque on the wire — no readable id or timestamp, URL-safe', () => {
    const raw = encodeCursor(AT, 'LEAD-202609-0042');
    expect(raw).not.toContain('LEAD-202609-0042');
    expect(raw).not.toContain('2026-09-04');
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: safe unencoded in a query string
  });

  it('rejects every malformed shape with the house BI message, never a silent page 1', () => {
    const bad = [
      '', // empty
      'not-base64-@@@', // undecodable
      Buffer.from('no-separator', 'utf8').toString('base64url'),
      Buffer.from('|LEAD-1', 'utf8').toString('base64url'), // empty timestamp
      Buffer.from('2026-09-04T03:15:00.000Z|', 'utf8').toString('base64url'), // empty id
      Buffer.from('bukan-tanggal|LEAD-1', 'utf8').toString('base64url'), // unparseable timestamp
    ];
    for (const raw of bad) {
      expect(() => decodeCursor(raw), raw).toThrow(PageCursorError);
    }
    expect(() => decodeCursor('not-base64-@@@')).toThrow(bi.INCOMPLETE_DATA);
  });

  it('carries an id containing a dash without ambiguity (house IDs always do)', () => {
    expect(decodeCursor(encodeCursor(AT, 'PRSP-202512-0001')).id).toBe('PRSP-202512-0001');
  });
});

describe('parseRequest', () => {
  it('treats an absent cursor as "first page" and applies the default limit', () => {
    expect(parseRequest(null, null)).toEqual({ limit: DEFAULT_LIMIT, cursor: null });
    expect(parseRequest('', '')).toEqual({ limit: DEFAULT_LIMIT, cursor: null });
  });

  it('decodes a supplied cursor and keeps the explicit limit', () => {
    const req = parseRequest('10', encodeCursor(AT, 'CLI-202609-0007'));
    expect(req.limit).toBe(10);
    expect(req.cursor?.id).toBe('CLI-202609-0007');
  });

  it('propagates a malformed cursor as PageCursorError (a 400, not a 500)', () => {
    expect(() => parseRequest('10', 'garbage-@@@')).toThrow(PageCursorError);
  });
});

describe('fromOverfetch', () => {
  const rowsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `LEAD-202609-${String(i).padStart(4, '0')}`, createdAt: new Date(AT.getTime() - i * 1000) }));
  const keyOf = (r: { id: string; createdAt: Date }) => ({ createdAt: r.createdAt, id: r.id });

  it('drops the probe row and mints the cursor from the LAST KEPT row', () => {
    const page = fromOverfetch(rowsOf(4), 3, keyOf);
    expect(page.rows).toHaveLength(3);
    expect(page.rows[2].id).toBe('LEAD-202609-0002'); // the 4th row was only a probe
    expect(page.nextCursor).not.toBeNull();
    // The cursor names row 3, so the next page resumes strictly after it — never
    // re-serving it and never skipping the probe row that was dropped.
    const c = decodeCursor(page.nextCursor!);
    expect(c.id).toBe('LEAD-202609-0002');
    expect(c.createdAt.toISOString()).toBe(page.rows[2].createdAt.toISOString());
  });

  it('reports the last page (null cursor) when the probe row did NOT come back', () => {
    expect(fromOverfetch(rowsOf(3), 3, keyOf).nextCursor).toBeNull();
    expect(fromOverfetch(rowsOf(1), 3, keyOf).nextCursor).toBeNull();
  });

  it('handles an empty result without inventing a cursor', () => {
    expect(fromOverfetch([], 3, keyOf)).toEqual({ rows: [], nextCursor: null });
  });

  it('never mutates or aliases the caller\'s array', () => {
    const src = rowsOf(2);
    const page = fromOverfetch(src, 5, keyOf);
    expect(page.rows).not.toBe(src);
    expect(src).toHaveLength(2);
  });
});

describe('overfetch', () => {
  it('asks for exactly one row more than the page — the has-more probe', () => {
    expect(overfetch(100)).toBe(101);
    expect(overfetch(1)).toBe(2);
  });
});

describe('sqlBounds / paginate — the unbounded (internal caller) contract', () => {
  const rows = [
    { id: 'CMP-202609-0002', createdAt: new Date('2026-09-02T00:00:00.000Z') },
    { id: 'CMP-202609-0001', createdAt: new Date('2026-09-01T00:00:00.000Z') },
  ];
  const keyOf = (r: { id: string; createdAt: Date }) => ({ createdAt: r.createdAt, id: r.id });

  it('NO request → LIMIT NULL (unbounded) and a sentinel that matches every row', () => {
    const b = sqlBounds(undefined);
    expect(b.limit).toBeNull(); // `limit NULL` in Postgres = no limit at all
    expect(b.at).toBe(NO_CURSOR_AT);
    expect(b.id).toBe(NO_CURSOR_ID);
    // The sentinel must be later than anything a row can carry, or the
    // predicate would silently drop rows for the internal callers.
    expect(NO_CURSOR_AT.getTime()).toBeGreaterThan(new Date('2200-01-01').getTime());
  });

  it('NO request → paginate returns every row and never a cursor', () => {
    expect(paginate(rows, undefined, keyOf)).toEqual({ rows, nextCursor: null });
    expect(paginate(rows, null, keyOf).nextCursor).toBeNull();
  });

  it('first page → over-fetches by one, still starts from the sentinel', () => {
    const b = sqlBounds({ limit: 50, cursor: null });
    expect(b.limit).toBe(51);
    expect(b.at).toBe(NO_CURSOR_AT);
  });

  it('resumed page → binds the cursor position verbatim', () => {
    const b = sqlBounds({ limit: 2, cursor: { createdAt: AT, id: 'LEAD-202609-0009' } });
    expect(b.limit).toBe(3);
    expect(b.at).toBe(AT);
    expect(b.id).toBe('LEAD-202609-0009');
  });

  it('WITH a request → paginate drops the probe row and emits the cursor', () => {
    const page = paginate(rows, { limit: 1, cursor: null }, keyOf);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].id).toBe('CMP-202609-0002');
    expect(decodeCursor(page.nextCursor!).id).toBe('CMP-202609-0002');
  });
});
