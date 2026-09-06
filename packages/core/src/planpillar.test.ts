import { describe, expect, it } from 'vitest';
import * as division from './division';
import * as plantask from './plantask';
import {
  ALASAN_LABEL,
  KANDIDAT_DIDAHULUKAN,
  PILAR_BARIS,
  PILAR_PILIH_DIVISI,
  PILAR_TO_DIVISI,
  kandidatDivisi,
  parseAngkaTarget,
  parseTargetKuota,
  satuanKanonik,
  seedRowFromPillar,
  type PillarSeedInput,
} from './planpillar';

function pillar(over: Partial<PillarSeedInput> = {}): PillarSeedInput {
  return {
    id: 1,
    jenis: 'konten',
    channel: 'TikTok Shop',
    aksi: 'V2 Naikkan kuota video',
    target: '30 video, jembatan Video bertayangan / bulan',
    sku: null,
    ...over,
  };
}

describe('PILAR_TO_DIVISI', () => {
  it('memetakan tepat lima jenis yang punya satu divisi pemilik', () => {
    expect(Object.keys(PILAR_TO_DIVISI).sort()).toEqual([
      'affiliate',
      'iklan',
      'konten',
      'live',
      'operasional',
    ]);
  });

  it('setiap divisi tujuan terdaftar di registry dan boleh menerima Brief', () => {
    // Kalau tidak, baris yang disemai akan lolos DB (tak ada CHECK enum di
    // `plan_row.divisi_pic`) lalu mati diam-diam sebagai `divisi_pic_tidak_valid`
    // saat diwariskan ke Brief.
    const assignable = division.briefAssignableNames();
    for (const nama of Object.values(PILAR_TO_DIVISI)) {
      expect(assignable).toContain(nama);
    }
  });

  it('tak satu pun jenis muncul di kedua daftar sekaligus', () => {
    for (const j of PILAR_PILIH_DIVISI) {
      expect(PILAR_TO_DIVISI[j]).toBeUndefined();
    }
  });

  it('PILAR_BARIS = kosakata ck_plan_row_pilar (delapan, tanpa tidak_dikerjakan)', () => {
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
    expect(PILAR_BARIS).not.toContain('tidak_dikerjakan');
  });
});

describe('kandidatDivisi', () => {
  it('mendahulukan AI Optimizer dan Store Operation tanpa membuang sisanya', () => {
    const k = kandidatDivisi();
    expect(k.slice(0, 2)).toEqual(['AI Optimizer', 'Store Operation']);
    expect([...k].sort()).toEqual([...division.briefAssignableNames()].sort());
  });

  it('dua divisi yang didahulukan memang terdaftar', () => {
    for (const nama of KANDIDAT_DIDAHULUKAN) {
      expect(division.byNama(nama)?.briefAssignable).toBe(true);
    }
  });
});

describe('parseAngkaTarget — konvensi angka Indonesia', () => {
  it('bilangan bulat polos', () => {
    expect(parseAngkaTarget('30')).toBe(30);
    expect(parseAngkaTarget('0')).toBe(0);
  });

  it('titik = pemisah ribuan', () => {
    expect(parseAngkaTarget('15.000')).toBe(15000);
    expect(parseAngkaTarget('15.000.000')).toBe(15000000);
  });

  it('koma = desimal', () => {
    expect(parseAngkaTarget('7,5')).toBe(7.5);
    expect(parseAngkaTarget('7,50')).toBe(7.5);
  });

  it('ribuan + desimal', () => {
    expect(parseAngkaTarget('15.000,25')).toBe(15000.25);
  });

  it('menolak bentuk yang tidak persis salah satu konvensi', () => {
    // `1.5` bukan ribuan (grup harus 3 digit) dan bukan desimal (titik bukan
    // pemisah desimal). Menebak salah satunya = mengarang angka.
    expect(parseAngkaTarget('1.5')).toBeNull();
    expect(parseAngkaTarget('15.00')).toBeNull();
    expect(parseAngkaTarget('1.2345')).toBeNull();
    expect(parseAngkaTarget('7,555')).toBeNull();
    expect(parseAngkaTarget('')).toBeNull();
    expect(parseAngkaTarget('abc')).toBeNull();
  });
});

