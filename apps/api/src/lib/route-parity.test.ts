/**
 * FE↔API route parity guard.
 *
 * Every path `web-internal` calls must be served by a route in `apps/api`. The
 * Go build and the TypeScript build were ported module by module, and nothing
 * checked that the two halves still met at the HTTP boundary — so a handful of
 * endpoints were simply never ported, and the pages that call them 404 in
 * production (`web-internal/next.config.ts` proxies `/api/v1/*` to
 * `agency-app-api`, and the Go backend is archived read-only).
 *
 * This is the same class of defect as C03-F2 (`quote-preview`): a route nobody
 * crossed the HTTP boundary for. A unit test per side passes while the pair is
 * broken. So the assertion here is deliberately about the PAIR.
 *
 * KNOWN_GAPS is the ledger of what is still unported (DECISIONS **O41**). It is
 * expected to SHRINK; adding to it needs a decision entry, because every line in
 * it is a page that does not work.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { apiRoutes, FE_SRC_PORTAL, feCalls, servedBy, walkFe } from './parity-scan';

/**
 * Endpoints the FE calls that `apps/api` does not serve — the unported remainder
 * of the Go→TS port (DECISIONS O41). Each line is a broken page; the list must
 * only ever shrink.
 */
/**
 * EMPTY as of 2026-07-29 — all six O41 gaps are served. Kept (rather than deleted
 * along with its assertions) because the "every entry is still genuinely missing"
 * test below is what stops a future gap from being parked here silently: adding a
 * line means admitting a page does not work, and needs a DECISIONS entry.
 */
const KNOWN_GAPS = new Set<string>([]);

