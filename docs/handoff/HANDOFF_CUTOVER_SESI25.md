# HANDOFF — Cutover Sesi 25 (C-03 SELESAI · gate berikutnya C-04)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI24.md`. Masih sahih **kecuali** §3 butir 8
> (`performance_snapshots` "0 baris" — kini 38, lihat §1.2 di bawah).
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4 (`npm run db:rebuild`) ·
> SESI19–22 §3.1 (daftar "jangan dikerjakan") · SESI23 §1.1 (baris tentang live WAJIB dibaca
> dari live) · SESI24 §1.4 (**jangan tambah NIK/PII baru ke repo** — repo masih publik, dicek
> ulang hari ini lewat API).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/baca-handoff-cutover-szsw80`** — di-restart dari `main` sesudah PR #85 merged |
| **Keadaan branch** | Lihat `git log --oneline main..HEAD` dan `git status --short`. Jangan percaya sha di berkas ini |
| **`main` saat sesi ini MULAI** | `df3dddb` = Merge PR #85. Rantai: … → #82 → #84 → **#85** |
| **PR sesi ini** | **#87** — C-03 ditutup + O50 selesai + draft rollback. **Di-merge di akhir sesi ⇒ `main` kini = Merge PR #87.** Verifikasi dengan `git log --oneline origin/main -1`, jangan percaya baris ini |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 `notif_events`** — dibaca dari live sesi ini |
| **Repo vs live** | ✅ **44 = 44**, `main` juga 44 |
| **C-03** | ✅ **SELESAI 2026-07-31** — run `30600363211`, **PASS 69 · FAIL 0** |
| **Karyawan aktif** | **59 aktif dari 65 baris** (sesi ini: 10 fixture dinonaktifkan §1.5, 4 di antaranya lalu dihapus §1.7). **Pakai 59 untuk keputusan apa pun** |
| **Fixture tersisa** | **6 tombstone permanen** — nonaktif + ban GoTrue, **tidak bisa dihapus siapa pun** (§1.7) |

**Angka acuan** tidak berubah dari SESI24 (sesi ini **nol perubahan kode** — hanya dokumen):
`apps/api` **313** · `@cdps/domain` **567** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed PASS · 4 invariant SQL PASS · `route-parity` 5/5, ketiga
ledger **KOSONG** · typecheck & lint bersih.

> ⚠️ **`npm test --workspaces` TIDAK menjalankan `web-internal`** — ia bukan anggota
> `workspaces`. Jalankan terpisah: `npx vitest run --root web-internal`.

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout -B <branch-anda> origin/main
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes                          # 44/44
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal                   # TERPISAH
```

---

## 1. Yang dikerjakan sesi ini

### 1.1 ✅ C-03 DITUTUP — UAT dijalankan terhadap deployment produksi

Pemilik meng-approve environment `c03-production`; job `uat` jalan 03:13→03:18 UTC.

| Skrip | Hasil |
|---|---|
| `cutover-houserules-walk.mjs` | **22/22** — menutup **SKIP-1** |
| `wave3-contract-smoke.mjs` | **34/34 wired** |
| `auth-smoke.mjs` | **13/13** — menutup **SKIP-3** |

**PASS 69 · FAIL 0 · nol baris SKIP di output.** Report:
**`docs/handoff/CUTOVER_UAT_REPORT_20260731.md`** (report `20260728` **tidak disunting** —
ia bukti historis walk lokal). Backlog §C-03 → ✅ SELESAI. `DECISIONS.md` 2026-07-31.

**Yang baru terbukti hari ini**, dan tidak pernah terbukti sebelumnya: konfigurasi env Vercel,
kunci JWT produksi, perilaku pooler Supabase. Itulah isi C-03 yang sebenarnya — report
2026-07-28 hanya pernah membuktikan kode + skema.

**Konfirmasi silang C-03 §7:** slot `od` walk diresolusi ke `2501140493` — salah satu dari tiga
orang yang baru diberi layered `director` kemarin. Ia lolos cek OD lintas-divisi **dari
deployment**, jadi grant kemarin merambat sampai ke aplikasi, bukan berhenti di tabel.

