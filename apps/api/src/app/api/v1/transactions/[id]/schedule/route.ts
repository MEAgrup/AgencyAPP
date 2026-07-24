/**
 * POST /api/v1/transactions/{id}/schedule — create / replace the installment
 * schedule for a Termin or Bayar di Belakang transaction before any payment is
 * received (M5 §4). Finance staff or Director only. Returns the new installments.
 *
 * Body: { items: { amount: string; due_date: string }[] }
 * Response: { installments: Installment[] } (FE finance.ts createSchedule).
 *
 * mapError: Incomplete / ScheduleTotal → 400, Forbidden → 403, NotFound → 404,
 * SchemeLocked → 409.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { installmentToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ items?: { amount?: string; due_date?: string }[] }>(request);
    const items = (b.items ?? []).map((item) => ({
      amount: item.amount ?? '',
      dueDate: item.due_date ?? '',
    }));
    const installments = await finance.setSchedule(db(), actor, id, items);
    return json({ installments: installments.map(installmentToWire) });
  });
}
