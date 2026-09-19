/**
 * G1-09-PLATFORM-DARI-DETAIL — regresi bug kelas O43 yang mematikan
 * `/account/pdt/upload` DAN `/account/pdt/laporan` di PRODUKSI (2026-09-19):
 * memilih klien mana pun menghasilkan "This page couldn't load", sementara
 * `GET /api/v1/clients` tetap menjawab 200.
 *
 * Sebabnya `ClientListRowWire` (`apps/api/src/lib/wire.ts`) adalah proyeksi
 * yang SENGAJA sempit dan TIDAK pernah memuat `platforms` — melebarkannya
 * berarti N+1 atas platforms/allocations/services untuk daftar yang tidak
 * membacanya. Tapi tipe FE `Client` menyatakan `platforms: Platform[]` WAJIB,
 * jadi `selectedClient.platforms.filter(...)` lolos typecheck dan baru meledak
 * di browser. Persis yang `CLAUDE.md` peringatkan: "Kunci yang HILANG lebih
 * berbahaya daripada null."
 *
 * Tes ini mengunci tiga hal sekaligus, dan yang PERTAMA adalah inti bug-nya:
 * sumbernya harus DETAIL klien, bukan baris roster.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClient = vi.fn();
vi.mock('@/lib/clients', () => ({ getClient: (id: string) => getClient(id) }));
vi.mock('@/lib/api', () => ({ api: {} }));

const { listPlatformPdtKlien, PDT_PLATFORMS } = await import('./pdt');

const platform = (o: Partial<Record<string, unknown>>) => ({
  client_platform_id: 1, platform: 'Shopee', active: true, tahap_fokus: null, shop_id: null, ...o,
});

beforeEach(() => getClient.mockReset());

describe('listPlatformPdtKlien', () => {
  it('membaca DETAIL klien — bukan baris roster yang tidak punya `platforms`', async () => {
    getClient.mockResolvedValue({ client: { platforms: [platform({})] } });
    await listPlatformPdtKlien('CLI-202607-0001');
    expect(getClient).toHaveBeenCalledWith('CLI-202607-0001');
  });

  it('`platforms` HILANG dari respons tidak melempar — itu yang dulu mematikan halaman', async () => {
    getClient.mockResolvedValue({ client: {} });
    await expect(listPlatformPdtKlien('CLI-202607-0001')).resolves.toEqual([]);
  });

  it('hanya toko AKTIF ber-platform PDT (PDT-22) yang lolos', async () => {
    getClient.mockResolvedValue({
      client: {
        platforms: [
          platform({ client_platform_id: 1, platform: 'Shopee' }),
          platform({ client_platform_id: 2, platform: 'TikTok Shop' }),
          platform({ client_platform_id: 3, platform: 'Shopee', active: false }),
          platform({ client_platform_id: 4, platform: 'Tokopedia' }),
          platform({ client_platform_id: 5, platform: 'Lazada' }),
        ],
      },
    });
    const rows = await listPlatformPdtKlien('CLI-202607-0001');
    expect(rows.map((p) => p.client_platform_id)).toEqual([1, 2]);
  });
});

describe('PDT_PLATFORMS', () => {
  it('cermin `platformKeVokabPdt` — Shopee + TikTok Shop, nol lainnya', () => {
    expect([...PDT_PLATFORMS].sort()).toEqual(['Shopee', 'TikTok Shop']);
  });
});
