import { describe, expect, it } from 'vitest';
import {
  STRATEGI_AKTIF,
  STRATEGI_DIAJUKAN,
  STRATEGI_DIARSIPKAN,
  STRATEGI_DRAFT,
  STRATEGI_DRAFT_REVISI,
  STRATEGI_KEDALUWARSA,
} from './strategi-sections';
import type { StrategiFieldVisibility } from './strategi';
import {
  FIELD_LABEL,
  VISIBILITAS_INTERNAL,
  VISIBILITAS_SHAREABLE,
  canEditVisibilitas,
  fieldLabel,
  groupVisibilitas,
  isDibagikan,
  isDiubah,
  nextVisibilitas,
  ringkasVisibilitas,
  tierLabel,
  unreachableSections,
} from './strategi-visibilitas';

const row = (p: Partial<StrategiFieldVisibility> & { field_id: string }): StrategiFieldVisibility => ({
  visibilitas: VISIBILITAS_SHAREABLE,
  tier: 'default_shareable',
  dapat_diubah: true,
  diubah_oleh: null,
  diubah_pada: null,
  ...p,
});

describe('canEditVisibilitas — the one control that is NOT Draft-only', () => {
  it('stays open on Diajukan and Aktif, which is the whole point', () => {
    // Rule 16(c) serves the client view from the approved ACTIVE version. A
    // Draft-only toggle would make "share one more field with the client
    // mid-contract" cost a Rule 13 revision — a trigger from H-2, a written
    // reason, a broken assumption, and a version number — for a decision that
    // changed nothing about the strategy.
    for (const s of [STRATEGI_DRAFT, STRATEGI_DRAFT_REVISI, STRATEGI_DIAJUKAN, STRATEGI_AKTIF]) {
      expect(canEditVisibilitas(s), s).toBe(true);
    }
  });

  it('refuses exactly the two statuses the domain refuses', () => {
    // Rule 13: an archived version is "immutable, still readable". Its overlay
    // is part of what a client already saw, so editing it rewrites the answer to
    // "what was shared on the day of the dispute".
    expect(canEditVisibilitas(STRATEGI_DIARSIPKAN)).toBe(false);
    expect(canEditVisibilitas(STRATEGI_KEDALUWARSA)).toBe(false);
  });

  it('answers about STATUS only — permission is a separate question', () => {
    // Same shape as `isEditable`, and the page `&&`-s `canWrite` at the call
    // site. Two questions in one predicate is how "AM cannot write" and "this
    // version is frozen" end up indistinguishable in a tooltip.
    expect(canEditVisibilitas(STRATEGI_AKTIF)).toBe(true);
  });

  it('mirrors the domain deny-list rather than guessing a new allow-list', () => {
    // A status this page has never heard of resolves to "offer the switch", and
    // that direction is chosen, not accidental: the server refuses with the
    // exact BI message, whereas a hidden switch on a legitimate new status is a
    // control the AM cannot reach and cannot see a reason for. The safety
    // property that must NOT be delegated this way is Rule 16(a), and that one
    // rides `dapat_diubah` per row, never this predicate.
    expect(canEditVisibilitas('status yang tidak dikenal')).toBe(true);
  });
});

describe('nextVisibilitas', () => {
  it('flips both ways — Rule 16 lets a default-shareable field be hidden too', () => {
    expect(nextVisibilitas(VISIBILITAS_SHAREABLE)).toBe(VISIBILITAS_INTERNAL);
    expect(nextVisibilitas(VISIBILITAS_INTERNAL)).toBe(VISIBILITAS_SHAREABLE);
  });

  it('treats anything it does not recognise as not-yet-shared', () => {
    // A value the server grew without this page must not resolve to "share it".
    expect(nextVisibilitas('sesuatu yang lain')).toBe(VISIBILITAS_SHAREABLE);
  });
});

describe('groupVisibilitas', () => {
  it('chapters by field ID the same way the gap panel chapters by kode', () => {
    const grouped = groupVisibilitas([
      row({ field_id: 'B-3.3' }),
      row({ field_id: 'A-10', tier: 'hard_internal', dapat_diubah: false, visibilitas: VISIBILITAS_INTERNAL }),
      row({ field_id: 'G-0' }),
      row({ field_id: 'A-3', tier: 'default_internal', visibilitas: VISIBILITAS_INTERNAL }),
    ]);
    expect(grouped.get('A')?.map((r) => r.field_id)).toEqual(['A-3', 'A-10']);
    expect(grouped.get('B')?.map((r) => r.field_id)).toEqual(['B-3.3']);
    expect(grouped.get('G')?.map((r) => r.field_id)).toEqual(['G-0']);
  });

  it('sorts numerically, so A-10 comes after A-3 rather than before it', () => {
    // Plain string sort puts 'A-10' before 'A-3', which reads as a missing field
    // to anyone scanning the list in PRD order.
    const grouped = groupVisibilitas(
      ['A-16', 'A-2', 'A-10', 'A-3'].map((field_id) => row({ field_id })),
    );
    expect(grouped.get('A')?.map((r) => r.field_id)).toEqual(['A-2', 'A-3', 'A-10', 'A-16']);
  });

  it('gives every section a bucket so the panel does not shift as rows change', () => {
    const grouped = groupVisibilitas([]);
    for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
      expect(grouped.get(key as never)).toEqual([]);
    }
  });

  it('still RENDERS a field ID it cannot chapter, in `lain`', () => {
    // An unrendered row is a field whose sharing state nobody can see — a worse
    // failure here than on the gap panel, where the count at least survives.
    const grouped = groupVisibilitas([row({ field_id: 'Z-9' })]);
    expect(grouped.get('lain')?.map((r) => r.field_id)).toEqual(['Z-9']);
  });
});