**SKIP-2 (badge notifikasi) TETAP TERBUKA** dan **pindah ke daftar QA UI C-04**, berdampingan
dengan `/master-services` + `/sales/kalkulator`. Ia tidak menahan DoD C-03 (*report tersimpan ·
FAIL = 0 · tiap SKIP beralasan*), tapi jangan sampai menguap.

### 1.2 🟠 Residu produksi run ini LEBIH BESAR dari yang diumumkan sebelum approval

Yang disetujui: *"2 lead `ZZC03` + baris `audit_log`"*. Yang benar-benar tertulis, diukur
dari live sesudah run:

| Tabel | Sebelum | Sesudah |
|---|---|---|
| `leads` · `prospect_attempts` | 3 · 3 | **6 · 6** |
| `audit_log` | 43 | **50** |
| `performance_snapshots` | **0** | **38** |
| `notifications` | **0** | **38** |
| `clients` · `transactions` | 0 · 0 | 0 · 0 (tak tersentuh) |

Dua hal yang perlu diketahui sesi berikutnya:

1. **Lead ketiga tidak ber-marker.** `LEAD-202607-0006` bernama **`Smoke`** (dari `auth-smoke`,
   yang punya konvensi penamaan sendiri) ⇒ prosedur bersih-bersih *"cari prefix `ZZC03`"* di
   runbook **akan melewatkannya**. Sudah masuk daftar C-04.
2. **`POST /performance/snapshots/scan` menghitung sungguhan** — 38 snapshot periode 2026-06 +
   **38 notifikasi `m14.performance.published` ke 38 karyawan riil**, dihitung dari produksi
   nol-klien-nol-transaksi. Benar secara mesin, tak bermakna secara bisnis. **Ini membatalkan
   premis SESI24 §3 butir 8** (`performance_snapshots` 0 baris): probe RLS-nya bisa dijalankan
   sekarang, tapi atas data sintetis.
   🔎 **Sisi baiknya:** ini satu-satunya jendela untuk mengerjakan **SKIP-2** — badge butuh
   notifikasi belum-dibaca, dan sebelum hari ini tabelnya kosong. Kerjakan **sebelum** dibersihkan.

`audit_log` **tidak boleh** dihapus saat bersih-bersih — aturan rumah #3 tanpa pengecualian
untuk data uji.

### 1.3 🟠 Slot Finance masih dilayani fixture O50 ⇒ run C-03 wajib diulang sesudah O50

`finance_staff` diresolusi ke **`9900000007`**. Roster live: **69 aktif = 59 riil + 10 fixture**
(Finance: 4 aktif = 3 riil + 1 fixture). Begitu O50 dieksekusi, discovery memilih Finance riil —
artinya run 2026-07-31 tidak reproducible apa adanya. Bukan alasan menunda O50; alasan untuk
**menjalankan ulang workflow sekali sesudahnya** sebagai konfirmasi terakhir sebelum gate GO.
Biayanya satu klik approval.

### 1.4 Redaksi PII di report

Repo dicek ulang lewat API hari ini: **masih publik**. Blok `aktor terpakai` karena itu masuk
report **tanpa nama orang**, dan satu NIK yang belum pernah ada di repo diganti `‹NIK-A›`.
Blok verbatim tetap hidup di artifact `c03-output` + log run. Reproducibility tidak hilang:
ketiga skrip **meresolusi aktor dari environment yang diuji**, bukan dari konstanta di berkas.

> ⚠️ Artifact `c03-output` (id `8781965829`) **kedaluwarsa 2026-10-29**. Sesudah itu output
> verbatim hanya ada di log run. Kalau bukti ini harus bertahan lebih lama, unduh sebelum itu.

### 1.5 ✅ O50 langkah 1 — 10 akun fixture dinonaktifkan + di-ban GoTrue (reversibel)

Izin pemilik: *"nonaktifkan 10 dulu"*. Dieksekusi satu transaksi lewat `set_employee_banned()`,
**1 baris `audit_log` ber-`before`/`after` per akun** (`actor='O50-OWNER-DECISION'`).
**Diverifikasi dua lapis:** tabel ⇒ `status_aktif=false` ×10 **DAN** GoTrue ⇒
`banned_until='infinity'` ×10. **Headcount aktif kini 59** — angka riil.

**Dua hal yang ditemukan saat mengerjakannya, dan keduanya mengubah bentuk O50:**

