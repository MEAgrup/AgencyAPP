/**
 * A-13d — the model behind the "Visibilitas klien" panel (M6A §4.1, Rule 16).
 *
 * Kept framework-free for the same reason `strategi-sections.ts` is: the two
 * things that decide whether the panel is correct — WHEN it may be edited, and
 * which section a field belongs to — are unit-testable without a browser.
 *
 * ## What this file must never do
 *
 * **It must not re-derive a field's tier.** The server sends `tier` and
 * `dapat_diubah` already computed from `packages/core/src/visibility.ts`, which
 * §7 makes the single home of the §4.1 map (enforced twice: TS predicate + DB
 * CHECK). A third copy here would be the copy most likely to miss a
 * hard-internal field, and that is a LEAK, not a rendering bug. Everything below
 * reads those two flags; nothing computes them.
 *
 * The one thing this file does add is `FIELD_LABEL` — prose, not policy. A wrong
 * label is a bad tooltip; a wrong tier is a disclosure.
 */
import {
  STRATEGI_DIARSIPKAN,
  STRATEGI_KEDALUWARSA,
  STRATEGI_SECTIONS,
  sectionOf,
  type SectionKey,
} from './strategi-sections';
import type { StrategiFieldVisibility } from './strategi';

/** Rule 16 — the two stored values, spelled the way §4 spells them. */
export const VISIBILITAS_SHAREABLE = 'Bagikan ke Klien';
export const VISIBILITAS_INTERNAL = 'Internal Saja';

/**
 * ⚠️ **Deliberately NOT `isEditable`.** Every other control on this page is
 * Draft-only; this one is not, and reusing `isEditable` here would silently undo
 * the server-side decision rather than mirror it.
 *
 * Rule 16(c) serves the client view from the approved ACTIVE version, so a
 * Draft-only toggle would mean the only way to share one more field with a
 * client mid-contract is to open a revision — which Rule 13 makes expensive on
 * purpose (a trigger from H-2, a written reason, a broken assumption) and which
 * bumps the version number over a decision that changed nothing about the
 * strategy. `setFieldVisibility` in the domain refuses exactly two statuses, and
 * this mirrors that list rather than inventing a narrower one.
 *
 * `Diarsipkan` / `Kedaluwarsa` are refused because that visibility is already
 * history (Rule 13 — "immutable, still readable"): it is part of what a client
 * saw, and editing it rewrites the answer to "what was shared on the day of the
 * dispute".
 *
 * Takes the STATUS only, exactly like `isEditable` — permission is `&&`-ed at
 * the call site. Folding `canWrite` in as a second argument reads fine and is
 * worse twice over: it makes this predicate answer two unrelated questions, and
 * the React Compiler could not preserve the page's manual memoization across it
 * (17 `preserve-manual-memoization` errors, none of them near this line). Same
 * shape as its neighbour is the shape that compiles.
 */
export function canEditVisibilitas(status: string): boolean {
  return status !== STRATEGI_DIARSIPKAN && status !== STRATEGI_KEDALUWARSA;
}

/** The value a toggle click should send — the opposite of what is stored. */
export function nextVisibilitas(current: string): string {
  return current === VISIBILITAS_SHAREABLE ? VISIBILITAS_INTERNAL : VISIBILITAS_SHAREABLE;
}

/** Whether the client sees this field as it currently stands. */
export function isDibagikan(row: StrategiFieldVisibility): boolean {
  return row.visibilitas === VISIBILITAS_SHAREABLE;
}

/**
 * Whether this row has been moved off its §4.1 default by a human.
 *
 * Read off `diubah_oleh`, not off a comparison with the default map — the page
 * does not hold that map (see the module note), and the server already
 * distinguishes the two by leaving the stamp null on an untouched seed row.
 */
export function isDiubah(row: StrategiFieldVisibility): boolean {
  return row.diubah_oleh !== null;
}

/**
 * Buckets the overlay by section, in §4 order.
 *
 * Reuses `sectionOf` rather than parsing again: a kekurangan kode and a field ID
 * are the same shape (`A-10`, `B-3.3`, `G-0`), and two parsers for one format is
 * how `B-3.3` ends up in one chapter on one panel and another chapter on the
 * next. A field ID the parser does not recognise lands in `lain` and is still
 * RENDERED — the same rule the gap panel follows, and for a stronger reason
 * here: an unrendered row is a field whose sharing state nobody can see.
 */