describe('ringkasVisibilitas', () => {
  it('counts what the header line claims', () => {
    const r = ringkasVisibilitas([
      row({ field_id: 'A-1' }),
      row({ field_id: 'A-3', visibilitas: VISIBILITAS_INTERNAL, tier: 'default_internal' }),
      row({ field_id: 'A-10', visibilitas: VISIBILITAS_INTERNAL, tier: 'hard_internal', dapat_diubah: false }),
      row({ field_id: 'A-13', visibilitas: VISIBILITAS_SHAREABLE, tier: 'default_internal', diubah_oleh: 'EMP-1', diubah_pada: '2026-08-09T00:00:00.000Z' }),
    ]);
    expect(r).toEqual({ total: 4, dibagikan: 2, terkunci: 1, diubah: 1 });
  });
});

describe('isDiubah reads the stamp, not a comparison with the default', () => {
  it('is false for an untouched seed row and true once a human moved it', () => {
    // The page does not hold the §4.1 default map on purpose (a third copy is
    // the one most likely to forget a hard-internal field), so "changed" has to
    // come from the server's own stamp.
    expect(isDiubah(row({ field_id: 'A-3' }))).toBe(false);
    expect(isDiubah(row({ field_id: 'A-3', diubah_oleh: 'EMP-1' }))).toBe(true);
  });

  it('reads sharing off the stored value, not off the tier', () => {
    // A default-internal field that the AM shared is SHARED. Reading the tier
    // instead would render the switch in the position opposite to reality.
    expect(isDibagikan(row({ field_id: 'A-3', tier: 'default_internal' }))).toBe(true);
    expect(
      isDibagikan(row({ field_id: 'B-1.1', visibilitas: VISIBILITAS_INTERNAL })),
    ).toBe(false);
  });
});

describe('labels', () => {
  it('names exactly the nineteen fields §4.1 itself enumerates', () => {
    // §4.1 lists its two exception rows field by field and calls the rest
    // "everything else" — so this set is the PRD's own idea of which fields are
    // worth describing in a visibility context.
    expect(Object.keys(FIELD_LABEL).sort()).toEqual(
      [
        'A-10', 'D-7', 'F-5', 'F-7', 'H-4', 'J-2', 'J-3',
        'A-3', 'A-13', 'C-6', 'E-4', 'F-1', 'H-1',
        'A-15', 'A-16', 'I-1', 'I-4', 'J-1', 'J-4',
      ].sort(),
    );
  });

  it('falls back to the kode, the vocabulary the gap panel already uses', () => {
    expect(fieldLabel('A-10')).toBe('Riwayat agensi sebelumnya');
    expect(fieldLabel('B-3.3')).toBe('B-3.3');
  });

  it('says a fourth tier out loud rather than guessing at it', () => {
    expect(tierLabel('hard_internal')).toBe('Tidak pernah dibagikan');
    // The switch is driven by `dapat_diubah`, not by this string — so an unknown
    // tier degrades to a confusing label, never to an offered toggle.
    expect(tierLabel('sesuatu_baru')).toBe('sesuatu_baru');
  });
});

describe('unreachableSections — a switch with no door is reported, not hidden', () => {
  const WIRED = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

  it('names Section J, which carries two toggleable fields and no form', () => {
    // Post X-16 (2026-08-09): J-1 is `default_shareable`, J-4 `default_internal`
    // — both toggleable, so the AM may change either. The nav disables J because
    // Section J has no form, so today those switches exist and cannot be reached.
    // That is the UI arriving at the same defect `gate-reachability.test.ts`
    // guards against on the server.
    const rows = [
      row({ field_id: 'A-3', tier: 'default_internal' }),
      row({ field_id: 'J-1', tier: 'default_shareable' }),
      row({ field_id: 'J-4', tier: 'default_internal' }),
    ];
    expect(unreachableSections(rows, WIRED)).toEqual(['J']);
  });

  it('says nothing when every row sits in a section the AM can open', () => {
    expect(unreachableSections([row({ field_id: 'A-3' })], WIRED)).toEqual([]);
  });

  it('reports an unchapterable field ID too', () => {
    expect(unreachableSections([row({ field_id: 'Z-9' })], WIRED)).toEqual(['lain']);
  });
});
