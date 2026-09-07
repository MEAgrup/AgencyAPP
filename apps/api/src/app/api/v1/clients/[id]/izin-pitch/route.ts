/**
 * Izin pemakaian angka klien di materi pitch (gerbang C-3/C-5).
 *
 *   GET  — status hari ini + seluruh riwayatnya. Statusnya TURUNAN dari baris
 *          terakhir ledger, tidak pernah kolom yang disimpan (aturan rumah #4).
 *   POST — mencatat izin. Sebuah INSERT, tak pernah UPDATE (aturan rumah #3);
 *          mencabut punya path-nya sendiri (`./cabut`) supaya "beri" dan
 *          "cabut" tidak pernah jadi satu endpoint ber-flag yang bisa salah
 *          kirim.
 *
 * Divisi Sales tidak punya akses ke path ini sama sekali — aksesnya read-only
 * dan hanya ke `/showcase` (pagar (a), C-1). Gerbangnya di domain.
 */
import { showcase } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { izinPanelToWire, izinStatusToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const sql = db();
    const [status, riwayat] = await Promise.all([
      showcase.statusIzin(sql, actor, id),
      showcase.riwayatIzin(sql, actor, id),
    ]);
    return json(izinPanelToWire(status, riwayat));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      berlaku_sampai?: unknown;
      dokumen_catatan?: unknown;
    };
    const status = await showcase.beriIzinPitch(db(), actor, id, {
      berlakuSampai: typeof body.berlaku_sampai === 'string' && body.berlaku_sampai !== '' ? body.berlaku_sampai : null,
      dokumenCatatan: typeof body.dokumen_catatan === 'string' ? body.dokumen_catatan : null,
    });
    return json(izinStatusToWire(status));
  });
}
