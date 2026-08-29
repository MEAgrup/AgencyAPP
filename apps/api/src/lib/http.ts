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
import { account, activity, admin, ads, auth, board, campaign, client, creative, demo, directory, finance, health, internaltask, kol, leads, livestream, marketing, milestone, msl, notification, performance, portal, sales, stage, task } from '@cdps/domain';

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
    err instanceof leads.TooManyProspectsError ||
    err instanceof sales.IncompleteError ||
    err instanceof activity.IncompleteError ||
    err instanceof sales.TooManyServicesError ||
    err instanceof sales.CustomTermRequiresNegotiationError ||
    err instanceof sales.AllocationTotalError ||
    err instanceof sales.TooManySalespeopleError ||
    err instanceof msl.IncompleteError ||
    err instanceof finance.IncompleteError ||
    err instanceof finance.OverVerificationError ||
    err instanceof finance.ScheduleTotalError ||
    err instanceof finance.OutstandingTotalError ||
    err instanceof client.IncompleteError ||
    err instanceof account.ValidationError ||
    err instanceof task.ValidationError ||
    err instanceof creative.ValidationError ||
    err instanceof ads.ValidationError ||
    err instanceof kol.ValidationError ||
    err instanceof performance.ValidationError ||
    err instanceof board.ValidationError ||
    err instanceof livestream.IncompleteError ||
    err instanceof livestream.ValidationError ||
    err instanceof campaign.ValidationError ||
    err instanceof marketing.ValidationError ||
    err instanceof milestone.ValidationError ||
    err instanceof internaltask.ValidationError ||
    err instanceof stage.ValidationError ||
    err instanceof notification.ValidationError ||
    err instanceof admin.ValidationError ||
    err instanceof auth.PasswordPolicyError
  ) {
    return errorJson(err.message, 400); // exact BI [...] message (or internal sentinel)
  }
  if (
    err instanceof demo.NotFoundError ||
    err instanceof leads.NotFoundError ||
    err instanceof sales.NotFoundError ||
    err instanceof msl.ServiceNotFoundError ||
    err instanceof finance.NotFoundError ||
    err instanceof client.NotFoundError ||
    err instanceof account.NotFoundError ||
    err instanceof task.NotFoundError ||
    err instanceof creative.NotFoundError ||
    err instanceof ads.NotFoundError ||
    err instanceof kol.NotFoundError ||
    err instanceof performance.NotFoundError ||
    err instanceof health.NotFoundError ||
    err instanceof board.NotFoundError ||
    err instanceof livestream.NotFoundError ||
    err instanceof campaign.NotFoundError ||
    err instanceof marketing.NotFoundError ||
    err instanceof milestone.NotFoundError ||
    err instanceof internaltask.NotFoundError ||
    err instanceof stage.NotFoundError ||
    err instanceof admin.NotFoundError ||
    err instanceof auth.EmployeeNotFoundError
  ) {
    return errorJson(err.message, 404);
  }
  if (
    err instanceof demo.ForbiddenError ||
    err instanceof leads.ForbiddenError ||
    err instanceof sales.ForbiddenError ||
    err instanceof msl.ForbiddenError ||
    err instanceof finance.ForbiddenError ||
    err instanceof client.ForbiddenError ||
    err instanceof account.ForbiddenError ||
    err instanceof task.ForbiddenError ||
    err instanceof creative.ForbiddenError ||
    err instanceof ads.ForbiddenError ||
    err instanceof kol.ForbiddenError ||
    err instanceof performance.ForbiddenError ||
    err instanceof health.ForbiddenError ||
    err instanceof board.ForbiddenError ||
    err instanceof livestream.ForbiddenError ||
    err instanceof campaign.ForbiddenError ||
    err instanceof marketing.ForbiddenError ||
    err instanceof milestone.ForbiddenError ||
    err instanceof internaltask.ForbiddenError ||
    err instanceof stage.ForbiddenError ||
    err instanceof portal.ForbiddenError ||
    err instanceof admin.ForbiddenError ||
    err instanceof directory.ForbiddenError ||
    err instanceof auth.ForbiddenError
  ) {
    return errorJson(err.message, 403);
  }
  if (
    err instanceof leads.BlockedError ||
    err instanceof sales.NotClosableError ||
    err instanceof activity.StageError ||
    err instanceof leads.AlreadyResolvedError ||
    err instanceof finance.ContractRequiredError ||
    err instanceof finance.SchemeLockedError ||
    err instanceof finance.SchemeNoScheduleError ||
    err instanceof finance.ScheduleExistsError ||
    err instanceof finance.NoOutstandingError ||
    err instanceof finance.ChangePendingError ||
    err instanceof finance.ChangeDecidedError ||
    err instanceof client.LockedFieldError ||
    err instanceof client.IntentLockedError ||
    err instanceof client.ServiceStateError ||
    err instanceof account.ConflictError ||
    err instanceof task.ConflictError ||
    err instanceof creative.ConflictError ||
    err instanceof ads.ConflictError ||
    err instanceof kol.ConflictError ||
    err instanceof board.ConflictError ||
    err instanceof livestream.ConflictError ||
    err instanceof marketing.DuplicateError ||
    err instanceof milestone.ConflictError ||
    err instanceof internaltask.ConflictError ||
    err instanceof stage.ConflictError ||
    err instanceof admin.ConflictError
  ) {
    // Lifecycle conflicts: a dedup block, an un-closable attempt, a lead whose
    // win was already resolved, or a full-verification blocked on a missing
    // contract. 409 with the verbatim message where BI applies.
    return errorJson(err.message, 409);
  }
  if (err instanceof UnauthorizedError || err instanceof auth.OldPasswordError) {
    // OldPasswordError is 401 like Go's handleChangePassword: the request was
    // well-formed, the CURRENT password just did not match.
    return errorJson(err.message, 401);
  }
  if (err instanceof BadRequestError) {
    return errorJson(err.message, 400);
  }
  // Unmapped throw → 500. Log the real error server-side (never in the client
  // body) so production 500s are diagnosable in the platform logs.
  console.error('[api] unhandled error →500:', err);
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