describe('FE↔API route parity', () => {
  const routes = apiRoutes();
  const calls = feCalls();

  it('finds both route tables (guards against the extraction silently breaking)', () => {
    // If either side ever reads as empty, every other assertion here becomes
    // vacuous — so assert the shape of the inputs, not just the diff.
    expect(routes.size).toBeGreaterThan(150);
    expect(calls.length).toBeGreaterThan(100);
    expect(routes).toContain('GET /me');
    expect(routes).toContain('POST /auth/login');
  });

  const isServed = (call: string) => [...routes].some((route) => servedBy(call, route));

  it('serves every endpoint web-internal calls, except the documented O41 gaps', () => {
    const missing = calls
      .filter(({ call }) => !isServed(call) && !KNOWN_GAPS.has(call))
      .map(({ call, file }) => `${call}  (called from ${file})`);
    expect(missing, `unported endpoints — the FE would 404:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps KNOWN_GAPS honest — every entry is still genuinely missing', () => {
    // When a gap gets ported, this fails until the line is deleted, so the
    // ledger cannot drift into fiction.
    const stale = [...KNOWN_GAPS].filter((gap) => isServed(gap));
    expect(stale, `already served — delete from KNOWN_GAPS: ${stale.join(', ')}`).toEqual([]);
  });

  it('serves the M4 §5 payment-intent handoff (O41 #1)', () => {
    // Positive assertion, not just absence from KNOWN_GAPS: proves the route file
    // is actually discovered on the path web-internal's setPaymentIntent() posts to.
    expect(routes).toContain('POST /clients/{}/payment-intent');
  });

  it('serves the M5 reminder dashboard on the path the FE actually calls', () => {
    // Regression: these were ported to `/reminders[/scan]` while both the FE and
    // Go use `/finance/reminders[/scan]`, so the Reminder Pembayaran page 404'd.
    expect(routes).toContain('GET /finance/reminders');
    expect(routes).toContain('POST /finance/reminders/scan');
    expect(routes).not.toContain('GET /reminders');
    expect(routes).not.toContain('POST /reminders/scan');
  });

  it('serves GET /leads/export (E1/E2)', () => {
    // Positive assertion, not a KNOWN_GAPS entry: `web-internal`'s
    // exportLeadsCsv() calls this with a raw fetch(), not `api.get()` (a CSV
    // body can't go through JSON.parse), so `feCalls()`'s `CALL_RE`
    // (`parity-scan.ts`) — which only recognizes `api.get/post/...` call
    // sites — can never see it and this route can never be flagged missing
    // by the generic scan either way. This line is the only thing that would
    // catch the route file going missing.
    expect(routes).toContain('GET /leads/export');
  });

  it('serves GET /clients/{}/assets — the Ads Asset picker (B-5 / K-3)', () => {
    // Positive assertion because THIS route existing is the whole of B-5's
    // second lock: before it, `/ads/[id]` shipped a "type the AST- from memory"
    // textbox precisely because no list endpoint existed. If the route file ever
    // goes missing, the picker degrades to an empty dropdown — which reads as a
    // permission problem, not a missing route.
    expect(routes).toContain('GET /clients/{}/assets');
  });

  it('serves the two Product Exchange M3-B machine routes (nol pemanggil web-internal by design)', () => {
    // Positive assertions, not `feCalls()` scan results: `web-internal` never
    // calls either path (MCN's coverage-push pipeline calls the first with a
    // bearer secret; the second is a manual/cron tick), so nothing else in this
    // file would ever notice if the route file disappeared.
    expect(routes).toContain('POST /internal/bridge/px-coverage');
    expect(routes).toContain('POST /internal/px/evaluate/tick');
    expect(routes).toContain('GET /internal/px/evaluate/tick');
  });
});

/**
 * The same guard for the SECOND frontend app (M15-C2, `web-client-portal`).
 *
 * `shape-parity.test.ts` has watched this app's response shapes since the
 * Client Portal read-model shipped; this half — whether the path it calls
 * exists at all — never got the equivalent guard. Found during the C-06
 * re-audit (`docs/backlog/CUTOVER_BACKLOG.md`): every call the app makes was
 * manually verified served, but nothing stopped a future one from silently
 * drifting the way `route-parity.test.ts` above stops it for `web-internal`.
 */
describe('FE↔API route parity — web-client-portal', () => {
  const routes = apiRoutes();
  const calls = feCalls(FE_SRC_PORTAL);

  it('finds the portal app FE calls (guards against the extraction silently breaking)', () => {
    // The portal is a small, deliberately narrow app (§4.2 allow-list) — the
    // count floor is far lower than web-internal's, but a scanner regression
    // (wrong root, `CALL_RE` stopped matching) must still fail loudly.
    expect(calls.length).toBeGreaterThan(5);
  });

  const isServed = (call: string) => [...routes].some((route) => servedBy(call, route));

  it('serves every endpoint web-client-portal calls', () => {
    // No KNOWN_GAPS here (unlike the web-internal block above): this app was
    // built whole in one wave (CR-09), not ported endpoint-by-endpoint from Go,
    // so there is no expected backlog of unported calls to carry.
    const missing = calls
      .filter(({ call }) => !isServed(call))
      .map(({ call, file }) => `${call}  (called from ${file})`);
    expect(missing, `unported endpoints — the portal page would 404:\n${missing.join('\n')}`).toEqual([]);
  });

  it('serves the four allow-listed data surfaces + auth (M15 §4.2/§6.1)', () => {
    // Positive assertions: the exact set this app's own `portal-data.ts`
    // docblock calls out, plus the auth realm it depends on.
    expect(routes).toContain('GET /client-portal/reports');
    expect(routes).toContain('GET /client-portal/service-progress');
    expect(routes).toContain('GET /client-portal/health');
    expect(routes).toContain('POST /client-portal/complaints');
    expect(routes).toContain('GET /client-portal/me');
    expect(routes).toContain('POST /auth/client-portal/forgot-password');
    expect(routes).toContain('POST /auth/client-portal/reset-password');
  });

  /**
   * M20 R11 — SATU permukaan laporan untuk klien (requirement pemilik
   * 2026-09-22: "klien hanya melihat 1 bagian report, jangan sampai ada 2
   * report yang bisa dilihat klien"; `docs/DECISIONS.md` 2026-09-22
   * M20-SATU-LAPORAN-PORTAL).
   *
   * Gelombang D M20 MENGGANTI sumber di balik dua rute yang sudah ada
   * (`client_reports` → `pdt_laporan_kiriman`+`pdt_laporan_publikasi`+
   * `pdt_laporan_insight`), bukan menambah rute ketiga di sampingnya. Rute
   * portal apa pun yang memuat report/laporan/pdt di luar dua ini berarti
   * daftar KEDUA lahir — persis yang pemilik larang — jadi himpunannya
   * dikunci PERSIS, bukan sekadar "mengandung".
   */
  it('memberi klien TEPAT SATU permukaan laporan: satu daftar, satu dokumen (M20 R11)', () => {
    const portalReportRoutes = [...routes]
      .filter((r) => r.includes('/client-portal/'))
      .filter((r) => /report|laporan|pdt/i.test(r))
      .sort();
    expect(portalReportRoutes).toEqual([
      'GET /client-portal/reports',
      'GET /client-portal/reports/{}/html',
    ]);
  });

  it('halaman laporan di web-client-portal tepat dua: daftar + detail — nol halaman "Laporan PDT" terpisah (M20 R11)', () => {
    // Sisi FE dari kunci yang sama: kalau Gelombang D lahir sebagai
    // `(portal)/laporan-pdt/**` atau `(portal)/pdt/**` di samping
    // `(portal)/laporan/**`, klien punya dua menu laporan walau rutenya satu.
    const pages = walkFe(join(FE_SRC_PORTAL, 'app'))
      .filter((f) => /[\\/]page\.tsx$/.test(f))
      .filter((f) => /laporan|report|pdt/i.test(f.slice(FE_SRC_PORTAL.length)))
      .map((f) => f.slice(FE_SRC_PORTAL.length).replace(/\\/g, '/'))
      .sort();
    expect(pages).toEqual([
      '/app/(portal)/laporan/[id]/page.tsx',
      '/app/(portal)/laporan/page.tsx',
    ]);
  });
});
