/**
 * The pure display helpers the portal pages depend on.
 *
 * `labelPeriode` is the one with real teeth: a client reads the period before
 * they read anything else, and getting it wrong is the kind of error that makes
 * them distrust the numbers underneath it. It also has to survive a malformed
 * pair without throwing — a page that crashes on a bad date tells the client
 * nothing, while a page showing the raw ISO pair at least still names a period.
 *
 * `toneBand` is asserted against the CLIENT-FACING labels on purpose: the
 * internal band names (`Healthy`/`Watch`/`At Risk`) never reach this app, so a
 * mapping keyed on them would be dead code that looks alive.
 */
import { describe, expect, it } from 'vitest';
import { labelPeriode, labelTipe, toneBand } from './portal-data';

describe('labelPeriode', () => {
  it('collapses a within-month range to one month name', () => {
    expect(labelPeriode('2026-08-01', '2026-08-31')).toBe('1 – 31 Agustus 2026');
  });

  it('names both months when the range crosses one', () => {
    expect(labelPeriode('2026-07-28', '2026-08-03')).toBe('28 Juli – 3 Agustus 2026');
  });

  it('names both years when the range crosses one', () => {
    expect(labelPeriode('2026-12-29', '2027-01-04')).toBe('29 Desember 2026 – 4 Januari 2027');
  });

  it('falls back to the raw pair instead of throwing on a malformed date', () => {
    expect(labelPeriode('', '')).toBe(' – ');
    expect(labelPeriode('bukan-tanggal', '2026-08-31')).toBe('bukan-tanggal – 2026-08-31');
    expect(labelPeriode('2026-08', '2026-08-31')).toBe('2026-08 – 2026-08-31');
  });
});

describe('labelTipe', () => {
  it('names the two real period types', () => {
    expect(labelTipe('mingguan')).toBe('Laporan Mingguan');
    expect(labelTipe('bulanan')).toBe('Laporan Bulanan');
  });

  it('degrades to a plain word rather than echoing an unknown value', () => {
    expect(labelTipe('kuartalan')).toBe('Laporan');
    expect(labelTipe('')).toBe('Laporan');
  });
});

describe('toneBand', () => {
  it('maps the three client-facing labels', () => {
    expect(toneBand('On Track')).toBe('ok');
    expect(toneBand('Needs Attention')).toBe('warn');
    expect(toneBand('Action Needed')).toBe('danger');
  });

  it('treats an absent label as "no assessment yet", never as a bad band', () => {
    // A brand-new client has no snapshot. Painting that red would tell them
    // their account is in trouble on day one.
    expect(toneBand(null)).toBe('none');
  });

  it('does not respond to the INTERNAL band names, which never reach this app', () => {
    expect(toneBand('Healthy')).toBe('none');
    expect(toneBand('Watch')).toBe('none');
    expect(toneBand('At Risk')).toBe('none');
  });
});
