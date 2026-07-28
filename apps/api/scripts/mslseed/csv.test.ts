/**
 * Tests for the mslseed CSV reader — port of `backend/cmd/mslseed/csv_test.go`,
 * plus the cases Go got for free from `encoding/csv` and this hand-written parser
 * has to earn (embedded newlines, escaped quotes, CRLF, BOM).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseRecords, WANT_HEADER } from './csv';

const SEED_CSV = fileURLToPath(new URL('../../../../supabase/seed/msl_kalkulator.csv', import.meta.url));
const GO_SEED_CSV = fileURLToPath(new URL('../../../../backend/seed/msl_kalkulator.csv', import.meta.url));

const header = WANT_HEADER.join(',');

/** A minimal well-formed data row (15 columns). */
function row(overrides: Partial<Record<(typeof WANT_HEADER)[number], string>> = {}): string {
  const base: Record<string, string> = {
    service_key: 'svc-a', name: 'Jasa A', category: 'Kat', unit: 'paket', min_qty: '',
    unit_price: '1000000', pricing_mode: 'flat', apply_ppn: '0', frequency: 'Monthly',
    price_note: '', commission_rule: '0% of standard price', effective_from: '2026-07-16',
    active: 'true', description: 'desc', source_row: '2',
  };
  return WANT_HEADER.map((k) => base[k] === undefined ? '' : (overrides[k] ?? base[k])).join(',');
}

describe('parseRecords', () => {
  it('keeps embedded newlines inside quoted fields', () => {
    const recs = parseRecords('a,"line1\nline2",c\n');
    expect(recs).toEqual([['a', 'line1\nline2', 'c']]);
  });

  it('unescapes "" to a single quote', () => {
    expect(parseRecords('a,"say ""hi""",c\n')).toEqual([['a', 'say "hi"', 'c']]);
  });

  it('normalizes CRLF inside quotes to LF and treats CRLF as a record separator', () => {
    expect(parseRecords('a,"x\r\ny"\r\nb,c\r\n')).toEqual([['a', 'x\ny'], ['b', 'c']]);
  });

  it('does not emit a trailing empty record for a final newline', () => {
    expect(parseRecords('a,b\n')).toEqual([['a', 'b']]);
    expect(parseRecords('a,b')).toEqual([['a', 'b']]);
  });

  it('preserves empty fields', () => {
    expect(parseRecords('a,,c\n')).toEqual([['a', '', 'c']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseRecords('﻿a,b\n')).toEqual([['a', 'b']]);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseRecords('a,"unterminated\n')).toThrow(/tanda kutip tidak ditutup/);
  });
});

describe('parseCsv', () => {
  it('parses rows and numbers them by record (header = 1)', () => {
    const rows = parseCsv(`${header}\n${row()}\n${row({ service_key: 'svc-b' })}\n`);
    expect(rows).toHaveLength(2);
    expect(rows[0].line).toBe(2);
    expect(rows[1].line).toBe(3);
    expect(rows[0].serviceKey).toBe('svc-a');
    expect(rows[1].serviceKey).toBe('svc-b');
  });

  it('keeps record numbering stable when a description spans physical lines', () => {
    const multi = row({ service_key: 'svc-multi', description: '"baris1\nbaris2\nbaris3"' });
    const rows = parseCsv(`${header}\n${multi}\n${row({ service_key: 'svc-after' })}\n`);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('baris1\nbaris2\nbaris3');
    // Would be 5 if we counted physical lines instead of records.
    expect(rows[1].line).toBe(3);
  });

  it('rejects a header with the wrong column count', () => {
    expect(() => parseCsv('service_key,name\n')).toThrow(/^header: 2 kolom, ingin 15/);
  });

  it('rejects a header with a renamed column', () => {
    const bad = ['service_key', 'nama', ...WANT_HEADER.slice(2)].join(',');
    expect(() => parseCsv(`${bad}\n`)).toThrow(/header kolom 2: "nama", ingin "name"/);
  });

  it('rejects a data row with the wrong column count', () => {
    expect(() => parseCsv(`${header}\na,b,c\n`)).toThrow(/^baris 2: 3 kolom, ingin 15/);
  });

  it('skips a blank line instead of failing on it', () => {
    const rows = parseCsv(`${header}\n${row()}\n\n${row({ service_key: 'svc-b' })}\n`);
    expect(rows.map((r) => r.serviceKey)).toEqual(['svc-a', 'svc-b']);
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv('')).toThrow(/berkas kosong/);
  });
});

describe('the canonical seed file', () => {
  it('parses to 32 services with the expected shape', () => {
    const rows = parseCsv(readFileSync(SEED_CSV, 'utf8'));
    expect(rows).toHaveLength(32);
    expect(rows[0].serviceKey).toBe('store-management-paket');
    expect(rows[0].name).toBe('Store Management (Paket)');
    // The multi-line verbatim description survived parsing.
    expect(rows[0].description).toContain('\n');
    // Every row carries a service_key and a name.
    for (const r of rows) {
      expect(r.serviceKey.trim()).not.toBe('');
      expect(r.name.trim()).not.toBe('');
    }
    // service_key is unique — it is the CSV's own identity column.
    expect(new Set(rows.map((r) => r.serviceKey)).size).toBe(32);
    // Service NAME is the seeder's idempotency key, so it must be unique too,
    // or two rows would fight over one MSL entry every run.
    expect(new Set(rows.map((r) => r.name.trim())).size).toBe(32);
  });

  // The Go tree is frozen and gets retired at C-05; until then the two copies of
  // the canonical seed must not drift.
  it.skipIf(!existsSync(GO_SEED_CSV))('is byte-identical to the frozen Go copy', () => {
    expect(readFileSync(SEED_CSV).equals(readFileSync(GO_SEED_CSV))).toBe(true);
  });
});
