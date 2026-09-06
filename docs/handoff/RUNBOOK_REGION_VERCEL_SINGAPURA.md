# RUNBOOK — memindahkan region app Vercel ke Singapura (`sin1`)

> Dibuat 2026-09-06, dari keluhan nyata tim ("banyak yg mengeluh") pada CDPS yang
> masih fase testing. Ditulis supaya **bisa dijalankan siapa pun**, termasuk yang
> tidak menyentuh kode.
>
> **Sisi kodenya SUDAH dikerjakan** (PR #299): `web-internal/vercel.json` dan
> `web-client-portal/vercel.json` kini memin `sin1`, sejajar `apps/api` yang
> sudah lebih dulu dipin pada 2026-09-04. Runbook ini untuk **(a)** memverifikasi
> bahwa pin itu benar-benar berlaku di produksi, **(b)** memperbaikinya lewat
> dashboard kalau ternyata tidak, dan **(c)** dipakai ulang kalau kelak ada app
> Vercel baru.

---

## 1. Kenapa ini penting — dalam satu gambar

Data CDPS ada di Supabase **Singapura**. Penggunanya di **Indonesia**. Tapi
`web-internal` meneruskan **seluruh** panggilan `/api/v1/*` ke `apps/api` lewat
*rewrite* (`web-internal/next.config.ts`). Jadi kalau `web-internal` berjalan di
region default Vercel (`iad1`, Washington DC), tiap panggilan API menempuh:

```
browser (Indonesia)
   └─▶ web-internal   (iad1 · Washington DC)      ← rewrite /api/v1/*
          └─▶ apps/api      (sin1 · Singapura)
                 └─▶ Supabase   (Singapura)
```

Menyeberangi Pasifik **dua kali** untuk mengambil baris yang — diukur langsung
di live 2026-09-06 — butuh **0,152 ms** (daftar notifikasi) sampai **1,876 ms**
(daftar klien lengkap dengan seluruh sembilan aturan izin RLS).

Dan satu kali buka halaman memuat **~11 panggilan** seperti itu; terbaca di log
runtime produksi sebagai satu ledakan request dalam dua detik yang sama.

Sesudah ketiganya di `sin1`, jalurnya menjadi Indonesia → Singapura → Singapura,
tanpa satu pun lintasan benua.

> ⚠️ **Batas klaim yang jujur.** Besar perbaikannya **belum diukur** — sesi yang
> menulis ini tidak bisa mencapai `*.vercel.app` (diblokir egress proxy), jadi
> nol pengukuran ujung-ke-ujung. Yang **terbukti**: database bukan hambatan, dan
> region antar app memang berbeda. Langkah §4 di bawah adalah cara membuktikan
> sisanya, dan ia butuh 30 detik.

---

## 2. Cara yang dipakai repo ini: `vercel.json` (sudah dikerjakan)

Region dikunci **di dalam repo**, bukan di dashboard. Alasannya: setelan
dashboard tidak terlihat di code review, tidak ikut ter-*rollback* saat revert,
dan tidak ada yang tahu kapan berubah.

Isi ketiga berkasnya — `apps/api/vercel.json`, `web-internal/vercel.json`,
`web-client-portal/vercel.json` — memuat baris yang sama:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"]
}
```

`sin1` = Singapore. Daftar lengkap kode region ada di dokumentasi Vercel
("Regions"); yang relevan di sini hanya dua: `sin1` (Singapura, benar) dan
`iad1` (Washington DC, **default kalau tidak diisi**).

**Kapan berlaku:** pada **deployment produksi berikutnya**, bukan seketika saat
berkasnya di-merge. Jadi setelah PR #299 merge, tunggu deploy `main` selesai
sebelum menguji §4.

**Penjaganya:** `apps/api/src/lib/region-parity.test.ts` — CI merah kalau salah
satu berkas hilang atau region-nya berbeda antar app. Dibuat karena region
adalah setelan yang **tidak terlihat di mana pun saat rusak**: nol galat, nol log
merah, nol tes gagal — aplikasinya hanya terasa lambat, dan "terasa lambat"
tidak pernah sampai ke backlog sebagai bug.

---

## 3. Kalau perlu lewat dashboard Vercel

Dipakai hanya untuk **memeriksa**, atau untuk app baru yang belum punya
`vercel.json`. Kalau `vercel.json` ada, ia yang menang — jadi mengubah dashboard
saja tidak akan mengubah apa pun pada ketiga app CDPS.

1. Buka <https://vercel.com> → login → pilih tim **MEA** (`meagency`).
2. Pilih project yang mau diperiksa:
   - `web-internal-mea` → berkasnya `web-internal/`
   - `agency-app-api` → berkasnya `apps/api/`
   - `web-client-portal` → berkasnya `web-client-portal/`
3. Buka tab **Settings**.
4. Di menu kiri, pilih bagian **Functions**.
5. Cari setelan region fungsi (namanya **Function Region**, kadang di bawah
   judul *Advanced*). Nilainya harus **Singapore, Southeast Asia (sin1)**.
6. Kalau berbeda dan project itu **tidak** punya `vercel.json`: ubah di sini,
   **Save**, lalu **redeploy** — setelan region tidak berlaku surut ke deployment
   yang sudah jadi.
7. Kalau project itu **punya** `vercel.json`: jangan ubah di dashboard. Perbaiki
   berkasnya lewat PR supaya perubahannya tercatat dan terjaga tes.

> **Redeploy:** tab **Deployments** → deployment produksi teratas → menu `⋯` →
> **Redeploy**. Centang *"Use existing Build Cache"* boleh, region tetap ikut
> yang baru.

---

## 4. Verifikasi — 30 detik, dan ini yang membuktikan hipotesisnya

Yang dibaca adalah header respons **`x-vercel-id`**. Ia menyebut PoP/region yang
benar-benar melayani request, jadi ia mengalahkan tebakan apa pun.

1. Buka CDPS di Chrome seperti biasa, lalu **login**.
2. Tekan **F12** (atau klik kanan → *Inspect*).
3. Pilih tab **Network**.
4. **Refresh** halamannya (F5) supaya requestnya terekam.
5. Di kolom filter, ketik `api/v1` supaya sisanya tersaring.
6. Klik salah satu baris yang muncul, misalnya `notifications`.
7. Pilih tab **Headers** → gulir ke bagian **Response Headers**.
8. Cari baris **`x-vercel-id`**.

**Cara membacanya:**

| Isi `x-vercel-id` | Artinya |
|---|---|
| memuat `sin1` | ✅ Sudah benar — melayani dari Singapura |
| memuat `iad1` | ❌ Masih Washington DC — region belum berlaku, ulangi §3 lalu redeploy |
| memuat keduanya, mis. `sin1::iad1::…` | Request masuk lewat PoP Singapura tapi **fungsinya** jalan di Washington DC — inilah kasus yang runbook ini perbaiki |

Bagian sebelum `::` adalah PoP tempat request masuk (mengikuti lokasi pengguna,
selalu dekat). Yang menentukan kecepatan adalah bagian yang menyebut **region
fungsi** — itu yang harus `sin1`.

**Sekalian ukur sebelum/sesudah**, karena angka lebih meyakinkan daripada
perasaan: di tab Network, kolom **Time** pada baris `/api/v1/*` menunjukkan
lama tiap panggilan. Catat satu angka sebelum redeploy dan satu sesudahnya, pada
halaman yang sama dan kondisi jaringan yang sama.

---

## 5. Yang SUDAH dicoba dan sengaja TIDAK dikerjakan

Supaya sesi berikutnya tidak menggali ulang jalan buntu yang sama.

**Tiket P2.5 — "pangkas round-trip `withClaims`"** (`docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`).
Awalnya diduga inilah penyebab lambatnya. **Bukan.** Ia memangkas 2 round-trip
di dalam region (±1 ms masing-masing), sementara masalahnya lintasan benua yang
ratusan milidetik — dan harganya menyentuh mekanisme yang menegakkan RLS di
**setiap** pembacaan. Untung ~2 ms, risiko klaim satu pengguna bocor ke request
pengguna lain.

Syarat membukanya kembali, tulis eksplisit supaya tidak dibuka karena firasat:
region sudah terbukti `sin1` di §4 **dan** tim masih mengeluh **dan** ada
pengukuran baru yang menunjuk round-trip DB sebagai biaya terbesarnya.

---

## 6. Kalau kelak ada app Vercel keempat

1. Buat `vercel.json` di root folder app itu dengan isi §2.
2. Tambahkan nama foldernya ke `APPS` di
   `apps/api/src/lib/region-parity.test.ts`.
3. Jalankan `npm run test -w @cdps/api` — harus hijau.

Langkah 2 bukan formalitas: tes itu memaku **ketiganya di region yang SAMA**,
karena yang salah pada 2026-09-06 bukan satu app melainkan **pasangannya** —
`apps/api` sudah benar sendirian selama dua hari, dan justru itu yang membuat
masalahnya tak terlihat.
