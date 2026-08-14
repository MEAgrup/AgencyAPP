// The wire shape of a state-machine transition, and how to render it.
//
// Every lifecycle edge in the API answers `packages/core` statemachine's
// `TransitionOk` verbatim (`apps/api/src/lib/http.ts` → transitionResponse →
// `json(result)`), i.e.:
//
//     {"ok": true, "from": "[To Do]", "to": "[In Progress]"}
//
// The retired Go backend serialized `statemachine.Result` WITHOUT json tags, so
// the same body used to arrive as `{"From": …, "To": …}` — and three lib modules
// still declared that capitalized shape after the cutover. Nothing type-checked
// it (the response is cast by `api.post<T>`, never validated), so the pages read
// `res.To` off a body that has no such key and every success banner rendered
// "Status berpindah ke undefined." — a class-O43 wire mismatch: the call
// succeeded, the UI lied about it.
//
// This module is the single place that knows the answer. It reads BOTH casings
// on purpose: the lowercase keys are the contract, and the capitalized fallback
// costs one `??` while making the renderer immune to a body that still comes
// from an older deployment. Pure and dependency-free so it stays unit-testable
// (the campaign-picker.ts precedent).

/** A successful transition as it arrives on the wire. */
export interface TransitionResult {
  ok?: boolean;
  from?: string;
  to?: string;
  /** Legacy Go serialization (`statemachine.Result`, no json tags). */
  From?: string;
  To?: string;
}

/** Status the entity left, or '—' when the body carried neither casing (house rule #7). */
export function transitionFrom(res: TransitionResult | null | undefined): string {
  return res?.from ?? res?.From ?? '—';
}

/** Status the entity reached, or '—' when the body carried neither casing. */
export function transitionTo(res: TransitionResult | null | undefined): string {
  return res?.to ?? res?.To ?? '—';
}

/** "[To Do] → [In Progress]" — the arrow label shown next to a success banner. */
export function transitionLabel(res: TransitionResult | null | undefined): string {
  return `${transitionFrom(res)} → ${transitionTo(res)}`;
}
