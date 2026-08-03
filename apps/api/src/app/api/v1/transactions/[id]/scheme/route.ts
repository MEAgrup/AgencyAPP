/**
 * POST /api/v1/transactions/{id}/scheme — M5 §4 Rule 5 / M5-OA-6: SPV/Head
 * Finance (or Director) switches a Transaction's Payment Intent scheme with a
 * logged reason, before any payment is verified. Ports Go's handleChangeScheme.
 * Forbidden → 403, NotFound → 404, Incomplete / ScheduleTotal → 400,
 * SchemeLocked (already verified) → 409.
 *
 * The scheme's wire name is `payment_intent_scheme` (Go's `handleChangeScheme`
 * body tag, and what `web-internal`'s `changeScheme` sends) — reading only
 * `payment_scheme` here made every change-scheme call arrive with an empty
 * scheme, i.e. a guaranteed `[data tidak lengkap ...]`. `payment_scheme` stays
 * as an alias so the M0 closing body's spelling also works.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface Body {
  payment_intent_scheme?: string;
  payment_scheme?: string;
  reason?: string;
  installments?: { amount?: string; due_date?: string }[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    await finance.changeScheme(
      db(), actor, id, b.payment_intent_scheme ?? b.payment_scheme ?? '', b.reason ?? '',
      (b.installments ?? []).map((i) => ({ amount: i.amount ?? '', dueDate: i.due_date ?? '' })),
    );
    return json({ status: 'ok' });
  });
}
