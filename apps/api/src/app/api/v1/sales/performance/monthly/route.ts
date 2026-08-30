/**
 * GET /api/v1/sales/performance/monthly — Kinerja Sales, View 2 (FILTER BY
 * NAME: one row per Year-Month) / View 5 (rekap tahunan, same shape grouped
 * by year via the `from`/`to` bounds). Same filter params as
 * `/sales/performance`; see that route for their meaning.
 */
import { salesperf } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { salesPerfMonthRowToWire } from '@/lib/wire';
import { parseSalesPerfFilter } from '../route';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const filter = parseSalesPerfFilter(new URL(request.url));
    const rows = await readAsActor(actor, (sql) => salesperf.byMonth(sql, actor, filter));
    return json({ data: rows.map(salesPerfMonthRowToWire) });
  });
}
