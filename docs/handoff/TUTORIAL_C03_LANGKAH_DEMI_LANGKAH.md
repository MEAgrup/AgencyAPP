# TUTORIAL C-03 — langkah demi langkah, untuk yang menjalankannya sendiri

> **Bedanya dengan `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`:** runbook itu menjelaskan **apa** yang
> ditutup dan **kenapa**. Berkas ini menjelaskan **cara mengetiknya**, termasuk dari mana mengambil
> secret dan cara tahu lebih dulu kalau secret-nya salah. Kalau Anda sudah terbiasa, pakai runbook.
>
> **Waktu:** ~20 menit kalau lancar. **Yang dibutuhkan:** laptop dengan internet, akses dashboard
> **Vercel**, dan akses repo.

---

## Langkah 0 — Prasyarat (sekali saja)

| Butuh | Cek | Kalau belum ada |
|---|---|---|
| **Node.js 20+** | `node -v` | pasang dari nodejs.org (versi LTS) |
| **git** | `git --version` | pasang dari git-scm.com |
| **Repo** | `cd AgencyAPP` | `git clone <url-repo> && cd AgencyAPP` |

Ambil kode terbaru dan pasang dependensi:

```bash
git checkout main
git pull origin main
npm ci
```

> ⚠️ **`npm ci` HARUS dari folder ROOT repo** (`AgencyAPP/`), **bukan** dari dalam `apps/api/`.
> Ini aturan rumah #6 — menjalankannya dari subfolder memasang dependensi yang salah dan skripnya
> gagal dengan error yang menyesatkan.

---

## Langkah 1 — Ambil dua nilai yang dibutuhkan

### 1a. `BASE` — alamat deployment

```
https://agency-app-api.vercel.app
```

**Tanpa garis miring di akhir.** Kalau alias produksinya sudah berganti, ambil dari Vercel →
project `agency-app-api` → tab **Deployments** → deployment `Production` → **Domains**.

### 1b. `SUPABASE_JWT_SECRET` — ini bagian yang paling sering salah

Skrip menandatangani token JWT (HS256) yang harus bisa **diverifikasi oleh API yang ter-deploy**.
Jadi yang benar adalah nilai yang **dipakai deployment itu**, bukan yang kelihatan mirip.

**Ambil dari Vercel — ini sumber yang otoritatif:**

1. Buka https://vercel.com → tim **MEA** → project **`agency-app-api`**
2. **Settings** → **Environment Variables**
3. Cari baris **`SUPABASE_JWT_SECRET`**
4. Klik ikon mata / menu **⋯ → Edit** untuk memunculkan nilainya, lalu **salin utuh**

> **Kenapa dari Vercel, bukan dari Supabase?** Karena yang menentukan lolos-tidaknya adalah apa
> yang dipakai API **untuk memverifikasi**. Kalau suatu saat nilai di Vercel dan di Supabase
> berbeda, nilai Vercel yang menang. Mengambil dari Supabase adalah tebakan yang biasanya benar —
> "biasanya" tidak cukup di sini.
>
> *(Sebagai rujukan saja, di Supabase letaknya: project **CDPS SG** → **Project Settings** → **API**
> → **JWT Settings** → **JWT Secret**. Pakai ini HANYA kalau baris di Vercel tidak bisa dibuka.)*

**Jangan** menempel secret ini ke chat, tiket, atau commit. Ia cuma hidup di terminal Anda.

### 1c. `BYPASS` — **tidak perlu diisi**

Diukur 2026-07-30: alias produksi **tidak ber-proteksi**. `GET /api/healthz` menjawab `200`
`{"status":"ok","service":"cdps-api"}`, bukan halaman challenge. Jadi biarkan kosong.

Kalau suatu saat proteksi dinyalakan, gejalanya khas: **semua** baris FAIL sekaligus seolah semua
path hilang. Saat itu barulah isi `BYPASS` dari Vercel → Settings → **Deployment Protection** →
*Protection Bypass for Automation*.

---

## Langkah 2 — Pasang variabel di terminal

Buka terminal di folder `AgencyAPP`, lalu (ganti `<...>` dengan nilai asli):

**macOS / Linux:**
```bash
export BASE=https://agency-app-api.vercel.app
export SUPABASE_JWT_SECRET='<tempel-secret-di-sini>'
```

**Windows PowerShell:**
```powershell
$env:BASE = "https://agency-app-api.vercel.app"
$env:SUPABASE_JWT_SECRET = "<tempel-secret-di-sini>"
```