describe('parseTargetKuota', () => {
  it('membaca angka + satuan dari kepala teks target', () => {
    expect(parseTargetKuota('30 video, jembatan Video bertayangan / bulan')).toEqual({
      kuota: 30,
      satuan: 'video',
    });
  });

  it('desimal berkoma', () => {
    expect(parseTargetKuota('7,5 jam, jembatan Jam live / minggu')).toEqual({
      kuota: 7.5,
      satuan: 'jam',
    });
  });

  it('tidak mengarang angka saat target tak berangka pembuka', () => {
    expect(parseTargetKuota('perbaikan listing hero SKU')).toBeNull();
    expect(parseTargetKuota('sebanyak 30 video')).toBeNull();
    expect(parseTargetKuota(null)).toBeNull();
    expect(parseTargetKuota('')).toBeNull();
  });

  it('angka berpemisah ribuan dibaca utuh, bukan dipenggal jadi 15', () => {
    // Regresi yang jadi alasan parser ini ditulis ulang: parser lama membaca
    // `15.000.000` sebagai 15 — salah 1000× dan, di jalur semai server-side,
    // tanpa satu pun AM yang melihatnya lebih dulu.
    expect(parseTargetKuota('15.000.000 rupiah belanja iklan')).toEqual({
      kuota: 15000000,
      satuan: 'rupiah',
    });
  });

  it('angka tanpa satuan tetap terbaca', () => {
    expect(parseTargetKuota('12')).toEqual({ kuota: 12, satuan: '' });
    expect(parseTargetKuota('12, naikkan')).toEqual({ kuota: 12, satuan: '' });
  });
});

describe('satuanKanonik', () => {
  it('merapikan ejaan ke katalog plantask divisinya', () => {
    expect(satuanKanonik('Creative', 'Video')).toBe('video');
    expect(satuanKanonik('Live Stream', 'SESI')).toBe('sesi');
  });

  it('meneruskan satuan yang katalognya tak kenal apa adanya', () => {
    expect(satuanKanonik('Creative', 'listing')).toBe('listing');
    expect(satuanKanonik('Ops', 'dokumen')).toBe('dokumen');
  });

  it('setiap satuan katalog memang bisa dipulihkan lewat divisinya', () => {
    for (const [nama, jenisList] of Object.entries(plantask.PLAN_TASK_CATALOG)) {
      for (const j of jenisList) {
        expect(satuanKanonik(nama, j.satuan)).toBe(j.satuan);
      }
    }
  });
});

