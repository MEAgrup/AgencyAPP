/**
 * The shared secret gate for the internal cron tick routes. These are pure —
 * no DB, no route — so they exhaustively pin the one thing that must never
 * regress: only a configured secret, presented via one of the two accepted
 * header shapes, opens the gate; everything else is closed.
 *
 * The two shapes exist because the cron provider is Vercel Cron, which injects
 * `Authorization: Bearer <CRON_SECRET>` and cannot send `x-plan-tick-secret`
 * (owner decision 2026-08-19), while curl / GitHub Actions / local tests keep
 * using the custom header + `PLAN_TICK_SECRET`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tickSecretOk } from './tick-auth';

const prevPlan = process.env.PLAN_TICK_SECRET;
const prevCron = process.env.CRON_SECRET;

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/internal/plan/tick', {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  delete process.env.PLAN_TICK_SECRET;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  if (prevPlan === undefined) delete process.env.PLAN_TICK_SECRET;
  else process.env.PLAN_TICK_SECRET = prevPlan;
  if (prevCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prevCron;
});

describe('tickSecretOk — fail-closed', () => {
  it('rejects when NEITHER secret is configured, whatever is presented', () => {
    expect(tickSecretOk(req({ 'x-plan-tick-secret': 'anything' }))).toBe(false);
    expect(tickSecretOk(req({ authorization: 'Bearer anything' }))).toBe(false);
  });

  it('rejects a request that presents no credential at all', () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    expect(tickSecretOk(req())).toBe(false);
  });
});

describe('tickSecretOk — x-plan-tick-secret header (GitHub Actions / curl)', () => {
  beforeEach(() => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
  });

  it('accepts the exact secret', () => {
    expect(tickSecretOk(req({ 'x-plan-tick-secret': 's3cr3t-token' }))).toBe(true);
  });
  it('rejects a wrong secret', () => {
    expect(tickSecretOk(req({ 'x-plan-tick-secret': 's3cr3t-toke!' }))).toBe(false);
  });
  it('rejects a right-prefix-wrong-length secret', () => {
    expect(tickSecretOk(req({ 'x-plan-tick-secret': 's3cr3t' }))).toBe(false);
  });
});

describe('tickSecretOk — Authorization: Bearer (Vercel Cron)', () => {
  it('accepts a Bearer token matching PLAN_TICK_SECRET', () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    expect(tickSecretOk(req({ authorization: 'Bearer s3cr3t-token' }))).toBe(true);
  });

  it('accepts a Bearer token matching CRON_SECRET (Vercel injects this env var)', () => {
    process.env.CRON_SECRET = 'vercel-injected';
    expect(tickSecretOk(req({ authorization: 'Bearer vercel-injected' }))).toBe(true);
  });

  it('is case-insensitive on the Bearer scheme', () => {
    process.env.CRON_SECRET = 'vercel-injected';
    expect(tickSecretOk(req({ authorization: 'bearer vercel-injected' }))).toBe(true);
  });

  it('rejects a Bearer token that matches neither secret', () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    process.env.CRON_SECRET = 'vercel-injected';
    expect(tickSecretOk(req({ authorization: 'Bearer nope' }))).toBe(false);
  });

  it('rejects a non-Bearer Authorization scheme carrying the secret', () => {
    process.env.PLAN_TICK_SECRET = 's3cr3t-token';
    expect(tickSecretOk(req({ authorization: 'Basic s3cr3t-token' }))).toBe(false);
  });
});
