/** GET /api/v1/marketing/performance-dashboard — the Lead/Staff Auto-Metrics dashboard split (M2 §5). */
import { marketing } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { marketingMetricsToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const list = await marketing.dashboard(db(), actor);
    return json({ data: list.map(marketingMetricsToWire) });
  });
}
