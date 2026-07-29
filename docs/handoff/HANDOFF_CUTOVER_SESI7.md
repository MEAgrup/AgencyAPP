# HANDOFF — Cutover Sesi 7 (O41 #1 selesai · kelas bug BENTUK respons ditemukan · O42 diperluas)

> **Dokumen standalone. Mulai chat berikutnya dari file ini** — tidak perlu membaca pendahulunya.
> Tanggal: 2026-07-29. Pendahulu: `HANDOFF_CUTOVER_SESI6.md`.

---

## 0. MULAI DI SINI — posisi branch & PR

| Item | Nilai |
|---|---|
| **Branch kerja** | **`claude/handoff-sesi-6-cutover-ysut7c`** ← lanjutkan di sini, atau buat branch baru dari `main` **sesudah** PR di bawah ter-merge |
| **PR** | **#65** — https://github.com/MEAgrup/AgencyAPP/pull/65 (dibuka 2026-07-29, isi 5 commit di bawah) |
| **Base** | `main` @ **`2c82f89`** |
| **Commit di branch (5, terbaru dulu)** | `7236849` docs handoff sesi 7 (dokumen ini) · `b047507` docs handoff sesi 6 · `95a99e5` **port `clients/{id}/payment-intent` + 2 fix bentuk respons M4** · `3818d4a` audit roster O42 · `f5d93c8` catat apply 0009+0010 ke live |
| **Semua ter-push?** | ✅ ya — working tree bersih, nol commit/berkas tertinggal |
| **PR lain yang terbuka** | ⚠️ **#63 KEDALUWARSA — minta pemilik menutupnya**, lihat §6 |

```bash
git fetch origin main
git checkout claude/handoff-sesi-6-cutover-ysut7c && git pull origin claude/handoff-sesi-6-cutover-ysut7c
npm ci                        # ⚠️ WAJIB dari ROOT repo — lihat §5.1
cd web-internal && npm ci && cd ..   # web-internal punya lockfile sendiri
```

---

## 1. Keadaan produksi (`CDPS SG`) — terverifikasi 2026-07-29

| Hal | Nilai |
|---|---|
| Migrasi ter-apply | **38** (termasuk RLS `0009` + `0010`, di-apply sesi lalu) |
| Tabel | **53** · policy **44** |
| Karyawan aktif | **68** — semuanya punya peran yang resolve (lihat §3.1) |
| Divisi CDPS yang **punya** aktor | `Account · Ads · Creative · Finance · KOL · Sales` |
| Divisi CDPS **tanpa** aktor | 🔴 **`Marketing`** — nol mapping, lihat §3.1 |
| Data operasional | `transactions` **0** · `clients` **0** · `campaigns` **0** · `leads` **3** (buatan QA) |

> ⚠️ **Live masih kosong secara operasional.** Semua verifikasi RLS/uang sejauh ini terbukti di PG16
> lokal + CI, **bukan** atas baris produksi nyata. **Ditagih pada TRX pertama yang masuk.**

---

## 2. Yang selesai sesi ini

### 2.1 ✅ O41 #1 — `POST /clients/{id}/payment-intent` (commit `95a99e5`)
Port `backend/internal/module4_client/intent.go`. Handoff M4 §5 Sales → Admin & Finance.

Satu deklarasi Sales, **dua baris ter-stamp dalam SATU transaksi DB** (`clients.payment_intent` +
`transactions.payment_intent_scheme`, M5 §8.3), masing-masing dengan baris audit before→after
sendiri. Keduanya di-lock `FOR UPDATE` sebelum pengecekan supaya verifikasi Finance yang bersamaan
tidak bisa menyelip antara baca dan tulis. Nol migrasi · nol installment dibuat di sini (jadwal
Termin tetap kerja `finance.createSchedule`) · nol notifikasi.

