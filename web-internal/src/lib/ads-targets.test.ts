/**
 * Unit tests for the pure helper in lib/ads-targets.ts.
 *
 * `weekLabel` is the one piece of formatting this file owns — every other figure
 * arrives pre-formatted from the server (`*_display`), so there is nothing else
 * here that could drift from the house rules. The label is shared by the weekly
 * table and the filing form's week picker, so a week must read identically in
 * both; that is what these assertions pin.
 */
import { describe, expect, it } from 'vitest';
import { weekLabel } from './ads-targets';

describe('weekLabel', () => {
  it('renders the ISO week number with its WIB Monday–Sunday range', () => {
    expect(weekLabel({ iso_week: 33, minggu_mulai: '2026-08-10', minggu_akhir: '2026-08-16' }))
      .toBe('Minggu 33 · 10 Agu 2026–16 Agu 2026');
  });

  it('renders a week that crosses a month and a year boundary', () => {
    expect(weekLabel({ iso_week: 1, minggu_mulai: '2025-12-29', minggu_akhir: '2026-01-04' }))
      .toBe('Minggu 1 · 29 Des 2025–4 Jan 2026');
  });

  it('passes a non-date through untouched rather than inventing a month', () => {
    expect(weekLabel({ iso_week: 5, minggu_mulai: '', minggu_akhir: 'bukan tanggal' }))
      .toBe('Minggu 5 · –bukan tanggal');
  });
});
