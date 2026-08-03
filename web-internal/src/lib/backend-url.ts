/**
 * Resolves the host that `next.config.ts` proxies `/api/v1/*` to, and refuses
 * hosts that belong to the retired Go + MySQL stack.
 *
 * WHY A GUARD AND NOT JUST A DEFAULT. `BACKEND_URL` is set per-environment on
 * the deploy platform, so the repo default is not what production actually
 * uses. The Railway `web-internal` service was wired to the Go backend when it
 * was created (docs/DEPLOY_RAILWAY.md, 2026-07-19) and has stayed wired to it
 * ever since — which is why leads created through that URL land in Railway
 * MySQL, not in Supabase, and why the Qualified Lead Form there answers with
 * Go's `[terjadi kesalahan]`. Nothing in the repo could tell: a proxy to a
 * wrong-but-reachable API looks exactly like a proxy to the right one until a
 * page misbehaves.
 *
 * Railway is being decommissioned. After that day a build still carrying such a
 * `BACKEND_URL` produces a frontend where EVERY page fails — with no clue in
 * the logs pointing at the cause. So the wiring is checked where it is decided,
 * at build time, and a bad value stops the build instead of shipping.
 *
 * A failed build does NOT take a running deployment down; it only blocks a new
 * broken one. `ALLOW_LEGACY_BACKEND_URL=1` overrides, for the case where
 * someone knowingly needs to redeploy the legacy pairing before switch-off.
 */

/** The deployed apps/api (Next + Supabase) — the only production API. */
export const PRODUCTION_BACKEND = 'https://agency-app-api.vercel.app';

/** Local apps/api during development (`npm run dev -w @cdps/api -- -p 3001`). */
export const DEV_BACKEND = 'http://127.0.0.1:3001';

/**
 * Hosts that serve, or used to serve, the retired Go backend. Railway's public
 * domains are `*.up.railway.app` (service) and `*.proxy.rlwy.net` (TCP proxy);
 * `*.railway.internal` is its private network. Port 8080 is the Go server's
 * own default (backend/cmd/cdps/main.go) — the local pairing this repo shipped
 * with before apps/api existed, and the one stale `.env` files still carry.
 */
export function isRetiredBackend(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // malformed is a separate complaint — see resolveBackendURL
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host.endsWith('.railway.app') || host === 'railway.app' ||
    host.endsWith('.rlwy.net') ||
    host.endsWith('.railway.internal')
  ) {
    return true;
  }
  return parsed.port === '8080';
}

/** Thrown for a `BACKEND_URL` the frontend must not be built against. */
export class BackendUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUrlError';
  }
}

export interface ResolveOptions {
  /** `process.env.BACKEND_URL` — wins when set, as it always has. */
  backendUrl?: string;
  /** `process.env.NODE_ENV` — picks the fallback when BACKEND_URL is unset. */
  nodeEnv?: string;
  /** `process.env.ALLOW_LEGACY_BACKEND_URL` — escape hatch, see file header. */
  allowLegacy?: string;
}

/**
 * resolveBackendURL returns the proxy target, throwing BackendUrlError when the
 * value is malformed or points at the retired stack.
 */
export function resolveBackendURL(opts: ResolveOptions = {}): string {
  const raw = (opts.backendUrl ?? '').trim();
  if (raw === '') {
    return opts.nodeEnv === 'production' ? PRODUCTION_BACKEND : DEV_BACKEND;
  }
  try {
    new URL(raw);
  } catch {
    throw new BackendUrlError(
      `BACKEND_URL bukan URL yang sah: ${JSON.stringify(raw)}. ` +
      `Isi dengan ${PRODUCTION_BACKEND} (produksi) atau ${DEV_BACKEND} (lokal).`,
    );
  }
  const allowLegacy = (opts.allowLegacy ?? '') !== '' && opts.allowLegacy !== '0';
  if (isRetiredBackend(raw) && !allowLegacy) {
    throw new BackendUrlError(
      `BACKEND_URL menunjuk ke stack Go + MySQL yang sudah dipensiunkan: ${raw}\n` +
      `Frontend HARUS memproksi /api/v1/* ke apps/api (Next + Supabase).\n` +
      `  produksi : BACKEND_URL=${PRODUCTION_BACKEND}\n` +
      `  lokal    : BACKEND_URL=${DEV_BACKEND}\n` +
      `Data yang ditulis lewat backend lama masuk ke MySQL Railway, BUKAN Supabase, ` +
      `dan hilang saat Railway dimatikan. Kalau Anda memang sengaja membangun ` +
      `pasangan lama sebelum switch-off, set ALLOW_LEGACY_BACKEND_URL=1.`,
    );
  }
  return raw;
}
