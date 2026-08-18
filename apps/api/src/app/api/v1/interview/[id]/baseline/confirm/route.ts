/**
 * POST /api/v1/interview/{id}/baseline/confirm — the AM corrects and confirms the
 * auto-filled interview fields per number (RAB-05, keputusan 1). A parser bug can
 * never shift a Blok C verdict until a human confirms, so submitting the interview
 * requires every scored field confirmed here first. The original proposal
 * (`nilai_usulan`) is frozen in the DB — only `nilai*` and `dikonfirmasi` move.
 */
import { risetAwal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { risetAwalBaselineToWire } from '@/lib/wire';

interface ConfirmItemWire {
  section: string;
  field_key: string;
  nilai_teks?: string | null;
  nilai_angka?: number | null;
  nilai_uang?: string | number | null;
  dikonfirmasi: boolean;
}

interface ConfirmWire {
  items?: ConfirmItemWire[];
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<ConfirmWire>(request);
    const items: risetAwal.ConfirmIsianItem[] = (b.items ?? []).map((it) => ({
      section: it.section,
      fieldKey: it.field_key,
      nilaiTeks: it.nilai_teks ?? null,
      nilaiAngka: it.nilai_angka ?? null,
      nilaiUang: it.nilai_uang ?? null,
      dikonfirmasi: Boolean(it.dikonfirmasi),
    }));
    const v = await risetAwal.confirmIsian(db(), actor, id, items);
    return json(risetAwalBaselineToWire(v));
  });
}