> Pakai **kutip tunggal** di macOS/Linux. Secret sering memuat karakter seperti `$` atau `&` yang
> akan diterjemahkan shell kalau tidak dikutip — dan hasilnya secret yang diam-diam berbeda.

**Variabel ini hilang saat terminal ditutup.** Kalau Anda tutup terminal, ulangi langkah 2.

---

## Langkah 3 — Cek 30 detik: apakah secret-nya benar?

**Jangan lewati langkah ini.** Secret yang salah membuat SEMUA cek gagal dengan cara yang terbaca
seperti "aplikasinya rusak", dan Anda akan menghabiskan waktu mencari bug yang tidak ada.

```bash
node -e "
import('./apps/api/scripts/lib/actors.mjs').then(async (m) => {
  const r = await m.discoverRoster({ base: process.env.BASE, secret: process.env.SUPABASE_JWT_SECRET });
  console.log(r.ok ? '✅ SECRET BENAR — roster terbaca: ' + r.roster.length + ' karyawan aktif'
                   : '🔴 GAGAL: ' + r.note);
});"
```

| Hasil | Artinya | Tindakan |
|---|---|---|
| `✅ SECRET BENAR — roster terbaca: 69 karyawan aktif` | siap | lanjut Langkah 4 |
| `🔴 GAGAL: … HTTP 401 …` | **secret salah** | ulangi 1b — salin ulang dari Vercel, hati-hati spasi di ujung |
| `🔴 GAGAL: … HTTP 404 …` | `BASE` salah | cek alamatnya, jangan ada `/` di akhir |
| `🔴 GAGAL: network: …` | tidak ada internet / DNS | cek koneksi |

> Angka **69** adalah yang diharapkan hari ini. Kalau muncul angka yang sangat berbeda (mis. 10),
> berarti Anda menunjuk environment lain — **berhenti**, jangan lanjut.

---

## Langkah 4 — Keputusan sebelum menjalankan: walk MENULIS ke produksi

`cutover-houserules-walk.mjs` **tidak read-only**. Setiap kali dijalankan ia membuat:

- **2 lead** bernama **`ZZC03 …`** (+ 1 percobaan prospect)
- **baris `audit_log`** yang mengikutinya

