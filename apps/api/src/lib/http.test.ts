/**
 * Unit tests for the HTTP error-mapping + response helpers (no Next, no DB).
 */
import { describe, expect, it } from 'vitest';
import { bi } from '@cdps/core';
import { account, demo } from '@cdps/domain';
import {
  BadRequestError,
  UnauthorizedError,
  errorJson,
  handle,
  json,
  mapError,
  readJson,
  transitionResponse,
} from './http';

describe('json / errorJson', () => {
  it('serializes a body with the JSON content type', async () => {
    const res = json({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('shapes an error body as { error }', async () => {
    expect(await errorJson('nope', 400).json()).toEqual({ error: 'nope' });
  });
});

describe('mapError', () => {
  it('maps IncompleteError to 400 with the exact BI message', async () => {
    const res = mapError(new demo.IncompleteError());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: bi.INCOMPLETE_DATA });
  });

  it('maps NotFoundError to 404', () => {
    expect(mapError(new demo.NotFoundError()).status).toBe(404);
  });

  it('maps ForbiddenError to 403', () => {
    expect(mapError(new demo.ForbiddenError()).status).toBe(403);
  });

  it('maps UnauthorizedError to 401', () => {
    expect(mapError(new UnauthorizedError()).status).toBe(401);
  });

  it('maps BadRequestError to 400', () => {
    expect(mapError(new BadRequestError()).status).toBe(400);
  });

  it('maps an unknown error to an opaque 500', async () => {
    const res = mapError(new Error('secret internals'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal server error' });
  });

  it('maps M6 account errors to their canonical status (verbatim BI)', async () => {
    const validation = mapError(new account.ValidationError(account.MSG_INVALID_AM));
    expect(validation.status).toBe(400);
    expect(await validation.json()).toEqual({ error: account.MSG_INVALID_AM });

    expect(mapError(new account.ForbiddenError(account.MSG_ASSIGN_FORBIDDEN)).status).toBe(403);
    expect(mapError(new account.NotFoundError()).status).toBe(404);
    expect(mapError(new account.ConflictError(account.MSG_ALREADY_ASSIGNED)).status).toBe(409);
  });
});

describe('handle', () => {
  it('returns the handler response on success', async () => {
    const res = await handle(async () => json({ ok: true }));
    expect(res.status).toBe(200);
  });

  it('maps a thrown error', async () => {
    const res = await handle(async () => {
      throw new demo.NotFoundError();
    });
    expect(res.status).toBe(404);
  });
});

describe('transitionResponse', () => {
  it('renders a successful transition as 200', async () => {
    const res = transitionResponse({ ok: true, from: '[To Do]', to: '[In Progress]' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, from: '[To Do]', to: '[In Progress]' });
  });

  it('renders role_denied as 403 with the BI message', async () => {
    const res = transitionResponse({ ok: false, code: 'role_denied', message: bi.TRANSITION_ROLE_DENIED });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: bi.TRANSITION_ROLE_DENIED });
  });

  it('renders a blocked transition as 409', () => {
    expect(transitionResponse({ ok: false, code: 'blocked', message: bi.TRANSITION_NOT_ALLOWED }).status).toBe(409);
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    const req = new Request('http://x/', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await readJson(req)).toEqual({ a: 1 });
  });

  it('throws BadRequestError on invalid JSON', async () => {
    const req = new Request('http://x/', { method: 'POST', body: 'not json' });
    await expect(readJson(req)).rejects.toBeInstanceOf(BadRequestError);
  });
});
