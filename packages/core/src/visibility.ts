/**
 * M6A A-10 — the two visibility tiers of a Strategi (§4.1, Rule 16).
 *
 * A Strategi is a CLIENT-FACING document by default: it is what the AM presents
 * at kickoff. §4.1 is the list of exceptions, and Rule 16 splits them three ways:
 *
 * | Tier                | Default in the client view | AM may toggle? |
 * |---------------------|----------------------------|----------------|
 * | `hard_internal`     | hidden                     | **never**      |
 * | `default_internal`  | hidden                     | yes, audit-logged |
 * | `default_shareable` | shown                      | yes, audit-logged |
 *
 * ## Why this list lives in `packages/core` and not in the page that renders it
 *
 * §7 makes the hard-internal set a **frozen invariant enforced twice**: rejected
 * by the TS predicate here AND by a DB CHECK, with the two forbidden to diverge.
 * A UI-side list would be a third copy, and the one that a `/s/{token}` renderer
 * is most likely to forget — which is a leak, not a bug.
 *
 * The tier is per FIELD ID, not per column. `A-10` is one question ("riwayat
 * agensi sebelumnya") even though a future schema may spread it over two columns;
 * the client either sees the answer or does not.
 *
 * ## The one thing to understand before editing this file
 *
 * `visibilityOf` is TOTAL over the field registry: every ID in
 * `STRATEGI_FIELD_IDS` has a tier, and `visibility.test.ts` fails if one does
 * not. That is deliberate and it is the whole safety property. A map with holes
 * needs a fallback, and either fallback is a bug waiting:
 *
 *   - fall back to **shareable** ⇒ a field nobody classified is published to the
 *     client. That is how I-4 ("catatan khusus untuk tiap divisi eksekusi — hal
 *     yang mudah salah dipahami") would have reached a client view.
 *   - fall back to **internal** ⇒ new fields silently vanish from the client
 *     document and nobody notices until a client asks why the deck is thinner.
 *
 * Adding a field to the PRD therefore means adding it here, and the test says so
 * by name. Do not add a default branch to make it stop.
 */

/** Rule 16 — the stored value is Bahasa Indonesia, because §4 writes it that way. */
export const VISIBILITY_SHAREABLE = 'Bagikan ke Klien';
export const VISIBILITY_INTERNAL = 'Internal Saja';
export const VISIBILITIES = [VISIBILITY_SHAREABLE, VISIBILITY_INTERNAL] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Which of the three §4.1 rows a field sits in. */
export type VisibilityTier = 'hard_internal' | 'default_internal' | 'default_shareable';

/**
 * The hard-internal set — never shareable, not by anyone, not with a toggle.
 *
 * **FROZEN.** This exact set is re-asserted by a DB CHECK; `visibility.test.ts`
 * pins it member by member so that widening it needs an explicit edit in a diff
 * a reviewer sees, and NARROWING it — moving a field out of here — is a
 * disclosure decision that belongs in `docs/DECISIONS.md`, not in a refactor.
 *
 * Read the list as a sentence about what MEA never shows a client: what the
 * previous agency did wrong (A-10), that we think their target is unrealistic
 * (D-7), how many of our people we put on them and for how long (F-5), how far
 * over we let ourselves go before escalating (F-7), the conditions under which
 * we would stop or shrink the scope (H-4), what our own reviewer said about the
 * AM's work (J-2, J-3), and the per-division notes about "hal yang mudah salah
 * dipahami" on this account (I-4).
 *
 * §4.1 enumerated the first seven. **I-4 was left unclassified by §4.1 and the
 * owner ruled it hard-internal (X-16, `docs/DECISIONS.md` 2026-08-09)** — read to
 * a client, I-4 reads as a list of the mistakes our team keeps making on their
 * account, so it gets the strictest tier and no toggle.
 */
export const STRATEGI_HARD_INTERNAL: readonly string[] = [
  'A-10', // riwayat agensi sebelumnya
  'D-7', // sanggahan target
  'F-5', // divisi & beban tim
  'F-7', // batas toleransi over-komitmen
  'H-4', // kondisi stop / ubah scope
  'I-4', // catatan per divisi eksekusi — §4.1 unclassified, hard-internal per X-16 (2026-08-09)
  'J-2', // catatan reviewer
  'J-3', // alasan revisi
];

