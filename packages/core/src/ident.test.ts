import { describe, expect, it, vi } from 'vitest';
import {
  type IdentExecutor,
  PREFIXES,
  format,
  isRegisteredPrefix,
  isValid,
  nextId,
  parse,
  periodOf,
} from './ident';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));

describe('prefix registry', () => {
  it('includes the core money-path & lifecycle prefixes', () => {
    for (const p of ['LEAD', 'CLI', 'TRX', 'INST', 'SVC', 'BRF', 'AST', 'BKG', 'CPR', 'CHR', 'PERF']) {
      expect(isRegisteredPrefix(p)).toBe(true);
    }
  });

  it('rejects unknown / test-only prefixes', () => {
    // TST is Go test scaffolding only — not part of the production registry.
    //
    // `DEMO` used to be asserted here as unregistered, on the inherited belief
    // that it was Go scaffolding too. It is not: `packages/domain/src/demo.ts`
    // mints `DEMO-…` ids in this codebase, and it reached `ident_next` through
    // the untyped executor so this guard never saw it. The M6A §7 registry scan
    // (packages/db/src/ident.registry.test.ts) found it; it is registered now,
    // which is why it moved out of this list.
    for (const p of ['TST', 'XYZ', 'cli', '']) {
      expect(isRegisteredPrefix(p)).toBe(false);
    }
  });

  it('every registered prefix carries entity + module metadata', () => {
    for (const [prefix, info] of Object.entries(PREFIXES)) {
      expect(prefix).toMatch(/^[A-Z]{2,5}$/);
      expect(info.entity.length).toBeGreaterThan(0);
      expect(info.module.length).toBeGreaterThan(0);
    }
  });
});

describe('format', () => {
  it('zero-pads the sequence to 4 digits', () => {
    expect(format('CLI', '202607', 1)).toBe('CLI-202607-0001');
    expect(format('TRX', '202607', 42)).toBe('TRX-202607-0042');
    expect(format('BRF', '202612', 9999)).toBe('BRF-202612-9999');
  });

  it('widens (never truncates) a sequence past 9999', () => {
    expect(format('AST', '202607', 12345)).toBe('AST-202607-12345');
  });
});

describe('parse', () => {
  it('splits a well-formed ID', () => {
    expect(parse('CLI-202607-0001')).toEqual({ prefix: 'CLI', period: '202607', n: 1 });
    expect(parse('AST-202607-12345')).toEqual({ prefix: 'AST', period: '202607', n: 12345 });
  });

  it('returns null for malformed IDs', () => {
    for (const bad of ['', 'CLI', 'CLI-202607', 'CLI-2026-0001', 'CLI-202607-1', 'cli-202607-0001', 'CLI_202607_0001']) {
      expect(parse(bad)).toBeNull();
    }
  });
});

describe('isValid', () => {
  it('accepts well-formed IDs with registered prefixes', () => {
    expect(isValid('CLI-202607-0001')).toBe(true);
    expect(isValid('PERF-202607-0007')).toBe(true);
  });

  it('rejects well-formed IDs with unregistered prefixes', () => {
    expect(isValid('TST-202607-0001')).toBe(false);
    expect(isValid('ZZZ-202607-0001')).toBe(false);
  });

  it('rejects malformed IDs', () => {
    expect(isValid('CLI-202607')).toBe(false);
  });
});

describe('periodOf (WIB bucket, matches ident_next SQL)', () => {
  it('buckets an instant near UTC midnight into the WIB month', () => {
    // 2026-06-30T17:30:00Z == 2026-07-01 00:30 WIB -> 202607 (O20).
    expect(periodOf(utc(2026, 6, 30, 17, 30))).toBe('202607');
    // 2026-06-30T16:00:00Z == 2026-06-30 23:00 WIB -> still 202606.
    expect(periodOf(utc(2026, 6, 30, 16, 0))).toBe('202606');
  });
});

describe('nextId wrapper', () => {
  it('delegates to the SQL allocator and returns its ID', async () => {
    const exec: IdentExecutor = { identNext: vi.fn().mockResolvedValue('CLI-202607-0001') };
    const at = utc(2026, 7, 1);
    const id = await nextId(exec, 'CLI', at);
    expect(id).toBe('CLI-202607-0001');
    expect(exec.identNext).toHaveBeenCalledWith('CLI', at);
  });

  it('rejects an unregistered prefix before touching the DB', async () => {
    const exec: IdentExecutor = { identNext: vi.fn() };
    // @ts-expect-error — deliberately passing an unregistered prefix at runtime.
    await expect(nextId(exec, 'ZZZ', utc(2026, 7, 1))).rejects.toThrow(/unregistered prefix/);
    expect(exec.identNext).not.toHaveBeenCalled();
  });
});
