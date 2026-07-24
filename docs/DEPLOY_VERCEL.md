# Deploy ke Vercel — CDPS (apps/api + web-internal)

Dua project Vercel dari **satu repo** `MEAgrup/AgencyAPP`. `vercel.json` di tiap
app sudah menetapkan framework Next.js + region `sin1` (Singapura, se-region DB
CDPS SG `ap-southeast-1`). Yang WAJIB diset manual di dashboard: **Root Directory**
(tak bisa lewat vercel.json) + **Environment Variables**.

Prasyarat: migrasi + fungsi O37/O38 sudah ter-apply ke CDPS SG (sudah dilakukan).

---

## Project 1 — `apps/api` (backend/BFF) — DEPLOY DULUAN

Vercel → **Add New → Project** → import repo → **Root Directory = `apps/api`**.
(apps/api anggota npm workspace; Vercel meng-install seluruh workspace dari root
repo otomatis, lalu build `apps/api`. Install/Build biarkan default.)

**Environment Variables:**
| Key | Value |
|-----|-------|
| `DATABASE_URL` | Transaction pooler (port **6543**): `postgresql://postgres.egddxfcnrtecheiykhlf:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://egddxfcnrtecheiykhlf.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key (Dashboard → Settings → API) |

> **TIDAK perlu** `SUPABASE_JWT_SECRET` (token ES256 diverifikasi via JWKS) maupun
> service-role/secret key. Ambil `[PASSWORD]` dari Dashboard → Connect (atau reset
> di Settings → Database). Pooler role bisa `SET ROLE authenticated` → RLS (O37) jalan.

Deploy → catat URL-nya (mis. `https://cdps-api.vercel.app`).

---

## Project 2 — `web-internal` (workspace internal) — DEPLOY SETELAH apps/api

Vercel → **Add New → Project** → import repo yang sama → **Root Directory =
`web-internal`**. (web-internal standalone: punya `package-lock.json` sendiri;
`vercel.json` memaksa `npm install` di dir ini.)

**Environment Variables:**
| Key | Value |
|-----|-------|
| `BACKEND_URL` | URL Project 1 (mis. `https://cdps-api.vercel.app`) |

> ⚠️ `BACKEND_URL` dibaca di `next.config.ts` `rewrites()` yang dievaluasi **saat
> build** → set SEBELUM build (karena itu apps/api dideploy dulu). web-internal
> me-rewrite `/api/v1/*` → `BACKEND_URL`.

---

## Setelah deploy
1. Buka URL web-internal → login.
2. **Login pertama tiap akun** (password awal `MeaCdps2026!`) → dipaksa
   `/change-password` (O38) → set sandi baru ≥8 → masuk workspace.
3. Verifikasi scope RLS (O37): Director/OD lihat semua; lead se-divisi; staff
   hanya data sendiri; dashboard finance queue = Finance lead/OD/Director (staff
   Finance 403 — sesuai matrix).
4. Push berikutnya ke branch yang di-track Vercel = auto-deploy.

## Toggle keamanan (Dashboard, sekali)
Authentication → Password Security → aktifkan **leaked-password protection**
(HaveIBeenPwned) — hilangkan advisor WARN + perkuat O38.
