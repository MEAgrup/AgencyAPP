#!/usr/bin/env node
// B2 (HANDOFF_PENUTUP_REVISI_OD_20260908.md §4) — mint a local HS256 JWT that
// `apps/api` accepts as a GoTrue access token, for browser QA against the LOCAL
// db-rebuild'd DB. This does NOT talk to Supabase Auth at all.
//
// ## Why this is safe and why it works
//
// `apps/api/src/lib/auth.ts` verifies a session token with `SUPABASE_JWT_SECRET`
// (HS256) and maps `app_metadata` to a CDPS Actor via `permission.actorFromClaims`
// — it never checks WHO issued the token, only that the signature matches the
// secret the server was given. Locally that secret is whatever `apps/api/.env.local`
// sets (see below), so a token signed with the SAME string here verifies. The one
// thing GoTrue does that this script does NOT replace is verifying a password —
// this is a route around *login*, not around authorization: every route past the
// cookie still runs the real RLS/domain checks against the real local DB.
//
// ## Why the claims must come from `employee_claims()`, not be guessed
//
// `app_metadata.division` for a real Director is `''` (empty), NOT the HRIS
// `divisi` column value ("Management") — `employee_claims()` (migration
// `20260723071013`) derives it from `role_mappings`, and Director/OD have no
// `role_mappings` row (they come from `employee_layered_roles` instead). A first
// pass of this harness hand-guessed `division: 'Management'` and got a page to
// render an error that a REAL Director JWT never triggers — a false-positive bug
// report waiting to happen. Always mint from the DB function's actual output:
//
//   psql "$DATABASE_URL" -tc "select employee_claims('EMP-0008')"
//
// and paste that object in verbatim (or pass --employee and let this script query
// it for you, below).
//
// Usage:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps \
//   node scripts/dev-jwt.mjs --employee EMP-0008
//
// Prints the token to stdout. Requires `SUPABASE_JWT_SECRET` to be set to the
// SAME value as `apps/api/.env.local` (defaults match apps/api/.env.example's
// placeholder convention — override both together if you change one).
import { createHmac } from 'node:crypto';
import postgres from 'postgres';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const employeeIdx = args.indexOf('--employee');
  const employeeId = employeeIdx !== -1 ? args[employeeIdx + 1] : null;
  const secret = process.env.SUPABASE_JWT_SECRET ?? 'local-dev-harness-secret-do-not-use-in-prod';
  const dbUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/cdps';

  if (!employeeId) {
    console.error('Usage: node scripts/dev-jwt.mjs --employee <EMP-ID>');
    process.exit(1);
  }

  const sql = postgres(dbUrl);
  let claims;
  try {
    const rows = await sql`select employee_claims(${employeeId}) as claims`;
    if (rows.length === 0 || rows[0].claims === null) {
      throw new Error(`employee_claims('${employeeId}') returned nothing — does that employee exist?`);
    }
    claims = rows[0].claims;
  } finally {
    await sql.end();
  }

  const now = Math.floor(Date.now() / 1000);
  const token = sign(
    { aud: 'authenticated', sub: employeeId, app_metadata: claims, exp: now + 60 * 60 * 24, iat: now },
    secret,
  );
  console.log(token);
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