Baris audit itu **append-only** — tidak ada jalur hapus, dan itu memang desainnya (aturan rumah #3).
Jadi jejaknya **permanen**.

Konteksnya supaya proporsional: live saat ini **3 lead, 0 client, 0 transaksi**. Menambah 2 lead
uji berlabel jelas dampaknya kecil, dan lead-nya sendiri bisa Anda tandai/abaikan belakangan.

**Putuskan sekarang, salah satu:**

- **Terima** — jalankan seperti di bawah. Ini yang normal.
- **Tidak mau ada `ZZC03` di produksi** — jalankan ketiga skrip terhadap **preview/staging** yang
  menunjuk DB mirip-produksi, **bukan** `CDPS SG` live. Konsekuensinya: hasilnya tidak sepenuhnya
  menutup SKIP-1, karena yang diuji bukan produksi.

---

## Langkah 5 — Jalankan ketiga skrip

Satu per satu, **jangan diborong**. Setiap perintah dari folder root repo.

```bash
node apps/api/scripts/cutover-houserules-walk.mjs
```
🎯 target: **22/22** — ini yang menutup **SKIP-1**

```bash
node apps/api/scripts/wave3-contract-smoke.mjs
```
🎯 target: **34/34**

```bash
node apps/api/scripts/auth-smoke.mjs
```
🎯 target: **13/13** — ini yang menutup **SKIP-3**

**Simpan seluruh output ketiganya.** Cara termudah, sekalian tampil di layar:

```bash
node apps/api/scripts/cutover-houserules-walk.mjs 2>&1 | tee /tmp/c03-walk.txt
node apps/api/scripts/wave3-contract-smoke.mjs    2>&1 | tee /tmp/c03-wave3.txt
node apps/api/scripts/auth-smoke.mjs              2>&1 | tee /tmp/c03-auth.txt
```

> **Windows PowerShell:** ganti `2>&1 | tee /tmp/xxx.txt` dengan
> `2>&1 | Tee-Object -FilePath c03-walk.txt` (dan seterusnya).

---

## Langkah 6 — Cara membaca hasilnya

### 6a. Blok `aktor terpakai` — ini bukti, bukan hiasan

Setiap skrip mencetak dari mana identitas aktornya berasal, **sebelum** cek pertama:

```
BASE=https://agency-app-api.vercel.app
  note: discovery: 69 karyawan aktif, 39 role_mapping
aktor terpakai:
  sales_staff    2110040032   Sales/staff        [role-match]
  director       200000001    …      +director   [layered:director]
  od             …            …      +od         [synthetic, klaim sintetis]
```

| Tanda | Arti |
|---|---|
| `discovery: N karyawan aktif` | ✅ roster terbaca dari deployment — **N harus ≈ 69** |
| `role-match` / `layered:director` | ✅ aktornya memang punya role itu |
| `klaim sintetis` | sah untuk menguji gate, **tapi tulis apa adanya di report** — jangan menyiratkan Director resmi yang menjalankannya |
| `discovery gagal … fallback` | 🔴 **BERHENTI.** Hasilnya tidak sah. Kembali ke Langkah 3 |

### 6b. Angka akhir

Yang dicari: **22/22 · 34/34 · 13/13**, dan **FAIL = 0 TANPA SKIP**.

### 6c. Kalau ada yang FAIL

**Jangan memperbaiki dengan mengubah policy RLS.** Semua policy yang tersentuh C-03 sudah
diverifikasi di lapisan DB; kegagalan di sini hampir pasti **auth / klaim / route**.

Kirimkan saja isi ketiga berkas `/tmp/c03-*.txt` apa adanya — diagnosis bisa dilakukan dari situ
tanpa akses Vercel.

---

## Langkah 7 — QA manual di browser (menutup SKIP-2)

Login ke `web-internal` yang ter-deploy sebagai role sungguhan, lalu centang:

- [ ] **Badge notifikasi** — jumlah unread muncul → klik → tandai terbaca → jumlah turun → refresh tetap konsisten
- [ ] **`/master-services`** — 32 layanan ber-versi tampil, harga ter-render `Rp. X.XXX.XXX,00`
- [ ] **`/sales/kalkulator`** — pilih layanan → total & komisi ter-render, **tanpa error 500**

> Yang ketiga paling penting diperhatikan: dulu halaman ini 500 karena bigint mentah lewat wire
> (C03-F2). Kalau ia kembali, itu regresi paling mahal di daftar ini.

### Bonus, kalau sempat — membuktikan arm RLS menyala lewat aplikasi

Minta **Head of Sales `2101180004`** login dan membuka halaman riwayat/audit:

| Yang terlihat | Artinya |
|---|---|
| **36** entri | ✅ arm lead/divisi menyala end-to-end |
| tepat **32** | 🔴 arm tidak menyala di jalur aplikasi — periksa `trg_sync_claims_mapping`, **bukan** policy |
| **0** | 🔴 masalah auth/route, bukan RLS |

**Jangan pakai Head of Account `2305100275`** — divisi Account punya 0 entri audit, jadi hasilnya
`0` baik arm menyala maupun mati. Ia tidak membedakan apa pun.

---

## Langkah 8 — Tutup C-03

1. Buat report baru: `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md`
   - tempel **blok `aktor terpakai`** ketiga skrip (provenance = syarat reproducible)
   - DoD: **FAIL = 0 TANPA SKIP**
   - ⚠️ **jangan menyunting report `20260728`** — itu bukti historis
2. `docs/backlog/CUTOVER_BACKLOG.md` §2: C-03 `[~]` → `[x]`

Sesudah itu C-03 tertutup, dan gate GO tinggal menunggu **O50** (10 akun fixture) + **backup MySQL
Railway** + **rencana rollback**.

---

## Ringkasan satu layar

```bash
cd AgencyAPP && git checkout main && git pull origin main && npm ci

export BASE=https://agency-app-api.vercel.app
export SUPABASE_JWT_SECRET='<dari Vercel → Settings → Environment Variables>'
# BYPASS tidak perlu — alias produksi tidak ber-proteksi (diukur 2026-07-30)

# cek secret dulu — 30 detik, hemat berjam-jam
node -e "import('./apps/api/scripts/lib/actors.mjs').then(async m=>{const r=await m.discoverRoster({base:process.env.BASE,secret:process.env.SUPABASE_JWT_SECRET});console.log(r.ok?'✅ '+r.roster.length+' karyawan':'🔴 '+r.note)})"

node apps/api/scripts/cutover-houserules-walk.mjs 2>&1 | tee /tmp/c03-walk.txt    # 22/22
node apps/api/scripts/wave3-contract-smoke.mjs    2>&1 | tee /tmp/c03-wave3.txt   # 34/34
node apps/api/scripts/auth-smoke.mjs              2>&1 | tee /tmp/c03-auth.txt    # 13/13
```
