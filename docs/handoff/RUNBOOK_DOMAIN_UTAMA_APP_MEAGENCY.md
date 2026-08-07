# RUNBOOK — Domain utama CDPS: `https://app.meagency.co.id`

> **Status:** domain sudah dipasang di Vercel oleh pemilik (2026-08-07). Dokumen ini menutup
> pertanyaan "apakah perlu setup lain?" dengan memisahkan **tiga hal** yang sering dicampur:
> (1) yang ternyata **tidak perlu diapa-apakan** karena arsitekturnya sudah benar,
> (2) satu **celah nyata di kode** yang sudah diperbaiki di commit ini,
> (3) yang **hanya bisa dikerjakan pemilik** di dashboard Vercel/Supabase — Claude tidak bisa:
> gateway sandbox menjawab `403` untuk CONNECT ke `app.meagency.co.id` **dan** `*.vercel.app`,
> dan MCP Vercel belum terotorisasi di sesi ini. Semua klaim di §1 dibuktikan dari **kode**,
> bukan dari probe live.

---

## 1. Kenapa domain baru nyaris tidak butuh setup — topologinya sudah benar

```
Browser staff ─── HTTPS ──▶ https://app.meagency.co.id        (Vercel: web-internal-mea)
                             │
                             │  Next rewrite, SERVER-SIDE (next.config.ts)
                             ▼
                            BACKEND_URL  →  agency-app-api    (Vercel: apps/api)
                             │
                             ▼
                            Supabase CDPS SG (Postgres + GoTrue)
```

**Browser hanya pernah bicara ke satu origin: `app.meagency.co.id`.** Hop ke `apps/api`
terjadi di server. Konsekuensinya, tiga hal yang biasanya jadi PR saat ganti domain
**tidak berlaku di sini**:

| Yang biasanya perlu diurus | Di CDPS | Bukti di kode |
|---|---|---|
| **CORS / allowed origins** | ❌ **tidak perlu** — tidak ada satu pun request cross-origin dari halaman. Semua client di `web-internal/src/lib/*` memanggil path **relatif** `/api/v1/...` (`const API_BASE = '/api/v1'`). `apps/api` memang tidak punya handler CORS sama sekali, dan itu benar. | `web-internal/src/lib/api.ts`, `clients.ts`, `marketing.ts`; `next.config.ts` `rewrites()` |
| **Cookie domain** | ❌ **tidak perlu** — cookie sesi diserialisasi **tanpa atribut `Domain`**, jadi ia host-only dan otomatis menempel ke hostname apa pun yang dipakai browser. Ganti domain = cookie ikut, nol perubahan. `HttpOnly; SameSite=Lax; Secure` (produksi) tetap benar karena FE dan API satu origin dari sudut pandang browser. | `apps/api/src/lib/auth.ts` → `sessionCookie()` / `clearedSessionCookie()`, cookie `cdps_access_token` |
| **Supabase Auth: Site URL + Redirect URL allow-list** | ❌ **tidak perlu untuk login** — browser **tidak pernah** menyentuh GoTrue. Login = `POST /api/v1/auth/login` → server tukar email+password lewat `token?grant_type=password` → server kirim cookie. Tidak ada flow berbasis redirect (magic link, OAuth, recovery email) yang dipakai. | `apps/api/src/lib/gotrue.ts` (`passwordGrant`), `apps/api/src/app/api/v1/auth/login/route.ts` |

Dicek juga dan **nihil**: tidak ada satu pun tempat di `apps/api`, `packages/domain`, atau
`packages/core` yang membangun URL absolut (tidak ada `PUBLIC_URL`/`SITE_URL`/`APP_URL`/
`VERCEL_URL`), dan belum ada fitur yang mengirim tautan ke luar (portal klien M15 belum
dibangun). Jadi tidak ada tautan lama yang perlu ditulis ulang.

