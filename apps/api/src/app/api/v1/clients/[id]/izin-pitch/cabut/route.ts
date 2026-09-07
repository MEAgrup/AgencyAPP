/**
 * POST /api/v1/clients/{id}/izin-pitch/cabut — menarik izin pitch (C-5).
 *
 * Path terpisah dari `POST ../izin-pitch` dengan sengaja: "beri" dan "cabut"
 * adalah dua peristiwa dengan arah berlawanan, dan satu endpoint ber-flag yang
 * membedakannya adalah satu salah-kirim dari mencabut izin yang mau diberikan.
 *
 * Menambah baris `cabut` ke ledger — tidak pernah menghapus baris `beri`.
 * Riwayat itulah yang menjawab "atas dasar apa angka klien ini pernah dipakai".
 */
import { showcase } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { izinStatusToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { alasan?: unknown };
    const status = await showcase.cabutIzinPitch(
      db(),
      actor,
      id,
      typeof body.alasan === 'string' ? body.alasan : null,
    );
    return json(izinStatusToWire(status));
  });
}
