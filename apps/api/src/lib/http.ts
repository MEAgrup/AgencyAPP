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

/**
 * Best-effort client IP from Vercel's `x-forwarded-for` (left-most entry is
 * the original client — see Vercel's proxy docs). Falls back to a fixed
 * sentinel so a request with no header still lands in a (shared,
 * conservative) rate-limit bucket rather than bypassing the limiter
 * entirely. Used by the login rate limiter (M15-C2 §5.2 OQ-5); reusable for
 * the complaint-form limiter when that surface is built.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first && first !== '' ? first : 'unknown';
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
 *
 * Dispatch is by `Error.name`, not `instanceof`, so this module never imports
 * `@cdps/domain` — importing the barrel (29 modules) here pulled all of it
 * into every route's lambda bundle, just for this `instanceof` chain (P1,
 * `docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md` Bagian 4). Every
 * domain error class already sets a module-qualified `this.name` (e.g.
 * `'SalesForbiddenError'`), so name lookup is exact — no two classes with
 * different statuses share a name (verified against every `packages/domain/src`
 * error class at the time this table was generated; `apps/api/src/lib/
 * http.test.ts` pins the full matrix). `auth.NotFoundError` and demo's bare
 * `NotFoundError` DO share the literal name `'NotFoundError'`, but
 * `auth.NotFoundError` is always caught inline by its two callers (`/me`,
 * `/vendor/me`) before it would ever reach `mapError` — see those route files.
 */
