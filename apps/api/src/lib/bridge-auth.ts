/**
 * Shared secret gate for the bridge machine ingest route
 * (`POST /api/v1/internal/bridge/orders`). Deliberately its OWN secret,
 * `BRIDGE_INGEST_SECRET` — never `PLAN_TICK_SECRET`/`CRON_SECRET` — because a
 * bridge credential and a cron credential rotate on different schedules and
 * are held by different systems (MEAGO MSDPS vs. our own cron). Rotating one
 * must never require touching the other.
 *
 * Same fail-closed posture as `tick-auth.ts`: unset secret ⇒ every request is
 * rejected. Only `Authorization: Bearer <secret>` is accepted — there is no
 * Vercel Cron caller here forcing a second header shape.
 */

function tokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** bridgeSecretOk gates the bridge ingest route. Unconfigured environment ⇒ always false (closed). */
export function bridgeSecretOk(request: Request): boolean {
  const expected = process.env.BRIDGE_INGEST_SECRET;
  if (!expected) return false; // unconfigured = closed
  const auth = request.headers.get('authorization');
  if (!auth || !/^Bearer\s+/i.test(auth)) return false;
  const got = auth.replace(/^Bearer\s+/i, '');
  return tokenEqual(got, expected);
}
