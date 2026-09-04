/**
 * `lib/skuscreener.ts` — the access gate and the payload readers.
 *
 * Both are places where being wrong is quiet rather than loud: a gate that is
 * too wide shows a page whose every action then 403s, and a payload reader that
 * accepts an unknown schema renders a table of `undefined` on a 200 response.
 */
import { describe, expect, it } from 'vitest';
import {
  canUseSkuScreener,
  canWriteSkuScreener,
  readComparePayload,
  readScreeningPayload,
  SCHEMA_PERBANDINGAN,
  SCHEMA_SCREENING,
} from '@/lib/skuscreener';
import type { Role } from '@/lib/types';

const role = (division: string, level: string, extra: Partial<Role> = {}): Role => ({
  division, level, od: false, director: false, ...extra,
});

describe('canUseSkuScreener — who may open the page', () => {
  it('admits Ads staff and Ads lead (the server write gate, canWriteSku)', () => {
    expect(canUseSkuScreener(role('Ads', 'staff'))).toBe(true);
    expect(canUseSkuScreener(role('Ads', 'lead'))).toBe(true);
  });

  it('admits Director (full access) and OD (read-everywhere oversight)', () => {
    expect(canUseSkuScreener(role('Sales', 'staff', { director: true }))).toBe(true);
    expect(canUseSkuScreener(role('Sales', 'staff', { od: true }))).toBe(true);
  });

  it('refuses every other division, including Account lead', () => {
    for (const d of ['Account', 'Creative', 'KOL', 'Live Stream', 'Sales', 'Marketing', 'Finance']) {
      expect(canUseSkuScreener(role(d, 'staff')), d).toBe(false);
      expect(canUseSkuScreener(role(d, 'lead')), `${d} lead`).toBe(false);
    }
  });

  it('tolerates a lowercased division, the way the HRIS mappings can arrive', () => {
    expect(canUseSkuScreener(role('ads', 'staff'))).toBe(true);
  });

  it('refuses while /me is still loading (role null) rather than flashing the page', () => {
    expect(canUseSkuScreener(null)).toBe(false);
  });

  it('refuses an Ads role with no level — the server gate names staff or lead, not "any Ads"', () => {
    expect(canUseSkuScreener(role('Ads', ''))).toBe(false);
  });
});

describe('canWriteSkuScreener — who may run/log/track', () => {
  it('is the write gate, so OD is read-only even though it may open the page', () => {
    expect(canUseSkuScreener(role('Sales', 'staff', { od: true }))).toBe(true);
    expect(canWriteSkuScreener(role('Sales', 'staff', { od: true }))).toBe(false);
  });

  it('lets a Director write, and Ads staff/lead write', () => {
    expect(canWriteSkuScreener(role('Sales', 'staff', { director: true }))).toBe(true);
    expect(canWriteSkuScreener(role('Ads', 'staff'))).toBe(true);
    expect(canWriteSkuScreener(role('Ads', 'lead'))).toBe(true);
  });

  it('an OD layered on an Ads account is still read-only', () => {
    // The layered-role case: OD is a read-only layer (Role Matrix §4), so it
    // must not be possible to gain writes by holding it on top of Ads.
    expect(canWriteSkuScreener(role('Ads', 'staff', { od: true }))).toBe(false);
  });

  it('refuses null and every non-Ads division', () => {
    expect(canWriteSkuScreener(null)).toBe(false);
    expect(canWriteSkuScreener(role('Account', 'lead'))).toBe(false);
  });
});

describe('payload readers — version-checked, never guessed', () => {
  it('reads a screening payload and refuses a comparison one', () => {
    const p = { schema: SCHEMA_SCREENING, targetRoas: 4 };
    expect(readScreeningPayload(p)).toBe(p);
    expect(readComparePayload(p)).toBeNull();
  });

  it('reads a comparison payload and refuses a screening one', () => {
    const p = { schema: SCHEMA_PERBANDINGAN, minKlikSesudah: 20 };
    expect(readComparePayload(p)).toBe(p);
    expect(readScreeningPayload(p)).toBeNull();
  });

  it('refuses a future schema version instead of rendering it as v1', () => {
    expect(readScreeningPayload({ schema: 'cdps.skuscreener.screening.v2' })).toBeNull();
  });

  it('refuses anything that is not a payload at all', () => {
    for (const v of [null, undefined, 0, '', 'screening', [], {}]) {
      expect(readScreeningPayload(v)).toBeNull();
      expect(readComparePayload(v)).toBeNull();
    }
  });
});
