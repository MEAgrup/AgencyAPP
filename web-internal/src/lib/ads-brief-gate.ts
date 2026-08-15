// Which Ads Briefs can carry a new Ad Campaign, and — when none can — what the
// advertiser has to do about it.
//
// M8 §4 Rule 1 lets an Ad Campaign be born ONLY under a Brief that is already
// `[In Progress]` (packages/domain `ads.createCampaign` answers
// MSG_BRIEF_NOT_IN_PROGRESS otherwise). A freshly briefed Ads task is born
// `[To Do]`, so the very first thing an advertiser sees on /ads is a division
// queue full of briefs and a "Pilih brief..." dropdown with nothing in it — the
// gate is invisible, and the page reads as broken rather than as gated.
//
// The status labels themselves are the shared vocabulary of the brief_task
// machine (STATE_MACHINES §7); the only edge this module cares about is
// `[To Do]` → `[In Progress]` (M12 §3, POST /tasks/{id}/start).
//
// Dependency-free ON PURPOSE (the campaign-picker.ts / lead-progress.ts
// precedent): `lib/ads.ts` imports `lib/api`, and the `@/` path alias is a
// Next/tsconfig feature vitest does not resolve — so anything that must be
// unit-testable cannot live there. The AdsBrief import below is type-only and
// erases at compile time.

import type { AdsBrief } from '@/lib/ads';

// brief_task status labels (STATE_MACHINES §7) — verbatim, never re-cased.
export const BRIEF_TODO = '[To Do]';
export const BRIEF_IN_PROGRESS = '[In Progress]';

export interface AdsBriefGate {
  /** `[In Progress]` — a campaign can be created under these right now (§4 Rule 1). */
  selectable: AdsBrief[];
  /** `[To Do]` — exactly one start edge (M12 §3) away from being selectable. */
  startable: AdsBrief[];
  /** Everything else (submitted / in review / approved / blocked): not a campaign parent. */
  blocked: AdsBrief[];
}

/** Split the Ads division queue into the three buckets the create-campaign form cares about. */
export function partitionAdsBriefs(briefs: readonly AdsBrief[] | null): AdsBriefGate {
  const gate: AdsBriefGate = { selectable: [], startable: [], blocked: [] };
  for (const b of briefs ?? []) {
    if (b.status === BRIEF_IN_PROGRESS) {
      gate.selectable.push(b);
    } else if (b.status === BRIEF_TODO) {
      gate.startable.push(b);
    } else {
      gate.blocked.push(b);
    }
  }
  return gate;
}

/**
 * The one line of guidance to show above the (empty) brief dropdown, or null when
 * the dropdown has something in it and needs no explanation. Bahasa Indonesia, and
 * deliberately NOT bracketed: house rule #5 reserves `[...]` for server-side
 * validation messages, and this is UI copy, not a rejection.
 */
export function gateHint(gate: AdsBriefGate): string | null {
  if (gate.selectable.length > 0) {
    return null;
  }
  if (gate.startable.length > 0) {
    return 'Belum ada brief Ads yang berstatus [In Progress]. Kampanye hanya lahir di bawah brief yang sudah dikerjakan — mulai dulu briefnya di bawah ini, lalu brief tersebut akan muncul di daftar pilihan.';
  }
  if (gate.blocked.length > 0) {
    return 'Semua brief Ads Anda sudah melewati tahap pengerjaan (atau sedang diblokir), jadi tidak ada yang bisa menampung kampanye baru. Kampanye hanya dapat dibuat saat brief berstatus [In Progress].';
  }
  return 'Belum ada brief divisi Ads yang terlihat untuk peran Anda. Brief lahir dari layanan klien (M6 §5) — minta AM membuat brief Ads terlebih dulu.';
}
