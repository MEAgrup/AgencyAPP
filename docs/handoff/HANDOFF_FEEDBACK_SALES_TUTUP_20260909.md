# Handoff — Feedback tim Sales: **enam butir di `main` DAN di live. FS-6b sudah dibangun; sisanya UAT peramban.**

> **PEMBARUAN 2026-09-09 (sesi berikutnya).** §2.1 di bawah — separuh kedua butir
> `#6` — **SUDAH DIKERJAKAN** di branch `claude/handoff-feedback-sales-tutup-3wucjl`
> (FS-6b, migrasi `20260926010000_fs6b_tenor_di_deal`). Rinciannya ada di
> `DECISIONS.md` baris 2026-09-09 FS-6b dan `DATA_MODEL.md` §3a-1. Teks §2.1
> **sengaja tidak dihapus** — ia tetap catatan terbaik tentang KENAPA pekerjaan
> itu perlu; yang berubah hanya statusnya, dan itu dicatat di §2.1a.
>
> Yang **BELUM**: §2.2 (UAT di peramban). Migrasi FS-6b **sudah di live** —
> lihat §2.1a.

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

### 2.1 ✅ (dulu 🔴) `#6` baru separuh — tenornya belum bisa DIJUAL

> **SUDAH DIKERJAKAN 2026-09-09 — lihat §2.1a untuk statusnya.** Bagian di bawah
> ini dibiarkan utuh sebagai catatan KENAPA-nya, bukan sebagai daftar tugas.

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

### 2.1a ✅ `#6` — separuh keduanya SUDAH mendarat (FS-6b, 2026-09-09)

Keempat langkah di §2.1 dikerjakan, plus dua pembaca yang **tidak** ada di daftar
itu dan justru membawa risiko uang terbesar.

| Langkah §2.1 | Status |
|---|---|
| 1 · kolom snapshot `durasi_bulan` di empat tabel | ✅ `20260926010000_fs6b_tenor_di_deal` — nullable, `> 0`, nol backfill |
| 2 · `deriveDuration` membaca snapshot lebih dulu | ✅ lewat `coalesce(npl, qfs, pinned, at_proposal)` di `loadApprovedLines` — badan `deriveDuration` sendiri tidak berubah |
| 3 · pemilih tenor di empat layar | ✅ kalkulator · Form Qualified · editor proposal (negosiasi + Edit Service) · `RenewalPanel` |
| 4 · batas `uq_qfs` dicatat, bukan diperbaiki | ✅ tercatat di baris `DECISIONS.md` FS-6b |

**Dua pembaca tambahan yang ditemukan saat mengerjakannya.** Keduanya salah
diam-diam dengan cara yang sama, dan keduanya di jalur uang:

- `tutupbuku.hitungAngkaPeriode` membaca `v.durasi_bulan` dari versi yang di-pin,
  jadi paket Rp 36jt/12 bulan diakui **Rp 12jt sebulan selama tiga bulan** lalu
  nol selama sembilan. Sekarang `coalesce(s.durasi_bulan, v.durasi_bulan)`.
  Tesnya diverifikasi GAGAL tanpa perbaikannya
  (`expected '1200000000' to be '300000000'`).
- `ads.computeAdsManagementEndDate` — sumber yang sama, akibat yang sama: Ads
  Management berakhir sembilan bulan terlalu cepat.

**Yang membuat pekerjaan ini aman terhadap deal berjalan:** `NULL` di kolom baru
berarti tepat satu hal — "pakai durasi versi" — sehingga tidak ada satu pun
tebakan yang perlu dibuat tentang baris lama, dan tidak ada satu pun yang
berubah artinya. Ada tes khusus untuk itu di ketiga jalur (closing, perpanjangan,
accrual).

**✅ Migrasi FS-6b SUDAH DI LIVE `CDPS SG` (2026-09-09), diterapkan SEBELUM
merge** — urutan yang sama dengan ketokan FS sebelumnya. Angka dan cara
memverifikasinya ada di baris `DECISIONS.md` FS-6b; ringkasnya: gate **tetap
150/41/33/73** (memang hanya empat kolom), ledger 216 → 217, drift per-slug nol
MISSING, keempat kolom 100% NULL sesudah apply (nol backfill terbukti), uji
negatif nol/negatif ditolak & 12 diterima lewat SQL langsung lalu dibatalkan
(nol jejak), dan `get_advisors security` nol temuan baru (28/1/8/3/1).

> Yang TERSISA dari FS-6b hanyalah pembuktian di peramban — lihat §2.2.

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
| `/sales/kalkulator` — kolom Durasi | **Sales staff** | `#6` (FS-6b) — dropdown tenor mengubah kolom Harga & Ringkasan |
| `/sales/{id}` — Form Qualified | **Sales staff** | `#6` (FS-6b) — tenor terkirim, lalu terbaca lagi di tabel snapshot |

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
