/**
 * GET /api/v1/attempts — list prospect attempts (M0/M1 §7), newest first.
 * Ports Go's handleListAttempts: response is `{data: [...]}` in snake_case, and
 * the optional `?status=` filter is applied in SQL — the client's status tabs
 * ARE that filter. Row scope is the RLS safety net, as GET /leads.
 */
import { page } from '@cdps/core';
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    // P2 §6: paged (?limit=, ?cursor=).
    const params = new URL(request.url).searchParams;
    const status = params.get('status') ?? '';
    const req = page.parseRequest(params.get('limit'), params.get('cursor'));
    const result = await readAsActor(actor, (sql) => sales.listAttempts(sql, { status, page: req }));
    return json({ data: result.rows.map(attemptRowToWire), next_cursor: result.nextCursor });
  });
}
