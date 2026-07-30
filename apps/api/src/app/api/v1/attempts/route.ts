/**
 * GET /api/v1/attempts — list prospect attempts (M0/M1 §7), newest first.
 * Ports Go's handleListAttempts: response is `{data: [...]}` in snake_case, and
 * the optional `?status=` filter is applied in SQL — the client's status tabs
 * ARE that filter. Row scope is the RLS safety net, as GET /leads.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const status = new URL(request.url).searchParams.get('status') ?? '';
    const attempts = await readAsActor(actor, (sql) => sales.listAttempts(sql, { status }));
    return json({ data: attempts.map(attemptRowToWire) });
  });
}
