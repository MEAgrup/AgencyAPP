# HANDOFF — Cutover Sesi 24 (C-03 §7 ditutup · C-03 eksekusi tidak lagi butuh laptop tertentu)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI23.md` + `HANDOFF_C03_MESIN_VERCEL.md`.
> Keduanya masih sahih **kecuali** premis "Claude tidak bisa menjangkau `*.vercel.app`" — itu
> terbukti hanya setengah benar (§1.3).
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4 (`npm run db:rebuild`) ·
> SESI19–22 §3.1 (daftar "jangan dikerjakan") · SESI23 §1.1 (aturan: baris tentang live WAJIB
> dibaca dari live).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/c03-vercel-director-access-7vmki0`** — di-restart dari `main` sesudah PR #84 merged |
| **Keadaan branch** | Lihat `git log --oneline main..HEAD` dan `git status --short`. Jangan percaya sha di berkas ini |
| **`main`** | **`437ac24`** = Merge PR #84. Rantai: … → #82 → **#84** |
| **PR** | **#84 MERGED.** Tidak ada PR terbuka saat berkas ini ditulis |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 event** — dibaca dari live di sesi ini |
| **Repo vs live** | ✅ **44 = 44**, nama berkas 1:1. **Dan kini `main` juga 44** — sebelumnya `main` tertinggal di 42 |
| **Run UAT C-03** | **`30600363211`** — `probe` ✅ hijau, **`uat` `waiting`** menunggu approval environment |

**Angka acuan** (Postgres 16 lokal, DB dibangun ulang dari nol, **44/44** bersih):
`apps/api` **313** · `@cdps/domain` **567** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · 4 invariant SQL **PASS** · `route-parity` **5/5**,
ketiga ledger (`KNOWN_GAPS`, `NESTED_INLINE_UNCHECKED`, `RFC3339_PENDING_DECISION`) **KOSONG** ·
typecheck & lint bersih.

> ⚠️ **`npm test --workspaces` TIDAK menjalankan `web-internal`** — ia bukan anggota `workspaces`
> (`package.json` hanya `apps/*` + `packages/*`). Jalankan terpisah:
> `npx vitest run --root web-internal`. Mengandalkan `--workspaces` saja membuat 26 test itu
> **terlihat hijau tanpa pernah dijalankan** — itu berlaku untuk setiap angka acuan di atas.

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout -B claude/c03-vercel-director-access-7vmki0 origin/main
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes                          # 44/44
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal                   # TERPISAH — lihat peringatan di atas
```

---

## 1. Yang dikerjakan sesi ini

### 1.1 ✅ C-03 §7 DITUTUP — 5 karyawan tak terpetakan jadi layered `director`

Keputusan pemilik: `200000001`, `200000002`, `2501140493`, `2507250557`, `2607060683` —
*"bisa view dan melakukan task di semua bagian"*. Dua yang pertama sudah `director` sejak
2026-07-24 ⇒ nol perubahan; tiga sisanya (dept HRIS `OD`) ditambahkan. `od` mereka **sengaja
dibiarkan menyala** (aditif; penanda OD dipakai OKR M13).

**`director`, bukan `od`:** `od` read-only di mana-mana (Role Matrix Phase 0 §4) ⇒ ia memenuhi
"view" tapi tidak "melakukan task".

**Di-apply ke live, diverifikasi DUA lapis** — dan lapis kedua yang menentukan:

| Lapis | Hasil |
|---|---|
| `employee_claims()->>'director'` | ✅ `true` ×5 |
| `auth.users.raw_app_meta_data->>'director'` | ✅ `true` ×5 |

Tanpa lapis kedua, grant yang klaimnya tidak merambat terbaca **persis sama** dengan grant yang
tidak pernah terjadi — kelas O46. Apply meniru `admin.setLayeredRole`: upsert + 1 baris `audit_log`
ber-`before`/`after` per orang, satu transaksi, `created_by='C03-OWNER-DECISION'`.

**Nol migrasi baru** — murni data; live tetap 44.

**`9900000001`/`9900000002` sengaja TIDAK disentuh:** dokumen mendaftar 7 baris, dua di antaranya
fixture `QA-SEED` (O50) yang justru harus **nol** di produksi per DoD C-04.

> 🟠 **Konsekuensi yang dinyatakan:** ketiganya ber-`division=''`, jadi `director` kini
> **satu-satunya** sumber akses mereka. Kalau kelak dicabut, mereka jatuh ke **nol scope**, bukan
> ke scope divisi. Pemetaan divisi dasar masih terbuka (worksheet §3.1).
>
> 🟠 **Pemegang sesi lama membawa klaim lama sampai login ulang** — JWT diterbitkan saat login.

### 1.2 🔴 Jalur seed layered role ternyata PATAH — ditemukan saat mengerjakan §1.1

Dua cacat, keduanya mematahkan perintah yang dokumen C-03 sendiri anjurkan:

| Cacat | Akibat |
|---|---|
| `LAYERED_ROLES` di `admin.ts` masih `{od, director}` walau migrasi `20260730154210` + CSV sudah memakai `lead` | `rolemapseed --apply` mem-parsing CSV bersih lalu **mati di `MSG_BAD_ROLE`** di baris `lead` — *sesudah* baris sebelumnya ter-commit ⇒ 3 grant `lead` produksi **tak bisa direproduksi dari seed**, dan bootstrap deployment baru berhenti separuh jalan |
| CSV memuat **`2409230432`** yang **tidak ada** di `employees` live | Guard fase-1 `engine.ts` membatalkan **seluruh** run |

Diperbaiki: gate diperluas ke `lead`, baris hantu dicabut, dan **3 baris `od` yang ADA di live tapi
HILANG dari CSV** ditambahkan supaya CSV idempoten lagi. Dikunci **3 test**, ketiganya
**divalidasi mutasi** (kembalikan `LAYERED_ROLES` ⇒ ketiganya MERAH).

**Satu divergensi disengaja dari string Go:** `MSG_BAD_ROLE` → `[role harus 'od', 'director', atau
'lead']`. Aturan rumah #5 melarang reword, tapi pesan lama kini **menyesatkan** dan Go sudah pensiun.
Test drift BI menangkapnya; ia **diperbarui eksplisit, bukan dilonggarkan**. Tercatat `DECISIONS.md`.

> **Koreksi:** klaim `HANDOFF_C03_MESIN_VERCEL.md` §7 *"pemegang layered `od` hanya `2409230432`"*
> **SALAH** — dibaca dari CSV, bukan dari live. Live tidak pernah punya baris itu.

### 1.3 ✅ C-03 berhenti butuh "mesin ber-akses" — sekarang jalan dari GitHub Actions

Premis lama menggabungkan **dua** hambatan jadi satu alasan. Dipisah, hasilnya berbeda:

| Hambatan | Sesi Claude | GitHub Actions |
|---|---|---|
| Jaringan ke `*.vercel.app` | 🔴 403 CONNECT | ✅ **tembus — terukur** |
| `SUPABASE_JWT_SECRET` | 🔴 nol | ✅ repository secret |

Dibuat `.github/workflows/c03-deployment-uat.yml`, **dua job sengaja dipisah**:

- **`probe`** — nol secret, nol tulis. Membuktikan runner menjangkau deployment **dan** membedakan
  ber-proteksi dari tidak (path tak dikenal harus 404; 401/403 = challenge ⇒ semua baris UAT akan
  FAIL palsu sebagai *path drift*). Plus validasi secret **read-only**.
- **`uat`** — ketiga skrip. **`workflow_dispatch` SAJA** — tidak ada trigger push/PR yang
  menyentuhnya. Production write tidak boleh bisa dipicu `git push`.

**Terukur 2026-07-31 dari runner:**

```
GET /api/healthz            -> 200 {"status":"ok","service":"cdps-api"}
GET /api/<path-tak-dikenal> -> 404          ⇒ TIDAK ber-proteksi, BYPASS tidak perlu
✅ SECRET BENAR — 69 karyawan aktif, 39 role_mapping
   layered director: 6 · od: 4
```

Angka `director: 6 · od: 4` adalah **konfirmasi silang** §1.1: 5 director riil + 1 fixture, 3 od riil
+ 1 fixture. Satu langkah membuktikan tiga hal sekaligus — secret cocok, deployment membaca DB yang
benar, dan grant §1.1 **sampai ke aplikasi**, bukan cuma ada di tabel.

### 1.4 🔴 Repo ini PUBLIK — dan itu mengubah penilaian O47b

Terkonfirmasi dua kali lewat API: `"private": false`, `"visibility": "public"`,
`"allow_forking": true` (forks 0, stars 0).

O47b tercatat sebagai *"tidak memblokir apa pun — terima risikonya"*. Penilaian itu masuk akal untuk
repo **privat**. Untuk repo **publik**, PII di histori git bukan lagi risiko internal — dan
`git filter-repo` tidak menarik kembali apa yang sudah ter-clone atau ter-indeks.

**Pemilik menyatakan akan mengubah repo ke privat.** Sesudah itu O47b kembali ke penilaian lama;
kalau tidak jadi, ia naik kelas jadi butir gate tersendiri.

> ⚠️ **Untuk sesi berikutnya:** selama status publik belum dipastikan berubah, **jangan menambah
> NIK/PII baru ke berkas repo**. Rujuk orang sebagai "5 karyawan §7" dan simpan NIK-nya di live saja.
> Sesi ini menambah NIK ke `DECISIONS.md`, handoff, dan CSV **sebelum** status publik diketahui.

---

## 2. 🔴 SATU HAL YANG MENGGANTUNG — baca ini lebih dulu

**Run `30600363211` job `uat` berstatus `waiting`**, tertahan required reviewer di environment
`c03-production`. Gerbang itu **bekerja sebagaimana mestinya** — ia ada supaya production write
butuh klik manusia.

**Yang harus dilakukan:**

1. Buka https://github.com/MEAgrup/AgencyAPP/actions/runs/30600363211 → **Review deployments** →
   centang `c03-production` → **Approve and deploy**
2. Sesudah hijau: baca artifact `c03-output` (3 berkas `.txt`)
3. Target: **22/22 · 34/34 · 13/13**, **FAIL = 0 TANPA SKIP**
4. Tulis `docs/handoff/CUTOVER_UAT_REPORT_20260731.md` — **salin blok `aktor terpakai`** ketiga skrip
   (provenance = syarat reproducible). **Jangan sunting report `20260728`**; ia bukti historis
5. `CUTOVER_BACKLOG.md` §2: C-03 `[~]` → `[x]`

> ⚠️ **Walk MENULIS ke produksi:** 2 lead `ZZC03 …` + baris `audit_log` yang **append-only**
> (aturan rumah #3) ⇒ jejaknya **permanen**. Pemilik sudah menyetujui (`confirm_write: YA`).
> Konteks proporsinya: live saat ini **3 lead · 0 client · 0 transaksi**.

**Kalau ada yang FAIL:** jangan perbaiki dengan mengubah policy RLS. Semua policy yang tersentuh
C-03 sudah diverifikasi di lapisan DB; kegagalan di sini hampir pasti **auth/klaim/route**.

**SKIP-2 (badge notifikasi) tetap manual** — butuh mata di browser, ~3 menit. Itu satu-satunya
bagian C-03 yang tidak bisa diotomatiskan tanpa menyimpan password user produksi sebagai secret.

---

## 3. Sisa pekerjaan

Pemilik menyatakan akan melanjutkan **O50 · O35 · backup MySQL** di sesi berikutnya.

| # | Butir | Siapa |
|---|---|---|
| 1 | **C-03** — approve run, baca hasil, tulis report, centang backlog (§2) | **pemilik** → Claude |
| 2 | **O50** — 10 akun `99000000xx` **masih aktif & bisa login** (1 Director, 2 lead divisi). DoD C-04 mensyaratkan **nol fixture UAT di produksi**. Efek samping: "69 karyawan" sebenarnya **59 riil + 10 fixture** | **pemilik** (izin nonaktifkan/hapus) |
| 3 | **O35** (sub-tim Creative M7 §3) · **O9** (target M14) · **divisi dasar** 3 orang OD (§1.1) | **pemilik** |
| 4 | **Backup MySQL Railway + OQ-2** · **rencana rollback** | **pemilik** |
| 5 | **O48 Grup A/B/E** — Grup C+D sudah live | **pemilik + head dev** → Claude |
| 6 | **Visibility repo** → privat, lalu tinjau ulang **O47b** (§1.4) | **pemilik** |
| 7 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 8 | Probe ulang `transactions` · `performance_snapshots` · `*_block_requests` — ketiganya **0 baris** di live, jadi arm RLS-nya belum terbukti oleh data | Claude, saat datanya ada |

**Progress pensiun Go: ~92%** (engineering sisi Claude **100%** sejak sesi 19; Fase 4 ~70%
**estimasi**, Fase 5 ~15% terkunci gate GO). Fase 4 bukan angka terukur — butir gate tidak punya
satuan yang bisa dijumlah.

## 4. Yang JANGAN dikerjakan

Seluruh daftar SESI19–23 masih berlaku. Penegasan yang paling relevan sekarang:

- **Jangan apply ulang migrasi mana pun** — 44 di live, 44 di repo, cocok 1:1.
- **Jangan salin baris "Live"/"Repo vs live" dari handoff mana pun** — baca dari live.
- **Jangan tulis ulang entri `DECISIONS.md` lama** — append-only; koreksi = entri baru.
- **Jangan tambah baris ke ketiga ledger** tanpa entri `DECISIONS.md`. Ketiganya hanya boleh menyusut.
- **Jangan bangun apa pun di `backend/`** — oracle paritas read-only sampai C-05.
- **Jangan setujui sendiri run `uat`** kalau kelak ada mekanismenya — gerbang itu ada justru supaya
  production write butuh manusia.
- **Jangan tambah NIK/PII ke repo** selama status publik belum berubah (§1.4).
