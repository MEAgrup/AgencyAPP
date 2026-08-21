/**
 * Registry of embedded HTML tools — self-contained, client-side utilities that
 * the team already runs as standalone `.html` files and that CDPS now surfaces
 * inside the shell via an `<iframe>`.
 *
 * ## Why an iframe, not a React port
 *
 * These tools compute everything in the browser from files the user drops in
 * (SheetJS parses the TikTok Shop exports; the math is all in the page). CDPS
 * does not recompute them — it INGESTS the payload they emit, exactly like the
 * existing AM baseline tool: `apps/api/.../interview/[id]/baseline` takes a
 * browser-computed `cdps.baseline.tiktok.v1` payload and re-derives only the
 * trust-critical fields server-side. Re-implementing the same math in TS would
 * create a second copy of one business rule — the drift trap CLAUDE.md warns
 * against — so the math stays in ONE place (the HTML) until a deliberate port.
 *
 * See `docs/DECISIONS.md` 2026-08-21 "Embed alat HTML AM di CDPS".
 *
 * ## Adding a tool
 *
 * 1. Drop the self-contained `.html` (plus any vendored asset it needs) under
 *    `web-internal/public/tools/`.
 * 2. Add one entry here.
 * 3. Add one gated nav line in `@/lib/nav.ts` pointing at `/tools/<slug>`.
 *
 * The `/tools/[slug]` route renders any entry; no per-tool page is needed.
 *
 * ## Who may use a tool
 *
 * Unlike a data page, an embedded tool has no server endpoint to gate — the math
 * runs in the browser. So the ONLY place access can be enforced is at render
 * time: `access(role)` below is the single source of truth, consumed BOTH by
 * `/tools/[slug]/page.tsx` (which refuses to render the iframe for a role that
 * fails it) AND by `@/lib/nav.ts` (which hides the menu line for the same role).
 * One predicate, no drift.
 */
import type { Role } from './types';

/** Case-insensitive division membership (mirrors the tolerance in `nav.ts`). */
function inDivision(role: Role, ...names: string[]): boolean {
  const d = (role.division ?? '').toLowerCase();
  return names.some((n) => n.toLowerCase() === d);
}

/**
 * Creative & Account Service only — owner decision (2026-08-21): the baseline
 * research tool is for those two teams. Division membership ONLY: a layered
 * OD/Director does NOT get in through read-everywhere (that bypass is for data
 * pages, and this is a working tool, not a record to inspect) unless they are
 * themselves on the Creative or Account division.
 */
export function creativeOrAccountOnly(role: Role): boolean {
  return inDivision(role, 'Account', 'Creative');
}

export interface EmbeddedTool {
  /** URL segment: `/tools/<slug>`. Also the registry key. */
  slug: string;
  /** Page heading shown above the embed. */
  title: string;
  /** One-line description under the heading. */
  tagline: string;
  /** Who this tool is for (rendered as a small meta line). */
  audience: string;
  /**
   * Path to the self-contained HTML under `public/` (leading slash). Served as
   * a static asset and loaded in an iframe — no CDPS API calls happen inside.
   */
  asset: string;
  /**
   * Who may open this tool. The single source of truth for both the page guard
   * and the nav gate (see the module doc). Called only with a resolved role;
   * callers handle the still-loading (`null`) case themselves.
   */
  access: (role: Role) => boolean;
}

export const EMBEDDED_TOOLS: Record<string, EmbeddedTool> = {
  'video-factory': {
    slug: 'video-factory',
    title: 'AM - baseline riset',
    tagline:
      'Baseline · Papan · Tracker · Sheet — turunkan baseline channel (CDPS Section B) dari export TikTok Shop, cari video yang sudah menjual, tetapkan angka target tim Creative, ukur hasil produksi lewat hashtag, lalu keluarkan baris siap tempel ke Video Master.',
    audience: 'Team Creative & Account Service',
    asset: '/tools/video-factory.html',
    access: creativeOrAccountOnly,
  },
};

/** Resolve one tool by slug, or `undefined` if the slug is not registered. */
export function getEmbeddedTool(slug: string): EmbeddedTool | undefined {
  return Object.prototype.hasOwnProperty.call(EMBEDDED_TOOLS, slug)
    ? EMBEDDED_TOOLS[slug]
    : undefined;
}
