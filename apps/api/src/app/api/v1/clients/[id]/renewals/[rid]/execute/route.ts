/**
 * POST /api/v1/clients/{id}/renewals/{rid}/execute — the separate step after
 * Approved/Auto Approved (mirrors `attempts/{id}/close` sitting after
 * Negotiation-Approved): births `CTR-`/`SVC-`/`TRX-`(+`INST-`) on the
 * EXISTING client, then REPLACES `client_sales_allocations` with the supplied
 * parties (KS-2 — credit moves entirely to whoever executes).
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
  durasi_bulan?: number;
  tanggal_mulai?: string;
  tanggal_akhir?: string;
  parties?: {
    primary_salesperson_id?: string;
    allocations?: AllocationBody[];
    commission_payment_pic_id?: string;
  };
  payment_scheme?: string;
  installments?: { amount?: string; due_date?: string }[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string; rid: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { rid } = await ctx.params;
    const b = await readJson<Body>(request);
    const result = await renewal.executeRenewal(db(), actor, rid, {
      durasiBulan: b.durasi_bulan ?? 0,
      tanggalMulai: b.tanggal_mulai ?? '',
      tanggalAkhir: b.tanggal_akhir ?? '',
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
    });
    return json({ contract_id: result.contractId, transaction_id: result.transactionId }, 201);
  });
}
