/**
 * POST /api/v1/transactions/{id}/outstanding-schedule — schedule the collection
 * of what a Transaction still owes (M5 §6): Finance enters the shortfall as dated
 * installments, which then surface on the reminder dashboard like any other due
 * amount. Admin & Finance / Director only.
 *
 * Distinct from POST /schedule on purpose. That one mints the ORIGINAL schedule
 * for a [Termin] / [Bayar di Belakang] deal and must sum to the agreed TOTAL; it
 * refuses once any money is in, because a schedule reconciled against existing
 * verifications is not a fresh schedule. This one is the opposite case: money is
 * already in, and what needs a due date is the REMAINDER.
 *
 * mapError: Incomplete / OutstandingTotal → 400, Forbidden → 403, NotFound → 404,
 * NoOutstanding / ScheduleExists → 409.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { installmentToWire } from '@/lib/wire';

interface Body {
  items?: { amount?: string; due_date?: string }[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    // A missing amount/due_date passes through as '' so the domain's
    // mandatory-field gate stays the single arbiter (same as /schedule).
    const items = (b.items ?? []).map((i) => ({
      amount: i.amount ?? '',
      dueDate: i.due_date ?? '',
    }));
    const created = await finance.scheduleOutstanding(db(), actor, id, items);
    return json({ installments: created.map(installmentToWire) });
  });
}
