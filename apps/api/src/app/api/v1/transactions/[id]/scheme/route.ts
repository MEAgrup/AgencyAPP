/**
 * POST /api/v1/transactions/{id}/scheme — M5 §4 Rule 5 / **M5-OA-7**: SPV/Head
 * Finance FILES a payment-scheme change; a Director's ACC is what applies it
 * (owner decision 2026-08-04, `docs/DECISIONS.md`).
 *
 * The path and the body are unchanged, so this stays the one door the FE has
 * always used — what changed is the outcome: for Finance the answer is now
 * `{status: 'pending'}` plus the filed request, and the transaction has NOT
 * moved. A Director filing answers `{status: 'applied'}`.
 * `POST /transactions/{id}/change-requests` is the same call under a name that
 * says what it does; both are served so neither half of the app can 404.
 *
 * Forbidden → 403, NotFound → 404, Incomplete / ScheduleTotal /
 * OutstandingTotal → 400, settled transaction or a filing already waiting → 409
 * with the verbatim BI message.
 *
 * The scheme's wire name is `payment_intent_scheme` (Go's `handleChangeScheme`
 * body tag, and what `web-internal` sends) — reading only `payment_scheme` here
 * made every change-scheme call arrive with an empty scheme, i.e. a guaranteed
 * `[data tidak lengkap ...]`. `payment_scheme` stays as an alias so the M0
 * closing body's spelling also works.
 */
import { finance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { schemeChangeRequestToWire } from '@/lib/wire';

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
    const req = await finance.requestSchemeChange(db(), actor, id, {
      newScheme: b.payment_intent_scheme ?? b.payment_scheme ?? '',
      reason: b.reason ?? '',
      schedule: (b.installments ?? []).map((i) => ({ amount: i.amount ?? '', dueDate: i.due_date ?? '' })),
    });
    return json({
      status: req.status === finance.CHANGE_APPROVED ? 'applied' : 'pending',
      request: schemeChangeRequestToWire(req),
    });
  });
}
