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
| **Branch kerja** | **`claude/go-retirement-progress-eq0855`** — lanjutkan di sini, jangan buka branch baru |
| **Keadaan branch** | **3 commit di atas `main`, sudah ter-push, BELUM ada PR.** Working tree bersih |
| **`main`** | **`a38e241`** = Merge PR #82 |
| **PR** | **tidak ada yang terbuka.** PR #82 sudah **merged**. Tiga commit terbaru belum di-PR-kan — buka PR baru bila ingin di-merge |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 event**. Tiga apply terakhir hari ini: `20260730120433` (fix O46) · `20260730153627` (O48 Grup C+D) · `20260730154210` (layered role `lead`) |
| **Repo vs live** | ✅ **44 = 44**, nama berkas = versi live **1:1** |

**Angka acuan** (Postgres 16 lokal, DB dibangun ulang dari nol, **44/44** bersih):
`apps/api` **311** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · 4 invariant SQL **PASS**
(`rls_checks` **32 check** · `auth_claims_checks` **4 check**) · `route-parity` **5/5**,
`KNOWN_GAPS` KOSONG · `NESTED_INLINE_UNCHECKED` KOSONG · `RFC3339_PENDING_DECISION` KOSONG.

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
| 2 | **7 karyawan tak terpetakan** — §7 di bawah. **Hanya 5 yang riil** (2 sisanya fixture O50) | **pemilik** |
| 3 | **O48 Grup A/B/E** — `O48_ANALISIS_KEPUTUSAN.md`. Grup C+D sudah selesai & live | **pemilik + head dev** → Claude |
| 4 | Backup MySQL Railway + OQ-2 · rencana rollback | **pemilik** |
| 5 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 6 | Probe ulang `transactions`, `performance_snapshots`, `*_block_requests` begitu ada data riil (ketiganya **kosong** di live, jadi arm-nya belum terbukti oleh data) | Claude, saat datanya ada |

## 7. Daftar 7 karyawan tak terpetakan — dan hanya 5 yang riil

`employee_claims(...)->>'division' = ''` ⇒ tidak punya divisi CDPS ⇒ **tidak dapat scope divisi apa
pun**. Arahnya aman (lebih sempit), tapi arm O46/O48 tidak menyala untuk mereka.

| # | `employee_id` | dept HRIS | jabatan | Catatan |
|---|---|---|---|---|
| 1 | `200000001` | Director | Director | Layered **director** ⇒ sudah akses penuh. **Non-blocking** |
| 2 | `200000002` | Director | Director | idem |
| ~~3~~ | ~~`9900000001`~~ | ~~Director~~ | ~~Director~~ | 🔴 **fixture O50**, bukan karyawan riil |
| 4 | `2501140493` | OD | SENIOR ORGANIZATION DEVELOPMENT | butuh divisi dasar + keputusan layered `od` |
| 5 | `2507250557` | OD | SENIOR DATA ANALYST | idem |
| 6 | `2607060683` | OD | JR ORGANIZATION DEVELOPMENT | idem |
| ~~7~~ | ~~`9900000002`~~ | ~~OD~~ | ~~SENIOR ORGANIZATION DEVELOPMENT~~ | 🔴 **fixture O50** |

**Jadi yang butuh keputusan Anda: 5 orang, dan hanya 3 di antaranya mendesak.**

- **`200000001` + `200000002` (Director) — tidak mendesak.** Layered `director` sudah memberi akses
  penuh di setiap gate; mapping divisi dasarnya kosmetik. Worksheet §3.1: petakan ke divisi wajar
  mana pun (mis. `Sales`/`lead`) — tidak berpengaruh.
- **Tiga orang dept `OD` — mendesak.** `OD` adalah **layered role, bukan divisi**, jadi mereka tidak
  punya divisi dasar dan saat ini **tidak melihat apa pun di luar data mereka sendiri**. Dua
  keputusan: (a) divisi dasar masing-masing; (b) **siapa yang dapat layered `od`** (read-only
  di mana-mana). Saat ini pemegang layered `od` hanya **`2409230432`** — bukan salah satu dari
  ketiganya.

> Perhatikan `2507250557` **SENIOR DATA ANALYST**: worksheet §2.2 juga mendaftar
> `DATA & BUSINESS INTELLIGENCE / DATA ANALYST INTERN` sebagai dept tanpa padanan CDPS. Kalau ada
> keputusan "analitik tidak dapat scope operasional", keduanya sebaiknya diputus bersama.

**Cara mengeksekusi sesudah dijawab** — `O34_O26_O35_WORKSHEET_ROSTER_V2.md` §4: tambah baris ke
`supabase/seed/role_mappings_riil.csv` (**tambah**, jangan regenerasi — live sudah 39 baris), lalu
`npm run rolemap:seed -w @cdps/api -- --apply`. Untuk layered role: `layered_roles_riil.csv`
(kini menerima `od`, `director`, **dan `lead`**).

> **Kalau yang dibutuhkan adalah menjadikan SEORANG karyawan lead** — gunakan layered role `lead`,
> **bukan** `role_mappings`. `role_mappings` berkunci `(divisi, jabatan)`, jadi menaikkan jabatan
> akan menaikkan **semua** pemegang jabatan itu. Preseden + alasannya: `DECISIONS.md` 2026-07-30.

**Titik masuk umum sesi berikutnya tetap `HANDOFF_CUTOVER_SESI23.md`.** Berkas ini khusus untuk yang
menjalankan C-03.
