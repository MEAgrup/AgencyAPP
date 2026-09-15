import { describe, expect, it } from 'vitest';
import {
  bacaVokabPlatform,
  evaluasiLapis,
  hitungPriceSegment,
  jendelaBulanPenuh,
  type PriceSegmentBand,
  type PxEvaluasiInput,
} from './gerbang';

const BANDS: readonly PriceSegmentBand[] = [
  { segment: 'low', maxIdr: 100_000 },
  { segment: 'mid', maxIdr: 500_000 },
  { segment: 'high', maxIdr: null },
];

function baseInput(overrides: Partial<PxEvaluasiInput> = {}): PxEvaluasiInput {
  return {
    shopId: 'shop-1',
    platform: 'TikTok Shop',
    policyPlatforms: ['tiktok', 'shopee'],
    salesThresholdIdr: 200_000_000,
    volume: { gmv30d: 340_000_000, jendelaMulai: '2026-07-01', jendelaSelesai: '2026-07-31' },
    level2Category: 'Sepatu Wanita',
    hargaSatuanTerakhir: 185_000,
    priceSegmentBands: BANDS,
    coverageStatus: 'covered',
    ...overrides,
  };
}

describe('bacaVokabPlatform', () => {
  it('maps Shopee/TikTok Shop, null for anything else', () => {
    expect(bacaVokabPlatform('Shopee')).toBe('shopee');
    expect(bacaVokabPlatform('TikTok Shop')).toBe('tiktok');
    expect(bacaVokabPlatform('Tokopedia')).toBeNull();
    expect(bacaVokabPlatform('Lazada')).toBeNull();
  });
});

describe('jendelaBulanPenuh', () => {
  it('accepts a full calendar month, including a leap-year February', () => {
    expect(jendelaBulanPenuh('2026-07-01', '2026-07-31')).toBe(true);
    expect(jendelaBulanPenuh('2024-02-01', '2024-02-29')).toBe(true); // leap year
    expect(jendelaBulanPenuh('2026-02-01', '2026-02-28')).toBe(true); // non-leap
  });

  it('rejects a partial window (e.g. 1-30 July, missing the 31st)', () => {
    expect(jendelaBulanPenuh('2026-07-01', '2026-07-30')).toBe(false);
  });

  it('rejects a window not starting on day 1, or spanning two months', () => {
    expect(jendelaBulanPenuh('2026-07-02', '2026-07-31')).toBe(false);
    expect(jendelaBulanPenuh('2026-07-01', '2026-08-31')).toBe(false);
  });
});

describe('hitungPriceSegment', () => {
  it('picks the first band whose max is inclusive of the price', () => {
    expect(hitungPriceSegment(100_000, BANDS)).toBe('low'); // upper bound inclusive
    expect(hitungPriceSegment(100_001, BANDS)).toBe('mid');
    expect(hitungPriceSegment(500_000, BANDS)).toBe('mid');
    expect(hitungPriceSegment(500_001, BANDS)).toBe('high');
    expect(hitungPriceSegment(999_999_999, BANDS)).toBe('high'); // null max = unbounded
  });

  it('returns null when bands is empty', () => {
    expect(hitungPriceSegment(100, [])).toBeNull();
  });
});

describe('evaluasiLapis — L1', () => {
  it('tanpa_agency_plan when shop_id is null, before any other layer runs', () => {
    const r = evaluasiLapis(baseInput({ shopId: null, volume: null }));
    expect(r).toEqual({ verdict: 'tanpa_agency_plan', lapisGagal: 1, levelCategory: null, priceSegment: null });
  });

  it('platform_belum_didukung for an unmapped platform (Tokopedia)', () => {
    const r = evaluasiLapis(baseInput({ platform: 'Tokopedia' }));
    expect(r.verdict).toBe('platform_belum_didukung');
    expect(r.lapisGagal).toBe(1);
  });

  it('platform_belum_didukung when the mapped vocab is outside policy.platforms', () => {
    const r = evaluasiLapis(baseInput({ policyPlatforms: ['shopee'] }));
    expect(r.verdict).toBe('platform_belum_didukung');
    expect(r.lapisGagal).toBe(1);
  });

  it('lolos L1 with shop_id set and platform in policy', () => {
    const r = evaluasiLapis(baseInput());
    expect(r.verdict).toBe('lolos');
  });
});

