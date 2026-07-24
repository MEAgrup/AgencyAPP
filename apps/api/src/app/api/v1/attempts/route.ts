/**
 * GET /api/v1/attempts[?status=] — list prospect attempts (M0/M1 §7), newest
 * first. Optional ?status= filters by attempt status (verbatim BI string).
 * Response: { data: AttemptRow[] } (FE sales.ts listAttempts).
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAs } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? '';
    const attempts = await readAs(actor, (tx) => sales.listAttempts(tx, status ? { status } : undefined));
    return json({ data: attempts.map(attemptRowToWire) });
  });
}
