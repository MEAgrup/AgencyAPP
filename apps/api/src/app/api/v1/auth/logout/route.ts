/**
 * POST /api/v1/auth/logout — clear the CDPS session cookie.
 *
 * The session token is a stateless signed JWT (no server-side session row), so
 * logout clears the cookie; the token simply expires on its own (12h). Ports
 * Go's handleLogout (minus server-side revocation — see DECISIONS 2026-07-23).
 */
import { clearSessionCookie } from '@/lib/auth';

export async function POST(): Promise<Response> {
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie() } });
}
