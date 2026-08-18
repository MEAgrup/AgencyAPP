/**
 * RAB-04/RAB-05 — pure unit tests (no DB): the platform→method registry and the
 * auto-fill mapping. The DB-backed behaviour (one row per active platform, audit,
 * server timestamp, tampered-payload rejection) is in `riset-awal.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
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

  it('NEVER maps median_6m/runrate_3m to B1-5, and never proposes B3-3 or B7-3 (§5.2 + human judgement)', () => {
    const rich: BaselinePayloadLike = {
      ...payload,
      gmv_baseline: { cakupan_riwayat: 'cukup' },
    };
    const keys = deriveIsianFromPayload(rich).map((f) => f.fieldKey);
    expect(keys).not.toContain('B1-5'); // median_6m is monthly; B1-5 is a 3-month total
    expect(keys).not.toContain('B3-3'); // ruang harga stays an interview question
    expect(keys).not.toContain('B7-3'); // kesiapan akses stays an interview question
    expect(keys.sort()).toEqual(['B2-3', 'B2-9']);
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

  it('maps aov → B2-9 and skuTotal → B2-3 with sumber=manual', () => {
    const isian = deriveIsianFromManual(manual);
    const b29 = isian.find((f) => f.fieldKey === 'B2-9');
    const b23 = isian.find((f) => f.fieldKey === 'B2-3');
    expect(b29?.sumber).toBe('manual');
    expect(b29?.nilaiUang).toBe(4_166_600n); // Rp41.666 → 4.166.600 minor
    expect(b23?.sumber).toBe('manual');
    expect(b23?.nilaiAngka).toBe(15);
  });
});
