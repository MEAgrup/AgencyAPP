/**
 * GET /api/v1/sales/performance/sources — Kinerja Sales View 3 (DASHBOARD
 * LEAD): leads grouped by (period, source, campaign), narrowed to one
 * salesperson's registrations when `?salesperson=` is set. Same
 * period/permission contract as GET /sales/performance.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { leadSourceRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const q = new URL(request.url).searchParams;
    const from = q.get('from');
    const to = q.get('to');
    const filter: salesperf.SalesPerfFilter = {
      period: from !== null && to !== null ? { from, to } : null,
      salespersonId: q.get('salesperson'),
      source: q.get('source'),
      campaignId: q.get('campaign'),
    };
    const rows = await readAsActor(actor, (sql) => salesperf.bySource(sql, actor, filter));
    return json({ data: rows.map(leadSourceRowToWire) });
  });
}
