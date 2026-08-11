/**
 * POST /api/v1/interview/{id}/score — compute + persist the Blok C qualification
 * via the ONE core scorer. The verdict is advisory: it is recorded and (when
 * tidak_siap) pings SPV/Head of Account, but blocks nothing.
 */
import { interview } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { interviewKualifikasiResultToWire, interviewScoreFromWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = (await readJson<Record<string, unknown>>(request)) ?? {};
    const configVersion = b.config_version == null ? undefined : Number(b.config_version);
    const prasyaratStatus = b.prasyarat_status == null ? undefined : (String(b.prasyarat_status) as never);
    const k = await interview.scoreInterview(db(), actor, id, interviewScoreFromWire(b), { configVersion, prasyaratStatus });
    return json(interviewKualifikasiResultToWire(k));
  });
}