> ⚠️ **Invarian yang harus dijaga ke depan:** begitu ada kode FE yang memanggil API dengan
> **URL absolut**, dua sifat di atas patah sekaligus — request jadi cross-origin (butuh CORS)
> **dan** cookie host-only berhenti terkirim. Gejalanya: semua halaman 401 padahal login
> sukses. Aturannya: **FE selalu memanggil path relatif.** Komentar penjaga sudah ditanam di
> `web-internal/next.config.ts`.

---

## 2. Celah nyata yang diperbaiki di commit ini

`next.config.ts` hanya memproksi `/api/v1/:path*`. Liveness probe `apps/api` ada di
`/api/healthz` — **di luar** pola itu — sehingga `https://app.meagency.co.id/api/healthz`
jatuh ke Next FE dan menjawab **404**, bukan status API.

Ditambahkan rewrite kedua untuk `/api/healthz`. Aman: `web-internal` tidak punya route
`/api/*` milik sendiri (`web-internal/src/app/api` tidak ada), jadi tidak ada yang tertutup.

Efeknya: uptime monitor bisa diarahkan ke **domain yang benar-benar dipakai staff** dan
sekali jalan menguji rantai FE server → proxy → API:

```bash
curl -s https://app.meagency.co.id/api/healthz     # ⇒ {"status":"ok","service":"cdps-api"}
```

Kalau ini `200` tapi UI tetap kosong, masalahnya di Supabase/DB, bukan di domain/proxy.
Kalau ini `404`, `BACKEND_URL` salah sasaran (lihat §3.1).

---

## 3. Yang HANYA bisa dikerjakan pemilik (dashboard) — checklist

Empat hal. Nomor 1 dan 2 wajib dicek; 3 dan 4 pilihan.

### 3.1 ✅ WAJIB — `BACKEND_URL` pada project Vercel `web-internal-mea`

Domain kustom hanya mengubah **pintu masuk**; ia tidak mengubah ke mana FE memproksi.
Pastikan `BACKEND_URL` = URL deployment `apps/api` untuk environment **Production**.

Kalau `BACKEND_URL` tidak di-set, kode jatuh ke fallback hardcode
`https://agency-app-api.vercel.app`. Itu kebetulan benar hari ini, jadi produksi tetap
jalan — tapi jangan bersandar padanya: begitu project API di-rename atau dipindah, seluruh
UI mati tanpa satu pun error build. **Set eksplisit.**

> 📌 Utang lama yang masih terbuka dan relevan di sini: `BACKEND_URL` **tidak** di-set untuk
> environment **Preview** (`HANDOFF_CUTOVER_SESI6` §6, diulang di SESI7). Preview FE karena itu
> tidak bisa dipercaya untuk QA. Sekalian set saat membuka halaman env-nya.

### 3.2 ✅ WAJIB — Deployment Protection pada `web-internal-mea` harus MATI untuk Production

Kalau *Vercel Authentication* aktif untuk Production, `app.meagency.co.id` menyambut staff
dengan halaman challenge Vercel, bukan halaman login CDPS — dan itu **tidak bisa dilewati**
akun MEA biasa (butuh akun tim Vercel). Gejalanya mudah disalahartikan sebagai "domain belum
propagasi".

Vercel → Project `web-internal-mea` → Settings → Deployment Protection:
- **Production: OFF** (staff harus bisa masuk tanpa akun Vercel)
- Preview: boleh tetap ON

Catatan: proteksi pada project **`agency-app-api`** adalah cerita berbeda dan **boleh tetap
ON** — browser tidak pernah memanggilnya langsung. Tapi kalau ON, skrip smoke C-03 butuh
`BYPASS` (lihat `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` §2), dan proxy FE→API tetap jalan hanya
bila proteksinya tidak memblokir server-to-server; bila UI 401/404 seragam sesudah §3.1 benar,
matikan proteksi API untuk Production.

### 3.3 ⚪ OPSIONAL — Supabase Auth "Site URL"

