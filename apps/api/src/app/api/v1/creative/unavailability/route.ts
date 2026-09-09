/**
 * /api/v1/creative/unavailability — ketidaktersediaan PRODUKSI seorang PIC.
 *
 * ⚠️ Ini BUKAN pengajuan cuti. CDPS bukan HRIS (CLAUDE.md), dan tabel di
 * belakangnya sengaja nol approval, nol saldo, nol entitlement: satu-satunya
 * pertanyaan yang dijawabnya adalah "boleh dijadwalkan hari itu atau tidak".
 *
 * GET  jendela tanggal (`?dari=YYYY-MM-DD&sampai=YYYY-MM-DD`), rentang yang
 *      BERSINGGUNGAN — cuti seminggu yang melingkupi jendela tetap muncul.
 * POST catat. **Leader/SPV saja** (D4: bukan self-service PIC).
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { toUnavailabilityInput, unavailabilityToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const u = new URL(request.url);
    const dari = u.searchParams.get('dari') ?? '';
    const sampai = u.searchParams.get('sampai') ?? '';
    const rows = await readAsActor(actor, (sql) =>
      dailyops.listUnavailability(sql, actor, dari, sampai));
    return json({ data: rows.map(unavailabilityToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Parameters<typeof toUnavailabilityInput>[0]>(request);
    const row = await dailyops.markUnavailable(db(), actor, toUnavailabilityInput(b ?? {}));
    return json(unavailabilityToWire(row), 201);
  });
}