/**
 * §4.1 row 2 — hidden by default, but the AM may share it, and the toggle is
 * audit-logged.
 *
 * These are the judgement calls: sharing them can be exactly right with a mature
 * client and exactly wrong with a new one, which is why the PRD gives the AM the
 * switch rather than picking for them.
 *
 * **J-4 was left unclassified by §4.1 and the owner ruled it default-internal
 * (X-16, `docs/DECISIONS.md` 2026-08-09).** ⚠️ J-4 is an AUTO DIFF over the whole
 * record, so even a J-4 an AM shares renders changes to fields that are
 * themselves hard-internal — the diff would leak D-7 and H-4 through the back
 * door while every per-field check passed. Whatever visibility J-4 carries, the
 * diff generator MUST filter its own rows through `shareableFields`; that is not
 * optional and it is not implied by this list.
 */
export const STRATEGI_DEFAULT_INTERNAL: readonly string[] = [
  'A-3', // ruang margin
  'A-13', // SLA klien
  'C-6', // risiko struktural
  'E-4', // floor price
  'F-1', // sumber dana iklan
  'H-1', // risk register
  'J-4', // auto-diff vs versi sebelumnya — §4.1 unclassified, default-internal per X-16 (2026-08-09); see ⚠️ above
];

/**
 * X-16 (RESOLVED 2026-08-09, `docs/DECISIONS.md`) — the six field IDs §4.1 left
 * unclassified.
 *
 * §4.1 described its third row as "everything else" and then ENUMERATED what it
 * meant, so six IDs appeared in §4 but in none of the three rows — the PRD
 * contradicting the PRD. The house rule was to flag rather than quietly resolve;
 * the owner then ruled:
 *
 *   - **A-15, A-16, I-1, J-1 → `default_shareable`.** They carry no entry of
 *     their own: `tierOf` resolves them through the `STRATEGI_FIELD_IDS`
 *     fallback, the same door every ordinary client-facing field uses. Making
 *     them shareable is what unblocked A-11 (`/s/{token}`).
 *   - **I-4 → `hard_internal`** — see `STRATEGI_HARD_INTERNAL`.
 *   - **J-4 → `default_internal`** — see `STRATEGI_DEFAULT_INTERNAL` and its
 *     diff-filter warning.
 *
 * Moving I-4 or J-4 out later is a disclosure decision and needs a DECISIONS.md
 * entry plus (for I-4) a `DROP/ADD CONSTRAINT` in the same commit as the change.
 */

/**
 * Sections whose every field §4.1 declares shareable in one stroke ("all of B",
 * "all of G").
 *
 * Kept as a section rule rather than 52 enumerated IDs because that is how the
 * PRD states it: expanding it here would mean a future `B-10.4` silently misses
 * the list, which is the exact hole `visibilityOf` is total to prevent.
 */
const WHOLLY_SHAREABLE_SECTIONS: readonly string[] = ['B', 'G'];

/**
 * Every field ID §4 defines, and therefore every ID that needs a tier.
 *
 * Sections B and G are covered by `WHOLLY_SHAREABLE_SECTIONS` and enumerated in
 * the test from the PRD itself, so they are not repeated here.
 */
