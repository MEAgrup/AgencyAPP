/**
 * GET /api/v1/sales/performance — Kinerja Sales View 1 (REPORT ACTIVITY AND
 * CLOSING): one row per salesperson over `?from=&to=` (both "YYYY-MM",
 * inclusive) or every period when both are omitted. `?salesperson=&source=
 * &campaign=` narrow further. Permission mirrors RLS S-01: Sales staff = own
 * row only (a `salesperson` naming someone else is 403), Sales lead/SPV =
 * whole division, OD/Director = read-all.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { salesPerfRowToWire } from '@/lib/wire';

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
    const rows = await readAsActor(actor, (sql) => salesperf.bySalesperson(sql, actor, filter));
    return json({ data: rows.map(salesPerfRowToWire) });
  });
}
