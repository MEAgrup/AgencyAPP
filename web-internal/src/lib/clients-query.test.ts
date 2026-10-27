import { describe, expect, it } from 'vitest';
import { clientsQueryString } from './clients';

// Feedback OD 27-10-2026 — filter Direktori Klien dikirim ke server.
describe('clientsQueryString', () => {
  it('tanpa filter = tanpa query string', () => {
    expect(clientsQueryString()).toBe('');
    expect(clientsQueryString({ q: '', closing_dari: '', closing_sampai: '', status_rilis: '', urut: 'terbaru' })).toBe('');
  });

  it('membawa rentang tanggal closing, status rilis, urut, dan kursor', () => {
    const p = new URLSearchParams(clientsQueryString({
      q: 'Toko A', closing_dari: '2026-10-01', closing_sampai: '2026-10-27',
      status_rilis: 'menunggu_finance', urut: 'terlama', cursor: 'abc', limit: 50,
    }));
    expect(p.get('q')).toBe('Toko A');
    expect(p.get('closing_dari')).toBe('2026-10-01');
    expect(p.get('closing_sampai')).toBe('2026-10-27');
    expect(p.get('status_rilis')).toBe('menunggu_finance');
    expect(p.get('urut')).toBe('terlama');
    expect(p.get('cursor')).toBe('abc');
    expect(p.get('limit')).toBe('50');
  });
});
