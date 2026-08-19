/**
 * The `/internal/plan/tick` secret gate (B-09). These cases all reject BEFORE the
 * handler touches the database, so they need no DATABASE_URL — they prove the one
 * thing that must never regress: an unset or wrong secret cannot drive the job.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './route';

const URL = 'http://localhost/api/v1/internal/plan/tick';
const prev = process.env.PLAN_TICK_SECRET;
const prevCron = process.env.CRON_SECRET;

function post(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'POST', headers, body: '{}' });
}
function get(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'GET', headers });
}

beforeEach(() => {
  delete process.env.PLAN_TICK_SECRET;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  if (prev === undefined) delete process.env.PLAN_TICK_SECRET;
  else process.env.PLAN_TICK_SECRET = prev;
  if (prevCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prevCron;
});

describe('POST /internal/plan/tick — secret gate', () => {
  it('rejects when the secret is not configured (closed by default)', async () => {
    const res = await POST(post({ 'x-plan-tick-secret': 'anything' }));
    expect(res.status).toBe(401);
  });

  it('rejects a missing header when a secret IS configured', async () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    const res = await POST(post());
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    const res = await POST(post({ 'x-plan-tick-secret': 's3cr3t-toke!' }));
    expect(res.status).toBe(401);
  });

  it('rejects a right-prefix-wrong-length secret', async () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    const res = await POST(post({ 'x-plan-tick-secret': 's3cr3t' }));
    expect(res.status).toBe(401);
  });

  // GET is the verb Vercel Cron uses. It must be gated exactly like POST — an
  // unset or wrong secret can never drive the job, whatever the verb.
  it('GET rejects when the secret is not configured (closed by default)', async () => {
    const res = await GET(get({ authorization: 'Bearer anything' }));
    expect(res.status).toBe(401);
  });

  it('GET rejects a wrong Bearer secret', async () => {
    process.env.CRON_SECRET = 's3cr3t-token';
    const res = await GET(get({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });
});