describe('seedRowFromPillar', () => {
  it('menyemai pilar konten lengkap jadi baris Creative', () => {
    const h = seedRowFromPillar(pillar(), ['TikTok Shop', 'Shopee']);
    expect(h.disemai).toBe(true);
    if (!h.disemai) return;
    expect(h.row).toEqual({
      strategiPillarId: 1,
      channel: 'TikTok Shop',
      pilar: 'konten',
      aksi: 'V2 Naikkan kuota video',
      skuSasaran: [],
      kuota: 30,
      satuan: 'video',
      divisiPic: 'Creative',
      hasilDiharapkan: '30 video, jembatan Video bertayangan / bulan',
    });
  });

  it('hasil_diharapkan (PC-11) adalah teks target pilar apa adanya', () => {
    const h = seedRowFromPillar(pillar({ target: '12 sesi, jembatan Jam live' }), ['Shopee']);
    expect(h.disemai && h.row.hasilDiharapkan).toBe('12 sesi, jembatan Jam live');
  });

  it('SKU pilar (E-3/E-4) jadi PC-5 satu item', () => {
    const h = seedRowFromPillar(pillar({ sku: 'RAK-A' }), ['TikTok Shop']);
    expect(h.disemai && h.row.skuSasaran).toEqual(['RAK-A']);
  });

  it('memetakan keempat jenis lain ke divisinya', () => {
    for (const [jenis, divisi] of Object.entries(PILAR_TO_DIVISI)) {
      const h = seedRowFromPillar(pillar({ jenis }), ['TikTok Shop']);
      expect(h.disemai && h.row.divisiPic).toBe(divisi);
      expect(h.disemai && h.row.pilar).toBe(jenis);
    }
  });

  it('sku/harga/retensi tidak disemai — alasannya butuh_divisi, bukan tebakan', () => {
    for (const jenis of PILAR_PILIH_DIVISI) {
      const h = seedRowFromPillar(pillar({ jenis }), ['TikTok Shop']);
      expect(h.disemai).toBe(false);
      if (h.disemai) return;
      expect(h.alasan).toEqual(['butuh_divisi']);
      // Usulannya tetap lengkap kecuali divisi — panel FE mengisinya sekali klik.
      expect(h.usulan.divisiPic).toBeUndefined();
      expect(h.usulan.kuota).toBe(30);
      expect(h.usulan.channel).toBe('TikTok Shop');
      expect(h.usulan.pilar).toBe(jenis);
    }
  });

  it('target tanpa angka ⇒ butuh_kuota, dan TIDAK disemai sebagai kuota 0', () => {
    const h = seedRowFromPillar(pillar({ target: 'perbaikan listing hero SKU' }), ['Shopee']);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toEqual(['butuh_kuota']);
    expect(h.usulan.kuota).toBeUndefined();
  });

  it('kuota nol yang tertulis eksplisit pun bukan baris — baris kuota-0 tak pernah jadi Brief', () => {
    const h = seedRowFromPillar(pillar({ target: '0 video' }), ['Shopee']);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toEqual(['butuh_kuota']);
  });

  it('pilar lintas channel disemai bila Strategi hanya punya satu channel', () => {
    const h = seedRowFromPillar(pillar({ channel: null }), ['Shopee']);
    expect(h.disemai && h.row.channel).toBe('Shopee');
  });

  it('pilar lintas channel pada Strategi multi-channel ⇒ butuh_channel', () => {
    const h = seedRowFromPillar(pillar({ channel: null }), ['Shopee', 'TikTok Shop']);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toEqual(['butuh_channel']);
    expect(h.usulan.channel).toBeUndefined();
  });

  it('Strategi tanpa channel sama sekali ⇒ butuh_channel (bukan channel kosong)', () => {
    const h = seedRowFromPillar(pillar({ channel: null }), []);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toContain('butuh_channel');
  });

  it('mengumpulkan SEMUA alasan sekaligus, bukan berhenti di yang pertama', () => {
    const h = seedRowFromPillar(
      pillar({ jenis: 'harga', channel: null, target: 'turunkan harga hero' }),
      ['Shopee', 'Tokopedia'],
    );
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toEqual(['butuh_divisi', 'butuh_channel', 'butuh_kuota']);
  });

  it('tidak_dikerjakan bukan pekerjaan — bukan_pilar_kerja, tanpa usulan', () => {
    const h = seedRowFromPillar(pillar({ jenis: 'tidak_dikerjakan' }), ['Shopee']);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toEqual(['bukan_pilar_kerja']);
    expect(h.usulan).toEqual({});
  });

  it('jenis di luar kosakata juga bukan_pilar_kerja', () => {
    const h = seedRowFromPillar(pillar({ jenis: 'entah' }), ['Shopee']);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toEqual(['bukan_pilar_kerja']);
  });

  it('setiap alasan punya label BI', () => {
    for (const a of ['bukan_pilar_kerja', 'butuh_divisi', 'butuh_kuota', 'butuh_channel'] as const) {
      expect(ALASAN_LABEL[a].length).toBeGreaterThan(0);
    }
  });

  it('satuan baris yang disemai dirapikan ke katalog divisinya', () => {
    const h = seedRowFromPillar(pillar({ target: '40 Video seller per bulan' }), ['Shopee']);
    expect(h.disemai && h.row.satuan).toBe('video');
  });
});