export const STRATEGI_FIELD_IDS: readonly string[] = [
  ...Array.from({ length: 16 }, (_, i) => `A-${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `C-${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `D-${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `E-${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `F-${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `H-${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `I-${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `J-${i + 1}`),
];

/**
 * Section B field IDs, transcribed from M6A §4 rather than derived.
 *
 * ⚠️ This list is NOT what makes B shareable — `tierOf` answers that from the
 * section rule above, and it keeps answering for a `B-10.4` that nobody added
 * here. The list exists for the one job the section rule cannot do: **seeding**
 * `STRG_FIELD_VISIBILITY`, which needs actual IDs to write rows for.
 *
 * So a missing entry costs a seed row, not a tier: the field still resolves
 * through `defaultVisibility` at read time. That asymmetry is why enumerating
 * here is safe when enumerating inside `tierOf` would not be.
 */
export const STRATEGI_SECTION_B_FIELD_IDS: readonly string[] = [
  'B-0.1', 'B-0.2', 'B-0.3', 'B-0.4', 'B-0.5', 'B-0.6', 'B-0.7', 'B-0.8',
  'B-1.1', 'B-1.2', 'B-1.3', 'B-1.4', 'B-1.5',
  'B-2.1', 'B-2.2', 'B-2.3', 'B-2.4',
  'B-3.1', 'B-3.2', 'B-3.3', 'B-3.4', 'B-3.5', 'B-3.6',
  'B-4.1', 'B-4.2', 'B-4.3', 'B-4.4', 'B-4.5',
  'B-5.1', 'B-5.2', 'B-5.3', 'B-5.4', 'B-5.5',
  'B-6.1', 'B-6.2', 'B-6.3', 'B-6.4', 'B-6.5',
  'B-7.1', 'B-7.2', 'B-7.3', 'B-7.4',
  'B-8.1', 'B-8.2', 'B-8.3',
  'B-9.1', 'B-9.2', 'B-9.3',
];

/** Section G field IDs — see the note on `STRATEGI_SECTION_B_FIELD_IDS`. */
export const STRATEGI_SECTION_G_FIELD_IDS: readonly string[] = ['G-0', 'G-1', 'G-2', 'G-3', 'G-4'];

/**
 * Every field ID a Strategi carries — the roster `createStrategi` seeds the
 * overlay from, and the roster `visibility.test.ts` proves `tierOf` is total over.
 */
export const STRATEGI_FIELD_ROSTER: readonly string[] = [
  ...STRATEGI_FIELD_IDS,
  ...STRATEGI_SECTION_B_FIELD_IDS,
  ...STRATEGI_SECTION_G_FIELD_IDS,
];

/**
 * The exact list of field IDs the DB CHECK must refuse to mark shareable.
 *
 * COMPUTED from the tier map, never typed a second time: §7 calls the
 * hard-internal set a frozen invariant enforced twice and forbids the two
 * enforcers to diverge, so the migration's CHECK is asserted against the output
 * of `isHardInternal` — not against a hand-copied literal that a later edit to
 * `STRATEGI_HARD_INTERNAL` could silently leave behind. A CHECK and a TS
 * predicate carrying different sets is precisely the divergence §7 names, and it
 * is a leak: the AM ticks the box, gets a 200, and the write fails at the wall
 * with no BI message anywhere near it.
 */
export function hardInternalFieldIds(): string[] {
  return STRATEGI_FIELD_ROSTER.filter((id) => isHardInternal(id));
}

/** `A-15` → `A`; `B-3.3` → `B`. Section letter only, channel suffixes never reach here. */
function sectionOf(fieldId: string): string {
  return fieldId.trim().charAt(0).toUpperCase();
}

/**
 * The §4.1 tier of one field ID, or `null` if the ID is not one §4 defines.
 *
 * `null` is NOT a permissive answer — it means "this is not a Strategi field",
 * and every caller must treat it as a refusal. `isShareableByDefault` below does.
 */
export function tierOf(fieldId: string): VisibilityTier | null {
  const id = fieldId.trim();
  if (id === '') return null;

  if (STRATEGI_HARD_INTERNAL.includes(id)) return 'hard_internal';
  if (STRATEGI_DEFAULT_INTERNAL.includes(id)) return 'default_internal';

  // Whole-section rules come AFTER the explicit lists so a future exception
  // inside B or G is honoured rather than swallowed by the section.
  if (WHOLLY_SHAREABLE_SECTIONS.includes(sectionOf(id)) && /^[A-J]-\d+(\.\d+)?$/.test(id)) {
    return 'default_shareable';
  }

  return STRATEGI_FIELD_IDS.includes(id) ? 'default_shareable' : null;
}

/** Rule 16(a) — a hard-internal field can never be toggled, by anyone, ever. */
export function isHardInternal(fieldId: string): boolean {
  return tierOf(fieldId) === 'hard_internal';
}

/** The seed value for the `STRG_FIELD_VISIBILITY` overlay when a Strategi is created. */
export function defaultVisibility(fieldId: string): Visibility | null {
  const tier = tierOf(fieldId);
  if (tier === null) return null;
  return tier === 'default_shareable' ? VISIBILITY_SHAREABLE : VISIBILITY_INTERNAL;
}

/**
 * Whether an AM is allowed to set this field to `Bagikan ke Klien`.
 *
 * An unknown field ID answers `false`. That direction is the whole point: a
 * typo'd or newly-invented ID must not become a publishing door, and a field the
 * registry has never heard of is exactly what an attacker or a careless
 * migration would supply.
 */
export function canToggleShareable(fieldId: string): boolean {
  const tier = tierOf(fieldId);
  return tier === 'default_internal' || tier === 'default_shareable';
}

/**
 * Filters a set of field IDs down to what a client may see, given the per-Strategi
 * overlay.
 *
 * Hard-internal is applied LAST and unconditionally: the overlay is a table an
 * AM writes into, so a row saying `A-10` is shareable must be treated as data to
 * ignore rather than as an instruction to obey. §7 requires this filter to run
 * BEFORE serialisation — a field removed from the rendered HTML but present in
 * the payload is still disclosed.
 */
export function shareableFields(
  fieldIds: readonly string[],
  overlay: Readonly<Record<string, Visibility>> = {},
): string[] {
  return fieldIds.filter((id) => {
    if (tierOf(id) === null) return false;
    if (isHardInternal(id)) return false;
    return (overlay[id] ?? defaultVisibility(id)) === VISIBILITY_SHAREABLE;
  });
}
