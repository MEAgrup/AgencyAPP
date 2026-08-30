/**
 * GET /api/v1/sales/performance/sources — Kinerja Sales, View 3 (DASHBOARD
 * LEAD): lead volume + funnel + closing, grouped by period + source +
 * campaign. Same filter params as `/sales/performance`.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { leadSourceRowToWire } from '@/lib/wire';
import { parseSalesPerfFilter } from '../route';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const filter = parseSalesPerfFilter(new URL(request.url));
    const rows = await readAsActor(actor, (sql) => salesperf.bySource(sql, actor, filter));
    return json({ data: rows.map(leadSourceRowToWire) });
  });
}
