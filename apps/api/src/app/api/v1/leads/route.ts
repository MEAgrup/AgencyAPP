/**
 * /api/v1/leads — list (GET) and register (POST) leads.
 *
 * Thin shell over @cdps/domain `leads`: resolve the actor from the JWT, validate
 * inputs (the BI `[...]` gate lives in the domain layer), then call the service,
 * which composes ident (LEAD + PRSP) + insert + sm_transition (reopen) + audit +
 * notify (co-pursuit) in one @cdps/db transaction. Ports Go's handleRegisterLead.
 *
 * A successful register returns 201 with the lead, the actor's attempt, and —
 * only on a co-pursuit join — a NON-error `notice` (BI). A dedup block surfaces
 * as 409 with the verbatim BI message (shared error mapper).
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { attemptStubToWire, leadRowToWire, leadStubToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    // Endpoint gate (O37, ported from Go `leadListScope`): Sales staff and any
    // unrelated division get the verbatim BI refusal instead of an empty list.
    // Which ROWS the permitted actors see is then decided by the leads_select
    // RLS policy, because the query runs through readAsActor.
    if (!leads.leadListScope(actor)) {
      throw new leads.ForbiddenError();
    }
    // web-internal passes optional ?status=<record_status>&q=<name/phone>
    // &source=<Source>&mine=1. `mine` narrows to leads the caller registered or
    // holds an attempt on — a convenience cut, never the security boundary: RLS
    // (`leads_select`) already decides which rows exist for this actor.
    const params = new URL(request.url).searchParams;
    const mine = params.get('mine');
    const rows = await readAsActor(actor, (sql) => leads.leadsDatabase(sql, {
      status: params.get('status') ?? undefined,
      q: params.get('q') ?? undefined,
      source: params.get('source') ?? undefined,
      mineEmployeeId: mine === '1' || mine === 'true' ? actor.employeeId : undefined,
    }));
    return json({ data: rows.map(leadRowToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<{
      lead_name?: string;
      phone_number?: string;
      email?: string;
      source?: string;
      campaign_id?: string;
      outside_campaign?: boolean;
    }>(request);
    // `campaign_id` / `outside_campaign` are the M1 §9.3 Origin Campaign link.
    // The FE has sent `campaign_id` since the M0 workspace shipped and this shell
    // dropped it on the floor — the O43 shape, silently: the route answered 201
    // and the lead landed with no campaign, so M2/M3 attributed nothing. Passing
    // them through is the fix; the mandatory-per-Source gate lives in the domain.
    const { lead, attempt, notice } = await leads.register(db(), actor, {
      leadName: body.lead_name ?? '',
      phoneNumber: body.phone_number ?? '',
      email: body.email,
      source: body.source,
      campaignId: body.campaign_id,
      outsideCampaign: body.outside_campaign,
    });
    const payload: {
      lead: ReturnType<typeof leadStubToWire>;
      attempt: ReturnType<typeof attemptStubToWire>;
      notice?: string;
    } = { lead: leadStubToWire(lead), attempt: attemptStubToWire(attempt) };
    if (notice !== '') {
      payload.notice = notice;
    }
    return json(payload, 201);
  });
}
