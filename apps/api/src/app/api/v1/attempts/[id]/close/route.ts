/**
 * POST /api/v1/attempts/{id}/close — Closing Form (M0 §6): births the Client
 * Record + Transaction + Services + Installments from a Negotiation-Approved /
 * Auto-Approved attempt, splits achievement across ≤5 salespeople (Σ=100%), and
 * fires M1 §6 win resolution. Ports Go's handleClose.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface AllocationBody {
  salesperson_id?: string;
  basis_points?: number;
}

interface Body {
  parties?: {
    primary_salesperson_id?: string;
    allocations?: AllocationBody[];
    commission_payment_pic_id?: string;
  };
  payment_scheme?: string;
  installments?: { amount?: string; due_date?: string }[];
  managed_since?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const result = await sales.close(db(), actor, id, {
      parties: {
        primarySalespersonId: b.parties?.primary_salesperson_id ?? '',
        allocations: (b.parties?.allocations ?? []).map((a) => ({
          salespersonId: a.salesperson_id ?? '',
          basisPoints: a.basis_points ?? 0,
        })),
        commissionPaymentPicId: b.parties?.commission_payment_pic_id,
      },
      paymentScheme: b.payment_scheme ?? '',
      installments: (b.installments ?? []).map((i) => ({ amount: i.amount ?? '', dueDate: i.due_date ?? '' })),
      managedSince: b.managed_since,
    });
    return json({ client_id: result.clientId, transaction_id: result.transactionId }, 201);
  });
}
