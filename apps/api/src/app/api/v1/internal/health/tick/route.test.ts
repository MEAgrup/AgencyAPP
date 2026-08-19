/**
 * The `/internal/health/tick` secret gate (M13-G1). These cases all reject BEFORE
 * the handler touches the database, so they need no DATABASE_URL — they prove the
 * one thing that must never regress: an unset or wrong secret cannot drive the
 * monthly snapshot sweep. The secret is the SAME `PLAN_TICK_SECRET` the plan tick
 * uses (reused, not a second credential).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

const URL = 'http://localhost/api/v1/internal/health/tick';
const prev = process.env.PLAN_TICK_SECRET;

function post(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'POST', headers, body: '{}' });
}

beforeEach(() => {
  delete process.env.PLAN_TICK_SECRET;
});
afterEach(() => {
  if (prev === undefined) delete process.env.PLAN_TICK_SECRET;
  else process.env.PLAN_TICK_SECRET = prev;
});

describe('POST /internal/health/tick — secret gate', () => {
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
});
