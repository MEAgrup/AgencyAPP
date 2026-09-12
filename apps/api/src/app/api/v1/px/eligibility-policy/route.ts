/**
 * /api/v1/px/eligibility-policy — Product Exchange PX-M2a: list every
 * calibration version (GET) and mint the next one (POST). Director-only
 * (`productexchange.canKelolaPolicy`), preseden `adsscanner_benchmark`.
 *
 * Uses the PRIVILEGED client: `px_eligibility_policy` is default-deny with no
 * SELECT policy (it is calibration, like `hari_libur`/`role_mappings`), so RLS
 * cannot scope this read — the Director gate lives in the domain layer
 * instead (see the module docstring in `@cdps/domain`'s `productexchange`).
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { eligibilityPolicyToWire } from '@/lib/wire';

interface EligibilityPolicyBody {
  nilai: unknown;
  catatan?: string;
  aktif?: boolean;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await productexchange.listEligibilityPolicy(db(), actor);
    return json({ data: rows.map(eligibilityPolicyToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<EligibilityPolicyBody>(request);
    const row = await productexchange.createEligibilityPolicy(db(), actor, {
      nilai: b.nilai,
      catatan: b.catatan ?? '',
      aktif: b.aktif,
    });
    return json(eligibilityPolicyToWire(row), 201);
  });
}
