import { describe, expect, it } from 'vitest';
import { computeDedup, DEDUP_FIELD_KEYS } from './interview-dedup';
import type { RisetAwalBaseline, RisetAwalIsian } from './riset-awal';

function isian(partial: Partial<RisetAwalIsian> & Pick<RisetAwalIsian, 'field_key'>): RisetAwalIsian {
  return {
    section: 'B2',
    field_key: partial.field_key,
    sumber: partial.sumber ?? 'analisa',
    nilai_teks: partial.nilai_teks ?? null,
    nilai_angka: partial.nilai_angka ?? null,
    nilai_uang: partial.nilai_uang ?? null,
    nilai_usulan: partial.nilai_usulan ?? null,
    dikonfirmasi: partial.dikonfirmasi ?? false,
  };
}

function baseline(isianRows: RisetAwalIsian[]): RisetAwalBaseline {
  return {
    interview_id: 'ITV-202608-0001',
    platforms: [],
    analisa: [],
    isian: isianRows,
    semua_terkonfirmasi: isianRows.length > 0 && isianRows.every((f) => f.dikonfirmasi),
  };
}

describe('computeDedup (RAB-08)', () => {
  it('null baseline dedups nothing — the form asks every question as before', () => {
    expect(computeDedup(null).byField.size).toBe(0);
  });

  it('folds the two riset-awal scored numbers (B2-9 AOV money, B2-3 SKU count)', () => {
    const b = baseline([
      isian({ field_key: 'B2-9', nilai_uang: '15000000', sumber: 'analisa', dikonfirmasi: true }),
      isian({ field_key: 'B2-3', nilai_angka: 42, sumber: 'analisa', dikonfirmasi: true }),
    ]);
    const { byField } = computeDedup(b);
    const aov = byField.get('B2-9')!;
    expect(aov.display).toBe('Rp. 150.000,00'); // 15_000_000 minor → Rp150rb
    expect(aov.source).toBe('Riset Awal (analisa)');
    expect(aov.confirmed).toBe(true);
    const sku = byField.get('B2-3')!;
    expect(sku.display).toBe('42');
    expect(sku.confirmed).toBe(true);
  });

  it('surfaces manual source + unconfirmed state', () => {
    const b = baseline([isian({ field_key: 'B2-9', nilai_uang: '5000000', sumber: 'manual', dikonfirmasi: false })]);
    const info = computeDedup(b).byField.get('B2-9')!;
    expect(info.source).toBe('Riset Awal (manual)');
    expect(info.confirmed).toBe(false);
  });

  it('NEVER dedups fields outside the safe set (B1-5/B3-3/B7-3 stay interview questions)', () => {
    const b = baseline([
      isian({ field_key: 'B1-5', nilai_uang: '99000000', dikonfirmasi: true }),
      isian({ field_key: 'B3-3', nilai_teks: 'terbatas', dikonfirmasi: true }),
    ]);
    expect(computeDedup(b).byField.size).toBe(0);
    // Guard the narrow set itself so a future widening is a deliberate edit.
    expect([...DEDUP_FIELD_KEYS].sort()).toEqual(['B2-3', 'B2-9']);
  });
});
