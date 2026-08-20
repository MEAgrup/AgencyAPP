/**
 * RAB-04/RAB-05 — pure unit tests (no DB): the platform→method registry and the
 * auto-fill mapping. The DB-backed behaviour (one row per active platform, audit,
 * server timestamp, tampered-payload rejection) is in `riset-awal.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveIsianFromClient,
  deriveIsianFromManual,
  deriveIsianFromPayload,
  metodeForPlatform,
  type BaselinePayloadLike,
  type ManualBaselineInput,
} from './riset-awal';

describe('RAB-04 · platform → method registry', () => {
  it('TikTok Shop is the only full-engine platform; Tokopedia is thin; rest manual', () => {
    expect(metodeForPlatform('TikTok Shop')).toBe('analisa_penuh');
    expect(metodeForPlatform('tiktok shop')).toBe('analisa_penuh'); // case-insensitive
    expect(metodeForPlatform('Tokopedia')).toBe('analisa_tipis');
    expect(metodeForPlatform('Shopee')).toBe('manual');
    expect(metodeForPlatform('Lazada')).toBe('manual');
    expect(metodeForPlatform('Blibli')).toBe('manual');
  });
});

describe('RAB-05 · auto-fill mapping from an analisa_penuh payload', () => {
  const payload: BaselinePayloadLike = {
    schema: 'cdps.baseline.tiktok.v1',
    toko: { aov: 150000 }, // Rp150.000
    produk: { sku_total: 42 },
    skor: { total: 80, kondisi_toko: 'mesin_jalan' },
  };

  it('maps toko.aov → B2-9 (money, ×100 minor units) and produk.sku_total → B2-3 (count)', () => {
    const isian = deriveIsianFromPayload(payload);
    const b29 = isian.find((f) => f.fieldKey === 'B2-9');
    const b23 = isian.find((f) => f.fieldKey === 'B2-3');

    expect(b29).toBeDefined();
    expect(b29?.section).toBe('B2');
    expect(b29?.sumber).toBe('analisa');
    expect(b29?.nilaiUang).toBe(15_000_000n); // Rp150.000 → 15.000.000 minor
    expect(b29?.nilaiAngka).toBeNull();

    expect(b23).toBeDefined();
    expect(b23?.nilaiAngka).toBe(42);
    expect(b23?.nilaiUang).toBeNull();
  });

  it('carries the original proposal frozen in nilaiUsulan (keputusan 1)', () => {
    const b29 = deriveIsianFromPayload(payload).find((f) => f.fieldKey === 'B2-9');
    expect(b29?.nilaiUsulan).toEqual({ nilai_uang: '15000000', aov_rupiah: 150000 });
  });

  it('maps runrate_3m → B1-5 as a 3-month TOTAL (× 3), never median_6m, never B3-3/B7-3', () => {
    const rich: BaselinePayloadLike = {
      ...payload,
      gmv_baseline: { cakupan_riwayat: 'cukup', runrate_3m: 30_000_000 }, // Rp30jt/bln
    };
    const isian = deriveIsianFromPayload(rich);
    const b15 = isian.find((f) => f.fieldKey === 'B1-5');
    expect(b15).toBeDefined();
    expect(b15?.section).toBe('B1');
    expect(b15?.sumber).toBe('analisa');
    expect(b15?.nilaiUang).toBe(9_000_000_000n); // 30jt × 3 = 90jt rupiah → 9jt×1000 minor
    expect(b15?.nilaiUsulan).toEqual({ nilai_uang: '9000000000', runrate_3m_rupiah: 30_000_000, rumus: 'omzet_3bln = runrate_3m × 3' });
    const keys = isian.map((f) => f.fieldKey);
    expect(keys).not.toContain('B3-3'); // ruang harga stays an interview question
    expect(keys).not.toContain('B7-3'); // kesiapan akses stays an interview question
    expect(keys.sort()).toEqual(['B1-5', 'B2-3', 'B2-9']);
  });

  it('does NOT map B1-5 when the baseline has no 3-month run-rate (absent ≠ zero)', () => {
    // median_6m present but runrate_3m absent/zero ⇒ no B1-5 (never median_6m).
    const noRr: BaselinePayloadLike = { ...payload, gmv_baseline: { cakupan_riwayat: 'kurang', runrate_3m: 0 } };
    expect(deriveIsianFromPayload(noRr).map((f) => f.fieldKey)).not.toContain('B1-5');
    const undef: BaselinePayloadLike = { ...payload, gmv_baseline: { cakupan_riwayat: 'kurang' } };
    expect(deriveIsianFromPayload(undef).map((f) => f.fieldKey)).not.toContain('B1-5');
  });

  it('omits a metric the export did not carry (absent ≠ zero, baseline fix #2)', () => {
    const partial: BaselinePayloadLike = { schema: 'cdps.baseline.tiktok.v1', toko: { aov: 200000 }, skor: { total: 70 } };
    const isian = deriveIsianFromPayload(partial);
    expect(isian.map((f) => f.fieldKey)).toEqual(['B2-9']); // no sku_total ⇒ no B2-3
  });
});

describe('RAB-05 · auto-fill mapping from a manual entry (sumber=manual)', () => {
  const manual: ManualBaselineInput = {
    gmvBulan: 5_000_000,
    order: 120,
    aov: 41_666,
    skuTotal: 15,
    belanjaIklan: 500_000,
    roas: 3.2,
  };

  it('maps aov → B2-9, skuTotal → B2-3, and gmvBulan × 3 → B1-5 with sumber=manual', () => {
    const isian = deriveIsianFromManual(manual);
    const b29 = isian.find((f) => f.fieldKey === 'B2-9');
    const b23 = isian.find((f) => f.fieldKey === 'B2-3');
    const b15 = isian.find((f) => f.fieldKey === 'B1-5');
    expect(b29?.sumber).toBe('manual');
    expect(b29?.nilaiUang).toBe(4_166_600n); // Rp41.666 → 4.166.600 minor
    expect(b23?.sumber).toBe('manual');
    expect(b23?.nilaiAngka).toBe(15);
    // B1-5 "omzet 3 bulan" = gmvBulan (Rp5jt/bln) × 3 = Rp15jt → 1.500.000.000 minor.
    expect(b15?.section).toBe('B1');
    expect(b15?.sumber).toBe('manual');
    expect(b15?.nilaiUang).toBe(1_500_000_000n);
  });

  it('does NOT map B1-5 when gmvBulan is zero (absent ≠ zero)', () => {
    const isian = deriveIsianFromManual({ ...manual, gmvBulan: 0 });
    expect(isian.map((f) => f.fieldKey)).not.toContain('B1-5');
  });
});

describe('QA 2026-08-20 · B6-3 from the client Target GMV (sumber=sales)', () => {
  it('maps target_gmv (monthly) × 3 → B6-3 as a 3-month total in minor units', () => {
    const isian = deriveIsianFromClient(100_000_000); // Rp100jt/bln
    expect(isian).toHaveLength(1);
    const b63 = isian[0];
    expect(b63.section).toBe('B6');
    expect(b63.fieldKey).toBe('B6-3');
    expect(b63.sumber).toBe('sales');
    expect(b63.nilaiUang).toBe(30_000_000_000n); // 100jt × 3 = 300jt → 30.000.000.000 minor
    expect(b63.nilaiUsulan).toEqual({ nilai_uang: '30000000000', target_gmv_bulan_rupiah: 100_000_000, rumus: 'target_3bln = target_gmv × 3' });
  });

  it('proposes nothing when Target GMV is missing or non-positive (AM types B6-3 by hand)', () => {
    expect(deriveIsianFromClient(null)).toEqual([]);
    expect(deriveIsianFromClient(0)).toEqual([]);
    expect(deriveIsianFromClient(-1)).toEqual([]);
  });
});
