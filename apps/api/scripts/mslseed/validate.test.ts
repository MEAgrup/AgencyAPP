/**
 * Tests for mslseed row validation — port of the validation half of
 * `backend/cmd/mslseed/csv_test.go`. Pure: no DB.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { money } from '@cdps/core';
import { parseCsv, type Row } from './csv';
import { rowToServiceInput, SeedRowError } from './validate';

const SEED_CSV = fileURLToPath(new URL('../../../../supabase/seed/msl_kalkulator.csv', import.meta.url));

/** A valid baseline row; override one field per test. */
function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    line: 2, serviceKey: 'svc-a', name: 'Jasa A', category: 'Kat', unit: 'paket',
    minQty: '', unitPrice: '1000000', pricingMode: 'flat', applyPPN: '0',
    frequency: 'Monthly', priceNote: 'catatan', commissionRule: '0% of standard price',
    effectiveFrom: '2026-07-16', active: 'true', description: 'desc', sourceRow: '2',
    ...overrides,
  };
}

describe('rowToServiceInput — happy path', () => {
  it('trims fields and normalizes the price to DECIMAL(15,2)', () => {
    const inp = rowToServiceInput(makeRow({ name: '  Jasa A  ', unitPrice: ' 1000000 ', category: ' Kat ' }));
    expect(inp.name).toBe('Jasa A');
    expect(inp.category).toBe('Kat');
    expect(inp.standardPrice).toBe('1000000.00');
    expect(inp.pricingMode).toBe('flat');
    expect(inp.applyPPN).toBe(false);
    expect(inp.active).toBe(true);
    expect(inp.effectiveFrom).toBe('2026-07-16');
  });

  it('defaults an empty pricing_mode to flat', () => {
    expect(rowToServiceInput(makeRow({ pricingMode: '' })).pricingMode).toBe('flat');
  });

  it('accepts an empty frequency (not every service has one)', () => {
    expect(rowToServiceInput(makeRow({ frequency: '' })).frequency).toBe('');
  });

  it('accepts passthrough with an empty unit_price, normalized to 0', () => {
    const inp = rowToServiceInput(makeRow({ pricingMode: 'passthrough', unitPrice: '' }));
    expect(money.parse(inp.standardPrice)).toBe(0n);
  });

  it('keeps min_qty for min_floor / batch_ceiling', () => {
    expect(rowToServiceInput(makeRow({ pricingMode: 'min_floor', minQty: '300' })).minQty).toBe('300');
    expect(rowToServiceInput(makeRow({ pricingMode: 'batch_ceiling', minQty: '1' })).minQty).toBe('1');
  });

  it('accepts apply_ppn=1 and active=false', () => {
    const inp = rowToServiceInput(makeRow({ applyPPN: '1', active: 'false' }));
    expect(inp.applyPPN).toBe(true);
    expect(inp.active).toBe(false);
  });

  it('accepts both O14 commission grammars', () => {
    expect(rowToServiceInput(makeRow({ commissionRule: '2.5% of standard price' })).commissionRule)
      .toBe('2.5% of standard price');
    expect(rowToServiceInput(makeRow({ commissionRule: 'flat Rp 500.000' })).commissionRule)
      .toBe('flat Rp 500.000');
  });
});

describe('rowToServiceInput — rejections', () => {
  const cases: Array<[string, Partial<Row>, RegExp]> = [
    ['empty name', { name: '   ' }, /name kosong/],
    ['unknown pricing_mode', { pricingMode: 'tiered' }, /pricing_mode tidak dikenal: "tiered"/],
    ['unknown frequency', { frequency: 'Weekly' }, /frequency tidak dikenal: "Weekly"/],
    ['min_qty missing for min_floor', { pricingMode: 'min_floor', minQty: '' }, /min_qty wajib diisi untuk pricing_mode=min_floor/],
    ['min_qty set for flat', { pricingMode: 'flat', minQty: '5' }, /min_qty harus kosong untuk pricing_mode=flat/],
    ['fractional min_qty', { pricingMode: 'min_floor', minQty: '2.5' }, /min_qty bukan bilangan bulat positif: "2.5"/],
    ['zero min_qty', { pricingMode: 'min_floor', minQty: '0' }, /min_qty bukan bilangan bulat positif: "0"/],
    ['non-numeric min_qty', { pricingMode: 'min_floor', minQty: 'sepuluh' }, /min_qty bukan bilangan bulat positif/],
    ['non-numeric unit_price', { unitPrice: 'gratis' }, /unit_price tidak valid: "gratis"/],
    ['zero unit_price for flat', { unitPrice: '0' }, /unit_price harus > 0 untuk pricing_mode=flat: "0"/],
    ['negative unit_price for passthrough', { pricingMode: 'passthrough', unitPrice: '-1' }, /unit_price tidak boleh negatif untuk passthrough: "-1"/],
    ['bad apply_ppn', { applyPPN: 'yes' }, /apply_ppn harus "0" atau "1": "yes"/],
    ['bad active', { active: '1' }, /active harus "true" atau "false": "1"/],
    ['commission_rule outside O14 grammar', { commissionRule: '10 persen' }, /commission_rule tidak dikenal \(grammar DECISIONS O14\): "10 persen"/],
    ['empty commission_rule', { commissionRule: '' }, /commission_rule tidak dikenal/],
    ['tiered commission prose', { commissionRule: '5% of standard price untuk deal > 50jt' }, /commission_rule tidak dikenal/],
    ['effective_from in the wrong shape', { effectiveFrom: '16-07-2026' }, /effective_from harus YYYY-MM-DD: "16-07-2026"/],
    ['effective_from with an impossible day', { effectiveFrom: '2026-02-30' }, /effective_from harus YYYY-MM-DD: "2026-02-30"/],
  ];

  for (const [label, override, want] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => rowToServiceInput(makeRow(override))).toThrow(want);
    });
  }

  it('reports the line number and service_key so a 32-row CSV is greppable', () => {
    try {
      rowToServiceInput(makeRow({ line: 17, serviceKey: 'nano-kol', name: '' }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SeedRowError);
      expect((e as SeedRowError).message).toBe('baris 17 (nano-kol): name kosong');
      expect((e as SeedRowError).line).toBe(17);
      expect((e as SeedRowError).serviceKey).toBe('nano-kol');
    }
  });
});

describe('the canonical seed file', () => {
  const rows = parseCsv(readFileSync(SEED_CSV, 'utf8'));

  it('validates all 32 rows', () => {
    const inputs = rows.map(rowToServiceInput);
    expect(inputs).toHaveLength(32);
  });

  it('carries the O24 commission decision on every row (0%, explicit)', () => {
    // DECISIONS O24 RESOLVED 2026-07-17: 0% is the FINAL value, not a placeholder.
    for (const inp of rows.map(rowToServiceInput)) {
      expect(inp.commissionRule).toBe('0% of standard price');
    }
  });

  it('marks every seeded service active and effective 2026-07-16', () => {
    for (const inp of rows.map(rowToServiceInput)) {
      expect(inp.active).toBe(true);
      expect(inp.effectiveFrom).toBe('2026-07-16');
    }
  });

  it('covers all four pricing modes', () => {
    const modes = new Set(rows.map((r) => rowToServiceInput(r).pricingMode));
    expect([...modes].sort()).toEqual(['batch_ceiling', 'flat', 'min_floor', 'passthrough']);
  });
});
