/**
 * POST /api/v1/internal/bridge/orders — machine ingest for the MSDPS→CDPS
 * bridge (Fase 1). Not a JWT actor route: MSDPS's `cdps_outbox` delivery job
 * calls this with `Authorization: Bearer <BRIDGE_INGEST_SECRET>` — a
 * SEPARATE credential from `PLAN_TICK_SECRET`/`CRON_SECRET` (`@/lib/
 * bridge-auth`), so rotating the bridge secret never touches cron.
 *
 * `Idempotency-Key` header is mandatory: MSDPS retries after an ambiguous
 * timeout, and a repeated key must return the ORIGINAL `ord_code`, 200, zero
 * new rows (`bridge.intake`).
 */
import { bridge } from '@cdps/domain';
import { bridgeSecretOk } from '@/lib/bridge-auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!bridgeSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const idempotencyKey = request.headers.get('idempotency-key') ?? '';
    const body = await readJson<unknown>(request);
    const { ordCode, status } = await bridge.intake(db(), body, idempotencyKey);
    return json({ ord_code: ordCode, status });
  });
}
