/**
 * TikTok Ads Scanner — one stored scan (Gelombang 4).
 *
 *  - GET /api/v1/adsscanner/runs/{id} — the full frozen scan: config, payload
 *    (ringkasan/sku/orphan/realokasi/angles/winners) and file provenance.
 *    Scope-gated in the domain (`getAdsScanRun`).
 *
 * Client-independent path (mirrors `/skuscreener/runs/{id}`): the run id
 * already names its client, so requiring the client in the URL would let the
 * two disagree.
 */
import { adsscanner } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adsScanRunDetailToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const d = await adsscanner.getAdsScanRun(db(), actor, id);
    return json(adsScanRunDetailToWire(d));
  });
}
