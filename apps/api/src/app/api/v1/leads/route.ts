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
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const rows = await leads.list(db());
    return json({ leads: rows });
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
    const payload: { lead: typeof lead; attempt: typeof attempt; notice?: string } = { lead, attempt };
    if (notice !== '') {
      payload.notice = notice;
    }
    return json(payload, 201);
  });
}
