/**
 * /api/v1/creative/scs/kategori — taksonomi Kategori.
 *
 * Taksonomi ini adalah DATA, bukan skema: hanya empat Kategori yang terbukti di
 * sumber yang di-seed migrasi, dan sisanya diisi lead Creative lewat rute ini.
 * Mengunci 24 nama di CHECK constraint berarti satu migrasi per koreksi.
 *
 * `?semua=1` menyertakan Kategori nonaktif — dipakai layar admin, bukan picker.
 */
import { scs } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { scsKategoriToWire, toScsKategoriInput } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const semua = new URL(request.url).searchParams.get('semua') === '1';
    const rows = await readAsActor(actor, (sql) => scs.listKategori(sql, actor, semua));
    return json({ kategori: rows.map(scsKategoriToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Parameters<typeof toScsKategoriInput>[0]>(request);
    const row = await scs.createKategori(db(), actor, toScsKategoriInput(b ?? {}));
    return json(scsKategoriToWire(row), 201);
  });
}
