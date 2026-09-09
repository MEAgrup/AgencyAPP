# Handoff — Feedback tim Sales: **enam butir di `main` DAN di live. Satu setengah tersisa.**

> Baca `docs/DECISIONS.md` baris **2026-09-09** (paling atas) lebih dulu — di situ
> angka live dan cara memverifikasinya. Handoff ini tidak mengulanginya; ia
> mencatat apa yang BELUM selesai dan kenapa.

---

## 1 · Posisi

| | Status |
|---|---|
| PR #325 | ✅ **MERGED** (`4613ede`), 11/11 check hijau, nol review manusia |
| Empat migrasi FS | ✅ **DI LIVE** `CDPS SG` — urut nama, `apply_migration`, per berkas |
| Deploy produksi | ✅ `web-internal-mea` + `agency-app-api` di `4613ede` **READY** |
| Gate live | **150 tabel · 41 prefix · 33 mesin · 73 event** |
| Drift repo↔live | **nol MISSING**, satu EXTRA ter-allowlist (A2-DRIFT, milik jalur D-3) |

Enam butirnya: `#1` tombol WhatsApp · `#2` Owner tampil nama · `#3` prospek
bersama · `#4` jenis `bayar_komisi` · `#5` durasi kontrak di Client Record ·
`#6` opsi durasi MSL.

---

## 2 · Yang TERSISA

### 2.1 🔴 `#6` baru separuh — tenornya belum bisa DIJUAL

**Ini satu-satunya sisa yang substantif, dan ia layak dibaca sebelum yang lain.**

Yang mendarat adalah **sisi katalog**: Sales Head kini bisa menyatakan
1/3/6/12 bulan dengan harga berbeda pada SATU layanan. Yang **belum** ada
adalah jalan bagi tenor itu untuk sampai ke deal:

- `durasi_options` **berhenti di layar MSL**. Satu-satunya berkas `web-internal`
  yang menyentuhnya di luar `lib/msl.ts` adalah `master-services/page.tsx`.
  Nol pemilih tenor di kalkulator, Qualified Form, negosiasi, maupun
  `RenewalPanel`.
- **Nol kolom snapshot `durasi_bulan`** di `qualified_form_services` →
  `negotiation_proposal_lines` → `renewal_proposal_lines` → `services`.
  `services` hanya mem-`pin` `master_version_no`, jadi accrual membaca durasi
  **versi**, bukan tenor yang dipilih klien.

Akibatnya, karena invarian "opsi terpendek = harga & durasi versi",
`sales.deriveDuration` **selalu** mengambil paket terpendek. Untuk menjual
paket 12 bulan berdiskon, tim Sales **masih** harus memakai sembilan layanan
lama yang terpecah — yaitu keluhan aslinya.

> Ini bukan regresi dan bukan klaim yang meleset: entri `DECISIONS.md` FS-4
> tidak pernah menyatakan sisi deal-nya dibangun. Tapi butir `#6` belum
> menghasilkan efek yang diminta sampai bagian ini ada.

**Bentuk pekerjaan berikutnya** (sudah dipetakan, belum dikerjakan):

1. Kolom snapshot `durasi_bulan` (nullable) di empat tabel di atas.
   `NULL` = "pakai durasi versi" ⇒ perilaku hari ini, **backfill tidak perlu
   menebak apa pun**.
2. `deriveDuration` membaca snapshot lebih dulu, baru jatuh ke versi.
3. Pemilih tenor di kalkulator / QF / negosiasi / `RenewalPanel`.
4. Batas yang **diterima apa adanya**, dicatat supaya tidak ditemukan ulang
   sebagai "bug": `uq_qfs UNIQUE (attempt_id, master_service_id)`
   (`20260722055205:37`) berarti satu deal tidak bisa memuat layanan yang sama
   dengan DUA tenor berbeda. Itu memang tidak dibutuhkan.

⚠️ Ini menyentuh **jalur uang** (harga mengalir ke `services` → `transactions` →
mesin accrual Gelombang D). Layak jadi PR-nya sendiri, dengan tes uang lebih
dulu.

### 2.2 🟡 UAT di peramban — belum pernah dilakukan

Utang **B2**. Harness-nya kini **ada** (`scripts/dev-jwt.mjs`,
`scripts/browser-tour.mjs`, `scripts/seed-browser-tour.ts`, mendarat lewat
PR #324) — jadi ini bukan lagi "tidak ada alatnya", melainkan "belum
dijalankan".

Tiga layar pembuktinya, dan peran yang harus dipakai:

| Layar | Peran | Membuktikan |
|---|---|---|
| `/sales` — kolom Owner | **Head Sales** | `#2` — nama, bukan `EMP-…` |
| `/clients/{id}` — panel Kontrak | **Sales staff** | `#5` — nol 403, jendela kontrak tampil |
| `/master-services` — form MSL | **Sales Head** | `#6` — editor baris opsi |

Kolom Owner sebagai Head Sales adalah bukti utama: gejalanya **hanya** muncul
di layar itu, karena OD/Director lolos `jwt_can_read_all()` dan tidak pernah
melihat bug-nya.

### 2.3 🟢 Nit yang sudah ditutup

- Angka basi "147 → 148" di baris `DECISIONS.md` FS-4 — **dikoreksi** di baris
  2026-09-09 (angka sebenarnya 149 → 150). Baris aslinya sengaja tidak disunting.
- `m1.lead.co_pursuit` — notifikasi yang dipakai alur prospek bersama — **sudah
  punya label** (`web-internal/src/lib/notifications.ts:100`). Bukan sisa task.

### 2.4 Di luar cakupan enam butir ini

`web-internal/src/lib/notifications.ts` ketinggalan ±50 label event, termasuk
`m1.attempt.unrespon` yang menyasar sales staff. Celah lama, layak ditiketkan
sendiri — **jangan** digabung ke pekerjaan `#6`.

---

## 3 · Jebakan yang kena di sesi ini, supaya tidak kena lagi

1. **`web-internal` BUKAN workspace npm** (`workspaces` = `apps/*`, `packages/*`).
   `npm install` di akar tidak pernah memasang deps-nya — itulah sumber banjir
   *"Cannot find module 'xlsx'"* yang berulang kali disebut handoff sebagai
   jebakan. Obatnya `npm install` **di dalam** `web-internal/`.
2. **Menyunting `wire.ts` tanpa menjalankan `npm test -w apps/api`.** Di commit
   F-3 itu memerahkan dua check CI (`api` dan `db-and-migrations` — job kedua
   juga menjalankan suite `@cdps/api`). Sesudah menyentuh `wire.ts`, keempat
   suite wajib diulang, bukan tiga.
3. **`list_migrations` bukan hitungan baris ledger.** Ia mengembalikan daftar;
   menghitungnya dengan mata melahirkan selisih 216 vs 212 yang sempat terlihat
   seperti drift. Yang otoritatif: `select count(*) from
   supabase_migrations.schema_migrations`, lalu bandingkan **per-slug**.
4. **Fixture yang tidak sengaja membuka RLS.** Versi pertama tes F-2 LOLOS
   padahal bug-nya hidup, karena fixture mengisi `employees.created_by` dengan
   id pembaca — membuka arm ketiga `employees_select`. Sinkronisasi HRIS
   sungguhan menulis `'SYSTEM'`. Kalau sebuah tes RLS hijau di percobaan
   pertama, curigai fixture-nya dulu.
