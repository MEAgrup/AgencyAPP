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
 */

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
}

export const EMBEDDED_TOOLS: Record<string, EmbeddedTool> = {
  'video-factory': {
    slug: 'video-factory',
    title: 'MEA Video Factory',
    tagline:
      'Baseline · Papan · Tracker · Sheet — turunkan baseline channel (CDPS Section B) dari export TikTok Shop, cari video yang sudah menjual, tetapkan angka target tim Creative, ukur hasil produksi lewat hashtag, lalu keluarkan baris siap tempel ke Video Master.',
    audience: 'Account Manager (Baseline & Papan) · CC / Leader Video (Tracker & Sheet)',
    asset: '/tools/video-factory.html',
  },
};

/** Resolve one tool by slug, or `undefined` if the slug is not registered. */
export function getEmbeddedTool(slug: string): EmbeddedTool | undefined {
  return Object.prototype.hasOwnProperty.call(EMBEDDED_TOOLS, slug)
    ? EMBEDDED_TOOLS[slug]
    : undefined;
}
