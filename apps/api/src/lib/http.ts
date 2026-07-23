/**
 * HTTP helpers for the API route handlers: typed error → status mapping and a
 * `handle()` wrapper so every route funnels through one place. Validation errors
 * carry the exact Bahasa Indonesia `[...]` message from the domain layer; this
 * module never invents or translates messages (CLAUDE.md §5).
 *
 * Framework-free (uses only the Web `Response`), so it is unit-testable without
 * Next.
 */
import type { statemachine } from '@cdps/core';
import { demo, leads, msl, sales } from '@cdps/domain';

/** 401 — no/invalid credentials. */
export class UnauthorizedError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** 400 — malformed request body. */
export class BadRequestError extends Error {
  constructor(message = 'bad request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** An error body always shaped `{ error: <message> }`. */
export function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * mapError turns a thrown error into a Response. Domain errors map to their
 * canonical status; the message is passed through verbatim (BI `[...]` for
 * validation). Unknown errors become an opaque 500 (never leak internals).
 */
export function mapError(err: unknown): Response {
  if (
    err instanceof demo.IncompleteError ||
    err instanceof leads.IncompleteError ||
    err instanceof sales.IncompleteError ||
    err instanceof sales.TooManyServicesError ||
    err instanceof sales.CustomTermRequiresNegotiationError ||
    err instanceof msl.IncompleteError
  ) {
    return errorJson(err.message, 400); // exact BI [...] message (or internal sentinel)
  }
  if (
    err instanceof demo.NotFoundError ||
    err instanceof leads.NotFoundError ||
    err instanceof sales.NotFoundError ||
    err instanceof msl.ServiceNotFoundError
  ) {
    return errorJson(err.message, 404);
  }
  if (
    err instanceof demo.ForbiddenError ||
    err instanceof sales.ForbiddenError ||
    err instanceof msl.ForbiddenError
  ) {
    return errorJson(err.message, 403);
  }
  if (err instanceof leads.BlockedError) {
    // A dedup block is a lifecycle conflict (matches Go's 409 on ErrBlocked),
    // carrying the verbatim BI [...] message.
    return errorJson(err.message, 409);
  }
  if (err instanceof UnauthorizedError) {
    return errorJson(err.message, 401);
  }
  if (err instanceof BadRequestError) {
    return errorJson(err.message, 400);
  }
  return errorJson('internal server error', 500);
}

/** handle wraps a route body so any thrown error is mapped consistently. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return mapError(err);
  }
}

/**
 * transitionResponse renders a state-machine result: a successful transition is
 * 200; a rejection maps to a status with the engine's exact BI message —
 * `role_denied` → 403, `blocked`/other → 409 (conflict on the lifecycle).
 */
export function transitionResponse(result: statemachine.TransitionResult): Response {
  if (result.ok) {
    return json(result, 200);
  }
  const status = result.code === 'role_denied' ? 403 : 409;
  return errorJson(result.message, status);
}

/** readJson parses a JSON request body, throwing BadRequestError on failure. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new BadRequestError('invalid JSON body');
  }
}
