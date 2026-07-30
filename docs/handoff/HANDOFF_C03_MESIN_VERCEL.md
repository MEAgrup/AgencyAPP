# HANDOFF — C-03 dilanjutkan di mesin ber-akses Vercel

> **Untuk siapa:** pemilik / siapa pun di mesin dengan **akses internet ke `*.vercel.app` + secret
> produksi**. Claude tidak bisa menjalankannya: gateway sandbox menolak CONNECT ke `*.vercel.app` dan
> sesi ini nol kredensial live (`HANDOFF_CUTOVER_SESI9.md` §0.2).
>
> **Runbook tekniknya tetap `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dan masih akurat.** Berkas ini tidak
> menggantikannya — ia menyatakan *apa yang berubah sejak runbook itu ditulis (2026-07-29)* dan
> **posisi repo/live per 2026-07-30**, supaya tidak ada langkah dijalankan dengan asumsi basi.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/c03-vercel-director-access-7vmki0`** — bercabang dari `claude/go-retirement-progress-eq0855`, bukan dari `main` |
| **Keadaan branch** | Working tree bersih. `git log --oneline main..HEAD` untuk isi & jumlah commit |
| **`main`** | **`a38e241`** = Merge PR #82. ⚠️ **`main` cuma 42 migrasi** — 2 yang terbaru hanya ada di branch |
| **PR** | **tidak ada yang terbuka.** PR #82 sudah **merged** |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 event**. Tiga apply terakhir 2026-07-30: `20260730120433` (fix O46) · `20260730153627` (O48 Grup C+D) · `20260730154210` (layered role `lead`) |
| **Repo vs live** | ✅ **44 = 44**, nama berkas = versi live **1:1** — dibaca dari live 2026-07-30 |
| **Layered `director`** | **5 riil + 1 fixture.** §7 sudah DIPUTUS & di-apply; nol migrasi baru (murni data) |

**Angka acuan** (Postgres 16 lokal, DB dibangun ulang dari nol, **44/44** bersih):
`apps/api` **313** · `@cdps/domain` **567** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · 4 invariant SQL **PASS**
(`rls_checks` **32 check** · `auth_claims_checks` **4 check**) · `route-parity` **5/5**,
`KNOWN_GAPS` KOSONG · `NESTED_INLINE_UNCHECKED` KOSONG · `RFC3339_PENDING_DECISION` KOSONG ·
typecheck & lint bersih.

> ⚠️ **`npm test --workspaces` TIDAK menjalankan `web-internal`** — ia bukan anggota `workspaces`
> (`package.json` hanya `apps/*` + `packages/*`). Jalankan terpisah:
> `npx vitest run --root web-internal`. Mengandalkan `--workspaces` saja membuat 26 test itu
> **terlihat hijau tanpa pernah dijalankan**.

> ⚠️ **Baris "Live" dan "Repo vs live" WAJIB dibaca ulang dari live** (`list_migrations`), bukan
> disalin dari tabel ini. Aturan itu lahir dari SESI22, yang menerbitkan "menunggu apply" **78 menit
> sesudah** apply-nya terjadi karena ia memverifikasi angka lokal tapi tidak pernah menanyai live.

## 1. Yang berubah sejak runbook ditulis (2026-07-29)

| Hal | Saat runbook ditulis | **Sekarang** |
|---|---|---|
| `main` | `efd59aa` | **`a38e241`** |
| Live | 40 migrasi | **44** — O46 diperbaiki **dan terbukti menyala**; O48 Grup C+D; layered `lead` |
| `apps/api` test | 301 | **311** |
| Ledger | 1 entri `RFC3339_PENDING_DECISION` | ✅ **ketiganya kosong** |
| Pemegang lead | Ads/KOL/Marketing **nol** | ✅ **setiap divisi punya lead** |

**Deployment yang akan Anda uji memuat keadaan yang benar-benar akan rilis.** Sebelum #82 arm RLS
O46 masih mati di produksi; sekarang tidak.

## 2. Langkah eksekusi

```bash
# 1. Ambil kode
git checkout main && git pull origin main        # harus sampai a38e241
#    (opsional) untuk menguji 3 commit terbaru:
#    git checkout claude/go-retirement-progress-eq0855 && git pull

npm ci                                           # ⚠️ WAJIB dari ROOT repo (aturan rumah #6)

# 2. Siapkan env — JANGAN ditebak, salin dari Vercel
export BASE=https://<url-agency-app-api>         # BUKAN localhost
export SUPABASE_JWT_SECRET='<secret produksi>'
export BYPASS='<token bypass>'                   # kosongkan bila deployment tidak ter-proteksi

# 3. Tiga skrip
node apps/api/scripts/cutover-houserules-walk.mjs   # target 22/22  -> menutup SKIP-1
node apps/api/scripts/wave3-contract-smoke.mjs      # target 34/34
node apps/api/scripts/auth-smoke.mjs                # target 13/13  -> menutup SKIP-3
```

