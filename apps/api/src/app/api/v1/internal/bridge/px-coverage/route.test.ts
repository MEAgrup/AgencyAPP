/**
 * The `/internal/bridge/px-coverage` secret gate (Product Exchange M3-B,
 * PX-M3-04). These cases all reject BEFORE the handler touches the database,
 * so they need no DATABASE_URL — pola sama `bridge/orders` (kalau ada) dan
 * `pdt/purge/tick/route.test.ts`. `BRIDGE_PX_SECRET` adalah secret TERPISAH
 * dari `BRIDGE_INGEST_SECRET`/`CRON_SECRET`/`PLAN_TICK_SECRET`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

const URL = 'http://localhost/api/v1/internal/bridge/px-coverage';
const prev = process.env.BRIDGE_PX_SECRET;
const prevIngest = process.env.BRIDGE_INGEST_SECRET;

function post(headers: Record<string, string> = {}, body = '{}'): Request {
  return new Request(URL, { method: 'POST', headers, body });
}

beforeEach(() => {
  delete process.env.BRIDGE_PX_SECRET;
  delete process.env.BRIDGE_INGEST_SECRET;
});
afterEach(() => {
  if (prev === undefined) delete process.env.BRIDGE_PX_SECRET;
  else process.env.BRIDGE_PX_SECRET = prev;
  if (prevIngest === undefined) delete process.env.BRIDGE_INGEST_SECRET;
  else process.env.BRIDGE_INGEST_SECRET = prevIngest;
});

describe('POST /internal/bridge/px-coverage — secret gate', () => {
  it('rejects when the secret is not configured (closed by default)', async () => {
    const res = await POST(post({ authorization: 'Bearer anything' }));
    expect(res.status).toBe(401);
  });

  it('rejects a missing Authorization header when a secret IS configured', async () => {
    process.env.BRIDGE_PX_SECRET = 'px-s3cr3t';
    const res = await POST(post());
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    process.env.BRIDGE_PX_SECRET = 'px-s3cr3t';
    const res = await POST(post({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('BRIDGE_INGEST_SECRET matching does NOT open this gate — separate credential (D12 preseden)', async () => {
    process.env.BRIDGE_PX_SECRET = 'px-s3cr3t';
    process.env.BRIDGE_INGEST_SECRET = 'orders-s3cr3t';
    const res = await POST(post({ authorization: 'Bearer orders-s3cr3t' }));
    expect(res.status).toBe(401);
  });
});