> 🚫 **TIGA hal di endpoint ini yang TERLIHAT seperti bug tapi BUKAN — jangan "diperbaiki":**
> 1. **Otoritas = IDENTITAS, bukan level.** Hanya `sales_pic_id` klien itu atau Director. **Sales Lead
>    yang bukan PIC klien tersebut memang DITOLAK**, sama seperti salesperson lain. M4 §5 Flow 1
>    menyebut *"the Sales PIC"* spesifik, dan lock matrix §4 memperlakukan Sales PIC vs Sales Lead
>    sebagai otoritas terpisah. Keputusan **W1-13**, sudah tercatat di `DECISIONS.md`.
> 2. **`MSG_INTENT_LOCKED` bukan string BI baru.** Di-port byte-per-byte dari Go; string itu sudah
>    disetujui di entri Decided **2026-07-10**. Bukan pelanggaran "nol string BI baru".
> 3. **Nol notifikasi.** M4 §5 Flow 2 minta *"notifies Finance"*, tapi katalog **FROZEN** tidak punya
>    event yang cocok dan tidak boleh diperluas sepihak. Deferral = keputusan W1-13. Tidak ada yang
>    hilang secara fungsional — TRX sudah terlihat Finance sejak closing membuatnya di
>    `[Menunggu Verifikasi]`.

Terkunci (`IntentLockedError` → **409**) begitu Finance mencatat verifikasi **apa pun** ATAU TRX
keluar dari `[Menunggu Verifikasi]`; dari titik itu skema milik Finance dan `finance.changeScheme`
(M5-OA-6) satu-satunya jalur.

### 2.2 🔴 Kelas bug BENTUK respons — ditemukan & 2 kasus ditutup (O43)
**Ini temuan yang lebih penting dari endpoint di §2.1. Baca sebelum menyentuh tiket O41 mana pun.**

`apps/api/src/lib/route-parity.test.ts` mendiff **keberadaan path**, **bukan badan JSON**. Jadi sebuah
endpoint bisa **ADA**, membalas **200**, dan halamannya **tetap kosong** — tanpa error di CI maupun di
log. Dua endpoint M4 memang begitu sampai commit `95a99e5`:

| Endpoint | Yang salah | Akibat di produksi |
|---|---|---|
| `GET /clients/{id}` | mengembalikan objek domain **camelCase mentah**, padahal tipe `Client` di FE snake_case. Lebih parah: `total_sales` + `transaction_id` yang halaman itu **render** sama sekali tidak ada di read model domain | **SETIAP** field di halaman Client Record membaca `undefined` |
| `GET /clients` | membalas `{ clients: … }`, sementara FE membaca `res.data` | `setClients(undefined)` → daftar klien kosong |

