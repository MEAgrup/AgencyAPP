/**
 * POST /api/v1/transactions/{id}/schedule — M5 §4: mint the Installment schedule
 * for a scheduled Transaction ([Termin] / [Bayar di Belakang]). Ports Go's
 * handleCreateSchedule.
 *
 * Not an upsert: an existing schedule or any verified payment makes this 409
 * (ScheduleExists) instead of replacing rows that money is reconciled against —
 * mid-flight re-scheduling belongs to POST /scheme, which is pre-verification
 * only. A scheme that carries no schedule is 409 (SchemeNoSchedule); amounts that
 * do not sum to the agreed total are 400 with the verbatim BI message.
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
    // Request mapping stays inline per the wire.ts convention (snake_case in,
    // camelCase for the domain). A missing amount/due_date is passed through as
    // '' so the domain's mandatory-field gate is the single place that decides
    // — not a second, divergent check here.
    const items = (b.items ?? []).map((i) => ({
      amount: i.amount ?? '',
      dueDate: i.due_date ?? '',
    }));
    const created = await finance.createSchedule(db(), actor, id, items);
    return json({ installments: created.map(installmentToWire) });
  });
}