1. **"Hapus 10" tidak bisa dijalankan apa adanya.** `9900000001` (1 lead + 2 audit) dan
   `9900000004` (2 lead + 4 audit) sudah menulis riwayat ⇒ aturan rumah #3 melarang membuangnya.
   Bentuk yang benar: **8 boleh dihapus, 2 wajib tombstone nonaktif.**
2. **`status_aktif=false` saja KOSMETIK.** Ia hanya menghentikan `getMe`; GoTrue tetap
   menerbitkan token. Pencabutan sesungguhnya ada di `set_employee_banned()` yang menulis
   **keduanya**. Siapa pun yang kelak menonaktifkan akun lewat `UPDATE employees` langsung akan
   mengira sudah mencabut akses padahal belum.

**Cakupan role tidak putus** (diverifikasi): Sales 1 lead · Account 2 · Creative 1 · Finance 1;
Ads/KOL/Marketing tetap dilayani 3 pemegang layered `lead` yang semuanya riil.

**Membatalkannya:** `select set_employee_banned('<nik>', false);` — mengembalikan `status_aktif`
dan mencabut ban. Sesi lama tetap harus login ulang.

### 1.7 ✅ O50 langkah 2 — 4 akun dihapus, 6 sisanya PERMANEN tidak bisa dihapus

Dihapus penuh (`employees` + `employee_credentials` + `employee_layered_roles` + `auth.users`,
1 baris `audit_log` ber-`before_json` berisi seluruh baris): **`…02`, `…03`, `…05`, `…07`**.
**Roster 69 → 65 · GoTrue 69 → 65 · layered 13 → 12 · aktif tetap 59.**

**Enam tombstone permanen, dua sebab berbeda:**

