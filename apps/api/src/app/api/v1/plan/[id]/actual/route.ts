/**
 * POST /api/v1/plan/{id}/actual — record a manual GMV actual (PE-1/PE-2, Rule
 * 10/11). Only GMV is manual; the proof (file + capture date) is mandatory. Both
 * gates + the audit row live in the domain (`recordManualActual`).
 */
import { plan } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { planActualToWire } from '@/lib/wire';

interface ActualBody {
  channel?: string;
  metric?: string;
  nilai?: number;
  file_bukti?: string;
  tanggal_ambil?: string;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<ActualBody>(request);
    const actual = await plan.recordManualActual(
      db(),
      actor,
      id,
      b.channel ?? '',
      b.metric ?? '',
      b.nilai as number,
      { fileBukti: b.file_bukti ?? '', tanggalAmbil: b.tanggal_ambil ?? '' },
    );
    return json(planActualToWire(actual));
  });
}
