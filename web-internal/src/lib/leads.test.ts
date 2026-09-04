import { describe, expect, it } from 'vitest';
import { exportLeadsCsvUrl, filenameFromContentDisposition } from './leads';

describe('exportLeadsCsvUrl (E1/E2)', () => {
  it('has no query string when no filter is applied', () => {
    expect(exportLeadsCsvUrl()).toBe('/api/v1/leads/export');
    expect(exportLeadsCsvUrl({})).toBe('/api/v1/leads/export');
  });

  it('carries status/q/source through, URL-encoded', () => {
    const url = exportLeadsCsvUrl({ status: '[Not Qualified]', q: 'Toko A', source: 'Scouting' });
    const [, qs] = url.split('?');
    const params = new URLSearchParams(qs);
    expect(params.get('status')).toBe('[Not Qualified]');
    expect(params.get('q')).toBe('Toko A');
    expect(params.get('source')).toBe('Scouting');
  });

  it('omits an empty/undefined field rather than sending it blank', () => {
    const url = exportLeadsCsvUrl({ status: '', q: 'x', source: undefined });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.has('status')).toBe(false);
    expect(params.get('q')).toBe('x');
    expect(params.has('source')).toBe(false);
  });
});

describe('filenameFromContentDisposition', () => {
  it('extracts the quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="leads-database-2026-09-11.csv"')).toBe(
      'leads-database-2026-09-11.csv',
    );
  });

  it('falls back to a default when the header is missing or unparseable', () => {
    expect(filenameFromContentDisposition(null)).toBe('leads-database.csv');
    expect(filenameFromContentDisposition('attachment')).toBe('leads-database.csv');
  });
});
