/**
 * /api/v1/transactions/{id}/change-requests — the FILE half of the
 * Director-gated transaction change (owner decision 2026-08-04, M5-OA-7).
 *
 * POST files a change carrying a mandatory `reason`, the new
 * `payment_intent_scheme`, and (for [Termin] / [Bayar di Belakang]) the
 * replacement `installments` for the OPEN part of the schedule — Σ must equal
 * Amount Outstanding, not the agreed total, so verified money is never
 * re-described. Nothing about the Transaction changes until a Director acts;
 * the Directors are notified so the ACC queue does not need polling. A settled
 * Transaction (409), a second filing while one waits (409) and an actor below
 * SPV/Head Finance (403) are all refused with the verbatim BI message.
 *
 * GET lists this Transaction's filings (any status) for the detail page. It
 * reads through `readAsActor`, so `transaction_change_requests_select` decides
 * which rows come back.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { schemeChangeRequestToWire } from '@/lib/wire';

interface Body {
  payment_intent_scheme?: string;
  reason?: string;
  installments?: { amount?: string; due_date?: string }[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const req = await finance.requestSchemeChange(db(), actor, id, {
      newScheme: b.payment_intent_scheme ?? '',
      reason: b.reason ?? '',
      schedule: (b.installments ?? []).map((i) => ({ amount: i.amount ?? '', dueDate: i.due_date ?? '' })),
    });
    return json({ request: schemeChangeRequestToWire(req) }, 201);
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    // '' = every status, so the detail page can show decided filings too.
    const rows = await readAsActor(actor, (sql) =>
      finance.schemeChangeRequests(sql, { transactionId: id, status: '' }));
    return json({ data: rows.map(schemeChangeRequestToWire) });
  });
}
