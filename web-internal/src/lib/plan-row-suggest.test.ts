import { describe, expect, it } from 'vitest';
import type { PlanRow } from './plan';
import {
  ALASAN_LABEL,
  KANDIDAT_DIDAHULUKAN,
  PILAR_PILIH_DIVISI,
  PILAR_TO_DIVISI,
  PILAR_BARIS,
  kandidatDivisi,
  kekuranganPilar,
  parseAngkaTarget,
  parseTargetKuota,
  suggestRowFromPillar,
} from './plan-row-suggest';
import { DIVISI_KERJA } from './divisions';
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

  it('suggests the pillar SKU (E-3/E-4) as a one-item SKU Sasaran (PC-5)', () => {
    const s = suggestRowFromPillar(pillar({ jenis: 'harga', sku: 'RAK-A' }));
    expect(s.skuSasaran).toEqual(['RAK-A']);
  });

  it('leaves SKU Sasaran empty when the pillar names no SKU', () => {
    const s = suggestRowFromPillar(pillar({ sku: null }));
    expect(s.skuSasaran).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cermin `packages/core/src/planpillar.ts` (B5)
// ---------------------------------------------------------------------------
//
// Berkas ini salinan manual, jadi tesnya sengaja MENGULANG tes core yang sama:
// kalau salah satu rumah berubah sendirian, salah satu dari dua suite ini yang
// jatuh. Angka acuannya `packages/core/src/planpillar.test.ts`.

describe('parseAngkaTarget — konvensi angka Indonesia', () => {
  it('titik = ribuan, koma = desimal', () => {
    expect(parseAngkaTarget('30')).toBe(30);
    expect(parseAngkaTarget('15.000')).toBe(15000);
    expect(parseAngkaTarget('15.000.000')).toBe(15000000);
    expect(parseAngkaTarget('7,5')).toBe(7.5);
    expect(parseAngkaTarget('15.000,25')).toBe(15000.25);
  });

  it('menolak bentuk yang bukan salah satu konvensi', () => {
    expect(parseAngkaTarget('1.5')).toBeNull();
    expect(parseAngkaTarget('15.00')).toBeNull();
    expect(parseAngkaTarget('7,555')).toBeNull();
    expect(parseAngkaTarget('abc')).toBeNull();
  });
});

describe('parseTargetKuota', () => {
  it('angka berpemisah ribuan dibaca utuh, bukan dipenggal jadi 15', () => {
    expect(parseTargetKuota('15.000.000 rupiah belanja iklan')).toEqual({
      kuota: 15000000,
      satuan: 'rupiah',
    });
  });

  it('null saat tak ada angka pembuka', () => {
    expect(parseTargetKuota('sebanyak 30 video')).toBeNull();
    expect(parseTargetKuota(null)).toBeNull();
  });
});

describe('suggestRowFromPillar — sisa cermin', () => {
  it('mengusulkan teks target sebagai hasil diharapkan (PC-11)', () => {
    expect(suggestRowFromPillar(pillar()).hasilDiharapkan).toBe(
      '30 video, jembatan Video bertayangan / bulan',
    );
  });

  it('tidak mengusulkan kuota dari angka yang ambigu', () => {
    const s = suggestRowFromPillar(pillar({ target: '1.5 juta belanja iklan' }));
    expect(s.kuota).toBe('');
  });

  it('lima jenis berdivisi + tiga jenis pilih-divisi, tanpa tumpang tindih', () => {
    expect(Object.keys(PILAR_TO_DIVISI).sort()).toEqual([
      'affiliate',
      'iklan',
      'konten',
      'live',
      'operasional',
    ]);
    for (const j of PILAR_PILIH_DIVISI) expect(PILAR_TO_DIVISI[j]).toBeUndefined();
  });

  it('setiap divisi tujuan ada di DIVISI_KERJA (cermin briefAssignableNames)', () => {
    for (const nama of Object.values(PILAR_TO_DIVISI)) {
      expect(DIVISI_KERJA as readonly string[]).toContain(nama);
    }
    for (const nama of KANDIDAT_DIDAHULUKAN) {
      expect(DIVISI_KERJA as readonly string[]).toContain(nama);
    }
  });
});

describe('kandidatDivisi', () => {
  it('mendahulukan AI Optimizer + Store Operation tanpa membuang sisanya', () => {
    const k = kandidatDivisi(DIVISI_KERJA);
    expect(k.slice(0, 2)).toEqual(['AI Optimizer', 'Store Operation']);
    expect([...k].sort()).toEqual([...DIVISI_KERJA].sort());
  });
});

describe('ALASAN_LABEL', () => {
  it('punya label BI untuk keempat alasan', () => {
    for (const a of ['bukan_pilar_kerja', 'butuh_divisi', 'butuh_kuota', 'butuh_channel']) {
      expect(ALASAN_LABEL[a]?.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// kekuranganPilar — panel "Pilar Strategi belum jadi baris kerja" (B5)
// ---------------------------------------------------------------------------

function row(over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 1,
    plan_id: 'PLAN-202608-0001',
    channel: 'Shopee',
    pilar: 'konten',
    strategi_pillar_id: null,
    service_id: null,
    di_luar_strategi: true,
    di_luar_service: false,
    di_luar_alasan: null,
    aksi: '',
    sku_sasaran: [],
    kuota: 30,
    satuan: 'video',
    budget: null,
    divisi_pic: 'Creative',
    minggu_sasaran: [],
    prioritas: 'Penting',
    hasil_diharapkan: '',
    prasyarat: null,
    instruksi_brief: null,
    status_baris: 'Rencana',
    status_baris_alasan: null,
    visibilitas: 'Bagikan ke Klien',
    keberatan_kapasitas: false,
    keberatan_alasan: null,
    terbawa: false,
    periode_asal_id: null,
    ...over,
  } as PlanRow;
}

describe('kekuranganPilar', () => {
  it('PILAR_BARIS = delapan pilar kerja, tanpa tidak_dikerjakan', () => {
    expect(PILAR_BARIS).toEqual([
      'affiliate',
      'harga',
      'iklan',
      'konten',
      'live',
      'operasional',
      'retensi',
      'sku',
    ]);
  });

  it('pilar lengkap yang sudah disemai server tidak muncul lagi', () => {
    // Pilar konten ber-channel + ber-kuota: server sudah menyemainya, dan
    // barisnya ada. Panel harus diam.
    const p = pillar({ id: 7 });
    expect(kekuranganPilar([p], [row({ strategi_pillar_id: 7 })], ['Shopee'])).toEqual([]);
  });

  it('pilar lengkap yang barisnya DIHAPUS AM tetap tidak ditawarkan ulang', () => {
    expect(kekuranganPilar([pillar({ id: 7 })], [], ['Shopee'])).toEqual([]);
  });

  it('sku/harga/retensi muncul dengan alasan butuh_divisi dan usulan lain terisi', () => {
    const k = kekuranganPilar([pillar({ id: 3, jenis: 'harga', sku: 'RAK-A' })], [], ['Shopee']);
    expect(k).toHaveLength(1);
    expect(k[0].alasan).toEqual(['butuh_divisi']);
    expect(k[0].divisiPic).toBeNull();
    expect(k[0].channel).toBe('TikTok Shop');
    expect(k[0].kuota).toBe(30);
    expect(k[0].satuan).toBe('video');
  });

  it('mengumpulkan semua alasan sekaligus', () => {
    const k = kekuranganPilar(
      [pillar({ id: 4, jenis: 'sku', channel: null, target: 'rapikan listing' })],
      [],
      ['Shopee', 'Tokopedia'],
    );
    expect(k[0].alasan).toEqual(['butuh_divisi', 'butuh_channel', 'butuh_kuota']);
    expect(k[0].kuota).toBeNull();
  });

  it('tidak_dikerjakan tak pernah muncul di panel', () => {
    expect(kekuranganPilar([pillar({ id: 5, jenis: 'tidak_dikerjakan' })], [], ['Shopee'])).toEqual(
      [],
    );
  });

  it('pilar lintas channel pada Strategi satu channel tidak muncul (server menyemainya)', () => {
    expect(kekuranganPilar([pillar({ id: 6, channel: null })], [], ['Shopee'])).toEqual([]);
  });

  it('baris di luar strategi tidak dianggap menutupi pilar mana pun', () => {
    const k = kekuranganPilar(
      [pillar({ id: 8, jenis: 'sku' })],
      [row({ strategi_pillar_id: null, di_luar_strategi: true })],
      ['Shopee'],
    );
    expect(k).toHaveLength(1);
  });
});
