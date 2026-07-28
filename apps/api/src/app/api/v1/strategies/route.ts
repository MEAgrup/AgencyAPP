/**
 * GET /api/v1/strategies — the Strategies visible to the actor (M6 §3): Account
 * lead / OD / Director see all; an Account-staff AM sees those on clients they
 * own; anyone else is forbidden. Ports Go's handleListStrategies.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategyToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => account.listStrategies(sql, actor));
    return json({ data: rows.map(strategyToWire) });
  });
}
