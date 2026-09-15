/**
 * POST /api/v1/internal/bridge/px-coverage — machine ingest for the MCN→CDPS
 * Product Exchange coverage push (PRD M3 Flow C, §7). Not a JWT actor route:
 * `mcnapp`'s coverage-push pipeline calls this with
 * `Authorization: Bearer <BRIDGE_PX_SECRET>` — a SEPARATE credential from
 * `BRIDGE_INGEST_SECRET`/`CRON_SECRET`/`PLAN_TICK_SECRET` (`@/lib/bridge-auth`
 * `bridgePxSecretOk`), so rotating this secret never touches the others.
 *
 * `Idempotency-Key` is mandatory — same reason as `bridge/orders`: MCN retries
 * after an ambiguous timeout, and a repeated key must return the ORIGINAL
 * `batch_key`, 200, zero new rows (`productexchange.intakeCoverage`).
 *
 * PX-M3-03: this path (`/internal/bridge/px-coverage`), not `/api/bridge/…`
 * illustrated in PRD §7 — see `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md`.
 * PX-M3-04: kolom asing/bentuk salah → 422 (`ProductExchangeContractError`),
 * bukan 400 — deviasi sadar dari konvensi HTTP repo lainnya.
 */
import { productexchange } from '@cdps/domain';
import { bridgePxSecretOk } from '@/lib/bridge-auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!bridgePxSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const idempotencyKey = request.headers.get('idempotency-key') ?? '';
    const body = await readJson<unknown>(request);
    const { batchKey, rowsReceived, duplicate } = await productexchange.intakeCoverage(db(), body, idempotencyKey);
    return json({ batch_key: batchKey, rows_received: rowsReceived, duplicate });
  });
}
