/**
 * POST /api/v1/leads/batch — register up to 5 prospects under ONE Source (M0 §3,
 * QA revisi 2026-08-07). The Sales door, not the Marketing import: every row mints
 * its own LEAD + PRSP owned by the caller, exactly as POST /leads does for one.
 *
 * Thin shell over @cdps/domain `leads.registerBatch`: resolve the actor from the
 * JWT, map the snake_case body, answer the per-row report. Batch-level refusals
 * (empty/over-cap list, the §9.3 campaign gate, an unknown campaign) surface as
 * errors through the shared mapper; a duplicate on one row is a verdict IN the
 * report, because the other rows are already committed.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { batchRegisterReportToWire } from '@/lib/wire';

interface Body {
  source?: string;
  campaign_id?: string;
  outside_campaign?: boolean;
  prospects?: { lead_name?: string; phone_number?: string; email?: string }[];
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Body>(request);
    const report = await leads.registerBatch(db(), actor, {
      source: b.source,
      campaignId: b.campaign_id,
      outsideCampaign: b.outside_campaign,
      prospects: (b.prospects ?? []).map((p) => ({
        leadName: p.lead_name ?? '',
        phoneNumber: p.phone_number ?? '',
        email: p.email,
      })),
    });
    // 201: at least one row minted ids. An all-rejected batch created nothing, so
    // it answers 200 with the report rather than claiming a creation.
    return json(batchRegisterReportToWire(report), report.registered > 0 ? 201 : 200);
  });
}
