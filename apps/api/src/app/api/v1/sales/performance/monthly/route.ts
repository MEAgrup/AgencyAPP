/**
 * GET /api/v1/sales/performance/monthly — Kinerja Sales View 2 (FILTER BY
 * NAME, one salesperson · one row per Year-Month) and View 5 (rekap
 * tahunan). Same filter/permission contract as GET /sales/performance; the
 * only difference is grouping — one row per (salesperson, month) that has any
 * activity in range, instead of one row per salesperson.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { salesPerfMonthRowToWire } from '@/lib/wire';

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
    const rows = await readAsActor(actor, (sql) => salesperf.byMonth(sql, actor, filter));
    return json({ data: rows.map(salesPerfMonthRowToWire) });
  });
}
