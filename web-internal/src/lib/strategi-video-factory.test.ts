import { describe, it, expect } from 'vitest';
import {
  parseVideoFactoryPayload,
  applyVideoFactoryPrefill,
  VIDEO_FACTORY_SCHEMA,
  type VideoFactoryPayload,
} from './strategi-video-factory';
import { blankChannel, type ChannelDraft } from '@/components/strategi/SectionB';

function payload(channel: Record<string, unknown>): VideoFactoryPayload {
  return { schema: VIDEO_FACTORY_SCHEMA, channel: { channel: 'TikTok Shop', ...channel } } as VideoFactoryPayload;
}

describe('parseVideoFactoryPayload', () => {
  it('menerima payload cdps.section_b.v1 yang sah', () => {
    const text = JSON.stringify({ schema: VIDEO_FACTORY_SCHEMA, channel: { channel: 'TikTok Shop', sku_listed: 120 } });
    const r = parseVideoFactoryPayload(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.channel.sku_listed).toBe(120);
  });

  it('menolak teks kosong dengan pesan BI dalam kurung siku', () => {
    const r = parseVideoFactoryPayload('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^\[.*\]$/);
  });

  it('menolak JSON yang bukan payload Section B (mis. baseline export lama)', () => {
    const r = parseVideoFactoryPayload(JSON.stringify({ schema: 'cdps.baseline.v1', section_b: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/versi tidak cocok/);
  });

  it('menolak teks non-JSON (mis. hasil "Copy baseline (teks)")', () => {
    const r = parseVideoFactoryPayload('BASELINE CHANNEL — CDPS SECTION B\nChannel: TikTok Shop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format tidak dikenali/);
  });

  it('menolak payload tanpa blok channel', () => {
    const r = parseVideoFactoryPayload(JSON.stringify({ schema: VIDEO_FACTORY_SCHEMA }));
    expect(r.ok).toBe(false);
  });
});

describe('applyVideoFactoryPrefill', () => {
  it('membuat channel TikTok Shop bila belum ada, dan menandainya created', () => {
    const { channels, summary } = applyVideoFactoryPrefill([], payload({ sku_listed: 100, rating_toko: 4.8 }));
    expect(channels).toHaveLength(1);
    expect(channels[0].channel).toBe('TikTok Shop');
    expect(channels[0].sku_listed).toBe('100');
    expect(channels[0].rating_toko).toBe('4.8');
    expect(summary.channelCreated).toBe(true);
    expect(summary.fieldsFilled).toBeGreaterThan(0);
  });

  it('mengisi channel TikTok Shop yang sudah ada tanpa menambah channel', () => {
    const existing = blankChannel('TikTok Shop');
    const { channels, summary } = applyVideoFactoryPrefill([existing], payload({ pengunjung_per_bulan: 5000 }));
    expect(channels).toHaveLength(1);
    expect(channels[0].pengunjung_per_bulan).toBe('5000');
    expect(summary.channelCreated).toBe(false);
  });

  it('TIDAK menimpa field yang sudah diisi AM (saran, bukan paksa)', () => {
    const existing: ChannelDraft = { ...blankChannel('TikTok Shop'), nama_toko: 'Toko Punya AM', sku_listed: '999' };
    const { channels, summary } = applyVideoFactoryPrefill(
      [existing],
      payload({ nama_toko: 'Toko dari Tool', sku_listed: 100, sku_aktif: 80 }),
    );
    expect(channels[0].nama_toko).toBe('Toko Punya AM'); // dipertahankan
    expect(channels[0].sku_listed).toBe('999'); // dipertahankan
    expect(channels[0].sku_aktif).toBe('80'); // yang kosong terisi
    expect(summary.fieldsSkipped).toBeGreaterThanOrEqual(2);
  });

  it('memetakan nilai persen apa adanya (0..100), bukan pecahan', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ conversion_rate_persen: 3.2, chat_response_rate_persen: 98, pesanan_terlambat_persen: 1.5 }),
    );
    expect(channels[0].conversion_rate_persen).toBe('3.2');
    expect(channels[0].chat_response_rate_persen).toBe('98');
    expect(channels[0].pesanan_terlambat_persen).toBe('1.5');
  });

  it('memetakan uang sebagai string rupiah major polos (siap money.parse)', () => {
    const { channels } = applyVideoFactoryPrefill(
      [],
      payload({ gmv_affiliate: '9000000', gmv_video: '12500000', top_sku: [{ nama: 'Serum A', gmv: '5000000' }] }),
    );
    expect(channels[0].gmv_affiliate).toBe('9000000');
    expect(channels[0].gmv_video).toBe('12500000');
    expect(channels[0].top_sku[0]).toEqual({
      nama: 'Serum A',
      gmv: '5000000',
      unit_terjual: '',
      harga_jual: '',
      margin_persen: '',
    });
  });

  it('mengisi list (top_sku/top_kreator/top_keyword/stok kritis) hanya bila list tujuan kosong', () => {
    const withSku: ChannelDraft = {
      ...blankChannel('TikTok Shop'),
      top_sku: [{ nama: 'SKU lama AM', gmv: '1', unit_terjual: '', harga_jual: '', margin_persen: '' }],
    };
    const { channels } = applyVideoFactoryPrefill(
      [withSku],
      payload({
        top_sku: [{ nama: 'SKU tool', gmv: '2' }],
        top_kreator: [{ nama: '@kreator', gmv: '3' }],
        top_keyword: [{ keyword: 'serum wajah' }],
        sku_stok_kritis: ['SKU tipis'],
      }),
    );
    expect(channels[0].top_sku).toHaveLength(1); // list AM dipertahankan
    expect(channels[0].top_sku[0].nama).toBe('SKU lama AM');
    expect(channels[0].top_kreator).toEqual([{ nama: '@kreator', gmv: '3' }]);
    expect(channels[0].top_keyword).toEqual([{ keyword: 'serum wajah', jumlah_order: '' }]);
    expect(channels[0].sku_stok_kritis).toEqual(['SKU tipis']);
  });

  it('membiarkan channel lain (mis. Shopee) tak tersentuh', () => {
    const shopee = { ...blankChannel('Shopee'), nama_toko: 'Toko Shopee' };
    const { channels } = applyVideoFactoryPrefill([shopee], payload({ sku_listed: 50 }));
    expect(channels).toHaveLength(2);
    expect(channels[0].channel).toBe('Shopee');
    expect(channels[0].nama_toko).toBe('Toko Shopee');
    expect(channels[1].channel).toBe('TikTok Shop');
    expect(channels[1].sku_listed).toBe('50');
  });
});
