/**
 * POST /api/v1/auth/login — local CDPS password login.
 *
 * Thin shell over @cdps/domain `auth`: validate email+password against
 * employee_credentials (bcrypt + lockout), mint the session token (an HS256 JWT
 * carrying the employee's app_metadata claims — the SAME shape requireActor
 * verifies for both the cookie and a bearer token), set it as the httpOnly
 * `cdps_session` cookie, and return the {employee, role, must_change_password}
 * identity. Ports Go's handleLogin.
 */
import { auth } from '@cdps/domain';
import { buildSessionCookie, signJwtHS256, SESSION_TTL_SECONDS } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = (body.email ?? '').trim();
    const password = body.password ?? '';
    if (email === '' || password === '') {
      throw new BadRequestError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    }

    const { employeeId, mustChange } = await auth.authenticate(db(), email, password);
    const claims = await auth.loadClaims(db(), employeeId);

    const secret = process.env.SUPABASE_JWT_SECRET ?? '';
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signJwtHS256(
      { app_metadata: claims, sub: employeeId, iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS },
      secret,
    );

    const identity = await auth.loadIdentity(db(), employeeId, mustChange);
    return json(identity, 200, { 'set-cookie': buildSessionCookie(token) });
  });
}
