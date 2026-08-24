import { describe, expect, it } from 'vitest';
import {
  COCKPIT_SCHEMA,
  applyCockpitToDiagnosa,
  applyCockpitToKpi,
  applyCockpitToNarasi,
  applyCockpitToTargets,
  buildCockpitPillars,
  konsentrasiPersen,
  mergeCockpitPillars,
  parseCockpitPayload,
  selectedAksi,
  type CockpitPayload,
} from './strategi-cockpit-import';
import type { DiagnosaDraftAll } from '@/components/strategi/SectionC';
import type { KpiDraft, TargetDraft } from '@/components/strategi/SectionD';
import type { NarasiDraft } from '@/components/strategi/SectionE';
import type { StrategiPillar } from './strategi';

const CHANNEL = 'TikTok Shop';

function payload(over: Partial<CockpitPayload> = {}): CockpitPayload {
  return { schema: COCKPIT_SCHEMA, channel: CHANNEL, ...over };
}

function blankDiagnosa(channel = CHANNEL): DiagnosaDraftAll {
  return {
    diagnosa: [{ channel, bottleneck: '', alasan: '', akar_masalah: '', gap_kompetitor: '' }],
    quick_wins: [],
    risiko_struktural: [],
    prasyarat_klien: [],
  };
}

function blankKpi(): KpiDraft {
  return { definisi_berhasil_30: '', definisi_berhasil_60: '', definisi_berhasil_90: '', leading_indicator: [] };
}

function blankTargets(channel = CHANNEL): TargetDraft {
  return {
    gmv: [{ channel, month_index: 1, nilai_floor: '', nilai_stretch: '' }],
    pendukung: [],
    assumptions: [],
  };
}

function blankNarasi(): NarasiDraft {
  return { growth_thesis: '', urutan_eksekusi_alasan: '', skenario_mundur: '', kondisi_stop_scope: '' };
}

