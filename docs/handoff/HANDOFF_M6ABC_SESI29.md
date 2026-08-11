# HANDOFF — Modul Interview ("Kelola Klien") Sesi 29 (titik mulai sesi berikutnya)

> Rantai: … → SESI27 (fondasi #136) → SESI28 (langkah 4–6, #137) → **SESI29 (ini, terbaru)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI29 menutup **dua 🔶 pemilik** (ambang flag prasyarat + scope Sales verdict) dan
> mengeksekusi **bagian 2 interpretasi-1** (resolusi prasyarat + durasi + eskalasi N=2).
> **Langkah 7–9 masih tersisa** — langkah 7 (UI) dispesifikasi penuh di §2.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 29)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` HEAD sebelum sesi ini** | merge commit PR #137 (SESI28 / langkah 4–6). |
| **Branch tugas sesi ini** | `claude/handoff-m6abc-sesi28-xy6uog` — 2 commit di atas #137: `a9bf727` (bagian 1: hapus cap 60) + commit bagian 2 (resolusi + eskalasi). |
| **Mulai kerja berikut** | Kalau branch ini SUDAH merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. Kalau BELUM merge: lanjut di branch ini. JANGAN menumpuk di atas history yang sudah merge. |

### 0.1 Status modul Interview — **langkah 4–6 + bagian 2 langkah 5 selesai, 3 langkah tersisa**

| # | Langkah | Status |
|---|---|---|
| 1–3 | Rekon / migrasi / core engine | ✅ #136 |
| 4 | `packages/db` executor | ✅ #137 |
| 5 | pg_cron reminder/SLA | ✅ #137 **+ SESI29** (cap 60 dihapus; eskalasi prasyarat N=2 + jalur resolusi) |
| 6 | `apps/api` + paritas 7-role | ✅ #137 **+ SESI29** (route `POST /interview/{id}/prasyarat`) |
| 7 | **UI "Kelola Klien" + sidebar skoring live** | ⬜ **tugas utama berikutnya (terbesar)** |
| 8 | Blok D prefill + flag verdict Strategi | ⬜ |
| 9 | Seed fixture Alpha Digital + CI hijau | ⬜ |

### 0.2 Posisi persis (akhir sesi 29)

| | |
|---|---|
| Migrasi | **86 berkas** (+ `20260811070000_interview_prasyarat_flag_persist` + `20260811080000_interview_prasyarat_eskalasi`) |
| Gate CI (ci.yml + db-rebuild.sh) | tabel **104** · mesin **19** · event **44** · prefix **32** — **DINAIKKAN sesi ini** (tabel 103→104: `interview_prasyarat_eskalasi`; event 43→44: katalog v6). Keduanya diedit di ci.yml **dan** db-rebuild.sh (gate kembar). |
| Test | core **16** (notification) · db **25** (interview.cron 11 + integration 14) · domain **24** (interview 6 + rls 15 + reals 3) · api **344** — semua hijau lokal (PG16) |
| Typecheck | `@cdps/core\|db\|domain\|api` + `web-internal` bersih |
| Invariant SQL | `auth_claims`/`ident`/`immutability`/`rls_checks` (O48) **PASS** |
| `KNOWN_GAPS` (route-parity) | tetap **kosong** (belum ada panggilan web-internal ke interview — itu langkah 7) |

### 0.3 DB lokal — WAJIB sebelum kerja DB/domain/api

Sandbox ini PG16 (CI = PG17, otoritas). Bootstrap yang dipakai sesi ini:
```bash
BASE=/tmp/cdpspg; PGBIN=/usr/lib/postgresql/16/bin
sudo -u postgres "$PGBIN/initdb" -D "$BASE/data" -U postgres --auth=trust
sudo -u postgres "$PGBIN/pg_ctl" -D "$BASE/data" -o "-p 5433 -k /tmp" -l "$BASE/server.log" start
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -c "create database cdps;"
# apply 86 migrasi urut (ls supabase/migrations/*.sql | sort), lalu seed.sql 2×.
npm install                       # node_modules TIDAK persist antar sesi
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"
npm test -w @cdps/db ; npm test -w @cdps/domain ; npm test -w @cdps/api
```
DB direklaim saat idle — kalau `psql` "Connection refused", start ulang pg_ctl,
drop+create cdps, apply ulang semua migrasi + seed.

## 1. Apa yang berubah sesi ini

Detail penuh: `docs/DECISIONS.md` **2026-08-11** dua baris teratas (bagian 2 + resolusi 🔶).

- **Bagian 1 (`a9bf727`)** — `20260811070000`: hapus cap 60 hari flag `prasyarat_bersyarat_terlambat`
  (`>= 7`, tanpa batas atas — flag persisten). Anchor tetap `dihitung_pada`.
- **Bagian 2** — `20260811080000`:
  - Tabel state **`interview_prasyarat_eskalasi`** (PK `am_pengisi_id`) — rumah eskalasi re-armable.
  - Katalog **v6** — event `kualifikasi_prasyarat_menggantung` (resolver `leadsOfDivision`).
  - `interview_daily_tick` blok **(e)**: AM dengan ≥2 prasyarat menggantung belum-selesai → eskalasi
    ke Account lead/SPV, sekali per episode, re-arm saat < 2.
  - db `markPrasyaratSelesai` + domain `resolvePrasyarat` + route `POST /interview/{id}/prasyarat`.
  - Durasi = TURUNAN dari flag `prasyarat_selesai` (`created_at − dihitung_pada`), nol kolom durasi.

### 🔶 Status interpretasi pemilik — SUDAH TUNTAS

- **Scope Sales verdict**: SEMPIT (closing + Sales lead) — dikonfirmasi, nol perubahan kode.
- **Ambang flag prasyarat**: spec direvisi + dieksekusi penuh (bagian 1 + 2). **Tidak ada 🔶 tersisa.**

### Catatan mekanis / gotcha (BACA sebelum langkah 7)

1. **Data prasyarat untuk UI langkah 7:** `prasyarat_status` (`belum`/`jalan`/`selesai`) ada di verdict
   surface (`getInterviewVerdict`) & full record (`getInterview`). Tombol "tandai prasyarat selesai" =
   `POST /interview/{id}/prasyarat` (sudah ada, gerbang `canWriteInterview`). **Durasi/flag** dibaca dari
   `interview_flag` (`prasyarat_selesai.detail.hari_penyelesaian`, atau hitung `created_at − dihitung_pada`).
   Sidebar boleh menampilkan flag `prasyarat_bersyarat_terlambat` (advisory) bila ada.
2. **Route baru `POST /interview/{id}/prasyarat` belum dipanggil web-internal** — begitu UI memanggilnya,
   `KNOWN_GAPS` route-parity WAJIB tetap kosong (path sudah dilayani `apps/api`). Ia mengembalikan
   `InterviewVerdictWire` (reuse; nol `*Wire` baru — tak perlu WIRE_TO_FE tambahan).
3. **`interview_flag` append-only** (`trg_flag_frozen`) + **ON DELETE CASCADE dari `interview`** ⇒ tak bisa
   men-DELETE interview ber-flag tanpa mematikan trigger. Ini hanya soal teardown TEST (lihat
   `interview.test.ts afterAll`: disable trigger → delete by client_id → enable). Produksi tak pernah delete.
4. **Skoring live sidebar (langkah 7)** = `hitungKualifikasi` core yang SAMA (preview = submit). JANGAN
   reimplement skor di FE — panggil `POST /interview/{id}/score` atau porting pure `hitungKualifikasi`.
5. **Tipe FE Interview** sudah ada di `web-internal/src/lib/interview.ts` (terdaftar shape-parity). Pakai itu.
6. **Money = minor units**; format `Rp. X.XXX.XXX,00`; div-by-zero → `—`.

## 2. Tugas berikutnya (urut; tiap langkah PR kecil)

**Langkah 7 — UI "Kelola Klien" + sidebar skoring live (TERBESAR).** Interview = tab 1 default.
Desktop-first (1440px, min 1280px; <1280px tampilkan notice). Section B0–B11, progressive disclosure,
autosave 20s pada Draft Isian (`PUT /interview/{id}/answers`), sidebar skoring pinned (skor, per-blok,
BEP ROAS, deal-breaker, verdict provisional — dari `hitungKualifikasi` yang SAMA). **Tambahkan kontrol
prasyarat** (status + tombol "tandai selesai" via `POST /interview/{id}/prasyarat`, tampilkan durasi bila
sudah selesai / flag terlambat bila menggantung). Print view internal + print view klien (**prasyarat saja**,
skor/verdict dibuang). **Pelajari primitif form `web-internal` dulu** (mis. `strategi-sections`) — jangan
menambah library form baru. Route API + tipe FE sudah siap (§Gotcha 1–5).

**Langkah 8 — Blok D prefill + flag verdict Strategi.** Kolom prefill (`sumber`,`interview_id`,
`interview_version`) + flag lemah (`sasaran_konservatif`/`hambatan_mendasar_tercatat`/`risiko_tinggi`).
Tes: (a) Section B numeric baseline TAK PERNAH di-prefill; (b) `tidak_siap` tetap boleh bikin Strategi &
Strategi membawa flag. Pakai `PREFILL_MAPPING` + `handoffKeStrategi` core. **Tanpa gate verdict.**

**Langkah 9 — seed fixture + CI hijau.** Perluas `supabase/seed.sql` (Alpha Digital) dengan 1 interview +
kualifikasi (idempotent, seed 2×). Naikkan gate hitungan seed bila perlu. Semua CI hijau.

## 3. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-11 (semua baris Interview; dua teratas = sesi ini).
- `packages/core/src/interview.ts` = kontrak skoring · `packages/core/src/notification.ts` = katalog (v6).
- `packages/domain/src/interview.ts` = domain (izin + orkestrasi; `resolvePrasyarat`).
- `packages/db/src/interview.ts` = persistence (`markPrasyaratSelesai`).
- `supabase/migrations/20260811070000` & `20260811080000` = koreksi + eskalasi prasyarat.
- `CLAUDE.md`, `docs/STATE_MACHINES.md`, `docs/DATA_MODEL.md`.
