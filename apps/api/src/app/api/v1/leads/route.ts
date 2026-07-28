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
    // web-internal passes optional ?status=<record_status>&q=<name/phone>.
    const params = new URL(request.url).searchParams;
    const rows = await readAsActor(actor, (sql) => leads.leadsDatabase(sql, {
      status: params.get('status') ?? undefined,
      q: params.get('q') ?? undefined,
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
    }>(request);
    const { lead, attempt, notice } = await leads.register(db(), actor, {
      leadName: body.lead_name ?? '',
      phoneNumber: body.phone_number ?? '',
      email: body.email,
      source: body.source,
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