**4. QA manual (runbook §4) — menutup SKIP-2:** badge notifikasi di FE ter-deploy. Jumlah unread
muncul → klik → tandai terbaca → jumlah turun → refresh tetap konsisten.

**5. Tulis report baru** `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md`. DoD: **FAIL = 0 TANPA SKIP**.

### ⚠️ Jebakan yang menghasilkan FAIL PALSU di SEMUA baris

Kalau deployment ber-proteksi dan **`BYPASS` tidak diisi**, Vercel menjawab **setiap** path dengan
halaman challenge. Itu terbaca seperti routing-404 dan dilaporkan sebagai *path drift* — seluruh
baris FAIL padahal aplikasinya sehat. Isi `BYPASS`, atau matikan proteksi sementara.

> ✅ **DIUKUR 2026-07-30 — alias produksi TIDAK ber-proteksi, jadi `BYPASS` boleh kosong.**
> `GET https://agency-app-api.vercel.app/api/healthz` ⇒ **`200`** dengan badan
> `{"status":"ok","service":"cdps-api"}` dan header `x-matched-path: /api/healthz` — respons aplikasi
> sungguhan, **bukan** halaman challenge. Path yang tidak ada (`/api/health`, `/me`) menjawab 404
> Next.js dengan `x-matched-path: /404`, jadi routing-nya hidup dan membedakan.
> Berlaku untuk **alias produksi ini saja** — preview deployment bisa tetap ber-proteksi.

### 📌 Koreksi: "`*.vercel.app` tidak terjangkau dari sesi Claude" tidak lagi utuh benar

Setiap dokumen C-03 sebelumnya menyatakan blokirnya mutlak. Yang benar per 2026-07-30:

| Jalur | Hasil |
|---|---|
| `curl` / `WebFetch` langsung dari sandbox | 🔴 tetap **403** (`gateway answered 403 to CONNECT`) — kebijakan jaringan environment, tidak berubah |
| **MCP server Vercel**, saat tersambung | ✅ **tembus** — dari situlah `200` di atas diukur |

**Tapi itu TIDAK membuat C-03 bisa dijalankan Claude,** dan alasannya kini berbeda — lebih sempit:

1. `SUPABASE_JWT_SECRET` **nol di environment sesi**, jadi tidak ada JWT per-role yang bisa
   ditandatangani. Ini blocker yang sebenarnya.
2. Perkakas MCP-nya **GET-saja tanpa header kustom**; ketiga skrip butuh `Authorization` + POST.

⇒ **Yang bisa dibuktikan dari sesi Claude cuma reachability dan status proteksi** (sudah, di atas).
Sisanya tetap milik mesin ber-secret. Jangan tulis ulang §-ini menjadi "Claude bisa menjalankan C-03".

## 3. Satu probe TAMBAHAN yang belum ada di runbook

Arm RLS O46 sudah terbukti menyala **di lapisan DB** (probe 8 skenario). Yang belum pernah dilihat:
apakah ia menyala **lewat aplikasi ter-deploy** — yaitu apakah JWT dari login sungguhan membawa
`level=lead` sampai ke policy.

**Termurah:** minta **Head of Sales `2101180004`** login ke FE ter-deploy dan buka halaman
riwayat/audit.

| Hasil | Artinya |
|---|---|
| **36** entri (own-only = 32) | ✅ arm menyala end-to-end |
| tepat **32** | 🔴 arm tidak menyala di jalur aplikasi — periksa **`trg_sync_claims_mapping`**, **bukan** policy (policy sudah terbukti benar) |
| **0** | 🔴 masalah auth/route, bukan RLS |

**JANGAN pakai Head of Account `2305100275`** — divisi Account punya **0** entri audit, jadi hasilnya
`0` baik arm menyala maupun mati; ia tidak membedakan apa pun. (SESI21/SESI22 menyarankannya; saran
itu sudah dicabut.)

**Bonus, kalau sempat:** minta **Ads lead `2307100292`** membuka halaman config KPI
(`/performance/config/weights`). Sebelum `20260730153627` halaman itu **kosong** untuk semua orang
selain Director/OD; sekarang harus terisi (**15** baris di live).

