import { describe, expect, it } from 'vitest';
import * as copilot from './copilot';
import * as division from './division';
import * as plantask from './plantask';
import {
  ALASAN_LABEL,
  KANDIDAT_DIDAHULUKAN,
  PILAR_BARIS,
  PILAR_PILIH_DIVISI,
  PILAR_TO_DIVISI,
  angleVideoDariDetail,
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
      instruksiBrief: null,
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

// ---------------------------------------------------------------------------
// Jahitan B4 → B5 — pilar dari AM Co-Pilot SERVER-SIDE, bukan dari tool HTML
// ---------------------------------------------------------------------------

/**
 * Dua jalur mengisi Section E dan **bentuk `target`-nya berbeda**, jadi jahitan
 * ini wajib dipaku dari kedua sisi:
 *
 *  - tool HTML (`buildCockpitPillars`) menulis `"30 video, jembatan …"` — diawali
 *    angka, jadi `parseTargetKuota` membacanya dan barisnya disemai penuh;
 *  - Co-Pilot server-side (`copilot.susunUsulan`, B4) menulis
 *    `"jembatan Median VV video toko: 10,0 VV → 12,5 VV dalam 3 minggu"` —
 *    **tidak** diawali angka.
 *
 * Yang kedua HARUS jatuh ke `butuh_kuota`, dan itu **benar, bukan bug**: `kuota`
 * PC-6 adalah *berapa deliverable akan dibuat* (40 video, 7 listing, 36 jam
 * live) — keputusan perencanaan yang server tak punya sumbernya. Target jembatan
 * (median VV 12.500) adalah angka yang BERBEDA; menyemainya sebagai kuota akan
 * melahirkan baris kerja yang menuntut 12.500 unit pekerjaan.
 *
 * Tes ini memakai `copilot` yang SEBENARNYA, bukan string yang ditulis ulang di
 * sini — kalau salah satu sisi mengubah format `target`, jahitan ini yang
 * memerah lebih dulu, bukan seorang AM yang menemukan Plan-nya kosong.
 */
describe('jahitan B4→B5 — pilar usulan AM Co-Pilot server-side', () => {
  const BENCH = {
    cr: 2, refund: 5, vidPostToko: 20, vidSalesToko: 25, vidSalesAff: 20, gpmToko: 30_000,
    liveSesi: 12, liveJam: 40, liveGmvJam: 1_000_000, liveCtor: 3, krSales: 30, krKonsen: 40,
    skuSales: 40, roas: 4, adsDep: 30, spikeFlag: 2,
  };
  const usulan = copilot.susunUsulan({
    benchmark_dipakai: BENCH,
    video: { toko: { diposting_periode: 8, rate: 0.1, gpm_median: 11_000 } },
    skor: { pilar: { video: 21 } },
  });
  const aksi = usulan.pilar.flatMap((x) => x.aksi);

  it('Co-Pilot memang menghasilkan pilar konten untuk toko ini', () => {
    expect(aksi.length).toBeGreaterThan(0);
    expect(usulan.pilar[0].jenis).toBe('konten');
  });

  it('divisi PIC-nya diturunkan otomatis — konten → Creative', () => {
    expect(PILAR_TO_DIVISI[usulan.pilar[0].jenis]).toBe('Creative');
  });

  it('target jembatan TIDAK dibaca sebagai kuota — baris tidak disemai, alasannya butuh_kuota', () => {
    for (const a of aksi) {
      const hasil = seedRowFromPillar(
        { id: 1, jenis: a.jenis, channel: 'TikTok Shop', aksi: `${a.kode} ${a.nama}`, target: a.target, sku: null },
        ['TikTok Shop'],
      );
      // `HasilSemai` adalah union ber-diskriminan: menyempitkannya lewat `if`
      // (bukan hanya `expect`) adalah yang membuat `tsc --noEmit` ikut menjaga
      // cabang ini — `expect` saja lolos tes tapi gagal typecheck.
      expect(hasil.disemai).toBe(false);
      if (hasil.disemai) throw new Error('pilar Co-Pilot seharusnya tidak disemai otomatis');
      expect(hasil.alasan).toContain('butuh_kuota');
      // Divisi dan channel-nya SUDAH terisi, jadi yang tersisa untuk AM benar-benar
      // hanya satu angka — bukan tiga kolom kosong.
      expect(hasil.alasan).not.toContain('butuh_divisi');
      expect(hasil.alasan).not.toContain('butuh_channel');
      expect(hasil.usulan.divisiPic).toBe('Creative');
      expect(hasil.usulan.kuota).toBeUndefined();
      expect(ALASAN_LABEL.butuh_kuota).toBe('isi kuota + satuan');
    }
  });

  it('target jembatan tetap terbawa sebagai hasil_diharapkan (PC-11), tidak hilang', () => {
    const a = aksi[0];
    const hasil = seedRowFromPillar(
      { id: 7, jenis: a.jenis, channel: 'TikTok Shop', aksi: `${a.kode} ${a.nama}`, target: a.target, sku: null },
      ['TikTok Shop'],
    );
    if (hasil.disemai) throw new Error('pilar Co-Pilot seharusnya tidak disemai otomatis');
    expect(hasil.usulan.hasilDiharapkan).toBe(a.target);
    expect(hasil.usulan.strategiPillarId).toBe(7);
  });

  it('bentuk tool HTML ("30 video, jembatan …") tetap disemai penuh — jalur itu tidak ikut rusak', () => {
    const hasil = seedRowFromPillar(
      { id: 2, jenis: 'konten', channel: 'TikTok Shop', aksi: 'V2 Naikkan kuota video', target: '30 video, jembatan Video bertayangan / bulan', sku: null },
      ['TikTok Shop'],
    );
    expect(hasil.disemai).toBe(true);
    if (hasil.disemai) {
      expect(hasil.row.kuota).toBe(30);
      expect(hasil.row.divisiPic).toBe('Creative');
    }
  });

  it('semua jenis pilar yang Co-Pilot bisa hasilkan punya divisi bawaan — nol butuh_divisi', () => {
    // Katalog Co-Pilot hanya 4 pilar; keempatnya harus ada di PILAR_TO_DIVISI,
    // kalau tidak setiap usulan akan menuntut AM memilih divisi tanpa alasan.
    for (const jenis of Object.values(copilot.PILAR_KE_JENIS)) {
      expect(PILAR_TO_DIVISI[jenis]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// angle_video → instruksi_brief (UAT Gelombang B §10 butir 7, 2026-09-07)
// ---------------------------------------------------------------------------
describe('angleVideoDariDetail', () => {
  it('merangkai angle jadi satu baris instruksi', () => {
    expect(
      angleVideoDariDetail({ angle_video: ['A — GPM Rp. 120.000,00', 'B — GPM Rp. 90.000,00'] }),
    ).toBe('Angle video yang sudah perform (Section E): A — GPM Rp. 120.000,00 | B — GPM Rp. 90.000,00');
  });

  it('null untuk detail tanpa angle — kolomnya tetap kosong, bukan kalimat kosong', () => {
    for (const kosong of [null, undefined, 42, 'x', {}, { angle_video: [] }, { angle_video: ['', '  '] }, { angle_video: 'bukan array' }]) {
      expect(angleVideoDariDetail(kosong)).toBeNull();
    }
  });

  it('membuang entri kosong tapi mempertahankan yang terisi', () => {
    expect(angleVideoDariDetail({ angle_video: ['', 'A', '  '] })).toContain('A');
  });
});

describe('seedRowFromPillar — angle video ikut ke baris kerja', () => {
  const DETAIL = { angle_video: ['Racun skincare — GPM Rp. 250.000,00'] };

  it('baris yang disemai membawa angle-nya ke instruksiBrief', () => {
    const h = seedRowFromPillar(pillar({ detail: DETAIL }), ['TikTok Shop']);
    expect(h.disemai).toBe(true);
    if (!h.disemai) return;
    expect(h.row.instruksiBrief).toContain('Racun skincare');
  });

  it('pilar yang TIDAK disemai tetap mengusulkan angle-nya (panel Plan memakainya)', () => {
    const h = seedRowFromPillar(pillar({ jenis: 'sku', detail: DETAIL }), ['TikTok Shop']);
    expect(h.disemai).toBe(false);
    if (h.disemai) return;
    expect(h.alasan).toContain('butuh_divisi');
    expect(h.usulan.instruksiBrief).toContain('Racun skincare');
  });

  it('pilar tanpa angle: instruksiBrief null, bukan string kosong', () => {
    const h = seedRowFromPillar(pillar(), ['TikTok Shop']);
    expect(h.disemai && h.row.instruksiBrief).toBeNull();
  });
});
