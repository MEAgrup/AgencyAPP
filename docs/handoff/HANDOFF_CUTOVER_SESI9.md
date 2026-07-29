# HANDOFF — Cutover Sesi 9

> Titik masuk **standalone**. `HANDOFF_CUTOVER_SESI8.md` jadi arsip latar; **mulai dari dokumen ini.**
>
> **Fokus sesi ini sudah ditetapkan pemilik — hanya tiga hal:**
> **(1) tutup 3 SKIP C-03** · **(2) lengkapi C-04** (O22 + aktor O34/O26/O35/O9 + konfirmasi data Railway) ·
> **(3) backup MySQL + rencana rollback.** Ketiganya adalah **sisa gate go/no-go**. Jangan ambil
> tiket lain (O41, O43(b)(c)) sebelum ini beres — lihat §5.

## 0. Posisi persis

| | |
|---|---|
| **Branch kerja** | **`claude/migrasi-cdps-sg-cutover-behnjc`** |
| **Kondisi branch** | **bersih, identik `main`** — di-restart dari `origin/main` sesudah #67 merge. Commit handoff ini duduk di atasnya |
| **`main`** | **`c0e65f1`** (hasil merge PR #67) |
| **PR terbuka** | **tidak ada** |
| **PR selesai** | #67 ✅ merge · #66 ✅ merge · #65 ✅ merge · #63 ditutup (premis kedaluwarsa) |
| **Live** | Supabase `CDPS SG` (`egddxfcnrtecheiykhlf`, `ap-southeast-1`) — **39 migrasi**, 53 tabel, `master_services` **32**, `role_mappings` **39**, `employees`/`employee_credentials`/`auth.users`/`auth.identities` **69/69/69/69** |
| **Drift live↔repo** | ✅ **TERTUTUP.** `main` kini memuat `…0011`; live tidak lagi di depan repo |

```bash
git fetch origin main
git checkout claude/migrasi-cdps-sg-cutover-behnjc
git pull origin claude/migrasi-cdps-sg-cutover-behnjc
npm ci                                # ⚠️ WAJIB dari ROOT repo — §6 aturan #6
cd web-internal && npm ci && cd ..    # web-internal punya lockfile sendiri
```

### 0.1 Nol pekerjaan tertinggal saat dokumen ini ditulis

```
belum ter-commit : 0        stash : 0        PR terbuka : 0
```

### 0.2 ⚠️ BACA INI SEBELUM MERENCANAKAN SESI

**Ketiga task fokus sesi ini TIDAK BISA diselesaikan Claude dari sandbox.** Ini bukan pesimisme,
ini terukur berulang kali:

| Hambatan | Bukti |
|---|---|
| Gateway menolak CONNECT ke `*.vercel.app` | `gateway answered 403 to CONNECT` (C-03 SKIP-1) |
| Gateway menolak CONNECT ke `supabase.co`; nol kredensial live di env | sesi 5–8 |
| Nol akses Railway (MySQL sumber) | tidak pernah ada |
| Kredensial login per-role tidak tersedia | C-03 SKIP-1 |
| O34/O26/O35/O9 = **keputusan manusia**, bukan kode | DECISIONS |

**Konsekuensi jujur:** yang bisa Claude kerjakan di sesi ini adalah **menyiapkan** (skrip, checklist,
draf rencana, template CSV, query verifikasi) — **eksekusinya** wajib dari mesin ber-akses milik
pemilik. Kalau sesi berikutnya dijalankan dari mesin ber-akses/CI ber-secret, barulah §1–§3 bisa
dituntaskan langsung. **Tanyakan ini di awal sesi**, jangan asumsikan.

---

## 1. Task A — tutup **3 SKIP C-03** 🟠

**Report:** `docs/handoff/CUTOVER_UAT_REPORT_20260728.md` (PASS 77 · FAIL 0 · SKIP 3).
Ketiga SKIP berakar pada **satu** sebab: walk belum pernah dijalankan terhadap **deployment Vercel**.
Yang sudah terbukti = **kode + skema**; yang belum = **konfigurasi deployment**.

| SKIP | Isi | Kenapa tertutup oleh satu langkah yang sama |
|---|---|---|
| **SKIP-1** | walk house-rules terhadap Vercel `agency-app-api` tak dijalankan | butuh `BASE=<url>` + JWT produksi + kredensial per-role |
| **SKIP-2** | QA badge notifikasi di FE **ter-deploy** belum pernah dilihat | butuh akses deployment (warisan C-02) |
| **SKIP-3** | `auth-smoke`: `/me` cookie valid → 401 | **bukan cacat kode** — skrip hardcode `EMP-202607-0001` yang ada di live (69 karyawan) tapi tidak ada di seed lokal 10 baris. Akan **PASS sendiri** terhadap deployment |

### Cara menutup (satu perintah beruntun, dari mesin ber-internet)

```bash
export BASE=https://<url-agency-app-api>          # deployment, BUKAN localhost
export SUPABASE_JWT_SECRET=<secret produksi>      # dari env Vercel, jangan ditebak

node apps/api/scripts/cutover-houserules-walk.mjs   # target 21/21
node apps/api/scripts/wave3-contract-smoke.mjs      # target 34/34
node apps/api/scripts/auth-smoke.mjs                # target 13/13 (SKIP-3 hilang di sini)
```

Lalu **QA manual** badge notifikasi di `web-internal` ter-deploy (SKIP-2), dan sekalian dua QA UI
yang masih menggantung dari C-04: **`/master-services`** + **`/sales/kalkulator`** (MSL 32 layanan
sudah live sejak 2026-07-28, UI-nya belum pernah di-QA di deployment).

**DoD:** tulis report baru `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md` — **FAIL = 0 TANPA SKIP**.
Jangan menyunting report 2026-07-28; ia bukti historis. Sesudah itu C-03 boleh dicentang penuh di
`docs/backlog/CUTOVER_BACKLOG.md` §2 (sekarang bertanda `[~]`).

> **Yang Claude bisa siapkan tanpa akses:** memastikan ketiga skrip menerima `BASE` dari env dengan
> benar, dan menambah **pengaman** supaya `auth-smoke` tidak lagi hardcode `EMP-202607-0001`
> (ambil employee pertama dari `/admin/employees`, atau jadikan parameter env). Itu menghapus
> SKIP-3 sebagai kelas masalah, bukan cuma instance-nya.

---

## 2. Task B — lengkapi **C-04** 🟠

Empat butir. **Tiga di antaranya keputusan manusia** — Claude tidak bisa mendorongnya maju.

### 2.1 Sudah ✅ (jangan dikerjakan ulang)
- **MSL** — 32 layanan ber-versi di live (2026-07-28, aktor NIK `2101180004`), idempotensi terbukti.
- **Karyawan riil** — 69 di keempat tabel (69/69/69/69), semua punya jalur login.
- **O42** — divisi `Marketing` hidup, `role_mappings` 39, claims NIKEN = `Marketing/staff`.
- **O33** — aktor Finance ada; `SENIOR FINANCE, ACCOUNTING & TAX` → `Finance`/`lead`.

### 2.2 ❌ **O22 — impor lead historis**
Aturan **sudah diputus 2026-07-10, jangan dibuka ulang**: **Pilihan B** = lead ber-status `Qualify`
**ATAU** prospek `Hot`/`Warm`, dalam **6 bulan terakhir** dihitung dari tanggal run impor. Lead di
luar filter **tidak** diimpor (arsip tetap di spreadsheet; agregat = kebutuhan reporting).

- **Sumber per-lead:** workbook upload *"Data Cena Sales Performance"* tab **`Daily Leads`**
  (1.769 baris ber-telepon lengkap; BANT + Seller/Affiliator/No Respon/Bad Respon + Hot/Warm/Cold + Note)
  dan `PROSPECT&CLOSING`/`Sheet72`.
- **`sales_pemegang` diresolusi lewat tabel nama-panggilan → NIK** (di sheet tertulis "Cena", "Esal", dst.).
  ⚠️ Tabel pemetaan ini **harus dibuat/di-konfirmasi pemilik** — jangan menebak NIK dari nama.
- **JANGAN pakai** tab `Input_Lead_Iklan[_2026]`/`Input_Lead_Organik[_2026]`: itu **agregat harian**
  tanpa nama/telepon, tidak bisa lewat engine dedup M1, dan **tidak boleh difabrikasi** jadi baris lead.

> 🔴 **Ketergantungan teknis yang harus dicek dulu:** jalur impor massalnya adalah
> **`POST /leads/bulk`**, dan itu **masih di `KNOWN_GAPS`** (belum diport, O41 #5). Jadi O22 punya
> dua kemungkinan urutan: **(a)** port `POST /leads/bulk` lebih dulu, atau **(b)** impor lewat
> jalur lain yang sudah ada. **Putuskan dan catat** — jangan improvisasi INSERT langsung ke
> `leads`, karena engine dedup M1 + mesin status + audit harus ikut jalan.

### 2.3 ❌ **Aktor produksi — keputusan pemilik**

| # | Isi | Butuh dari | Dampak kalau kosong |
|---|---|---|---|
| **O34** | Aktor Wave 2 butir (a)–(e) + lead Marketing/BD — kini masih **fixture UAT** | Pemilik | fixture UAT tersisa di jalur produksi ⇒ **DoD C-04 gagal** |
| **O26** | NIK + email Director (Yohan & Nerissa) untuk layered role | Pemilik | grant Director bersandar pada baris seed |
| **O35** | Sub-tim Creative M7 §3 — **3 keputusan berurutan** | Nerissa | gate lead-divisi existing tetap berlaku sementara |
| **O9** | Target periode M14 | SPV Ads + OD | **non-blocking** (`is_placeholder`) |

Terkait tapi di luar daftar pemilik: **O25** (anomali kalkulator — Nano KOL batas minimal 10×Rp5jt,
basis komisi 5% Store Management, enforcement budget GMV Max Rp8,5jt) → Sales Head/COO.
Dan **O42(3)**: sumber kebenaran `role_mappings` **39** (live) vs **23** (`backend/seed/…csv`) vs
**12** (`supabase/seed.sql`). ⚠️ **Risiko konkret:** blok `role_mappings` di `supabase/seed.sql`
diakhiri `ON CONFLICT (divisi,jabatan) DO UPDATE SET division, level` — menjalankan seed itu ke live
akan **menulis ke akar perizinan**. Rekomendasi berdiri: live = sumber kebenaran (preseden **O38**
*"repo mengikuti live"*), `seed.sql` tetap fixture dev/CI **+ diberi pengaman**.

**`Marketing`/`lead` tetap kosong** — tidak ada jabatan kepala BD/Marketing aktif ⇒ reassign owner
Campaign di produksi tetap **hanya Director**. Sudah dicatat keputusan sadar; **bukan** pekerjaan tertunda.

### 2.4 ❌ **Konfirmasi: data Railway/MySQL riil atau UAT?**
Asumsi tercatat (**OQ-2/A1**): **UAT**. Kalau ternyata **riil**, cutover butuh rencana
ekspor-impor **per-entitas mengikuti rantai FK**:

```
LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST
```

**Jangan improvisasi — catat keputusan di DECISIONS lebih dulu.** Ini satu pertanyaan yang bisa
mengubah ukuran seluruh sisa cutover, jadi **tanyakan paling awal**.

**DoD C-04:** nol fixture UAT di jalur produksi · login riil semua role lolos · ~~MSL ber-versi~~ ✅.

---

## 3. Task C — **backup MySQL + rencana rollback** 🔴

Dua item terakhir gate, keduanya **belum tersentuh**, dan keduanya **butuh akses Railway** yang
Claude tidak punya.

### 3.1 Backup MySQL Railway terakhir
Harus tersimpan **sebelum** Railway dimatikan (C-05 langkah 5). Yang perlu dipastikan:
dump lengkap + **restorable** (uji restore ke instance kosong — dump yang tak pernah diuji restore
bukan backup), lokasi simpan disepakati, dan checksum dicatat.

### 3.2 Rencana rollback — **draf untuk disetujui**
Prinsip yang sudah tertulis di backlog: **Railway tetap hidup N hari pasca-cutover sebelum dimatikan.**
Yang belum: **N**, pemicu, dan siapa yang menarik pelatuk. Draf untuk dibahas — **belum disetujui**:

| Butir | Usul | Kenapa |
|---|---|---|
| **N** | **14 hari** kalender | melewati satu siklus penuh jalur uang (invoice → verifikasi → komisi) |
| **Pemicu rollback** | jalur uang M4/M5 gagal di produksi & tak bisa ditambal < 4 jam · kehilangan/korupsi data · seluruh role tak bisa login | rollback itu keputusan bisnis, jadi pemicunya harus terukur, bukan "kalau terasa salah" |
| **Cara** | balikkan `web-internal/next.config.ts` proxy `/api/v1/*` ke Go, hidupkan Railway | ⚠️ **belum diverifikasi** — Go "archived read-only" dan `apps/api` sudah menulis ke Supabase, jadi **data yang masuk pasca-cutover TIDAK ada di MySQL**. Rollback ⇒ **kehilangan data periode itu** kecuali ada jalur balik |
| **Konsekuensi yang harus diakui** | rollback bukan gratis | inilah alasan **N** dan pemicunya harus disepakati **sebelum** GO, bukan sesudah |
| **PIC** | Yohan & Nerissa (OQ-1) | sama dengan PIC gate |

> 🔴 **Temuan yang harus diangkat ke pemilik, jangan dikubur di draf:** rollback ke Go **bukan**
> operasi simetris. Sesudah cutover, tulis masuk ke Supabase; MySQL membeku. Jadi "rollback" realistis
> = **kembali ke Go + terima kehilangan data sejak cutover**, atau siapkan **jalur balik
> Supabase→MySQL** (pekerjaan nyata, belum ada, belum diestimasi). **Pilih sadar.** Kalau pemilik
> memilih menerima kehilangan data, itu sah — tapi harus tertulis di DECISIONS, bukan diasumsikan.

---

## 4. Status gate go/no-go (terverifikasi 2026-07-29)

`docs/backlog/CUTOVER_BACKLOG.md` §2 — legenda `[x]` selesai · `[~]` sebagian · `[ ]` belum:

| Item | Status |
|---|---|
| C-00 CI · C-01 O37 · C-02 notifikasi | ✅ ✅ ✅ |
| **C-03** UAT | `[~]` FAIL=0, **3 SKIP** → **Task A** |
| **C-04** data + aktor | `[~]` MSL ✅ karyawan ✅ O42 ✅ · O22 ❌ aktor ❌ Railway ❌ → **Task B** |
| **Backup MySQL** | `[ ]` → **Task C** |
| **Rencana rollback** | `[ ]` → **Task C** |

**≈ 3,5 dari 7.** Sesudah GO → **C-05** (buang job CI Go, arsipkan `backend/` **dengan tag**,
tandai config Railway deprecated, perbarui `CLAUDE.md`, matikan Railway).
**C-05 sengaja 0%** — Go masih **oracle paritas satu-satunya**.

## 5. Yang SENGAJA ditunda di luar tiga task fokus

Jangan mulai ini tanpa arahan baru — tapi jangan lupa juga, karena keduanya **kerusakan yang
kelihatan user**, bukan utang rapi:

| # | Isi | Catatan |
|---|---|---|
| **O41** | **6 endpoint** masih di `KNOWN_GAPS` (`apps/api/src/lib/route-parity.test.ts` = buku besarnya) | `GET /finance/queue` ⇒ halaman `/finance` **mati** · `GET /transactions/{}` ⇒ detail transaksi **mati** · `POST /transactions/{}/schedule` (Σ termin = total, mint `INST-`, lock baris, guard idempotensi) · `GET /transactions/{}/bermasalah` · **`POST /leads/bulk`** (bersinggungan **O22** — lihat §2.2) · `GET /audit` |
| **O43(b)(c)** | test paritas-**bentuk** otomatis, lalu audit **60+ route GET** | jumlah bug bentuk respons **belum diketahui, asumsikan >0**. `GET /transactions/{}` sudah tahu FE membaca `res.transaction.installments` |
| **O44(c) B2** | lupa-password self-service | menunggu provider email. **B1 sudah jadi jalur pemulihan**, jadi tidak memblokir |
| **C-06** | `web-client-portal` | ditunda by design, tidak memblokir cutover |

## 6. Aturan rumah yang paling sering menggigit

1. **Setiap objek domain lewat wire mapper.** camelCase/bigint mentah ⇒ 500 atau halaman kosong
   (penyebab C03-F2 **dan** O43).
2. **Baca lewat `readAsActor`** — KECUALI tabel default-deny (`role_mappings`,
   `employee_layered_roles`, `employee_credentials`): di sana `readAsActor` mengembalikan **nol
   baris**, gate ditegakkan di app layer dengan client privileged. Lihat docstring
   `packages/domain/src/admin.ts`.
3. **`audit_log` append-only** — `forbid_mutation` memblokir DELETE, jadi `afterEach` **tidak bisa**
   membersihkannya. Assertion audit pakai **watermark `max(id)`**, bukan hitung per `entity_id`.
4. **Nol string BI baru tanpa entri DECISIONS.**
5. **Deteksi method route** harus mencakup `export const POST = handler`, bukan hanya
   `export async function POST`.
6. **`npm ci` HARUS dari ROOT repo.** Dari dalam `packages/*`/`apps/*` ⇒ pohon ter-prune lalu
   typecheck gagal `Cannot find module 'next'` — artefak instalasi, bukan regresi kode.
7. **Otoritas password = GoTrue**, bukan `employee_credentials`. Port verbatim dari Go = bug senyap.
   `apps/api` **tidak punya** `SUPABASE_SERVICE_ROLE_KEY` ⇒ jalur tulis admin lewat RPC SECURITY DEFINER.
8. **`ci.yml` terpicu DUA KALI per commit** (`push` + `pull_request`) ⇒ 11 check = 2×5 job + Vercel.
   Job `backend` normalnya **~6 menit**; kalau satu tersangkut sementara kembarannya hijau, itu
   flakiness runner — **cek pasangannya dulu** sebelum mendorong "perbaikan".
   (Di sesi 8 **kedua** kembaran `backend` tersangkut >15 menit pada diff **docs-only**; #67 tetap
   di-merge karena semua gate bermakna — `api`, `core-engines`, `db-and-migrations`, `web-internal`,
   Vercel — hijau dan nol berkas Go tersentuh.)

## 7. Cara menjalankan test DB-backed di sandbox

```bash
pg_ctlcluster 16 main start          # "Removed stale pid file" itu normal
su postgres -c "psql -c 'DROP DATABASE IF EXISTS cdps;' -c 'CREATE DATABASE cdps;'"
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
for f in $(ls supabase/migrations/*.sql | sort); do
  su postgres -c "psql -d cdps -v ON_ERROR_STOP=1 -q -f '$f'" || echo "GAGAL $f"
done
su postgres -c "psql -d cdps -q -f supabase/seed.sql"
# harus 53 tabel:
su postgres -c "psql -d cdps -tAc \"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'\""

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
cd web-internal && npm test          # 26 test, terpisah dari workspaces
```

Invariant SQL: `psql` butuh berkas yang bisa dibaca user `postgres` ⇒ **copy ke `/tmp` + `chmod 644`**:

```bash
mkdir -p /tmp/inv && cp supabase/tests/*.sql /tmp/inv/ && chmod 644 /tmp/inv/*.sql
for f in ident_checks immutability_checks rls_checks auth_claims_checks; do
  su postgres -c "psql -d cdps -v ON_ERROR_STOP=1 -q -f /tmp/inv/$f.sql" && echo "PASS $f"
done
```

**Angka acuan terakhir (2026-07-29, Postgres nyata, DB dimigrasi ulang dari nol):**
`@cdps/domain` **470** · `apps/api` **194** · `web-internal` **26** · `core` **112** · `db` **9** ·
keempat invariant SQL **PASS** · 39 migrasi → **53 tabel** · gate seed utuh
(10 employees / 12 role_mappings / 14 machines / 15 events).

## 8. Menunggu keputusan pemilik (ringkas)

| # | Isi | Memblokir gate? |
|---|---|---|
| **Data Railway riil atau UAT?** | menentukan ukuran sisa cutover | **Ya** — tanyakan paling awal (§2.4) |
| **O34 · O26 · O35** | aktor Wave 2 · NIK/email Director · sub-tim Creative | **Ya** — DoD C-04 "nol fixture" |
| **O22 sumber + tabel nama→NIK** | lead historis | **Ya** untuk C-04 |
| **N hari + pemicu rollback + terima-kehilangan-data-atau-tidak** | §3.2 | **Ya** |
| **Kredensial per-role + `SUPABASE_JWT_SECRET` produksi + URL Vercel** | menutup 3 SKIP C-03 | **Ya** (§1) |
| **O42(3)** | sumber kebenaran `role_mappings` 39 vs 23 vs 12 | Tidak, tapi ada risiko `seed.sql` menulis ke live |
| **O25** | anomali kalkulator | Tidak |
| **O9** | target periode M14 | Tidak (`is_placeholder`) |
| **O44(c) B2** | provider email/SMTP | Tidak — B1 jalur pemulihan |

**O24 · O33 · O37 · O38 · O39 · O40 · O42 · O43(a) · O44 sudah RESOLVED — jangan dibuka lagi.**
