# Deploy CDPS on Railway

This is a **monorepo** — the Go backend lives in `backend/` and the Next.js
internal app in `web-internal/`. On Railway that becomes **three services in one
project**, each pointed at its own directory:

| Railway service | Root Directory | Builds from        |
| --------------- | -------------- | ------------------ |
| **backend**     | `backend`      | `backend/Dockerfile` |
| **web-internal**| `web-internal` | Railpack (Next.js) |
| **MySQL**       | —              | Railway database   |

> Railway analyzes the **Root Directory** of each service. Because the repo root
> has no `go.mod` or `package.json`, a service left at the repo root fails to
> build ("Railpack could not detect a buildable app"). The fix is to set each
> service's Root Directory as in the table above.

## What is already wired up in the repo

- **`backend/Dockerfile`** — multi-stage build of the `cdps` server, bundling the
  SQL migrations (the server auto-migrates on boot), running as a non-root user.
- **`backend/railway.json`** — Dockerfile builder + `GET /healthz` healthcheck.
- **Backend code** — binds Railway's `$PORT`; reads the DB from `CDPS_DSN` /
  `DATABASE_URL` / `MYSQL_URL` and converts Railway's `mysql://…` URL to the Go
  driver format automatically.
- **`web-internal/railway.json`** — Railpack builder + `npm run start`.
- **Frontend code** — `next.config.ts` proxies `/api/v1/*` to `BACKEND_URL`
  (defaults to `http://127.0.0.1:8080` for local dev).

## Setup on railway.app

### 1. Backend service

If you already created a service that is failing, just fix it:

1. Open the service → the **Set root directory** button (or **Settings → Source →
   Root Directory**) → set it to **`backend`** → redeploy.
2. **Add MySQL:** project **New → Database → Add MySQL**.
3. Backend service → **Variables → New Variable**:

   | Variable       | Value                  |
   | -------------- | ---------------------- |
   | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` |

   (Type the value with the `${{ … }}` reference picker; `MySQL` must match the
   database service's name.)
4. Deploy. Migrations run on boot; the deploy goes live once `/healthz` returns
   `200`.
5. **Settings → Networking → Generate Domain** for a public URL.

### 2. Frontend service (web-internal)

1. Project **New → GitHub Repo → `MEAgrup/AgencyAPP`** (same repo, a second
   service).
2. That service → **Settings → Root Directory** → **`web-internal`**.
3. **Variables → New Variable**:

   | Variable      | Value                                   |
   | ------------- | --------------------------------------- |
   | `BACKEND_URL` | the backend's public URL, e.g. `https://backend-production-xxxx.up.railway.app` |

   (Or, to keep the API private, use Railway private networking:
   `http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:8080` — internal traffic never
   leaves the project.)
4. Deploy, then **Settings → Networking → Generate Domain** for the app URL.

## Environment variables

| Service      | Variable              | Required | Purpose                                                         |
| ------------ | --------------------- | -------- | --------------------------------------------------------------- |
| backend      | `DATABASE_URL`        | yes      | MySQL connection (Railway `mysql://…`), via reference variable. |
| backend      | `PORT`                | auto     | Injected by Railway; the server binds it. Do not set manually.  |
| backend      | `CDPS_DSN`            | optional | Overrides the DB connection (Go DSN or `mysql://` URL).         |
| backend      | `HRIS_BASE_URL`       | optional | HRIS service base URL (auth + employee sync).                  |
| backend      | `HRIS_SERVICE_TOKEN`  | optional | When set, employees sync over HTTP instead of CSV.             |
| backend      | `CDPS_MIGRATIONS_DIR` | preset   | Set to `/app/migrations` in the image; leave as-is.           |
| web-internal | `BACKEND_URL`         | yes      | Backend URL the frontend proxies `/api/v1/*` to.              |
| web-internal | `PORT`                | auto     | Injected by Railway; `next start` binds it.                    |

> The backend boots and passes its healthcheck even before HRIS is configured
> (the initial employee sync is best-effort and non-fatal). Configure `HRIS_*`
> when the HRIS integration is ready — employee data is never baked into the image.

## Redeploys

Every push to the deployed branch triggers new builds for the affected services.
Backend migrations are applied idempotently on each boot, so schema changes ship
with the code that needs them.

## The client portal (`web-client-portal`)

Not deployable yet — it currently has no app code (a separate external auth realm
per `CLAUDE.md`). When it exists, add a fourth service with Root Directory
`web-client-portal`, following the same pattern as web-internal.