Secara fungsional tidak dipakai (§1). Tetap disarankan diisi
`https://app.meagency.co.id` sebagai **hygiene**: begitu suatu hari ada flow berbasis email
(recovery mandiri, invite portal klien M15), Site URL yang masih menunjuk hostname lama akan
mengirim staff ke tautan mati. Mengisinya sekarang gratis dan tidak mengubah perilaku login.

Supabase Dashboard → project **CDPS SG** → Authentication → URL Configuration.
(Tidak bisa lewat MCP: tool Supabase yang tersedia di sesi ini tidak mencakup auth config.)

### 3.4 ⚪ OPSIONAL — hostname lama

`web-internal-mea.vercel.app` tetap hidup dan tetap melayani aplikasi yang sama. Tidak
berbahaya, tapi dua hostname untuk satu aplikasi = bookmark bercabang. Pilihan:
set `app.meagency.co.id` sebagai domain utama di Vercel (redirect otomatis dari yang lain),
lalu umumkan satu URL saja ke tim.

`agency-app-api.vercel.app` **jangan** diberi domain kustom kecuali ada kebutuhan nyata —
tidak ada konsumen di luar proxy FE, dan menambah hostname publik hanya memperluas permukaan
serang endpoint login.

---

## 4. Verifikasi (jalankan dari mesin ber-internet)

Claude tidak bisa menjalankan blok ini — CONNECT ke `app.meagency.co.id` dijawab `403` oleh
gateway sandbox.

```bash
# 1. FE hidup di domain utama
curl -sS -o /dev/null -w '%{http_code}\n' https://app.meagency.co.id/
#   ⇒ 200. CATATAN: jangan harap redirect 3xx ke /login di sini — gerbang auth-nya
#   client-side (`(shell)/layout.tsx` → router.replace('/login')), jadi curl WAJAR
#   melihat 200 di `/`. Redirect ke login hanya terlihat di browser.

# 2. Proxy tembus ke API (butuh §2 sudah ter-deploy)
curl -sS https://app.meagency.co.id/api/healthz
#   ⇒ {"status":"ok","service":"cdps-api"}

# 3. Login end-to-end + cookie ter-set untuk domain yang BENAR
curl -sS -i -X POST https://app.meagency.co.id/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<email>","password":"<password>"}' | grep -i 'set-cookie\|HTTP/'
#   ⇒ HTTP 200 + Set-Cookie: cdps_access_token=…; Path=/; HttpOnly; SameSite=Lax; Secure
#   ⇒ TIDAK boleh ada atribut Domain= (host-only itu memang yang kita mau)

# 4. Cookie diterima balik oleh rute terproteksi
curl -sS -c /tmp/c.txt -X POST https://app.meagency.co.id/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"<email>","password":"<password>"}' >/dev/null
curl -sS -b /tmp/c.txt https://app.meagency.co.id/api/v1/me
#   ⇒ profil aktor + klaim role, BUKAN 401
```

Kalau langkah 4 menjawab `401` padahal langkah 3 `200`: itu tanda ada pemanggilan API dengan
URL absolut di FE, atau `BACKEND_URL` menunjuk deployment lain yang JWT secret-nya beda.

---

## 5. Di luar cakupan (sengaja)

- **Pembersihan config Railway** (`web-internal/railway.json` dll.) — bertiket **C-05**,
  tertahan di belakang C-04 + gate go/no-go manusia. Lihat entri `DECISIONS.md` 2026-08-07
  "PENEGASAN PLATFORM".
- **Default `BASE` di `.github/workflows/c03-deployment-uat.yml`** tetap
  `https://agency-app-api.vercel.app` — benar apa adanya: skrip C-03 menguji **API** langsung,
  bukan lewat proxy FE, jadi ia harus menembak hostname API.
- **`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` di project `web-internal-mea`** — didaftarkan di
  `WAVE1_STAGING_DEPLOY_RUNBOOK.md` §4, tapi `web-internal` tidak memakai `supabase-js`
  sama sekali (nol referensi di `web-internal/src`). Sisa vestigial, tidak berbahaya;
  jangan dihapus tanpa memastikan tidak ada build yang membacanya.
