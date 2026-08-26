/**
 * A-12 + the two Section D controls that outlive `Draft` — the model behind the
 * things an AM does to a Strategi that is already running (M6A Rules 13, 19).
 *
 * Framework-free like `strategi-sections.ts` and `strategi-visibilitas.ts`: the
 * rules here decide whether a revision can even be requested, and getting one
 * wrong shows up as a button that 409s rather than as a wrong pixel.
 *
 * ## Three statuses, three different answers, and they are NOT the same rule
 *
 * | Control                | Reachable when                        | Why |
 * |------------------------|---------------------------------------|-----|
 * | D-7 Sanggahan Target   | `Draft` / `Draft Revisi`              | it is an argument about a target being SET, made while setting it (`requireDraftAndWriter`) |
 * | D-8 status flip        | any live version                      | an assumption breaks during execution — exactly when every edit door is shut |
 * | A-12 open revision     | `Aktif` only                          | Rule 13: version n must be the approved active one before n+1 can exist |
 *
 * Collapsing any two of these into one predicate is how a control ends up
 * offered in a state the server refuses, or hidden in a state where it is the
 * only thing that helps.
 */
import {
  STRATEGI_AKTIF,
  STRATEGI_DIARSIPKAN,
  STRATEGI_KEDALUWARSA,
  isEditable,
} from './strategi-sections';
import type { AssumptionState, StrategiDetail } from './strategi';

/** Rule 19 — D-7 is written while the target is being set, so: Draft only. */
export function canRaiseSanggahan(status: string): boolean {
  return isEditable(status);
}

/**
 * Rule 13 — a revision may only be opened from the approved ACTIVE version.
 *
 * Not "anything that is not a draft": `Diajukan` is awaiting approval and
 * `Diarsipkan` is a superseded version, and opening a revision from either would
 * be asking to revise something nobody approved or something already replaced.
 */
export function canOpenRevisi(status: string): boolean {
  return status === STRATEGI_AKTIF;
}

/**
 * D-8 status flip — reachable outside `Draft`, unlike every other Section D
 * write, because an assumption breaks during execution.
 *
 * ⚠️ **This is NARROWER than the server.** `setAssumptionStatus` in the domain
 * checks ownership and nothing else — it would accept a flip on a `Diarsipkan`
 * version too, and that flip fires `strategi_revisi_disarankan`: a "please
 * revise" notification about a version that has already been superseded. The UI
 * declines to offer that; the asymmetry is recorded as an open question rather
 * than closed by inventing a server rule the PRD does not state.
 */
export function canFlipAsumsi(status: string): boolean {
  return status !== STRATEGI_DIARSIPKAN && status !== STRATEGI_KEDALUWARSA;
}

/** What the A-12 dialog collects — the three things Rule 13 requires. */
export interface RevisiDraft {
  /** H-2 kodes. Rule 13 (a): "a trigger from the enumerated list". */
  trigger_revisi: string[];
  /** Rule 13 (b): free text, and it is the record of why version n+1 exists. */
  alasan_revisi: string;
  /** Rule 13 (c): D-8 kodes — which assumption(s) broke. */
  asumsi_gugur: string[];
}

export const REVISI_KOSONG: RevisiDraft = {
  trigger_revisi: [],
  alasan_revisi: '',
  asumsi_gugur: [],
};

/**
 * The triggers this Strategi may cite — the ones it DECLARED in H-2, not the
 * global vocabulary.
 *
 * `openRevision` refuses a trigger this record never declared
 * (`MSG_TRIGGER_NOT_DECLARED`), and it is a cross-row check the DB CHECK cannot
 * make. Offering the global list would put codes in front of the AM that are
 * guaranteed to be rejected — and the rejection names a rule ("tidak
 * dideklarasikan di H-2") that reads as a bug to anyone who did not write H-2.
 */
export function declaredTriggers(detail: StrategiDetail): string[] {
  return detail.trigger_revisi.map((t) => t.kode);
}

/**
 * Which of Rule 13's three requirements the draft still fails, in BI.
 *
 * Mirrors `MSG_REVISION_INCOMPLETE`, which the server answers as ONE message for
 * any combination. Splitting it here is not a second gate — the server still
 * decides — it is so the AM can see which of the three boxes is empty instead of
 * re-reading a sentence that lists all three every time.
 *
 * `asumsiCount` is the number of D-8 rows THIS Strategi has (`detail.assumptions.length`),
 * not the draft's selection. Requirement (c) only binds when that is > 0 — since
 * D-8 is no longer a submit gate (⟳ 2026-08-26 DECISIONS), a Strategi can reach
 * `Aktif` with zero assumptions ever recorded, and there is nothing to cite.
 */
export function revisiKekurangan(draft: RevisiDraft, asumsiCount: number): string[] {
  const out: string[] = [];
  if (draft.trigger_revisi.length === 0) out.push('trigger revisi (dari H-2)');
  if (draft.alasan_revisi.trim() === '') out.push('alasan revisi');
  if (asumsiCount > 0 && draft.asumsi_gugur.length === 0) out.push('asumsi mana yang gugur (D-8)');
  return out;
}

/** Body for `POST /strategi/{id}/revision`, trimmed the way the server expects. */
export function revisiToBody(draft: RevisiDraft): {
  trigger_revisi: string[];
  alasan_revisi: string;
  asumsi_gugur: string[];
} {
  return {
    trigger_revisi: draft.trigger_revisi.map((t) => t.trim()).filter(Boolean),
    alasan_revisi: draft.alasan_revisi.trim(),
    asumsi_gugur: draft.asumsi_gugur.map((a) => a.trim()).filter(Boolean),
  };
}

/** Adds or removes one value — the shape every multi-select in this form needs. */
export function toggleIn(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** What the D-7 form collects. All three are required (`MSG_SANGGAHAN_INCOMPLETE`). */
export interface SanggahanDraft {
  alasan: string;
  angka_pembanding: string;
  target_realistis: string;
}

export const SANGGAHAN_KOSONG: SanggahanDraft = {
  alasan: '',
  angka_pembanding: '',
  target_realistis: '',
};

export function sanggahanLengkap(draft: SanggahanDraft): boolean {
  return (
    draft.alasan.trim() !== '' &&
    draft.angka_pembanding.trim() !== '' &&
    draft.target_realistis.trim() !== ''
  );
}

/**
 * The status an assumption should move to when the AM presses the one button.
 *
 * `Terverifikasi` is deliberately NOT offered as a click target here: the flip
 * that matters operationally is `Gugur` (it fires `strategi_revisi_disarankan`),
 * and a three-way control invites an AM to mark an assumption verified as a
 * tidy-up gesture — which is a claim about reality, not a UI state.
 */
export function nextAsumsiStatus(current: AssumptionState): AssumptionState {
  return current === 'Gugur' ? 'Berlaku' : 'Gugur';
}