export function groupVisibilitas(
  rows: readonly StrategiFieldVisibility[],
): Map<SectionKey, StrategiFieldVisibility[]> {
  const out = new Map<SectionKey, StrategiFieldVisibility[]>();
  for (const s of STRATEGI_SECTIONS) out.set(s.key, []);
  for (const r of rows) {
    const key = sectionOf(r.field_id);
    const bucket = out.get(key);
    if (bucket) bucket.push(r);
    else out.set(key, [r]);
  }
  for (const bucket of out.values()) {
    bucket.sort((a, b) => a.field_id.localeCompare(b.field_id, 'en', { numeric: true }));
  }
  return out;
}

/**
 * Sections that hold visibility rows the AM cannot navigate to.
 *
 * The panel is scoped to the active section, and the nav disables any section
 * without a form — today that is **J**, which carries J-1 and J-4, both of them
 * toggleable. Left unsaid that is a switch with no door: four fields whose
 * sharing state nobody can see or change, and no message anywhere saying so.
 * The same failure mode `gate-reachability.test.ts` guards on the server side,
 * arriving through the UI instead.
 *
 * Reported rather than fixed here on purpose: the fix is Section J's form, not a
 * second navigation path bolted onto this panel.
 */
export function unreachableSections(
  rows: readonly StrategiFieldVisibility[],
  reachable: readonly SectionKey[],
): SectionKey[] {
  const grouped = groupVisibilitas(rows);
  const out: SectionKey[] = [];
  for (const [key, bucket] of grouped) {
    if (bucket.length > 0 && !reachable.includes(key)) out.push(key);
  }
  return out;
}

/** What the header line above the list reports. */
export interface VisibilitasRingkas {
  total: number;
  dibagikan: number;
  /** Rule 16(a) — rows with no switch at all, counted so the AM sees they exist. */
  terkunci: number;
  /** Rows a human moved off the §4.1 default. */
  diubah: number;
}

export function ringkasVisibilitas(
  rows: readonly StrategiFieldVisibility[],
): VisibilitasRingkas {
  return {
    total: rows.length,
    dibagikan: rows.filter(isDibagikan).length,
    terkunci: rows.filter((r) => !r.dapat_diubah).length,
    diubah: rows.filter(isDiubah).length,
  };
}

/**
 * Prose for the field IDs §4.1 names, and only those.
 *
 * §4.1 enumerates its two exception rows field by field and then calls the rest
 * "everything else" — so these nineteen are exactly the fields the PRD thought
 * worth describing in a visibility context, which is the same set an AM is
 * actually deciding about. The remaining ~100 are default-shareable by a blanket
 * rule and render with their kode, the same vocabulary the gap panel already
 * uses on this page.
 *
 * The six §4.1 once left unclassified are named here too. The owner resolved
 * their tiers via X-16 on 2026-08-09 (`docs/DECISIONS.md`), so they are grouped
 * below by the tier they landed in — no longer flagged as provisional.
 */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  // §4.1 row 1 (+ I-4 via X-16, 2026-08-09) — hard-internal, never shareable.
  'A-10': 'Riwayat agensi sebelumnya',
  'D-7': 'Sanggahan target',
  'F-5': 'Divisi & beban tim',
  'F-7': 'Batas toleransi over-komitmen',
  'H-4': 'Kondisi stop / ubah scope',
  'I-4': 'Catatan per divisi eksekusi',
  'J-2': 'Catatan reviewer',
  'J-3': 'Alasan revisi',
  // §4.1 row 2 (+ J-4 via X-16, 2026-08-09) — internal by default, the AM may share.
  'A-3': 'Ruang margin',
  'A-13': 'SLA klien',
  'C-6': 'Risiko struktural',
  'E-4': 'Floor price',
  'F-1': 'Sumber dana iklan',
  'H-1': 'Risk register',
  'J-4': 'Auto-diff vs versi sebelumnya',
  // Default-shareable via X-16 (2026-08-09) — named here for a friendlier badge.
  'A-15': 'Akses & hak per channel',
  'A-16': 'Blocker akses + target tanggal',
  'I-1': 'Ringkasan turunan ke kerangka Plan',
  'J-1': 'Versi, status, tanggal submit, AM',
};

/** The label for a field ID, or the kode itself when §4.1 does not name it. */
export function fieldLabel(fieldId: string): string {
  return FIELD_LABEL[fieldId] ?? fieldId;
}

/** Short Bahasa Indonesia name for a §4.1 tier, for the badge next to a row. */
export function tierLabel(tier: string): string {
  if (tier === 'hard_internal') return 'Tidak pernah dibagikan';
  if (tier === 'default_internal') return 'Default internal';
  if (tier === 'default_shareable') return 'Default dibagikan';
  // An unknown tier is a server that grew a fourth one without this page. Say so
  // rather than guessing — and the row still renders, with its switch driven by
  // `dapat_diubah`, which is the flag that actually decides.
  return tier;
}
