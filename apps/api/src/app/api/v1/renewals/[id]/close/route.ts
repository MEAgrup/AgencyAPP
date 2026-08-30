/**
 * POST /api/v1/renewals/{id}/close — births Contract (CTR-) + Transaction
 * (TRX-) + Services (SVC-) + Installments from an Approved/Auto-Approved
 * renewal/cross-sell request (R-03), on the SAME client — no `CLI-`, no
 * `client_platforms`. Mirrors `/attempts/{id}/close`'s body shape plus the
 * new Contract's own window (a renewal always births a fresh `contracts`
 * row — R-01/§4 — so this form also collects what `contract.ts` collects).
 */
import { renewal } from '@cdps/domain';
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
  contract_durasi_bulan?: number;
  contract_tanggal_mulai?: string;
  contract_tanggal_akhir?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const result = await renewal.closeRenewal(db(), actor, id, {
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
      contractDurasiBulan: Number(b.contract_durasi_bulan ?? 0),
      contractTanggalMulai: b.contract_tanggal_mulai ?? '',
      contractTanggalAkhir: b.contract_tanggal_akhir ?? '',
    });
    return json({ client_id: result.clientId, transaction_id: result.transactionId }, 201);
  });
}
