/**
 * POST /api/v1/attempts/{id}/qualify — submit the Qualified Lead Form (M0 §4),
 * pinning each service against the MSL version effective today and advancing the
 * attempt Contacted → Qualified. Ports Go's handleQualify.
 *
 * Auto-calc (Estimasi Nilai + Komisi) and the 1..5 cap live in the domain layer;
 * this shell resolves the actor and maps the snake_case wire body.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, readJson, transitionResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{
      nama_pic?: string;
      toko?: string;
      kota?: string;
      link_toko?: string;
      kategori?: string;
      platform?: string;
      store_link?: string;
      gmv_baseline?: string;
      target_gmv?: string;
      marketing_budget?: string;
      services?: { master_service_id?: string; quantity?: number; amount?: string }[];
    }>(request);
    const result = await sales.submitQualifiedForm(db(), actor, id, {
      namaPic: body.nama_pic ?? '',
      toko: body.toko ?? '',
      kota: body.kota ?? '',
      linkToko: body.link_toko ?? '',
      kategori: body.kategori ?? '',
      platform: body.platform ?? '',
      storeLink: body.store_link,
      gmvBaseline: body.gmv_baseline ?? '',
      targetGmv: body.target_gmv ?? '',
      marketingBudget: body.marketing_budget,
      services: (body.services ?? []).map((s) => ({
        masterServiceId: s.master_service_id ?? '',
        quantity: s.quantity,
        amount: s.amount,
      })),
    });
    return transitionResponse(result);
  });
}
