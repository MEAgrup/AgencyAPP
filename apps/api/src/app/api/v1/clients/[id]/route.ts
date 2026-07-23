/**
 * /api/v1/clients/{id} — the Client Record (M4).
 *
 * GET: one Client Record (M4 basic) — the client plus its platforms,
 * sales-allocation snapshot, closed Services, and payment Transaction
 * (+ installments). Ports Go's handleGetClient.
 *
 * PATCH: a lock-matrix-checked edit (M4 §4) — only fields the actor's role may
 * edit are applied, each logged before→after; a locked/system field is rejected.
 * Ports Go's handleEditClient. Incomplete → 400, Forbidden → 403,
 * NotFound → 404, LockedField → 409 (shared error mapper).
 */
import { client, sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const record = await sales.getClient(db(), id);
    return json({ client: record });
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{
      nama_pic?: string;
      toko?: string;
      kota?: string;
      link_toko?: string;
      kategori?: string;
      gmv_baseline?: string;
      target_gmv?: string;
      marketing_budget?: string;
      sales_pic_id?: string;
      commission_payment_pic_id?: string;
    }>(request);
    await client.updateClient(db(), actor, id, {
      namaPic: b.nama_pic,
      toko: b.toko,
      kota: b.kota,
      linkToko: b.link_toko,
      kategori: b.kategori,
      gmvBaseline: b.gmv_baseline,
      targetGmv: b.target_gmv,
      marketingBudget: b.marketing_budget,
      salesPicId: b.sales_pic_id,
      commissionPaymentPicId: b.commission_payment_pic_id,
    });
    return json({ ok: true });
  });
}