## 4. Kalau ada yang FAIL

- **Jangan** perbaiki dengan mengubah policy RLS. Semua policy yang tersentuh C-03 sudah diverifikasi
  di lapisan DB; kegagalan di sini hampir pasti **auth/klaim/route**.
- Kirimkan output ketiga skrip apa adanya — Claude bisa mendiagnosis dari situ tanpa akses Vercel.

---

## 5. 🔴 O50 — BACA SEBELUM GO (bukan blocker C-03, tapi blocker gate GO)

**10 akun ber-pola `99000000xx` ada di live**, semuanya `status_aktif=true` dan **semuanya bisa
login** — satu per peran, termasuk **1 Director** (`9900000001`) dan **2 lead divisi**
(`9900000003` Sales, `9900000005` Account). Bentuknya fixture UAT, dan DoD **C-04** mensyaratkan
**nol fixture UAT di jalur produksi**.

Claude **tidak menyentuhnya** — menghapus akun produksi butuh persetujuan eksplisit. Minimal
sementara: **`status_aktif=false`** supaya sinkronisasi mencabut aksesnya.

**Efek samping yang mengecoh:** mereka mencemari setiap hitungan headcount. "69 karyawan" yang
dipakai memutuskan A4/O48 sebenarnya **59 riil + 10 fixture**.

## 6. Sisa pekerjaan sesudah C-03

| # | Butir | Siapa |
|---|---|---|
| 1 | **O50** — konfirmasi asal-usul 10 akun `99000000xx` + izin nonaktifkan/hapus | **pemilik** |
| ~~2~~ | ✅ **5 karyawan tak terpetakan — DIPUTUS & di-apply** (§7): kelimanya layered `director`, diverifikasi dua lapis | selesai |
| 2b | **Divisi dasar** untuk `2501140493`/`2507250557`/`2607060683` — masih `''`. Kosmetik selama `director` menyala, **penting saat dicabut** (§7) | **pemilik** |
| 3 | **O48 Grup A/B/E** — `O48_ANALISIS_KEPUTUSAN.md`. Grup C+D sudah selesai & live | **pemilik + head dev** → Claude |
| 4 | Backup MySQL Railway + OQ-2 · rencana rollback | **pemilik** |
| 5 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 6 | Probe ulang `transactions`, `performance_snapshots`, `*_block_requests` begitu ada data riil (ketiganya **kosong** di live, jadi arm-nya belum terbukti oleh data) | Claude, saat datanya ada |

## 7. ✅ 5 karyawan tak terpetakan — DIPUTUS dan SUDAH DI-APPLY (2026-07-30)

**Keputusan pemilik: kelimanya layered `director`** — *"bisa view dan melakukan task di semua
bagian"*. Sudah diterapkan ke live dan diverifikasi; **butir ini tertutup**, tidak perlu diputus lagi.

| # | `employee_id` | dept HRIS | jabatan | Hasil |
|---|---|---|---|---|
| 1 | `200000001` | Director | Director | `director` sejak 2026-07-24 ⇒ **nol perubahan** |
| 2 | `200000002` | Director | Director | idem |
| 3 | `2501140493` | OD | SENIOR ORGANIZATION DEVELOPMENT | ✅ `director` **ditambahkan** (`od` tetap menyala) |
| 4 | `2507250557` | OD | SENIOR DATA ANALYST | idem |
| 5 | `2607060683` | OD | JR ORGANIZATION DEVELOPMENT | idem |
| ~~—~~ | ~~`9900000001`~~ / ~~`9900000002`~~ | ~~Director~~ / ~~OD~~ | — | 🔴 **fixture O50 — SENGAJA tidak disentuh** (§5) |

**Kenapa `director`, bukan `od`:** `od` adalah **read-only di mana-mana** (Role Matrix Phase 0 §4),
jadi ia memenuhi "view" tapi **tidak** "melakukan task". `od` ketiganya dibiarkan menyala karena
aditif — `director` sudah mencakupnya, dan penanda OD masih dipakai OKR (M13).

**Kenapa dua fixture tidak ikut:** DoD C-04 mensyaratkan **nol fixture UAT di jalur produksi**.
Memberi mereka `director` memperburuk O50, bukan menutupnya.

**Cara apply-nya** (meniru persis `admin.setLayeredRole`): upsert `employee_layered_roles` + **satu
baris `audit_log` ber-`before`/`after` per orang**, satu transaksi, `created_by='C03-OWNER-DECISION'`.

