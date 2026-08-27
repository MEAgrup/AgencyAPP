import { describe, it, expect } from 'vitest';
import { applyVideoFactoryToManual, parseVideoFactoryPayload, type ManualBaselineFields } from './riset-awal-video-factory';
import { VIDEO_FACTORY_SCHEMA } from './strategi-video-factory';

const EMPTY: ManualBaselineFields = {
  gmv_bulan: '',
  order: '',
  aov: '',
  sku_total: '',
  belanja_iklan: '',
  roas: '',
  periode_mulai: '',
  periode_akhir: '',
  tanggal_ambil: '',
};

function payloadText(channel: Record<string, unknown>): string {
  return JSON.stringify({ schema: VIDEO_FACTORY_SCHEMA, channel: { channel: 'Tokopedia', ...channel } });
}

describe('applyVideoFactoryToManual', () => {
  it('mengisi GMV/bulan, order, dan jumlah SKU dari payload yang cocok platform-nya', () => {
    const parsed = parseVideoFactoryPayload(
      payloadText({
        sku_listed: 84,
        tanggal_ambil_data: '2026-08-20',
        baseline: [
          { month_index: 1, gmv: '45000000', jumlah_pesanan: 900 },
          { month_index: 2, gmv: '45000000', jumlah_pesanan: 900 },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = applyVideoFactoryToManual(EMPTY, parsed.payload, 'Tokopedia');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.gmv_bulan).toBe('45000000');
    expect(result.fields.order).toBe('900');
    expect(result.fields.sku_total).toBe('84');
    expect(result.fields.tanggal_ambil).toBe('2026-08-20');
    // Not in the payload — stay manual.
    expect(result.fields.aov).toBe('');
    expect(result.fields.belanja_iklan).toBe('');
    expect(result.fields.roas).toBe('');
    expect(result.summary.fieldsFilled).toBe(4);
  });

  it('tidak menimpa field yang sudah diketik AM', () => {
    const parsed = parseVideoFactoryPayload(payloadText({ sku_listed: 84, baseline: [{ month_index: 1, gmv: '45000000', jumlah_pesanan: 900 }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const current: ManualBaselineFields = { ...EMPTY, gmv_bulan: '99999999' };
    const result = applyVideoFactoryToManual(current, parsed.payload, 'Tokopedia');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.gmv_bulan).toBe('99999999');
    expect(result.fields.order).toBe('900');
    expect(result.summary.fieldsSkipped).toBe(1);
  });

  it('menolak payload yang platform-nya tidak cocok dengan tab yang sedang dibuka', () => {
    const parsed = parseVideoFactoryPayload(payloadText({ sku_listed: 84 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = applyVideoFactoryToManual(EMPTY, parsed.payload, 'Shopee');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^\[.*\]$/);
    expect(result.error).toMatch(/Tokopedia/);
  });

  it('mengambil baris baseline dengan month_index tertinggi', () => {
    const parsed = parseVideoFactoryPayload(
      payloadText({
        baseline: [
          { month_index: 2, gmv: '20000000', jumlah_pesanan: 400 },
          { month_index: 1, gmv: '10000000', jumlah_pesanan: 200 },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = applyVideoFactoryToManual(EMPTY, parsed.payload, 'Tokopedia');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.gmv_bulan).toBe('20000000');
    expect(result.fields.order).toBe('400');
  });
});
