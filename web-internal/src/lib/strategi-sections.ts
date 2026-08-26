/**
 * A-13 — the Section A→J model behind the Strategi form, kept framework-free.
 *
 * `page.tsx` renders what this file returns, so the two things that actually
 * decide whether the form is usable — which section a gap belongs to, and how
 * many gaps a section has — are unit-testable without a browser (same reason
 * `nav.ts` is separate from `Sidebar.tsx`).
 *
 * ## Why the grouping lives here and not in the server response
 *
 * `GET /strategi/{id}/kekurangan` returns flat rows: `{ kode, pesan }`, where
 * `kode` is a PRD field ID — `A-5`, `D-6`, `G-1` — and for per-channel gaps it
 * carries the channel after a slash: `B-1/Shopee`, `E-2/TikTok Shop`,
 * `C-3/Shopee`.
 *
 * That shape is deliberate on the server side: §5 step 5 asks for a live count
 * of unmet required fields, and a flat list is what a count is taken over. The
 * SECTION a field belongs to is a property of the PRD's form layout — a UI
 * concern — so deriving it here keeps the server from having to know how the
 * form is chaptered. If the form is ever re-chaptered, nothing server-side moves.
 *
 * ## The one rule that matters
 *
 * A gap whose section cannot be derived must still be COUNTED and REACHABLE.
 * Dropping it would let the submit button say "0 kekurangan" while the server
 * refuses the submit — the worst failure this panel can have, because the AM has
 * no way to find out what is wrong. Unrecognised kodes land in `lain` and the
 * page renders that group like any other.
 */

/** The ten sections of §4, in the order the PRD writes them. */
export const STRATEGI_SECTIONS = [
  { key: 'A', label: 'Konteks Klien & Bisnis' },
  { key: 'B', label: 'Baseline per Channel' },
  { key: 'C', label: 'Diagnosa & Akar Masalah' },
  { key: 'D', label: 'Target & KPI' },
  { key: 'E', label: 'Strategi Inti' },
  { key: 'F', label: 'Komitmen Resource' },
  { key: 'G', label: 'Kalender & Fase' },
  { key: 'H', label: 'Risiko & Trigger Revisi' },
  { key: 'I', label: 'Turunan ke Plan & Brief' },
  { key: 'J', label: 'Approval & Versi' },
] as const;

export type SectionKey = (typeof STRATEGI_SECTIONS)[number]['key'] | 'lain';

/** One unmet requirement, exactly as `GET /strategi/{id}/kekurangan` returns it. */
export interface Kekurangan {
  kode: string;
  pesan: string;
}

const SECTION_KEYS: readonly string[] = STRATEGI_SECTIONS.map((s) => s.key);

/**
 * Kodes that are not field IDs and therefore cannot be parsed for a section.
 *
 * `checkCompleteness` used to emit one this way: `Rule 8` ("every target
 * carries an assumption"), a cross-field rule over D-2 and D-9 with no field
 * number of its own. Since ⟳ 2026-08-26 (DECISIONS) Rule 8 is advisory only —
 * `checkCompleteness` no longer emits it at all — so this map is currently
 * empty, but the mechanism stays for the next cross-field kode that needs it.
 *
 * This map is for kodes the server deliberately emits without a field ID. It is
 * NOT a place to paper over a kode that should have had one — a `Z-9` still goes
 * to `lain`, on purpose.
 */
const KODE_SECTION_OVERRIDE: Readonly<Record<string, SectionKey>> = {};

/**
 * sectionOf maps a kekurangan kode to its section.
 *
 * Accepts `A-5`, `B-1/Shopee`, and `G-1` alike: the section is the leading
 * letter, and everything after it is the field number and (optionally) the
 * channel. Anything that does not start with one of the ten section letters
 * followed by `-` is `lain` — see the module note on why that is not dropped.
 */
export function sectionOf(kode: string): SectionKey {
  const k = kode.trim();
  const override = KODE_SECTION_OVERRIDE[k];
  if (override !== undefined) return override;
  // `k[1] === '-'` matters: without it a future kode like `AKSES-3` would be
  // filed under A purely because it starts with the same letter.
  if (k.length >= 2 && k[1] === '-' && SECTION_KEYS.includes(k[0])) {
    return k[0] as SectionKey;
  }
  return 'lain';
}

/**
 * channelOf returns the channel a per-channel gap belongs to, or null.
 *
 * Channel names contain spaces (`TikTok Shop`) but never a slash, so the first
 * slash is an unambiguous separator.
 */
export function channelOf(kode: string): string | null {
  const i = kode.indexOf('/');
  if (i < 0) return null;
  const rest = kode.slice(i + 1).trim();
  return rest === '' ? null : rest;
}

/** `A-5` from `A-5/Shopee`; unchanged when there is no channel. */
export function fieldIdOf(kode: string): string {
  const i = kode.indexOf('/');
  return (i < 0 ? kode : kode.slice(0, i)).trim();
}

/**
 * groupKekurangan buckets the flat server list by section.
 *
 * Every section gets an entry even when empty — the nav renders a stable ten
 * rows, so a section going from 3 gaps to 0 does not shift the ones below it
 * while the AM is reading. `lain` is the exception: it appears only when
 * something landed in it, because an always-visible "lain: 0" is noise that
 * teaches AMs to ignore the row that matters most when it is not 0.
 */
export function groupKekurangan(items: Kekurangan[]): Map<SectionKey, Kekurangan[]> {
  const out = new Map<SectionKey, Kekurangan[]>();
  for (const s of STRATEGI_SECTIONS) out.set(s.key, []);
  for (const it of items) {
    const key = sectionOf(it.kode);
    const bucket = out.get(key);
    if (bucket) bucket.push(it);
    else out.set(key, [it]);
  }
  return out;
}

/** Section label for the nav; `lain` is named so an AM knows to report it. */
export function sectionLabel(key: SectionKey): string {
  const s = STRATEGI_SECTIONS.find((x) => x.key === key);
  return s ? `${s.key}. ${s.label}` : 'Lainnya (tidak dikenali)';
}

// ---------------------------------------------------------------------------
// Status — mirrors machine #15 (STATE_MACHINES). The server is the authority;
// this only decides what the page offers.
// ---------------------------------------------------------------------------

export const STRATEGI_DRAFT = 'Draft';
export const STRATEGI_DRAFT_REVISI = 'Draft Revisi';
export const STRATEGI_DIAJUKAN = 'Diajukan';
export const STRATEGI_AKTIF = 'Aktif';
export const STRATEGI_KEDALUWARSA = 'Kedaluwarsa';
export const STRATEGI_DIARSIPKAN = 'Diarsipkan';

/**
 * isEditable mirrors `requireDraftAndWriter`: Sections A→I accept writes only in
 * `Draft` / `Draft Revisi`.
 *
 * The one documented exception is NOT here: flipping a D-8 assumption to `Gugur`
 * is reachable while `Aktif`, because an assumption breaks during execution —
 * exactly when every edit door is shut. That control has its own gate rather
 * than widening this one, so nothing else leaks through with it.
 */
export function isEditable(status: string): boolean {
  return status === STRATEGI_DRAFT || status === STRATEGI_DRAFT_REVISI;
}
