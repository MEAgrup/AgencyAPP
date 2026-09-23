/**
 * Tests for `px-catalog-push.ts` — pure unit, nol DATABASE_URL (fetch di-mock).
 * Kontrak diuji: `docs/BRIDGE_PX_CATALOG_CONTRACT.md`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { productexchange } from '@cdps/domain';
import { catalogPushIdempotencyKey, pushCatalogSnapshot } from './px-catalog-push';

const prevUrl = process.env.MCN_BRIDGE_URL;
const prevSecret = process.env.BRIDGE_PX_SECRET;

beforeEach(() => {
  delete process.env.MCN_BRIDGE_URL;
  delete process.env.BRIDGE_PX_SECRET;
});
afterEach(() => {
  if (prevUrl === undefined) delete process.env.MCN_BRIDGE_URL;
  else process.env.MCN_BRIDGE_URL = prevUrl;
  if (prevSecret === undefined) delete process.env.BRIDGE_PX_SECRET;
  else process.env.BRIDGE_PX_SECRET = prevSecret;
});

function samplePayload(rows: productexchange.PxCatalogSnapshotRow[] = []): productexchange.PxCatalogSnapshotPayload {
  return {
    snapshotAt: '2026-09-23T02:14:00.000Z',
    source: 'cdps',
    policyNote: 'px_catalog_item_v; verdict lolos pada policy aktif v3',
    rows,
  };
}

const oneRow: productexchange.PxCatalogSnapshotRow = {
  clientPlatformId: '42', // bigint di DB → string dari postgres.js, bukan number
  platformProductId: '1729384756102',
  namaProduk: 'Serum Wajah 30ml',
  platform: 'tiktok',
  namaToko: 'Toko Contoh Official',
  level2Category: 'Kecantikan',
  priceSegment: 'high',
  sudahAfiliasi: false,
  dihitungPada: new Date('2026-09-22T18:00:00.000Z'),
};

describe('pushCatalogSnapshot — MCN_BRIDGE_URL/BRIDGE_PX_SECRET belum diset', () => {
  it('no-op eksplisit (configured:false), nol percobaan fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await pushCatalogSnapshot(samplePayload([oneRow]), { fetchImpl });
    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_configured');
    expect(result.rowsSent).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('pushCatalogSnapshot — terkonfigurasi', () => {
  beforeEach(() => {
    process.env.MCN_BRIDGE_URL = 'https://mcn.example.test/';
    process.env.BRIDGE_PX_SECRET = 's3cr3t-px';
  });

  it('mengirim envelope + body PERSIS kontrak (snake_case, 9 kolom baris)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ batch_key: 'px-catalog-20260923-abc123456789', rows_received: 1, duplicate: false }), {
        status: 200,
      }),
    );
    const result = await pushCatalogSnapshot(samplePayload([oneRow]), { fetchImpl, now: new Date('2026-09-23T03:00:00Z') });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // Trailing slash pada MCN_BRIDGE_URL tidak melahirkan // ganda.
    expect(url).toBe('https://mcn.example.test/api/bridge/px-catalog');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer s3cr3t-px',
      'Content-Type': 'application/json',
    });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^px-catalog-20260923-[0-9a-f]{12}$/);

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      snapshot_at: '2026-09-23T02:14:00.000Z',
      source: 'cdps',
      policy_note: 'px_catalog_item_v; verdict lolos pada policy aktif v3',
      rows: [
        {
          client_platform_id: '42', // string — kontrak z.string(), bukan number CDPS
          platform_product_id: '1729384756102',
          nama_produk: 'Serum Wajah 30ml',
          platform: 'tiktok',
          nama_toko: 'Toko Contoh Official',
          level2_category: 'Kecantikan',
          price_segment: 'high',
          sudah_afiliasi: false,
          dihitung_pada: '2026-09-22T18:00:00.000Z',
        },
      ],
    });

    expect(result).toMatchObject({ configured: true, ok: true, status: 200, rowsSent: 1, rowsReceived: 1, duplicate: false });
  });

  it('rows boleh kosong (kontrak §Non-negotiables #6 — katalog PX kosong sekarang, bukan 422)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ batch_key: 'px-catalog-20260923-000000000000', rows_received: 0, duplicate: false }), {
        status: 200,
      }),
    );
    const result = await pushCatalogSnapshot(samplePayload([]), { fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.rows).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('key idempotensi STABIL untuk payload+tanggal identik, BEDA untuk payload berbeda', () => {
    const wireA = { snapshot_at: 'x', source: 'cdps' as const, policy_note: 'n', rows: [] };
    const wireB = { snapshot_at: 'y', source: 'cdps' as const, policy_note: 'n', rows: [] };
    const now = new Date('2026-09-23T00:00:00Z');
    expect(catalogPushIdempotencyKey(wireA, now)).toBe(catalogPushIdempotencyKey(wireA, now));
    expect(catalogPushIdempotencyKey(wireA, now)).not.toBe(catalogPushIdempotencyKey(wireB, now));
    expect(catalogPushIdempotencyKey(wireA, now)).toMatch(/^px-catalog-20260923-[0-9a-f]{12}$/);
  });

  it('MCN 422 (kontrak dilanggar) → ok:false, error dari body, TIDAK melempar', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "[payload katalog PX tidak sesuai kontrak: kolom 'x' tidak dikenal]" }), {
        status: 422,
      }),
    );
    const result = await pushCatalogSnapshot(samplePayload([oneRow]), { fetchImpl });
    expect(result).toMatchObject({ configured: true, ok: false, status: 422 });
    expect(result.error).toContain('tidak sesuai kontrak');
  });

  it('MCN 401 (secret salah) → ok:false, TIDAK melempar', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    const result = await pushCatalogSnapshot(samplePayload([oneRow]), { fetchImpl });
    expect(result).toMatchObject({ configured: true, ok: false, status: 401, error: 'Unauthorized' });
  });

  it('kegagalan jaringan (fetch melempar) → ok:false, status 0, TIDAK melempar ulang', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));
    const result = await pushCatalogSnapshot(samplePayload([oneRow]), { fetchImpl });
    expect(result).toMatchObject({ configured: true, ok: false, status: 0 });
    expect(result.error).toContain('ECONNREFUSED');
  });
});
