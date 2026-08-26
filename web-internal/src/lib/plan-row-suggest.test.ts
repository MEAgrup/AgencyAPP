import { describe, expect, it } from 'vitest';
import { suggestRowFromPillar } from './plan-row-suggest';
import type { StrategiPillar } from './strategi';

function pillar(over: Partial<StrategiPillar> = {}): StrategiPillar {
  return {
    id: 1,
    jenis: 'konten',
    channel: 'TikTok Shop',
    urutan: 1,
    sku: null,
    peran: null,
    aksi: 'V2 Naikkan kuota video',
    target: '30 video, jembatan Video bertayangan / bulan',
    harga_normal: null,
    harga_promo: null,
    floor_price: null,
    vendor_id: null,
    slot_jam: null,
    tarif: null,
    target_gmv_per_jam: null,
    detail: {},
    ...over,
  };
}

describe('suggestRowFromPillar', () => {
  it('extracts aksi, kuota, satuan, and divisi PIC from a Cockpit-style konten pillar', () => {
    const s = suggestRowFromPillar(pillar());
    expect(s.aksi).toBe('V2 Naikkan kuota video');
    expect(s.kuota).toBe('30');
    expect(s.satuan).toBe('video');
    expect(s.divisiPic).toBe('Creative');
  });

  it('maps iklan/affiliate/live/operasional to their owning division', () => {
    expect(suggestRowFromPillar(pillar({ jenis: 'iklan' })).divisiPic).toBe('Ads');
    expect(suggestRowFromPillar(pillar({ jenis: 'affiliate' })).divisiPic).toBe('KOL');
    expect(suggestRowFromPillar(pillar({ jenis: 'live' })).divisiPic).toBe('Live Stream');
    expect(suggestRowFromPillar(pillar({ jenis: 'operasional' })).divisiPic).toBe('Ops');
  });

  it('leaves divisi PIC unset for sku/harga/retensi — no single owning division', () => {
    expect(suggestRowFromPillar(pillar({ jenis: 'sku' })).divisiPic).toBeNull();
    expect(suggestRowFromPillar(pillar({ jenis: 'harga' })).divisiPic).toBeNull();
    expect(suggestRowFromPillar(pillar({ jenis: 'retensi' })).divisiPic).toBeNull();
  });

  it('does not fabricate a quantity when target has no leading number', () => {
    const s = suggestRowFromPillar(pillar({ target: 'perbaikan listing hero SKU' }));
    expect(s.kuota).toBe('');
    expect(s.satuan).toBe('');
  });

  it('handles a decimal quantity with a comma', () => {
    const s = suggestRowFromPillar(pillar({ target: '7,5 jam, jembatan Jam live / minggu' }));
    expect(s.kuota).toBe('7.5');
    expect(s.satuan).toBe('jam');
  });
});
