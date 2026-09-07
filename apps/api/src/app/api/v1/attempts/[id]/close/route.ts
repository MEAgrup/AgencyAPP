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
  /**
   * "Include PPN" — the one button that decides whether 11% is added to this
   * invoice (D-4). Read strictly as `=== true` so a missing key, `null`, or a
   * stray string can never switch tax on for a client who did not agree to it.
   */
  include_ppn?: boolean;
  /** K-2 — Sales overrides the catalog-derived engagement duration. */
  durasi_bulan_override?: number | null;
  /** K-2 — mandatory whenever `durasi_bulan_override` is sent. */
  alasan_override?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
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
      includePPN: b.include_ppn === true,
      // `null` from the wire means "no override" exactly like an absent key —
      // a form that clears the field sends null, and treating that as the number
      // `null` would reach the range check and fail a legitimate closing.
      durasiBulanOverride: b.durasi_bulan_override ?? undefined,
      alasanOverride: b.alasan_override,
    });
    return json(
      {
        client_id: result.clientId,
        transaction_id: result.transactionId,
        // Explicit null, never omitted (O43): "no agreement window" is a state
        // the closing screen has to be able to tell apart from "key missing".
        contract_id: result.contractId,
      },
      201,
    );
  });
}
