/**
 * Shared secret gate for the internal cron tick routes
 * (`internal/{health,performance,plan,penugasan}/tick`). This was copy-pasted
 * into all four route files; consolidated here so the accepted credential shapes
 * stay identical across every tick and can only ever change in one place.
 *
 * Two credential shapes are accepted, both carrying the SAME shared secret:
 *   - header `x-plan-tick-secret: <secret>`    — GitHub Actions / curl / local test.
 *   - header `Authorization: Bearer <secret>`  — Vercel Cron. Vercel Cron can only
 *     GET a path in its own deployment and injects `Authorization: Bearer <CRON_SECRET>`
 *     itself; it CANNOT send a custom header (owner decision 2026-08-19: provider =
 *     Vercel Cron). So the routes must also honour Bearer, or the whole scheme is
 *     un-callable by the chosen provider.
 *
 * The secret is read from `PLAN_TICK_SECRET` OR `CRON_SECRET` — either may hold it.
 * Vercel populates the Bearer header from an env var it requires to be named
 * `CRON_SECRET`, so accepting that name lets the owner set ONE Vercel env var and be
 * done; local/GitHub-Actions callers keep using `PLAN_TICK_SECRET`. Set both to the
 * same value to run one logical secret across every provider.
 *
 * BOTH unset ⇒ every request is rejected (fail-closed): a missing env var must never
 * turn a privileged system hook into an anonymous one.
 */

/** Constant-time-ish equality over two server-held short tokens (length is not secret here). */
function tokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** The shared secret(s) the tick endpoints will accept, from the environment. */
function expectedSecrets(): string[] {
  return [process.env.PLAN_TICK_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === 'string' && s !== '',
  );
}

/** The credential(s) presented on the request, across both accepted header shapes. */
function presentedSecrets(request: Request): string[] {
  const out: string[] = [];
  const custom = request.headers.get('x-plan-tick-secret');
  if (custom) out.push(custom);
  const auth = request.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) out.push(auth.replace(/^Bearer\s+/i, ''));
  return out;
}

/**
 * tickSecretOk gates an internal cron tick request. Returns true only when a
 * configured secret is presented via one of the accepted headers. Unconfigured
 * environment ⇒ always false (closed).
 */
export function tickSecretOk(request: Request): boolean {
  const expected = expectedSecrets();
  if (expected.length === 0) return false; // unconfigured = closed
  for (const got of presentedSecrets(request)) {
    for (const exp of expected) {
      if (tokenEqual(got, exp)) return true;
    }
  }
  return false;
}
