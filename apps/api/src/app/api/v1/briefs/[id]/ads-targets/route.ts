/**
 * GET  /api/v1/briefs/{id}/ads-targets — the six metric targets of an Ads
 *      Brief-as-task, plus the suggestion (Strategy KPI + brief Quantity Target)
 *      the form pre-fills from. Read gate = the M8 §9.1 read predicate.
 * PUT  /api/v1/briefs/{id}/ads-targets — set/replace them. SPV/Lead Ads or
 *      Director only (M8-OA-4: an Advertiser never sets their own target).
 *
 * Keputusan pemilik 2026-08-14 (DECISIONS.md).
 */
import { ads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { adsBriefTargetsToWire, adsBriefTargetsViewToWire, toAdsTargetInput } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const v = await ads.getBriefTargets(db(), actor, id);
    return json(adsBriefTargetsViewToWire(v));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Parameters<typeof toAdsTargetInput>[0]>(request);
    const t = await ads.setBriefTargets(db(), actor, id, toAdsTargetInput(b));
    return json(adsBriefTargetsToWire(t));
  });
}
