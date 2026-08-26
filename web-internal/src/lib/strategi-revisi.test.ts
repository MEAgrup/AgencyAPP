import { describe, expect, it } from 'vitest';
import {
  STRATEGI_AKTIF,
  STRATEGI_DIAJUKAN,
  STRATEGI_DIARSIPKAN,
  STRATEGI_DRAFT,
  STRATEGI_DRAFT_REVISI,
  STRATEGI_KEDALUWARSA,
} from './strategi-sections';
import type { StrategiDetail } from './strategi';
import {
  REVISI_KOSONG,
  SANGGAHAN_KOSONG,
  canFlipAsumsi,
  canOpenRevisi,
  canRaiseSanggahan,
  declaredTriggers,
  nextAsumsiStatus,
  revisiKekurangan,
  revisiToBody,
  sanggahanLengkap,
  toggleIn,
} from './strategi-revisi';

const ALL = [
  STRATEGI_DRAFT,
  STRATEGI_DRAFT_REVISI,
  STRATEGI_DIAJUKAN,
  STRATEGI_AKTIF,
  STRATEGI_DIARSIPKAN,
  STRATEGI_KEDALUWARSA,
];

describe('three controls, three different status rules', () => {
  it('opens D-7 Sanggahan only while the target is still being set', () => {
    // `raiseSanggahan` goes through `requireDraftAndWriter`. Rule 19 is an
    // argument about a target being SET, made while setting it.
    expect(ALL.filter(canRaiseSanggahan)).toEqual([STRATEGI_DRAFT, STRATEGI_DRAFT_REVISI]);
  });

  it('opens A-12 revision from Aktif and nothing else', () => {
    // NOT "anything that is not a draft": `Diajukan` is awaiting approval and
    // `Diarsipkan` is already superseded. Rule 13 needs version n to be the
    // approved active one before n+1 can exist.
    expect(ALL.filter(canOpenRevisi)).toEqual([STRATEGI_AKTIF]);
  });

  it('keeps the D-8 flip reachable exactly when an assumption can still break', () => {
    // The one Section D write that outlives Draft — an assumption breaks during
    // execution, which is when every edit door is shut.
    expect(ALL.filter(canFlipAsumsi)).toEqual([
      STRATEGI_DRAFT,
      STRATEGI_DRAFT_REVISI,
      STRATEGI_DIAJUKAN,
      STRATEGI_AKTIF,
    ]);
  });

  it('never lets the three collapse into one predicate', () => {
    // The regression this file exists for: on `Aktif`, exactly one of the three
    // is open for editing and one other is open for flipping. A shared
    // `isEditable` would close all three.
    expect(canRaiseSanggahan(STRATEGI_AKTIF)).toBe(false);
    expect(canOpenRevisi(STRATEGI_AKTIF)).toBe(true);
    expect(canFlipAsumsi(STRATEGI_AKTIF)).toBe(true);

    expect(canRaiseSanggahan(STRATEGI_DRAFT)).toBe(true);
    expect(canOpenRevisi(STRATEGI_DRAFT)).toBe(false);
    expect(canFlipAsumsi(STRATEGI_DRAFT)).toBe(true);
  });
});

describe('declaredTriggers', () => {
  it('offers only what H-2 declared, not the global vocabulary', () => {
    // `openRevision` refuses a trigger this record never declared, and that is a
    // cross-row check no DB CHECK can make. Offering the global list would put
    // codes in front of the AM that are guaranteed to be rejected.
    const detail = {
      trigger_revisi: [
        { id: 1, kode: 'pencapaian_di_bawah_target', ambang: 80, catatan: null, urutan: 1 },
        { id: 2, kode: 'perubahan_algoritma', ambang: null, catatan: null, urutan: 2 },
      ],
    } as unknown as StrategiDetail;
    expect(declaredTriggers(detail)).toEqual([
      'pencapaian_di_bawah_target',
      'perubahan_algoritma',
    ]);
  });

  it('answers empty rather than inventing a fallback list', () => {
    const detail = { trigger_revisi: [] } as unknown as StrategiDetail;
    expect(declaredTriggers(detail)).toEqual([]);
  });
});

