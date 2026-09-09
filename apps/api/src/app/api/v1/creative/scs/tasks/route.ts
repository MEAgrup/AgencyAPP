/**
 * /api/v1/creative/scs/tasks — antrean baris `SMO & Content Strategist`.
 *
 * GET  jendela tanggal (inklusif dua ujung) + filter PIC/Kategori/status.
 *      Staff Creative dipersempit ke barisnya sendiri DI DOMAIN, bukan hanya
 *      oleh RLS — tanpa itu, tes domain (service-role) hijau untuk query yang
 *      lewat API justru kosong.
 * POST buat satu baris. `client_id` boleh TIDAK dikirim: baris "all client"
 *      adalah kasus sah, dan itu seluruh alasan modul ini berdiri sendiri
 *      (ketokan `M19-SCS-ENGINE` opsi b).
 */
import { scs } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { scsTaskToWire, toScsTaskInput } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const u = new URL(request.url);
    const rows = await readAsActor(actor, (sql) => scs.queueScsTasks(sql, actor, {
      dariTanggal: u.searchParams.get('dari') ?? '',
      sampaiTanggal: u.searchParams.get('sampai') ?? '',
      pic: u.searchParams.get('pic'),
      kategoriKode: u.searchParams.get('kategori'),
      status: u.searchParams.get('status'),
    }));
    return json({ tasks: rows.map(scsTaskToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Parameters<typeof toScsTaskInput>[0]>(request);
    const row = await scs.createScsTask(db(), actor, toScsTaskInput(b ?? {}));
    return json(scsTaskToWire(row), 201);
  });
}
