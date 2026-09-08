/**
 * POST /api/v1/skus/{id}/pic — tunjuk PIC satu baris SKU (M18 §9).
 *
 * **Leader Store Operation saja.** K-1 memisahkan cakupan dari penugasan: AM
 * menetapkan APA yang dikerjakan dan sekeras apa targetnya, leader divisi
 * menetapkan SIAPA. AM yang memanggil ini mendapat 403 dengan pesan BI-nya.
 */
import { storeops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ pic_id?: string }>(request);
    await storeops.assignPic(db(), actor, id, b.pic_id ?? '');
    return json({ ok: true });
  });
}