describe('revisiKekurangan — Rule 13 (a), (b), (c)', () => {
  it('names all three when the dialog just opened, and this Strategi has D-8 rows', () => {
    expect(revisiKekurangan(REVISI_KOSONG, 3)).toEqual([
      'trigger revisi (dari H-2)',
      'alasan revisi',
      'asumsi mana yang gugur (D-8)',
    ]);
  });

  it('treats whitespace as empty, the way the server does', () => {
    expect(
      revisiKekurangan(
        {
          trigger_revisi: ['pencapaian_di_bawah_target'],
          alasan_revisi: '   ',
          asumsi_gugur: ['A1'],
        },
        3,
      ),
    ).toEqual(['alasan revisi']);
  });

  it('is empty once all three are answered', () => {
    expect(
      revisiKekurangan(
        {
          trigger_revisi: ['pencapaian_di_bawah_target'],
          alasan_revisi: 'GMV meleset dua bulan berturut',
          asumsi_gugur: ['A1'],
        },
        3,
      ),
    ).toEqual([]);
  });

  it('waives (c) when this Strategi has zero D-8 rows recorded (owner QA 2026-08-26)', () => {
    expect(
      revisiKekurangan(
        {
          trigger_revisi: ['pencapaian_di_bawah_target'],
          alasan_revisi: 'GMV meleset, D-8 belum pernah diisi',
          asumsi_gugur: [],
        },
        0,
      ),
    ).toEqual([]);
  });
});

describe('revisiToBody', () => {
  it('trims and drops blanks so the server sees what the AM meant', () => {
    expect(
      revisiToBody({
        trigger_revisi: [' pencapaian_di_bawah_target ', ''],
        alasan_revisi: '  target perlu ditinjau  ',
        asumsi_gugur: ['A1', '  '],
      }),
    ).toEqual({
      trigger_revisi: ['pencapaian_di_bawah_target'],
      alasan_revisi: 'target perlu ditinjau',
      asumsi_gugur: ['A1'],
    });
  });
});

describe('toggleIn', () => {
  it('adds what is missing and removes what is present', () => {
    expect(toggleIn([], 'A1')).toEqual(['A1']);
    expect(toggleIn(['A1', 'A2'], 'A1')).toEqual(['A2']);
  });
});

describe('sanggahanLengkap — MSG_SANGGAHAN_INCOMPLETE has three halves', () => {
  it('refuses a fresh form and any partial one', () => {
    expect(sanggahanLengkap(SANGGAHAN_KOSONG)).toBe(false);
    expect(
      sanggahanLengkap({ alasan: 'tidak realistis', angka_pembanding: '', target_realistis: '1' }),
    ).toBe(false);
    expect(
      sanggahanLengkap({ alasan: '   ', angka_pembanding: '1', target_realistis: '1' }),
    ).toBe(false);
  });

  it('accepts all three filled', () => {
    expect(
      sanggahanLengkap({
        alasan: 'baseline 180jt, target 460jt',
        angka_pembanding: '180000000',
        target_realistis: '300000000',
      }),
    ).toBe(true);
  });
});

describe('nextAsumsiStatus', () => {
  it('flips between Berlaku and Gugur, and never offers Terverifikasi', () => {
    // `Terverifikasi` is a claim about reality, not a tidy-up gesture. The
    // operationally meaningful flip is `Gugur` — it fires
    // `strategi_revisi_disarankan`.
    expect(nextAsumsiStatus('Berlaku')).toBe('Gugur');
    expect(nextAsumsiStatus('Gugur')).toBe('Berlaku');
    expect(nextAsumsiStatus('Terverifikasi')).toBe('Gugur');
  });
});
