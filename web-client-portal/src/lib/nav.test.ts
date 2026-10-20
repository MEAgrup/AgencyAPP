import { describe, expect, it } from 'vitest';
import { navItems } from './nav';

describe('navItems', () => {
  it('menyembunyikan Progres Layanan saat saklar mati', () => {
    expect(navItems(false).map((n) => n.label)).toEqual(['Ringkasan', 'Laporan', 'Ajukan Komplain']);
    expect(navItems(false).some((n) => n.href === '/progres')).toBe(false);
  });

  it('menampilkan semua tab, urutan seperti semula, saat saklar nyala', () => {
    expect(navItems(true).map((n) => n.href)).toEqual(['/', '/laporan', '/progres', '/komplain']);
  });
});
