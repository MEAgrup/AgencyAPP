/**
 * Tests for the MSL admin form ↔ payload mapping.
 *
 * The test that matters here is `round-trips EVERY field it sends`. Because
 * `updateService` is full-replace, the defect class is not "this field is
 * wrong" but "this field was never carried", and a per-field assertion only
 * catches the fields someone remembered to assert. So the round-trip test walks
 * the payload's OWN keys and demands each one came back from the service row —
 * a field added to `MslPayload` without being read in `serviceToForm` fails
 * here rather than erasing itself in production on the next "Ubah".
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MSL_FORM,
  formatDurasiBulan,
  formToPayload,
  parseDurasiBulan,
  serviceToForm,
  todayISO,
  type MslPayload,
} from './msl';
import type { MasterService } from './types';

/**
 * A service row with a DISTINCT, non-default value in every field the form
 * touches. Defaults are useless as fixtures: a mapping that drops a field
 * still "passes" when the dropped value happens to equal the empty one.
 */
function fixture(over: Partial<MasterService> = {}): MasterService {
  return {
    id: 'MSV-202608-0046',
    name: 'AI Video',
    standard_price: '1500000',
    commission_rule: '10% of standard price',
    category: 'AI Optimizer',
    unit: 'paket',
    min_qty: '5.00',
    pricing_mode: 'min_floor',
    apply_ppn: true,
    frequency: 'bulanan',
    price_note: 'harga khusus Q3',
    description: 'Produksi video berbasis AI',
    active: true,
    requires_strategy_plan: false,
    plan_tier: 'ditentukan_am',
    durasi_bulan: 6,
    qty_menambah: 'durasi',
    pengakuan: 'per_periode',
    version_no: 1,
    effective_from: '2026-08-31',
    ...over,
  };
}

/**
 * How each payload key is expected to be recoverable from the service row.
 * `effective_from` is the one deliberate exception — a new version cuts over
 * from today, not from the old version's start date.
 */
const RECOVERED_FROM: { [K in keyof MslPayload]: (s: MasterService) => MslPayload[K] | 'SKIP' } = {
  name: (s) => s.name,
  standard_price: (s) => s.standard_price,
  commission_rule: (s) => s.commission_rule,
  category: (s) => s.category,
  unit: (s) => s.unit,
  min_qty: (s) => s.min_qty,
  pricing_mode: (s) => s.pricing_mode,
  apply_ppn: (s) => s.apply_ppn,
  frequency: (s) => s.frequency,
  price_note: (s) => s.price_note,
  description: (s) => s.description,
  active: (s) => s.active,
  plan_tier: (s) => s.plan_tier,
  durasi_bulan: (s) => s.durasi_bulan,
  qty_menambah: (s) => s.qty_menambah,
  pengakuan: (s) => s.pengakuan,
  effective_from: () => 'SKIP',
};

describe('serviceToForm → formToPayload', () => {
  it('round-trips EVERY field it sends — a dropped field is an erased field', () => {
    const svc = fixture();
    const payload = formToPayload(serviceToForm(svc));

    // Walk the payload's own keys, not a hand-written list: that is what makes
    // this test notice a field added later.
    const keys = Object.keys(payload) as (keyof MslPayload)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const want = RECOVERED_FROM[k](svc);
      if (want === 'SKIP') continue;
      expect(payload[k], `payload.${k} did not survive the round-trip`).toEqual(want);
    }

    // And the one exception is exactly that — today, not the old cutover.
    expect(payload.effective_from).toBe(todayISO());
    expect(payload.effective_from).not.toBe(svc.effective_from);
  });

  it('carries durasi_bulan through an edit — the regression that made this file exist', () => {
    const payload = formToPayload(serviceToForm(fixture({ durasi_bulan: 6 })));
    expect(payload.durasi_bulan).toBe(6);
  });

  it('sends null, not a missing key, for a service that has no durasi_bulan', () => {
    const payload = formToPayload(serviceToForm(fixture({ durasi_bulan: null, qty_menambah: 'volume' })));
    expect(payload.durasi_bulan).toBeNull();
    expect('durasi_bulan' in payload).toBe(true);
  });

  it('forces passthrough to price 0 and drops min_qty for modes that ignore it', () => {
    const flat = formToPayload(serviceToForm(fixture({ pricing_mode: 'flat', min_qty: '5.00' })));
    expect(flat.min_qty).toBe('');
    const pass = formToPayload(serviceToForm(fixture({ pricing_mode: 'passthrough' })));
    expect(pass.standard_price).toBe('0');
  });

  it('a blank new-service form sends durasi_bulan null, not 0, and qty_menambah volume', () => {
    expect(formToPayload(EMPTY_MSL_FORM).durasi_bulan).toBeNull();
    // The safe default has to survive all the way to the wire, not just sit in
    // the form state: a new catalog entry must never start life claiming that
    // buying 10 of it means a ten-month contract.
    expect(formToPayload(EMPTY_MSL_FORM).qty_menambah).toBe('volume');
  });
});

describe('parseDurasiBulan', () => {
  it('treats empty and whitespace as "tidak berlaku"', () => {
    expect(parseDurasiBulan('')).toBeNull();
    expect(parseDurasiBulan('   ')).toBeNull();
  });

  it('passes a whole positive number of months through unchanged', () => {
    expect(parseDurasiBulan('1')).toBe(1);
    expect(parseDurasiBulan(' 12 ')).toBe(12);
  });

  it('does NOT sanitize a bad value into a plausible one — the server rejects it', () => {
    // 0 and negatives must reach the server as themselves so the reply is the
    // house BI message, not a form that silently stored "no duration".
    expect(parseDurasiBulan('0')).toBe(0);
    expect(parseDurasiBulan('-5')).toBe(-5);
    expect(parseDurasiBulan('1.5')).toBe(1.5);
    expect(parseDurasiBulan('abc')).toBeNaN();
  });
});

describe('formatDurasiBulan', () => {
  it('renders an em dash for a service the field does not apply to', () => {
    expect(formatDurasiBulan(null)).toBe('—');
    expect(formatDurasiBulan(undefined)).toBe('—');
  });

  it('names the unit — this column used to hold DAYS, so a bare number is ambiguous', () => {
    expect(formatDurasiBulan(6)).toBe('6 bulan');
    expect(formatDurasiBulan(1)).toBe('1 bulan');
  });
});