describe('evaluasiLapis — L2', () => {
  it('data_tidak_lengkap when there is no volume row at all', () => {
    const r = evaluasiLapis(baseInput({ volume: null }));
    expect(r).toEqual({ verdict: 'data_tidak_lengkap', lapisGagal: 2, levelCategory: null, priceSegment: null });
  });

  it('data_tidak_lengkap on a partial window — never extrapolates (Rule 6)', () => {
    const r = evaluasiLapis(
      baseInput({ volume: { gmv30d: 999_999_999, jendelaMulai: '2026-07-01', jendelaSelesai: '2026-07-30' } }),
    );
    expect(r.verdict).toBe('data_tidak_lengkap');
    expect(r.lapisGagal).toBe(2);
  });

  it('volume_kurang when gmv30d is below the threshold (Avitaskin example, PRD §5)', () => {
    const r = evaluasiLapis(
      baseInput({ volume: { gmv30d: 10_945_407, jendelaMulai: '2026-07-01', jendelaSelesai: '2026-07-31' } }),
    );
    expect(r.verdict).toBe('volume_kurang');
    expect(r.lapisGagal).toBe(2);
    // L2 failure must not carry L3/L4 provenance (Rule 1: L3 is never asked for a SKU that failed L2).
    expect(r.levelCategory).toBeNull();
    expect(r.priceSegment).toBeNull();
  });

  it('lolos L2 when gmv30d meets the threshold exactly', () => {
    const r = evaluasiLapis(
      baseInput({ volume: { gmv30d: 200_000_000, jendelaMulai: '2026-07-01', jendelaSelesai: '2026-07-31' } }),
    );
    expect(r.verdict).toBe('lolos');
  });
});

describe('evaluasiLapis — L3', () => {
  it('kategori_belum_dikonfirmasi when level2Category is null', () => {
    const r = evaluasiLapis(baseInput({ level2Category: null }));
    expect(r.verdict).toBe('kategori_belum_dikonfirmasi');
    expect(r.lapisGagal).toBe(3);
    expect(r.levelCategory).toBeNull();
  });

  it('kategori_belum_dikonfirmasi when harga_satuan_terakhir is null, category kept as provenance', () => {
    const r = evaluasiLapis(baseInput({ hargaSatuanTerakhir: null }));
    expect(r.verdict).toBe('kategori_belum_dikonfirmasi');
    expect(r.lapisGagal).toBe(3);
    expect(r.levelCategory).toBe('Sepatu Wanita');
    expect(r.priceSegment).toBeNull();
  });

  it('lolos L3 and computes price_segment from harga_satuan_terakhir', () => {
    const r = evaluasiLapis(baseInput({ coverageStatus: null }));
    expect(r.priceSegment).toBe('mid');
  });
});

describe('evaluasiLapis — L4', () => {
  it('kreator_kosong when the latest snapshot has zero coverage (Tas Wanita example, PRD §5)', () => {
    const r = evaluasiLapis(baseInput({ coverageStatus: 'kosong' }));
    expect(r.verdict).toBe('kreator_kosong');
    expect(r.lapisGagal).toBe(4);
    expect(r.levelCategory).toBe('Sepatu Wanita');
    expect(r.priceSegment).toBe('mid');
  });

  it('kreator_kosong when there is no snapshot row at all for (category, segment)', () => {
    const r = evaluasiLapis(baseInput({ coverageStatus: null }));
    expect(r.verdict).toBe('kreator_kosong');
    expect(r.lapisGagal).toBe(4);
  });

  it('lolos end to end (Sepatu Wanita / mid example, PRD §5)', () => {
    const r = evaluasiLapis(baseInput());
    expect(r).toEqual({ verdict: 'lolos', lapisGagal: null, levelCategory: 'Sepatu Wanita', priceSegment: 'mid' });
  });
});