| Akun | Terkunci oleh |
|---|---|
| `9900000001` · `9900000004` | riwayat: lead + baris `audit_log` (aturan rumah #3) |
| `9900000006` · `…08` · `…09` · `…10` | **trigger `forbid_mutation()` di `performance_snapshots`** |

🔴 **Koreksi penilaian saya sendiri beberapa jam sebelumnya.** Saya menyebut keempat akun terakhir
"boleh dihapus" karena `performance_snapshots` saya baca sebagai field turunan yang recomputable
(aturan rumah #4). **Salah.** Skema memperlakukannya sebagai **riwayat immutable** (#3), dan DB
adalah otoritasnya. Percobaan hapus **ditolak DB dan ter-rollback utuh** —
*"performance_snapshots is append-only/immutable: DELETE forbidden"*. **Penolakan itu dihormati,
bukan disiasati:** satu-satunya cara menembusnya adalah menonaktifkan trigger immutability di
produksi, yang berarti membongkar jaminan demi 4 baris fixture.

**Sebab-akibatnya perlu diingat:** run C-03 kemarin **mengubah 4 fixture yang tadinya bisa dihapus
menjadi permanen** — `snapshots/scan` menyentuh seluruh karyawan aktif termasuk fixture. Ini biaya
nyata dari residu C-03 §5.2, dan alasan konkret untuk berpikir dua kali sebelum menjalankan smoke
yang menulis ke produksi.

### 1.8 ✅ DoD C-04 dirumuskan ulang & disetujui pemilik ⇒ O50 TERTUTUP PENUH

*"Nol fixture UAT di produksi"* → ***"nol fixture UAT yang AKTIF atau BISA LOGIN di produksi"***.
Rumusan lama mustahil secara harfiah (§1.7). **Yang dilonggarkan adalah keberadaan baris, BUKAN
akses** — dan supaya tidak bisa diklaim tanpa bukti, DoD-nya diberi **tiga kueri pengukur** di
`CUTOVER_BACKLOG.md` §C-04, ketiganya wajib nol dan **wajib dibaca dari live**:

| Pengukur | Hasil 2026-07-31 |
|---|---|
| fixture ber-`status_aktif=true` | **0** |
| fixture yang `banned_until` NULL / sudah lewat (masih bisa login) | **0** |
| fixture yang masih resolve ke role lewat `role_mappings` | **0** |

Ditambahkan butir anti-rembet supaya pelonggaran ini tidak dipakai membenarkan hal lain:
*"nol data uji yang bisa disalahartikan sebagai data bisnis"* — residu C-03 tetap wajib
dibersihkan sejauh yang diizinkan skema. `DECISIONS.md` 2026-07-31.

**Risiko yang diterima sadar:** 6 baris fixture akan ikut terlihat di query `employees`
selamanya. Filternya pola `99%`.

### 1.6 ✅ Draft rencana rollback ditulis

`docs/handoff/RENCANA_ROLLBACK_CUTOVER.md`. Isi terpentingnya bukan prosedurnya, melainkan §0:
**rollback sekarang hampir gratis** (`clients` 0 · `transactions` 0 — nol data bisnis yang hanya
hidup di Supabase), **dan jendela itu tertutup pada transaksi riil pertama**, karena mundur
sesudahnya menuntut importer mundur yang **sengaja tidak dibangun** (O47). Itu menjadikan gate GO
bukan cuma *"apakah TS siap"* tapi juga *"apakah kita menerima jalan mundur tertutup"*.
Dua bagian 🔶 TBD sampai backup MySQL (butir 4) ada.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| 1 | **C-04** — gate berikutnya. Termasuk: bersih-bersih residu §1.2, QA UI (`/master-services`, `/sales/kalkulator`, **badge eks-SKIP-2**), aktor produksi | **pemilik** → Claude |
| 2 | ~~**O50**~~ ✅ **TERTUTUP PENUH 2026-07-31** (§1.5 · §1.7 · §1.8): 4 dihapus, 6 tombstone permanen, DoD C-04 dirumuskan ulang & disetujui, ketiga pengukur **0**. **Tidak ada sisa.** Tindak lanjut: **ulang run C-03 sekali** (§1.3) — slot `finance_staff` dulu `9900000007`, yang kini terhapus | Claude, sesudah pemilik approve run |
| 3 | **O35** (sub-tim Creative M7 §3) · **O9** (target M14) · **divisi dasar** 3 orang OD — **pakai headcount 59, bukan 69** (§1.5) | **pemilik** |
| 4 | **Backup MySQL Railway + OQ-2** — **prasyarat rollback**, lihat `RENCANA_ROLLBACK_CUTOVER.md` §3.1 | **pemilik** |
| 4b | ~~Rencana rollback~~ ✅ **draft ditulis 2026-07-31** — `docs/handoff/RENCANA_ROLLBACK_CUTOVER.md`. Naik jadi "bisa dijalankan" begitu butir 4 selesai | Claude |
| 5 | **O48 Grup A/B/E** — Grup C+D sudah live | **pemilik + head dev** → Claude |
| 6 | **Visibility repo** → privat, lalu tinjau ulang **O47b** | **pemilik** |
| 7 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 8 | ~~Probe `performance_snapshots` saat datanya ada~~ — datanya ada (38), tapi **sintetis**. Probe `transactions` · `*_block_requests` masih menunggu data riil | Claude, saat datanya ada |

**Progress pensiun Go: ~94%** (engineering sisi Claude **100%** sejak sesi 19; Fase 4 naik dari
~70% ke ~80% karena C-03 tertutup — tetap **estimasi**, butir gate tidak punya satuan yang bisa
dijumlah; Fase 5 ~15% terkunci gate GO).

## 3. Yang JANGAN dikerjakan

Seluruh daftar SESI19–24 masih berlaku. Penegasan yang paling relevan sekarang:

- **Jangan apply ulang migrasi mana pun** — 44 di live, 44 di repo, cocok 1:1.
- **Jangan salin baris "Live"/"Repo vs live" dari handoff mana pun** — baca dari live.
- **Jangan sunting `CUTOVER_UAT_REPORT_20260728.md`** — bukti historis, berdiri sendiri.
- **Jangan hapus baris `audit_log`** saat membersihkan residu C-03 (aturan rumah #3).
- **Jangan tulis ulang entri `DECISIONS.md` lama** — append-only; koreksi = entri baru.
- **Jangan tambah baris ke ketiga ledger** tanpa entri `DECISIONS.md`. Ketiganya hanya menyusut.
- **Jangan bangun apa pun di `backend/`** — oracle paritas read-only sampai C-05.
- **Jangan tambah NIK/PII baru ke repo** selama status publik belum berubah.
- **Jangan setujui sendiri run `uat`** — gerbang `c03-production` ada justru supaya production
  write butuh manusia.
