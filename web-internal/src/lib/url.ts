/**
 * True when a free-form value looks like a clickable web link (e.g. a Google
 * Drive share URL) rather than plain text that happens to sit in a field
 * meant for one. Mirrors `looksLikeUrl` in `packages/domain/src/brief-
 * inherit.ts` — same rule, kept separate because this side has no shared
 * package with the domain layer.
 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
