/**
 * GET /api/v1/attempts — list prospect attempts (M0/M1 §7), newest first.
 * Ports Go's handleListAttempts. Row scope is the RLS safety net, as GET /leads.
 */
import { sales } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const attempts = await sales.listAttempts(db());
    return json({ attempts });
  });
}
