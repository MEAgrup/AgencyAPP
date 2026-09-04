/**
 * GET /api/v1/adsscanner/runs/{id}/html — the stored scan rendered as a
 * standalone HTML document by the engine's own renderer, scope-gated in the
 * domain (`renderAdsScanHtml`).
 *
 * Unlike `/reports/{id}/html` there is NO `mode=klien|internal` here, and that
 * is the point: an Ads Scanner run is an internal working document end to end
 * (which SKUs to kill, where to move budget), so there is no client-safe
 * variant to offer and no Client Portal route that reaches this. Adding a
 * client mode would be a product decision, not a rendering flag.
 *
 * Renders the FROZEN payload — it does not re-run the engine — so the HTML
 * always shows the numbers as scored against the benchmark version recorded on
 * the row (house rule #4).
 */
import { adsscanner } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle } from '@/lib/http';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await adsscanner.renderAdsScanHtml(db(), actor, id);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
}