**Diverifikasi SESUDAH apply, di DUA lapis** — dan lapis kedua itu wajib, bukan kelebihan:

| Lapis | Cek | Hasil |
|---|---|---|
| Fungsi | `employee_claims(...)->>'director'` | ✅ `true` untuk kelimanya |
| **Klaim tersimpan** | `auth.users.raw_app_meta_data->>'director'` | ✅ `true` untuk kelimanya |

> Tanpa lapis kedua, grant yang klaimnya **tidak merambat** terbaca **persis sama** dengan grant yang
> berhasil — itu kelas O46. `trg_sync_claims_layered` terbukti bekerja.

### 🟠 Tiga hal yang MASIH terbuka sesudah keputusan ini

1. **Pemegang sesi lama masih membawa klaim lama.** JWT diterbitkan **saat login**, jadi ketiganya
   harus **logout → login ulang** sebelum akses barunya terasa. Kalau mereka lapor "belum berubah",
   ini penyebab pertama yang diperiksa — bukan RLS.
2. **`division` ketiganya tetap `''`.** Jadi `director` sekarang **satu-satunya** sumber akses
   mereka: kalau kelak dicabut, mereka jatuh ke **nol scope**, bukan ke scope divisi. Pemetaan
   divisi dasar (worksheet §3.1) masih terbuka — kini kosmetik, tapi jadi penting saat pencabutan.
3. **`2507250557` SENIOR DATA ANALYST** — worksheet §2.2 juga mendaftar `DATA & BUSINESS
   INTELLIGENCE / DATA ANALYST INTERN` tanpa padanan CDPS. Kalau kelak ada keputusan "analitik tidak
   dapat scope operasional", keduanya diputus bersama.

### 🔴 Dua cacat yang ditemukan saat mengerjakan ini — keduanya sudah diperbaiki di repo

Keduanya membuat **jalur eksekusi yang dokumen ini sendiri anjurkan** tidak bisa dijalankan:

| Cacat | Akibat |
|---|---|
| `LAYERED_ROLES` di `admin.ts` masih `{od, director}` walau migrasi `20260730154210` + CSV sudah memakai `lead` | `rolemapseed --apply` mem-parsing CSV bersih lalu **mati di `MSG_BAD_ROLE`** di baris `lead` — sesudah baris sebelumnya ter-commit. 3 grant `lead` di produksi **tidak bisa direproduksi dari seed** |
| `layered_roles_riil.csv` memuat **`2409230432`** yang **tidak ada** di `employees` live | Guard fase-1 `engine.ts` (*"menunjuk karyawan yang tidak ada"*) **membatalkan seluruh run** ⇒ CSV yang diapalkan tidak bisa dijalankan apa adanya |

Perbaikannya: `LAYERED_ROLES` + `MSG_BAD_ROLE` diperluas ke `lead` (dikunci **3 test**, divalidasi
mutasi), baris hantu dicabut, dan **3 baris `od` yang ADA di live tapi HILANG dari CSV**
ditambahkan supaya CSV idempoten lagi terhadap live.

> ⚠️ **Koreksi versi sebelumnya berkas ini:** ia menyatakan *"pemegang layered `od` hanya
> `2409230432`"*. **Salah** — itu dibaca dari CSV, bukan dari live. Live tidak pernah punya baris itu;
> pemegang `od` justru ketiga orang OD di atas. Persis cacat yang §0 peringatkan: **angka tentang live
> wajib dibaca dari live.**

**Cara mengeksekusi sisa mapping divisi** — `O34_O26_O35_WORKSHEET_ROSTER_V2.md` §4: tambah baris ke
`supabase/seed/role_mappings_riil.csv` (**tambah**, jangan regenerasi — live sudah 39 baris), lalu
`npm run rolemap:seed -w @cdps/api -- --apply`. Untuk layered role: `layered_roles_riil.csv`
(menerima `od`, `director`, dan `lead` — kini di **kedua** gate, tidak cuma di parser).

> **Kalau yang dibutuhkan adalah menjadikan SEORANG karyawan lead** — gunakan layered role `lead`,
> **bukan** `role_mappings`. `role_mappings` berkunci `(divisi, jabatan)`, jadi menaikkan jabatan
> akan menaikkan **semua** pemegang jabatan itu. Preseden + alasannya: `DECISIONS.md` 2026-07-30.

**Titik masuk umum sesi berikutnya tetap `HANDOFF_CUTOVER_SESI23.md`.** Berkas ini khusus untuk yang
menjalankan C-03.
