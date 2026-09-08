/**
 * /api/v1/finance/tutup-buku/{periode}/selisih?dari=1&ke=2 — apa yang berubah
 * antara dua kali penutupan.
 *
 * Konsekuensi ketiga dari ketokan buka-ulang. Tanpa layar ini, buka-tutup
 * adalah cara mengubah angka keuangan yang tidak meninggalkan jejak yang bisa
 * dibaca manusia.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { selisihVersiToWire } from '@/lib/wire';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ periode: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    const q = new URL(request.url).searchParams;
    const dari = Number(q.get('dari'));
    const ke = Number(q.get('ke'));
    if (!Number.isInteger(dari) || !Number.isInteger(ke) || dari < 1 || ke < 1) {
      throw new tutupbuku.ValidationError(tutupbuku.MSG_VERSI_TIDAK_ADA);
    }
    const selisih = await readAsActor(actor, (sql) =>
      tutupbuku.bandingkanVersi(sql, periode, dari, ke),
    );
    return json({ data: selisihVersiToWire(selisih) });
  });
}
