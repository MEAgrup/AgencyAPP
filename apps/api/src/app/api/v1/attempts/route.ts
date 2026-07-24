/**
 * GET /api/v1/attempts[?status=] — list prospect attempts (M0/M1 §7), newest
 * first. Optional ?status= filters by attempt status (verbatim BI string).
 * Response: { data: AttemptRow[] } (FE sales.ts listAttempts).
 */
import { sales } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { attemptRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? '';
    const attempts = await sales.listAttempts(db(), status ? { status } : undefined);
    return json({ data: attempts.map(attemptRowToWire) });
  });
}
