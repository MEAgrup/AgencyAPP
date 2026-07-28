/**
 * GET /api/v1/attempts — list prospect attempts (M0/M1 §7), newest first.
 * Ports Go's handleListAttempts. Row scope is the RLS safety net, as GET /leads.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const attempts = await readAsActor(actor, (sql) => sales.listAttempts(sql));
    return json({ attempts });
  });
}
