/**
 * /api/v1/finance/tutup-buku — daftar bulan yang pernah disentuh kunci D-3.
 *
 * GET: bulan terbaru dulu. Bulan yang belum pernah ditutup memang tidak punya
 * baris — itu keadaan bakunya, bukan lubang data.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { periodeToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const raw = new URL(request.url).searchParams.get('limit');
    const limit = raw === null || raw === '' ? 24 : Number(raw);
    const list = await readAsActor(actor, (sql) => tutupbuku.listPeriode(sql, limit));
    return json({ data: list.map(periodeToWire) });
  });
}