Keduanya **kelas yang sama dengan C03-F2** (house rule #8: setiap objek domain lewat wire mapper).
Sudah ditutup lewat `clientDetailToWire` + `clientListRowToWire` (mirror `clientView`/`serviceViews`
Go; uang di-format IDR **di boundary**, persis tempat `money.Format()` Go memformatnya), dipakai di
ketiga route M4. Ditambah `totalSales`/`transactionId`/`masterServiceId` ke `sales.getClient`.

**Yang MASIH terbuka → O43, §3.2.**

### 2.3 O42 diperluas — audit roster live penuh (commit `3818d4a`)
Lihat §3.1. Ringkas: temuan asli **meremehkan** masalahnya dan **salah menebak korbannya**.

### 2.4 Verifikasi (dijalankan 2026-07-29, terhadap Postgres NYATA)
`@cdps/domain` **436** hijau (bukan 285 skip; +10) · `apps/api` **186** (+9) · `web-internal` **26** ·
`core` **112** · `db` **9** · keempat invariant SQL **PASS** · typecheck seluruh workspace bersih ·
`KNOWN_GAPS` **8 → 6**.

Test baru mencakup: keempat opsi §5 Rule 2 ter-stamp di dua baris · audit ganda before→after ·
matriks otoritas termasuk penolakan Sales Lead · dua jalur lock (ada verifikasi / status pindah) ·
bukti intent **TIDAK** merilis klien ke Account maupun membuat installment · dan assertion positif
bahwa route-nya benar-benar terdeteksi di path yang FE panggil.

---

## 3. Menunggu keputusan manusia (tidak bisa didorong developer)

### 3.1 🔴 O42 — divisi `Marketing` tidak punya wujud di produksi
`role_mappings` live hanya pernah menghasilkan **6** division. **`Marketing` tidak ada sama sekali**
⇒ tidak satu pun dari 68 karyawan aktif bisa resolve ke `division='Marketing'`, dan re-sync HRIS
**tidak** akan mengubahnya sampai ada baris mapping.

| Yang mati di produksi | Bukti di kode |
|---|---|
| **Reassign owner Campaign (M3 §5 Rule 1 / M3-OA-6) — untuk aktor APA PUN** | `campaign.validateOwnerCandidate` wajib kandidat `Marketing`/`staff` aktif. Director lolos `canReassign` (`permission.isLead` meloloskan director) lalu **tertahan di validasi kandidat** ⇒ `NotFoundError`. Tidak ada aktor yang bisa lewat. |
| Campaign hanya bisa lahir **self-owned di tangan Director** | `campaign.canCreate` = Director ∪ Marketing staff/lead; suku kedua kosong. |
| Leads Database: arm Marketing-lead **dan** Marketing-staff | `leads.leadListScope` ⇒ tinggal Director/OD/Sales-lead. Bersinggungan **O40**. |
| Arm own-campaign migrasi **`0009`** | Butuh aktor Marketing-staff **DAN** campaign; keduanya nol ⇒ **belum pernah bisa fire**. Jangan tandai terverifikasi di produksi. |

**Koreksi arah-sebaliknya:** divergensi CSV **tidak punya korban**. 61 dari 68 resolve lewat mapping;
**7** yang tidak adalah **tepat** ketujuh pemegang `employee_layered_roles` (3 OD riil, 2 Director
riil, QA Director, QA OD) — `division=''` mereka memang perilaku yang dikehendaki (mirror Go:
*absent mapping = pure Director/OD*). **Nol** mapping yatim, **nol** karyawan tanpa peran. Baris CSV
`BUSINESS DEVELOPMENT`→Marketing yang hilang dari live tidak menelantarkan siapa pun — divisi itu pun
tidak ada di roster.

**Butuh dari pemilik / HR / OD — empat pertanyaan:**
1. Siapa pemilik proses ubah-peran (HR? OD? Director?) dan lewat UI apa? (hari ini: **SQL langsung ke
   produksi**, satu-satunya jalur — `apps/api` nol route `role_mappings`)
2. `role_mappings` di-manage lewat admin CDPS, atau di-derive dari sheet HR tiap sync?
3. Rekonsiliasi **38** (live) vs **23** (`backend/seed/role_mappings_riil.csv`) vs **12**
   (`supabase/seed.sql`) — mana sumber kebenarannya?
4. 🆕 Apakah MEA memang **belum punya** divisi Marketing (⇒ M1/M3 de-facto dijalankan Sales/Account,
   PRD perlu dibaca ulang), atau divisi itu **ada** di HRIS dengan **nama lain** yang belum dipetakan?
   → menentukan apakah O42 selesai dengan **satu baris mapping** atau dengan **revisi scope M1/M3**.

### 3.2 🆕 O43 — paritas BENTUK respons
Latar: §2.2. Yang butuh keputusan **pemilik**:

- **(a)** `clientListRowToWire` sengaja **lebih sempit** dari `handleListClients` Go, yang merender
  `clientView` **PENUH** per baris. Memperlebarnya berarti **N+1** query platforms/allocations/
  services untuk kolom yang halaman roster tidak pernah baca. Dipilih proyeksi sempit yang menutup
  **100%** field yang FE benar-benar render. **Deviasi dari oracle Go ini perlu di-ack** — atau
  paritas penuh yang dimaui.

Sisanya kerja **developer**, bukan keputusan:
- **(b)** **60+ route GET lain belum pernah diaudit** terhadap tipe FE-nya. Dua ditemukan hanya karena
  tiket ini menyentuh M4 ⇒ jumlah sebenarnya **tidak diketahui, asumsikan >0**.
- **(c)** Bikin **test paritas-bentuk otomatis**: diff kunci wire mapper terhadap `interface` di
  `web-internal/src/lib/*.ts`, seperti `route-parity.test.ts` men-diff path. Satu-satunya cara kelas
  ini berhenti lolos CI.

### 3.3 Sisa yang lain
| # | Isi |
|---|---|
| **O40** | ✅ diputus arah (b), **eksekusi ditunda sampai setelah gate C-04**. Kerjanya + kolom "Didaftarkan oleh" ada di **issue #64** |
| **O34 · O26 · O35 · O25 · O9** | Aktor Wave 2 · NIK/email Director · sub-tim Creative · anomali kalkulator · target M14 → `HANDOFF_CUTOVER_SESI5.md` §3.1 |

**O24 & O33 sudah RESOLVED — jangan dibuka lagi.** Komisi Rp0 adalah nilai sah; Finance sudah punya
aktor produksi (`SENIOR FINANCE, ACCOUNTING & TAX` → `Finance`/`lead`).

---

## 4. TIKET BERIKUTNYA

### 4.1 Sisa O41 — 6 endpoint, semuanya butuh fungsi domain baru
Buku besarnya: `apps/api/src/lib/route-parity.test.ts` (`KNOWN_GAPS`) + baris O41 `DECISIONS.md`.
Urutan hulu-ke-hilir:

| # | Endpoint | Catatan |
|---|---|---|
| 1 | `GET /finance/queue` | Go `Service.Queue`; gate endpoint Finance/OD/Director. **Aktor Finance riil SUDAH ada** (O33) dan `0010` **sudah** ter-apply ⇒ jebakan "hijau lokal, kosong di produksi" dari sesi 6 **tidak lagi berlaku** |
| 2 | `GET /transactions/{id}` | Go `LoadTransaction`. **`trxVisibility` JANGAN di-port** — visibilitas baris = RLS (O37); penolakan muncul sebagai **404**, deviasi yang sudah disetujui |
| 3 | `POST /transactions/{id}/schedule` | Go `CreateSchedule`: lock baris, guard idempotensi ada-installment/ada-verifikasi, Σ termin = total, mint `INST-` |
| 4 | `GET /transactions/{id}/bermasalah` | file route-nya **ADA** tapi hanya meng-ekspor `POST` |
| 5 | `POST /leads/bulk` | impor massal lead Marketing (bersinggungan O22 — **dan** O42: tidak ada aktor Marketing) |
| 6 | `GET /audit` | jejak audit lintas-modul (panel riwayat aset Creative) |

> 🔴 **Untuk keenamnya: periksa BENTUK respons, bukan cuma keberadaan route** (§2.2 / O43). Halaman
> `finance/transactions/[id]` membaca `res.transaction.installments` — pastikan mapper-nya ada
> sebelum menyatakan endpoint #2 selesai.

House rule yang mengikat: baca WAJIB `requireActor` + `readAsActor` · setiap objek domain lewat
**wire mapper** (penyebab C03-F2 **dan** O43: bigint/camelCase mentah ⇒ 500 atau halaman kosong).

### 4.2 Sisa pekerjaan lain
Impor lead historis (**O22**) · 3 SKIP C-03 (`HANDOFF_CUTOVER_SESI3.md` §5) · konfirmasi data
Railway/MySQL riil atau UAT. Sesudah **C-04** → **C-05** (retire Go).

---

## 5. Jebakan & pelajaran (hemat waktu — jangan diulang)

### 5.1 ⚠️ `npm ci` HARUS dari ROOT repo
Menjalankannya dari dalam `packages/*` atau `apps/*` menghasilkan pohon **ter-prune** (mis. tanpa
`next`, hanya ~44 paket di root `node_modules`), lalu `npm run typecheck -w @cdps/api` gagal dengan
`Cannot find module 'next'`. Itu **artefak instalasi, BUKAN regresi kode.** Hilang waktu di sesi ini.

### 5.2 Cara menjalankan test DB-backed di sandbox (426→436 lolos, bukan 285 skip)
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
```
Invariant SQL: `psql` butuh file yang bisa dibaca user `postgres` ⇒ **copy ke `/tmp` + `chmod 644`**
dulu, kalau tidak dapat `Permission denied` dari scratchpad.

### 5.3 Lain-lain
1. **Notifikasi & audit tak bisa dihapus** ⇒ assertion yang **menghitung** baris **wajib** di-scope ke
   `entity_id` milik test itu, kalau tidak gagal pada run KEDUA di DB yang sama. CI tidak pernah
   melihatnya karena selalu DB baru.
2. **Probe RLS wajib punya baris kontrol** (superuser + Director). Probe tanpa kontrol pernah memberi
   0 untuk SEMUA role dan terlihat seperti temuan dramatis — ternyata `INSERT` fixture-nya gagal.
3. **Diff route jangan pakai regex** — path FE menyisipkan `${cond ? \`?${qs}\` : ''}` (template +
   brace bersarang). Pakai scanner ber-penghitung kedalaman.
4. `payment_verifications` mereferensi `transactions` **dan** `installments` ⇒ di `afterEach`, hapus
   **sebelum** keduanya atau FK-nya trip.
5. `npm run lint -w @cdps/api` gagal juga di tree bersih (`apps/api` tanpa `eslint.config.*`) —
   pre-existing, di luar CI.
6. Job CI `backend` 5–6 menit, `db-and-migrations` ~1,5 menit — bukan hang.
7. **`send_later`/`CronCreate` tidak bisa diandalkan lintas sesi** — session-only dan hanya fire saat
   REPL idle.

### 5.4 Batasan sandbox — per 2026-07-29
- ✅ **Supabase MCP dengan akses `CDPS SG` TERSEDIA** — dipakai sesi ini untuk audit roster O42 dan
  sesi lalu untuk apply 2 migrasi. **Periksa dulu tool yang ada** sebelum menyimpulkan live tak
  terjangkau; batasan ini **per-sesi**, bukan sifat permanen environment.
- ❌ Deployment **Vercel** tetap tak bisa disentuh.
- ❌ **Tidak ada klien HTTP ke `agency-app-api`** ⇒ konfirmasi endpoint lewat **HTTP nyata** masih
  **utang O41** yang belum pernah bisa dibayar dari dalam sesi. Semua klaim "endpoint jalan" sejauh
  ini berbasis test + pembacaan kode, **bukan** request nyata ke produksi.

---

## 6. ⚠️ Pekerjaan menggantung yang butuh aksi pemilik

**PR #63 (`claude/handoff-sesi-5-inmsq9`, draft) sudah KEDALUWARSA — sebaiknya DITUTUP.**
Isinya mengoreksi `HANDOFF_CUTOVER_SESI6.md` §0/§1 + runbook agar berbunyi *"migrasi RLS BELUM
ter-apply, sandbox tidak bisa"*. **Kedua migrasi sudah ter-apply 2026-07-29**, dan commit `f5d93c8`
di branch ini sudah menulis ulang bagian yang sama dengan keadaan sebenarnya (runbook kini bertanda
**"✅ SUDAH DIJALANKAN — JANGAN DIJALANKAN ULANG"**). Membiarkannya terbuka berisiko: kalau di-merge
setelah PR #65, ia akan **konflik** atau **mengembalikan** dokumen ke premis yang salah.

Tidak ditutup dari sesi ini karena menutup PR adalah aksi keluar yang perlu persetujuan pemilik.

---

## 7. Aturan main (tidak berubah)

Jangan sentuh `backend/` (Go **beku**, oracle paritas saja) · perubahan ke `apps/api` / `packages/*` /
`web-internal` / `supabase/` · baca PRD + `STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi ·
**nol string BI baru tanpa DECISIONS** · katalog notifikasi **FROZEN 15 event** · baca WAJIB
`requireActor` + `readAsActor` · notifikasi & audit **tak pernah** bisa dihapus · helper RLS
`SECURITY DEFINER` hidup di schema `private` · setiap objek domain lewat **wire mapper** · **jangan
apply migrasi ke `CDPS SG` tanpa menuliskannya ke `supabase/migrations/`** · ambiguitas/deviasi PRD ⇒
**STOP**, tulis baris **Open** di `DECISIONS.md` · seed/impor data produksi lewat jalur domain, bukan
SQL langsung.

---

## 8. Utang teknis yang diketahui

1. 🟡 **Penomoran migrasi repo (`202601…`) ≠ riwayat remote (`202607…`).** `supabase db push` akan
   menganggap SELURUH migrasi belum ter-apply. **Selaraskan sebelum memakai jalur CLI.**
2. **O39** — pintu registrasi lead tanpa gate role (diputuskan: dibiarkan, utang terdokumentasi).
3. **O43(b)** — 60+ route GET belum diaudit bentuk respons-nya.
4. `clear_must_change_password` & `employee_display_name` ada di DB, nol pemanggil TS — bersihkan di C-05.
5. Dua salinan `msl_kalkulator.csv` (`backend/seed/` beku + `supabase/seed/` aktif); test penjaga
   auto-skip begitu `backend/` hilang.
6. `apps/api` tanpa `eslint.config.*`.
7. `BACKEND_URL` tidak di-set untuk environment **Preview** Vercel `web-internal-mea` ⇒ preview FE
   memanggil API **produksi**, jadi preview per-PR tidak pernah menguji API dari branch yang sama.