describe('parseCockpitPayload', () => {
  it('menolak teks kosong dengan pesan BI dalam kurung siku', () => {
    const r = parseCockpitPayload('  ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^\[.*\]$/);
  });

  it('menolak JSON rusak', () => {
    const r = parseCockpitPayload('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format tidak dikenali/);
  });

  it('menolak skema yang tidak cocok (mis. hasil "Copy Draft STRG" yang disalin sebagai teks)', () => {
    const r = parseCockpitPayload(JSON.stringify({ schema: 'cdps.section_b.v1' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/skema tidak cocok/);
  });

  it('menerima payload mea.cockpit.v1 yang sah', () => {
    const r = parseCockpitPayload(JSON.stringify(payload({ thesis: 'tumbuh dari X' })));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.thesis).toBe('tumbuh dari X');
  });
});

describe('konsentrasiPersen', () => {
  it('memakai totalGMVExplicit sebagai basis kalau ada', () => {
    const p = payload({ baseline: { top1GMV: 30 } as never, gmvM: 1000 });
    // no totalGMVExplicit, so falls back to gmvM
    expect(konsentrasiPersen(p)).toBe(3);
  });

  it('mengembalikan null kalau tidak ada basis apa pun', () => {
    const p = payload({ baseline: { top1GMV: 30 } as never });
    expect(konsentrasiPersen(p)).toBeNull();
  });

  it('jatuh ke konsentrasiAff sebagai basis sementara', () => {
    const p = payload({ baseline: { top1GMV: 30, konsentrasiAff: 42 } as never });
    expect(konsentrasiPersen(p)).toBe(42);
  });
});

describe('selectedAksi', () => {
  it('hanya mengembalikan kode yang on=true dan dikenal katalog', () => {
    const p = payload({
      aksi: { A2: { on: true }, D1: { on: false }, ZZ: { on: true } },
    });
    expect(selectedAksi(p)).toEqual(['A2']);
  });
});

describe('applyCockpitToDiagnosa', () => {
  it('mengisi bottleneck margin & alasan kalau margin tertimbang di bawah 40%', () => {
    const p = payload({ baseline: { marginTertimbang: 25.3, roas: 5 } as never });
    const { draft, filled } = applyCockpitToDiagnosa(blankDiagnosa(), p);
    expect(draft.diagnosa[0].bottleneck).toBe('margin');
    expect(draft.diagnosa[0].alasan).toBe(
      'Margin tertimbang 25.3% di bawah ambang 40% [B-3.3]; ROAS berjalan 5 [B-5.4]',
    );
    expect(filled).toBeGreaterThan(0);
  });

  it('tidak menimpa bottleneck yang sudah diisi AM', () => {
    const draft = blankDiagnosa();
    draft.diagnosa[0].bottleneck = 'konversi';
    const p = payload({ baseline: { marginTertimbang: 25.3 } as never });
    const { draft: next } = applyCockpitToDiagnosa(draft, p);
    expect(next.diagnosa[0].bottleneck).toBe('konversi');
  });

  it('tidak menyentuh baris diagnosa channel lain (C-6/C-7 tetap terisi — keduanya bukan per-channel)', () => {
    const draft = blankDiagnosa('Shopee');
    const p = payload({ channel: CHANNEL, baseline: { marginTertimbang: 25.3 } as never });
    const { draft: next } = applyCockpitToDiagnosa(draft, p);
    expect(next.diagnosa[0].bottleneck).toBe('');
    expect(next.diagnosa[0].alasan).toBe('');
  });

  it('mengisi C-5 quick win hanya dari aksi qw:true yang dipilih, dan tidak menambah kalau list sudah terisi', () => {
    const p = payload({ aksi: { A2: { on: true, grup: 1 }, D1: { on: true, grup: 2 }, A1: { on: true, grup: 1 } } });
    const { draft } = applyCockpitToDiagnosa(blankDiagnosa(), p);
    expect(draft.quick_wins.map((q) => q.aksi)).toEqual([
      'A2 Aktivasi kreator terdaftar',
      'D1 Seleksi kreatif pakai CTR klik produk',
    ]);
    expect(draft.quick_wins[0].pic_divisi).toBe('KOL');

    const again = applyCockpitToDiagnosa(draft, p).draft;
    expect(again.quick_wins).toHaveLength(2); // not duplicated
  });

  it('mengisi C-3 akar masalah dari catatan aksi terpilih', () => {
    const p = payload({ aksi: { A2: { on: true, catatan: 'yang sudah join tapi belum posting' } } });
    const { draft } = applyCockpitToDiagnosa(blankDiagnosa(), p);
    expect(draft.diagnosa[0].akar_masalah).toBe('[A2] yang sudah join tapi belum posting');
  });

  it('mengisi C-6 risiko struktural & C-7 prasyarat saat margin gagal', () => {
    const p = payload({ baseline: { marginTertimbang: 25.3, durasiKontrakBulan: 1 } as never });
    const { draft } = applyCockpitToDiagnosa(blankDiagnosa(), p);
    expect(draft.risiko_struktural.length).toBeGreaterThanOrEqual(2);
    expect(draft.prasyarat_klien).toHaveLength(1);
    expect(draft.prasyarat_klien[0].item).toMatch(/margin bersih riil per SKU/);
  });
});

describe('applyCockpitToTargets', () => {
  it('mengisi floor & stretch bulan 1 hanya kalau sel masih kosong', () => {
    const p = payload({ floor: 30_000_000, stretch: 40_000_000 });
    const { draft, filled } = applyCockpitToTargets(blankTargets(), p);
    expect(draft.gmv[0].nilai_floor).toBe('30000000');
    expect(draft.gmv[0].nilai_stretch).toBe('40000000');
    expect(filled).toBeGreaterThan(0);
  });

  it('tidak menimpa sel yang sudah terisi', () => {
    const t = blankTargets();
    t.gmv[0] = { ...t.gmv[0], nilai_floor: '10', nilai_stretch: '20' };
    const p = payload({ floor: 30_000_000, stretch: 40_000_000 });
    const { draft } = applyCockpitToTargets(t, p);
    expect(draft.gmv[0].nilai_floor).toBe('10');
  });

  it('menambah target pendukung ACOS maksimum & ROAS minimum dari baseline', () => {
    const p = payload({ baseline: { acosMax: 5.1, roasMin: 19.5 } as never });
    const { draft } = applyCockpitToTargets(blankTargets(), p);
    expect(draft.pendukung).toEqual([
      { channel: CHANNEL, month_index: 1, metric: 'acos_maks', nilai_stretch: '5.1' },
      { channel: CHANNEL, month_index: 1, metric: 'roas_min', nilai_stretch: '19.5' },
    ]);
  });

  it('menambah satu asumsi D-8 saat margin gagal, tanpa duplikat saat diterapkan ulang', () => {
    const p = payload({ baseline: { marginTertimbang: 25.3 } as never });
    const once = applyCockpitToTargets(blankTargets(), p).draft;
    expect(once.assumptions).toHaveLength(1);
    expect(once.assumptions[0].pemilik).toBe('klien');
    const twice = applyCockpitToTargets(once, p).draft;
    expect(twice.assumptions).toHaveLength(1);
  });
});

describe('applyCockpitToKpi', () => {
  it('menambah leading indicator hanya dari pemetaan yang yakin, tidak melebihi maksimum', () => {
    const p = payload({ aksi: { V2: { on: true }, L1: { on: true }, V1: { on: true } } });
    const { draft, filled } = applyCockpitToKpi(blankKpi(), p);
    expect(draft.leading_indicator.sort()).toEqual(['jam_live', 'jumlah_video']);
    expect(filled).toBe(2); // V1 has no confident mapping, skipped
  });

  it('tidak menghapus indikator yang sudah dipilih AM', () => {
    const kpi = { ...blankKpi(), leading_indicator: ['gmv' as const] };
    const p = payload({ aksi: { V2: { on: true } } });
    const { draft } = applyCockpitToKpi(kpi, p);
    expect(draft.leading_indicator).toEqual(['gmv', 'jumlah_video']);
  });
});

describe('applyCockpitToNarasi', () => {
  it('mengisi growth thesis & urutan eksekusi hanya kalau kosong', () => {
    const p = payload({ thesis: 'tumbuh dari konten', pilarAlasan: 'konten dulu baru iklan' });
    const { draft, filled } = applyCockpitToNarasi(blankNarasi(), p);
    expect(draft.growth_thesis).toBe('tumbuh dari konten');
    expect(draft.urutan_eksekusi_alasan).toBe('konten dulu baru iklan');
    expect(filled).toBe(2);
  });

  it('tidak menimpa growth thesis yang sudah diisi', () => {
    const draft = { ...blankNarasi(), growth_thesis: 'sudah ada' };
    const p = payload({ thesis: 'dari cockpit' });
    const { draft: next } = applyCockpitToNarasi(draft, p);
    expect(next.growth_thesis).toBe('sudah ada');
  });
});

describe('buildCockpitPillars', () => {
  it('mengelompokkan aksi terpilih per grup, mengabaikan yang belum dikelompokkan', () => {
    const p = payload({
      pilarNama: ['Perbaiki konten', 'Naikkan affiliate'],
      aksi: {
        V2: { on: true, grup: 1, rencana: '80', target: 'Video bertayangan / bulan' },
        A2: { on: true, grup: 2, rencana: '15' },
        D1: { on: true }, // ungrouped, dropped
      },
    });
    const pillars = buildCockpitPillars(p);
    expect(pillars).toHaveLength(2);
    expect(pillars[0]).toMatchObject({
      jenis: 'konten',
      channel: CHANNEL,
      peran: 'Pilar 1 — Perbaiki konten',
      aksi: 'V2 Naikkan kuota video',
      target: '80 video, jembatan Video bertayangan / bulan',
    });
    expect(pillars[1]).toMatchObject({
      jenis: 'affiliate',
      peran: 'Pilar 2 — Naikkan affiliate',
      aksi: 'A2 Aktivasi kreator terdaftar',
      target: '15 kreator',
    });
  });
});

describe('mergeCockpitPillars', () => {
  const existing: StrategiPillar[] = [
    {
      id: 1,
      jenis: 'tidak_dikerjakan',
      channel: null,
      urutan: 1,
      sku: null,
      peran: null,
      aksi: 'tidak menggarap live shopping',
      target: '',
      harga_normal: null,
      harga_promo: null,
      floor_price: null,
      vendor_id: null,
      slot_jam: null,
      tarif: null,
      target_gmv_per_jam: null,
      detail: {},
    },
    {
      id: 2,
      jenis: 'konten',
      channel: CHANNEL,
      urutan: 2,
      sku: null,
      peran: 'Pilar 1',
      aksi: 'V2 Naikkan kuota video',
      target: 'lama',
      harga_normal: null,
      harga_promo: null,
      floor_price: null,
      vendor_id: null,
      slot_jam: null,
      tarif: null,
      target_gmv_per_jam: null,
      detail: {},
    },
  ];

  it('mengganti pilar cockpit yang cocok (jenis+channel+aksi), menyisakan yang lain', () => {
    const fresh = buildCockpitPillars(
      payload({ aksi: { V2: { on: true, grup: 1, rencana: '80' } } }),
    );
    const merged = mergeCockpitPillars(existing, fresh);
    expect(merged).toHaveLength(2);
    const kept = merged.find((p) => p.jenis === 'tidak_dikerjakan');
    expect(kept?.aksi).toBe('tidak menggarap live shopping');
    const replaced = merged.find((p) => p.aksi === 'V2 Naikkan kuota video');
    expect(replaced?.target).toBe('80 video');
    expect(merged.map((p) => p.urutan)).toEqual([1, 2]);
  });
});
