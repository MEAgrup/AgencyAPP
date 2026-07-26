/**
 * POST /api/v1/sessions/{id}/results — [Confirmed by Vendor] → [Completed] (M10 §4
 * Flow 2): the AM logs the vendor-reported result. Gate (§4 Rule 2 / §6.3): actual
 * datetime, actual duration, orders, GMV and the Vendor Report Link are mandatory;
 * viewers optional. Owning AM / Director. Ports Go's handleLogResults.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

interface Body {
  actual_datetime?: string;
  actual_duration_hours?: string;
  viewers_peak?: number | null;
  viewers_avg?: number | null;
  orders_generated?: number | null;
  gmv?: string;
  vendor_report_link?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const result = await livestream.logResults(db(), actor, id, {
      actualDatetime: b.actual_datetime ?? '',
      actualDurationHours: b.actual_duration_hours ?? '',
      viewersPeak: b.viewers_peak ?? null,
      viewersAvg: b.viewers_avg ?? null,
      ordersGenerated: b.orders_generated ?? null,
      gmv: b.gmv ?? '',
      vendorReportLink: b.vendor_report_link ?? '',
    });
    return transitionResponse(result);
  });
}
