/**
 * Saklar mati harus berarti TIDAK ADA permintaan ke
 * `/client-portal/service-progress` — bukan data diambil lalu disembunyikan.
 * Diuji di batas `@/lib/api`, satu-satunya pintu keluar ke backend.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (path: string) => get(path) } }));

import { muatRingkasan } from './ringkasan';

const PROGRES = '/client-portal/service-progress';

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (path: string) => {
    if (path === '/client-portal/health') return { label: 'Berjalan baik', periode_akhir: null };
    if (path === PROGRES) {
      return [{ nama_layanan: 'Jasa Buka Toko Online Basic', label: 'Completed', jumlah_pekerjaan: 8, jumlah_selesai: 8 }];
    }
    return [];
  });
});

describe('muatRingkasan', () => {
  it('saklar mati: tidak memanggil service-progress, services null', async () => {
    const hasil = await muatRingkasan(false);
    const paths = get.mock.calls.map((c) => c[0]);
    expect(paths).not.toContain(PROGRES);
    expect(paths).toContain('/client-portal/health');
    expect(hasil.services).toBeNull();
    expect(hasil.adaGagal).toBe(false);
  });

  it('saklar nyala: memanggil service-progress seperti sebelumnya', async () => {
    const hasil = await muatRingkasan(true);
    expect(get.mock.calls.map((c) => c[0])).toContain(PROGRES);
    expect(hasil.services).toHaveLength(1);
  });

  it('satu surface gagal tidak mengosongkan yang lain', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/client-portal/health') throw new Error('[gagal]');
      return [];
    });
    const hasil = await muatRingkasan(false);
    expect(hasil.health).toBeNull();
    expect(hasil.reports).toEqual([]);
    expect(hasil.adaGagal).toBe(true);
    expect((hasil.gagal as Error).message).toBe('[gagal]');
  });
});
