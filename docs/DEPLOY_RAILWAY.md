# Railway — sedang didekomisi (jangan deploy apa pun ke sini)

> ## ⛔ DOKUMEN INI DULU BERISI PANDUAN SETUP. PANDUANNYA SUDAH DICABUT.
>
> Versi lama menyuruh membuat tiga service Railway (**backend Go**, **MySQL**,
> **web-internal**) dan mengisi `BACKEND_URL` frontend dengan URL backend Go.
> Mengikutinya hari ini berarti **membangun ulang stack yang sudah dipensiunkan**
> — dan itu bukan hipotetis: topologi persis itu masih hidup di Railway sekarang,
> dan itulah sebab kegagalan QA 2026-08-03 (lihat §3).
>
> Stack produksi CDPS adalah **TypeScript + Supabase di Vercel** (`CLAUDE.md`
> §Stack, `DECISIONS.md` 2026-07-29 "Pensiun Go"). Railway **dimatikan** —
> pekerjaannya adalah **C-05** di `docs/backlog/CUTOVER_BACKLOG.md`.

---

## 1. Topologi yang berlaku

| Komponen | Di mana | Catatan |
|---|---|---|
| **API** (`apps/api`) | Vercel, project `agency-app-api` | `https://agency-app-api.vercel.app` |
| **Frontend internal** (`web-internal`) | Vercel, project `web-internal-mea` | memproksi `/api/v1/*` → API di atas |
| **Database** | Supabase, project **`CDPS SG`** | migrasi HANYA lewat `supabase/migrations/**` |

`web-internal/next.config.ts` memproksi `/api/v1/*` ke `BACKEND_URL`; bila tak
di-set, produksi jatuh ke `https://agency-app-api.vercel.app`. **Nilai yang
menunjuk ke host Railway atau port `:8080` MENGGAGALKAN BUILD** —
`web-internal/src/lib/backend-url.ts`, dengan pelarian `ALLOW_LEGACY_BACKEND_URL=1`
untuk yang memang sengaja. Build yang gagal tidak menjatuhkan deployment yang
sedang berjalan; ia hanya mencegah deployment rusak yang baru.

---

## 2. Yang MASIH hidup di Railway (per 2026-08-03)

| Service Railway | Isi | Nasib |
|---|---|---|
| `backend` | server Go (`backend/Dockerfile`) | mati bersama Railway |
| `MySQL` | DB Go | mati; backup terverifikasi 4 lapis ada di tangan pemilik |
| `web-internal` | frontend Next, domain `agencyapp-frontend-production.up.railway.app` | ⚠️ **ini yang dipakai orang** — §3 |

**Data di dalamnya tidak berharga, dan itu terukur.** OQ-2 2026-07-31
(`docs/handoff/BACKUP_MYSQL_RAILWAY_REPORT_20260731.md`): 50 tabel, **239 baris
total**, seluruh rantai jalur uang `CLIENT → SERVICE → TRX → INST` **nol baris**.
Sisanya seed migrasi + artefak masa pengembangan yang sudah digantikan Supabase
(`employees` 65 di Railway vs 69 di Supabase; `master_services` **1** vs **32**).
Beberapa lead/attempt QA bertambah sesudah tanggal itu — tetap data percobaan.

---

## 3. ⚠️ Yang TIDAK terukur oleh OQ-2: siapa membuka apa

OQ-2 mengaudit **database**, bukan **browser**. Yang belum pernah tercatat di
mana pun sampai 2026-08-03:

- Frontend yang tim benar-benar buka adalah **`agencyapp-frontend-production.up.railway.app`**,
  dan `BACKEND_URL`-nya menunjuk ke **backend Go**. Semua yang diketik di sana
  masuk ke **MySQL Railway**, bukan Supabase.
- Stack TS/Supabase **belum dipakai siapa pun**: `auth.users` 65 akun, hanya
  **2 yang pernah login**, login terakhir **2026-07-28** — keduanya probe UAT
  C-03, bukan manusia bekerja.

**Konsekuensinya untuk hari switch-off:** risikonya bukan kehilangan data,
melainkan tim kehilangan satu-satunya URL yang mereka pakai — dan pindah ke URL
Vercel yang belum pernah dicoba siapa pun. Itu wajib diselesaikan **sebelum**
Railway dimatikan, bukan sesudahnya.

---

## 4. Checklist sebelum switch-off

Urutannya penting. Butir 1–3 memindahkan orang; butir 4 baru mematikan mesin.

1. **Verifikasi frontend Vercel bisa dipakai** — buka `web-internal-mea`, login
   dengan akun karyawan sungguhan, jalankan satu alur penuh: register lead →
   Contacted → Qualified Lead Form → submit. Ini pertama kalinya jalur itu
   dipakai manusia di stack baru; jangan asumsikan hijau karena UAT hijau.
2. **Umumkan URL barunya** dan pastikan bookmark/pintasan tim diganti. Kalau
   domainnya mau tetap sama, pasang custom domain di Vercel **sebelum** Railway
   mati, jangan sesudah.
3. **Jangan salin data QA Railway ke Supabase.** Rantai jalur uangnya nol dan
   pemilik sudah menyatakan lead/attempt yang ada hanya percobaan
   (report OQ-2 §4). Yang perlu ada di Supabase — 32 layanan MSL, 65 karyawan,
   role mapping — sudah ada di sana.
4. **Matikan service Railway** (manual, pemilik — Claude tak punya akses), lalu
   kerjakan sisa **C-05**: hapus job `backend` dari CI, arsipkan `backend/`
   dengan tag, hapus secret `RAILWAY_MYSQL_URL` & `RAILWAY_BACKUP_PASSPHRASE`
   (**passphrase paling belakangan** — tanpanya berkas backup tak bisa dibuka).

### Interim, kalau frontend Railway perlu tetap hidup sebentar

Set `BACKEND_URL` service `web-internal` di Railway ke
`https://agency-app-api.vercel.app`. Frontend Railway lalu membaca/menulis ke
Supabase, dan service `backend` + `MySQL` bisa dimatikan lebih dulu tanpa
menunggu orangnya pindah. Setelah itu URL Railway dan URL Vercel menampilkan
data yang sama.

---

## 5. Arsip — setup lama (JANGAN dijalankan)

<details><summary>Panduan tiga-service Railway, disimpan untuk jejak sejarah</summary>

Root Directory per service: `backend` (Dockerfile) · `web-internal` (Railpack) ·
MySQL (database Railway). Backend membaca `DATABASE_URL` = `${{MySQL.MYSQL_URL}}`,
mengauto-migrasi saat boot, healthcheck `GET /healthz`. Frontend mengisi
`BACKEND_URL` dengan URL publik backend, atau
`http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:8080` lewat private networking.

**Kenapa jangan dijalankan lagi:** `backend/` beku read-only sampai C-05
(`CLAUDE.md`), MySQL sudah tidak dipakai, dan `BACKEND_URL` semacam itu kini
menggagalkan build `web-internal` secara sengaja (§1).

</details>