const STATUS_BY_ERROR_NAME: Record<string, number> = {
  // 400
  AccountValidationError: 400, // account.ValidationError
  ActivityIncompleteError: 400, // activity.IncompleteError
  AdminValidationError: 400, // admin.ValidationError
  AdsValidationError: 400, // ads.ValidationError
  AllocationTotalError: 400, // sales.AllocationTotalError
  AuthPasswordPolicyError: 400, // auth.PasswordPolicyError
  BadCommissionRuleError: 400, // sales.BadCommissionRuleError
  BoardValidationError: 400, // board.ValidationError
  CampaignValidationError: 400, // campaign.ValidationError
  ClientIncompleteError: 400, // client.IncompleteError
  ClientPortalValidationError: 400, // clientPortal.PortalValidationError
  CreativeValidationError: 400, // creative.ValidationError
  CustomTermRequiresNegotiationError: 400, // sales.CustomTermRequiresNegotiationError
  FinanceIncompleteError: 400, // finance.IncompleteError
  IncompleteError: 400, // demo.IncompleteError
  InternalTaskValidationError: 400, // internaltask.ValidationError
  KolValidationError: 400, // kol.ValidationError
  LeadIncompleteError: 400, // leads.IncompleteError
  LeadTooManyProspectsError: 400, // leads.TooManyProspectsError
  LiveStreamIncompleteError: 400, // livestream.IncompleteError
  LiveStreamValidationError: 400, // livestream.ValidationError
  MarketingValidationError: 400, // marketing.ValidationError
  MilestoneValidationError: 400, // milestone.ValidationError
  MslIncompleteError: 400, // msl.IncompleteError
  OutstandingTotalError: 400, // finance.OutstandingTotalError
  OverVerificationError: 400, // finance.OverVerificationError
  PageCursorError: 400, // core page.PageCursorError — a cursor this server did not mint
  PerformanceValidationError: 400, // performance.ValidationError
  ReqValidationError: 400, // req.ValidationError
  SalesIncompleteError: 400, // sales.IncompleteError
  SalesPerfValidationError: 400, // salesperf.ValidationError
  SalesTooManyServicesError: 400, // sales.TooManyServicesError
  ScheduleTotalError: 400, // finance.ScheduleTotalError
  StageValidationError: 400, // stage.ValidationError
  TaskValidationError: 400, // task.ValidationError
  TooManySalespeopleError: 400, // sales.TooManySalespeopleError
  ValidationError: 400, // notification.ValidationError
  // 401 — OldPasswordError is 401 like Go's handleChangePassword: the request
  // was well-formed, the CURRENT password just did not match.
  AuthOldPasswordError: 401, // auth.OldPasswordError
  // 403
  AccountForbiddenError: 403, // account.ForbiddenError
  AdminForbiddenError: 403, // admin.ForbiddenError
  AdsForbiddenError: 403, // ads.ForbiddenError
  AuthForbiddenError: 403, // auth.ForbiddenError
  BoardForbiddenError: 403, // board.ForbiddenError
  CampaignForbiddenError: 403, // campaign.ForbiddenError
  ClientForbiddenError: 403, // client.ForbiddenError
  ClientPortalForbiddenError: 403, // clientPortal.PortalForbiddenError
  CreativeForbiddenError: 403, // creative.ForbiddenError
  DirectoryForbiddenError: 403, // directory.ForbiddenError
  FinanceForbiddenError: 403, // finance.ForbiddenError
  ForbiddenError: 403, // demo.ForbiddenError
  HealthForbiddenError: 403, // health.ForbiddenError
  InternalTaskForbiddenError: 403, // internaltask.ForbiddenError
  KolForbiddenError: 403, // kol.ForbiddenError
  LeadForbiddenError: 403, // leads.ForbiddenError
  LiveStreamForbiddenError: 403, // livestream.ForbiddenError
  MarketingForbiddenError: 403, // marketing.ForbiddenError
  MilestoneForbiddenError: 403, // milestone.ForbiddenError
  MslForbiddenError: 403, // msl.ForbiddenError
  PerformanceForbiddenError: 403, // performance.ForbiddenError
  PortalForbiddenError: 403, // portal.ForbiddenError
  ReqForbiddenError: 403, // req.ForbiddenError
  SalesForbiddenError: 403, // sales.ForbiddenError
  SalesPerfForbiddenError: 403, // salesperf.ForbiddenError
  StageForbiddenError: 403, // stage.ForbiddenError
  TaskForbiddenError: 403, // task.ForbiddenError
  // 404
  AccountNotFoundError: 404, // account.NotFoundError
  AdminNotFoundError: 404, // admin.NotFoundError
  AdsNotFoundError: 404, // ads.NotFoundError
  AuthEmployeeNotFoundError: 404, // auth.EmployeeNotFoundError
  BoardNotFoundError: 404, // board.NotFoundError
  CampaignNotFoundError: 404, // campaign.NotFoundError
  ClientNotFoundError: 404, // client.NotFoundError
  ClientPortalNotFoundError: 404, // clientPortal.PortalNotFoundError
  CreativeNotFoundError: 404, // creative.NotFoundError
  FinanceNotFoundError: 404, // finance.NotFoundError
  HealthNotFoundError: 404, // health.NotFoundError
  InternalTaskNotFoundError: 404, // internaltask.NotFoundError
  KolNotFoundError: 404, // kol.NotFoundError
  LeadNotFoundError: 404, // leads.NotFoundError
  LiveStreamNotFoundError: 404, // livestream.NotFoundError
  MarketingNotFoundError: 404, // marketing.NotFoundError
  MilestoneNotFoundError: 404, // milestone.NotFoundError
  NotFoundError: 404, // demo.NotFoundError (see auth.NotFoundError note above)
  PerformanceNotFoundError: 404, // performance.NotFoundError
  ReqNotFoundError: 404, // req.NotFoundError
  SalesNotFoundError: 404, // sales.NotFoundError
  ServiceNotFoundError: 404, // msl.ServiceNotFoundError
  StageNotFoundError: 404, // stage.NotFoundError
  TaskNotFoundError: 404, // task.NotFoundError
  // 409 — lifecycle conflicts: a dedup block, an un-closable attempt, a lead
  // whose win was already resolved, or a full-verification blocked on a
  // missing contract. 409 with the verbatim message where BI applies.
  AccountConflictError: 409, // account.ConflictError
  ActivityStageError: 409, // activity.StageError
  AdminConflictError: 409, // admin.ConflictError
  AdsConflictError: 409, // ads.ConflictError
  BoardConflictError: 409, // board.ConflictError
  ChangeDecidedError: 409, // finance.ChangeDecidedError
  ChangePendingError: 409, // finance.ChangePendingError
  ContractRequiredError: 409, // finance.ContractRequiredError
  CreativeConflictError: 409, // creative.ConflictError
  IntentLockedError: 409, // client.IntentLockedError
  InternalTaskConflictError: 409, // internaltask.ConflictError
  KolConflictError: 409, // kol.ConflictError
  LeadAlreadyResolvedError: 409, // leads.AlreadyResolvedError
  LeadBlockedError: 409, // leads.BlockedError
  LiveStreamConflictError: 409, // livestream.ConflictError
  LockedFieldError: 409, // client.LockedFieldError
  MarketingDuplicateError: 409, // marketing.DuplicateError
  MilestoneConflictError: 409, // milestone.ConflictError
  NoOutstandingError: 409, // finance.NoOutstandingError
  NotClosableError: 409, // sales.NotClosableError
  ReqConflictError: 409, // req.ConflictError
  ScheduleExistsError: 409, // finance.ScheduleExistsError
  SchemeLockedError: 409, // finance.SchemeLockedError
  SchemeNoScheduleError: 409, // finance.SchemeNoScheduleError
  ServiceStateError: 409, // client.ServiceStateError
  StageConflictError: 409, // stage.ConflictError
  TaskConflictError: 409, // task.ConflictError
  // 429 — the two app-level throttles: login (all realms) and the Client
  // Portal complaint form (spec §5.2). Both carry a BI `[...]` message.
  AuthRateLimitedError: 429, // auth.RateLimitedError
  ClientPortalRateLimitedError: 429, // clientPortal.PortalRateLimitedError
};

export function mapError(err: unknown): Response {
  if (err instanceof UnauthorizedError) {
    return errorJson(err.message, 401);
  }
  if (err instanceof BadRequestError) {
    return errorJson(err.message, 400);
  }
  if (err instanceof Error) {
    const status = STATUS_BY_ERROR_NAME[err.name];
    if (status !== undefined) {
      return errorJson(err.message, status);
    }
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
