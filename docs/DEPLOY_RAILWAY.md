# Deploy the CDPS backend on Railway

The backend (`backend/cmd/cdps`) deploys to Railway from this repo using the
committed `Dockerfile` and `railway.json`. Railway builds the Docker image,
provisions MySQL, and runs the API server, which **auto-migrates on boot**.

## What is already wired up

- **`Dockerfile`** (repo root) — multi-stage build of the `cdps` server plus the
  SQL migrations, running as a non-root user. Railway uses this automatically.
- **`railway.json`** — tells Railway to build with the Dockerfile and health-check
  `GET /healthz`.
- **Code** — the server binds Railway's `$PORT`, and reads the database
  connection from `CDPS_DSN`, `DATABASE_URL`, or `MYSQL_URL` (Railway's
  `mysql://…` URL is converted to the Go driver format automatically).

## One-time setup on railway.app

1. **New Project → Deploy from GitHub repo** → pick `MEAgrup/AgencyAPP`.
   (You have already connected GitHub, so it should appear in the list.)
2. Railway detects the root `Dockerfile` and creates a service. Leave the
   **Root Directory** as the repo root — the Dockerfile builds `backend/` itself.
3. **Add a database:** in the project, **New → Database → Add MySQL**.
4. **Point the backend at MySQL.** Open the backend service → **Variables** →
   **New Variable**, and add a reference variable so the app gets the DB URL:

   | Variable       | Value                    |
   | -------------- | ------------------------ |
   | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}`   |

   (Type the value with the `${{ … }}` reference picker — Railway substitutes the
   live MySQL URL. The exact service name — `MySQL` — must match the database
   service you added.)
5. **Deploy.** Railway builds the image, runs migrations on boot, and starts
   serving. The healthcheck at `/healthz` must return `200` for the deploy to go
   live.
6. **Public URL:** backend service → **Settings → Networking → Generate Domain**.
   Railway routes external `443` to the app's `$PORT` automatically.

## Environment variables

| Variable             | Required | Purpose                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | MySQL connection (Railway `mysql://…`), via the reference variable above. |
| `PORT`               | auto     | Injected by Railway; the server binds it. Do not set manually.          |
| `CDPS_DSN`           | optional | Overrides the DB connection. Accepts the Go driver DSN or a `mysql://` URL. |
| `HRIS_BASE_URL`      | optional | Base URL of the HRIS service (auth + employee sync).                    |
| `HRIS_SERVICE_TOKEN` | optional | Service token; when set, employees sync over HTTP instead of CSV.       |
| `CDPS_MIGRATIONS_DIR`| preset   | Set to `/app/migrations` in the image; leave as-is.                     |

> The server boots and passes the healthcheck even before HRIS is configured
> (the initial employee sync is best-effort and non-fatal). Configure the
> `HRIS_*` variables when the HRIS integration is ready — employee data is never
> baked into the image.

## Redeploys

Every push to the deployment branch triggers a new build. Migrations are applied
idempotently on each boot, so schema changes ship with the code that needs them.
