import { describe, expect, it } from 'vitest';
import { weekLabel } from './ads-weekly';

describe('weekLabel', () => {
  it('renders "Minggu N · d Mon yyyy–d Mon yyyy" from the ISO week + bounds', () => {
    expect(
      weekLabel({ iso_week: 33, minggu_mulai: '2026-08-10', minggu_akhir: '2026-08-16' }),
    ).toBe('Minggu 33 · 10 Agu 2026–16 Agu 2026');
  });

  it('uses the Indonesian month abbreviations (Mei, Agu, Des)', () => {
    expect(
      weekLabel({ iso_week: 1, minggu_mulai: '2026-12-28', minggu_akhir: '2027-01-03' }),
    ).toBe('Minggu 1 · 28 Des 2026–3 Jan 2027');
  });

  it('leaves a non-date string untouched rather than inventing a month', () => {
    expect(
      weekLabel({ iso_week: 5, minggu_mulai: 'n/a', minggu_akhir: '2026-02-01' }),
    ).toBe('Minggu 5 · n/a–1 Feb 2026');
  });
});
