# HANDOFF — Cutover Sesi 4 (C-04 dimulai: alat seed MSL ✅ · sisa: jalankan ke live + keputusan aktor)

> **Dokumen standalone.** Lanjutkan chat berikutnya dari file ini.
> Tanggal: 2026-07-28. Pendahulu: `HANDOFF_CUTOVER_SESI1.md` → `SESI2.md` → `HANDOFF_CUTOVER_SESI3.md`.

---

## 0. JAWABAN SINGKAT — apa yang berubah sesi ini?

C-04 butir data #4 (**Master Service List 0 baris**) **SELESAI** — alatnya dibuat, diverifikasi, lalu
**benar-benar dijalankan ke project live `CDPS SG`**. `master_services` sekarang **32 baris ber-versi**,
bukan 0. Closing tidak lagi terhalang MSL kosong.

| Lapisan | Status |
|---|---|
| Port Go → TypeScript/Supabase | ✅ selesai (ter-merge di `main`) |
| Skema DB repo = live `CDPS SG` | ✅ selesai (O38, sesi 3) |
| Verifikasi paritas (C-03) | ✅ FAIL = 0, **3 SKIP** masih butuh akses deployment |
| **C-04 · seed MSL — alat + verifikasi** | ✅ **SELESAI sesi ini** |
| **C-04 · seed MSL — apply ke `CDPS SG`** | ✅ **SELESAI sesi ini** — 32 dibuat, rerun 32 dilewati (lihat §3.1) |
| C-04 · import lead historis (O22) | ❌ belum |
| C-04 · aktor produksi (O34/O33/O26/O35) | ❌ belum — **memblokir pada keputusan manusia** |
| Retire Go (C-05) | ❌ belum (memang sesudah cutover) |
| Client Portal (C-06) | ⏸️ ditunda by design (O4/O5) |

---

## 1. LOKASI TERAKHIR — mulai dari sini

| Item | Nilai |
|---|---|
| **Branch kerja** | `claude/c-04-master-service-list-ioh59y` |
| **Base** | `claude/handoff-cutover-sesi1-yh3o39` @ `ba57ae4` (= head PR #60) |
| **PR sesi ini** | **#61** (draft, **stacked** → base PR #60) |
| **PR pendahulu** | **#60** (draft → PR #59) dan **#59** (draft → `main`) — **keduanya masih terbuka** |
| **Rencana induk** | `docs/backlog/CUTOVER_BACKLOG.md` §C-04 |
| **Runbook seed MSL** | `docs/handoff/MSL_KALKULATOR_VALIDASI.md` § "Cara seed ke sistem" |

### ⚠️ URUTAN MERGE — jangan dibalik

Tiga PR bertumpuk: **#59 → #60 → #61**. Merge dalam urutan itu, dan **jangan deploy migrasi dari
`main` di antara #59 dan #60** (alasan lengkap: `HANDOFF_CUTOVER_SESI3.md` §1 — #59 sendirian masih
memuat migrasi C-01 versi lama yang terbukti gagal apply ke `CDPS SG`). PR #61 tidak menambah
migrasi apa pun, jadi ia aman di posisi paling atas.

---

## 2. Yang selesai sesi ini

### 2.1 Handoff sesi 3 tidak hilang — hanya belum ter-merge
`HANDOFF_CUTOVER_SESI3.md` tidak ada di `main` maupun di riwayat git lokal; ia hidup di branch
`claude/handoff-cutover-sesi1-yh3o39` (PR #60, belum di-merge). Sesi ini memulai kerja dari `main`
dan **harus mundur** setelah lokasinya diketahui. **Untuk sesi berikutnya:** base kerja yang benar
adalah head PR **#61**, bukan `main` — `main` masih tertinggal 3 PR.

### 2.2 CLI seed MSL untuk stack baru ✅
`backend/cmd/mslseed` (Go, beku) di-port 1:1 ke:

| File | Isi |
|---|---|
| `apps/api/scripts/mslseed.ts` | CLI: argumen, resolusi aktor, dry-run/apply |
| `apps/api/scripts/mslseed/csv.ts` | pembaca CSV RFC 4180 (Go dapat ini gratis dari `encoding/csv`) |
| `apps/api/scripts/mslseed/validate.ts` | validasi per baris → `msl.ServiceInput` |
| `apps/api/scripts/mslseed/engine.ts` | rencana idempoten + eksekusi |
| `supabase/seed/msl_kalkulator.csv` | 32 layanan — salinan **byte-identik** dari `backend/seed/` |

Sifat yang dipertahankan dari Go (bukan ditulis ulang sebagian):

- **Tulis hanya lewat `msl.createService`/`msl.updateService`.** Tidak ada INSERT langsung, jadi
  validasi + mint `MSV-YYYYMM-NNNN` pasca-validasi + versi immutable + baris audit ikut apa adanya.
  CLI tidak punya jalur istimewa yang tidak dimiliki admin UI `/master-services`.
- **Dry-run default**, `--apply` eksplisit.
- **Idempoten by nama layanan** pada `effective_from` baris: belum ada → create; ada tapi ada field
  berubah → **versi baru** (bukan mutasi); identik → dilewati.
- **Semua baris divalidasi sebelum DB disentuh.** Satu baris rusak ⇒ abort, nomor baris +
  `service_key` disebut.
- Aktor di-resolve lewat fungsi SQL **`employee_claims()`** — resolver yang **sama** dengan Access
  Token Hook & RLS — jadi CLI tidak bisa memberi dirinya role di luar jalur JWT. Staff Sales ditolak
  dengan pesan verbatim `[anda tidak memiliki akses untuk mengubah master service list]`.

Dep baru: **`tsx`** (devDependency `@cdps/api`) — runner TS untuk skrip ops. Nol migrasi, nol string
BI baru, nol event notifikasi baru.

### 2.3 Sumber seed dikoreksi (dicatat, tidak ditafsir diam-diam) ✅
`CUTOVER_BACKLOG` §C-04 butir 4 dan `HANDOFF_CUTOVER_SESI3` §4.1 menyebut bahan seed =
`MSL_DRAFT_KOMPILASI.csv`. Itu **salah sasaran**, dan konsekuensinya besar:

| | `msl_kalkulator.csv` (**dipakai**) | `MSL_DRAFT_KOMPILASI.csv` (**tidak dipakai untuk seed**) |
|---|---|---|
| Isi | 32 layanan rate card **aktif** | 180 kandidat dari 1.517 baris ledger deal |
| Harga | harga **standar** per satuan + formula | harga **deal** historis (sudah kena nego/tier/durasi) |
| Kesiapan | final — `commission_rule` beres via **O24 RESOLVED** | dokumennya sendiri bilang "**bahan validasi Sales Head, BUKAN seed final**"; 135/180 grup masih butuh konfirmasi merge |
| Perannya | rate card deal **baru** (Estimasi Nilai M0) | referensi impor migrasi **W1-19 / O18** |

Menyeed yang 180 akan memasukkan harga hasil nego ke jalur Estimasi Nilai & komisi deal baru —
dilarang O3/OD-2 + house rule #4. Entri `DECISIONS.md` (Decided 2026-07-28) mencatat koreksi ini.
**Efek praktis: seed MSL tidak menunggu keputusan siapa pun** — persis seperti dugaan sesi 3.

### 2.4 Dokumen yang ikut dikoreksi
`MSL_KALKULATOR_VALIDASI.md`: instruksi seed sekarang jalur TS (jalur Go jadi catatan sejarah), dan
§5 butir 2 tidak lagi menyebut komisi 0% sebagai "placeholder interim" — **O24 RESOLVED 2026-07-17**
menjadikannya nilai final. Pembaca lama bisa salah simpul bahwa seed masih diblokir Sales Head.

---

## 3. Bukti verifikasi (semua dijalankan sesi ini)

| Gate | Hasil |
|---|---|
| **CI PR #61** | **hijau 5/5** — `db-and-migrations` · `backend` · `api` · `core-engines` · `web-internal` |
| **Vercel** | **Ready 2/2** (`agency-app-api`, `web-internal-mea`) |
| `typecheck --workspaces` | bersih (4 workspace) |
| `@cdps/core` · `db` · `domain` · `api` | **112** · **9** · **422** · **173** (api naik dari 104: **+69 test baru**) |
| Test baru `scripts/mslseed/*` | **69** (16 csv · 30 validate · 23 engine, 6 di antaranya DB-backed) |
| Invariant SQL | ident · immutability · rls · auth_claims → **PASS** |
| Migrasi | **36/36** apply bersih ke Postgres 16 segar; **53 tabel** |
| `next build` (`apps/api`) | hijau |
| **CLI dry-run** | 32 baris → `dibuat=32 versi_baru=0 dilewati=0 error=0`, **nol tulis ke DB** |
| **CLI apply** | 32 layanan `MSV-…` v1 + **32 baris audit** `create` |
| **CLI rerun apply** | `dibuat=0 versi_baru=0 dilewati=32 error=0` (idempoten) |
| **Ubah harga → rerun** | `versi_baru=1`, v1 **tetap utuh** (append, bukan mutasi) |
| **Gate role** | staff Sales → pesan BI verbatim, **nol tulis**; Director → lolos |

### 3.1 Apply ke live `CDPS SG` — SUDAH DIJALANKAN (2026-07-28)

Dijalankan Yohan dari Mac-nya (sandbox sesi ini tidak bisa menyentuh `CDPS SG`: `*.vercel.app`
dijawab `CONNECT tunnel failed 403` oleh proxy, dan egress TCP 6543 ditutup — dinding yang sama
dengan 3 SKIP C-03). `DATABASE_URL` diambil dari env var Vercel project `agency-app-api`, jadi
string yang dipakai identik dengan yang dipakai API produksi.

| Tahap | Hasil |
|---|---|
| dry-run | `dibuat=32 versi_baru=0 dilewati=0 error=0` — nol tulis |
| apply | `dibuat=32 versi_baru=0 dilewati=0 error=0` |
| rerun apply (uji idempotensi) | `dibuat=0 versi_baru=0 dilewati=32 error=0` |

Aktor: NIK **`2101180004`**. Fakta bahwa dry-run sampai mencetak rencana **membuktikan** NIK itu lolos
`msl.canEditMasterServices` — gate izin dievaluasi paling awal, sebelum satu baris pun divalidasi,
jadi aktor tanpa hak berhenti dengan `[anda tidak memiliki akses untuk mengubah master service list]`
tanpa pernah melihat rencana. `created_by` + 32 baris audit tercatat permanen atas NIK ini.

`dibuat=32` (bukan sebagian "dilewati") juga mengonfirmasi ulang bahwa `master_services` memang
benar-benar 0 baris sebelum ini, sesuai temuan sesi 3.

**Pelajaran operasional (kalau mengulang ini untuk import berikutnya):** tiga percobaan pertama gagal
bukan karena kode, tapi karena cara menjalankan — (1) `npm run -w` dijalankan dari `~`, bukan dari
root repo; (2) blok multi-baris di-paste sekaligus sehingga perintah `read -s` menelan baris
BERIKUTNYA sebagai nilai; (3) clipboard tertimpa saat menyalin perintah `$(pbpaste)` dari chat,
sehingga yang ter-export justru perintah itu sendiri. Pola yang akhirnya jalan: copy nilai dari
Vercel, lalu panggil `export DATABASE_URL="$(pbpaste)"` **dari history (panah atas)** — jangan
menyalin apa pun setelah menyalin nilainya. Verifikasi tanpa membocorkan isi: cek `${#DATABASE_URL}`
+ 13 karakter pertama saja.

### Jalur uang benar-benar hidup di atas MSL hasil seed
Diuji di **DB lokal termigrasi** (bukan di live — ini bagian verifikasi alat, bukan verifikasi
produksi). Kuotasi M0 dihitung dari data hasil seed; keempat `pricing_mode` kena:

```
Store Management (Paket)      qty=1  → Rp. 6.000.000,00    (flat)
Nano KOL (1K–10K followers)   qty=3  → Rp. 55.500.000,00   (min_floor: dinaikkan ke min 10 × 5jt, +PPN 11%)
SKU Design                    qty=7  → Rp. 700.000,00      (batch_ceiling, min 1)
GMV Max                       amount=8.500.000 → Rp. 9.435.000,00  (passthrough +PPN 11%)
Estimasi Nilai : Rp. 71.635.000,00
Total Komisi   : Rp. 0,00            (O24: 0% final, Rp0 adalah hasil sah)
```

Baris Nano KOL itu sekaligus memperlihatkan **anomali O25 (a)** apa adanya: qty 3 tetap ditagih
10 × Rp5jt + PPN = Rp55,5jt. Engine-nya benar; **angkanya** yang masih menunggu Sales Head/COO.

### Catatan sandbox (terbukti, hemat waktu sesi depan)
- Postgres 16 **sudah terpasang** sebagai cluster Debian: `pg_ctlcluster 16 main start` (bukan
  `initdb` manual). Kalau start bilang *"Removed stale pid file"*, itu normal setelah container idle.
- DB fresh: `DROP DATABASE cdps; CREATE DATABASE cdps;` → apply 36 migrasi → `supabase/seed.sql`.
- **`audit_log` menolak DELETE** (house rule #3 dipasang di DB). Cleanup test **tidak boleh**
  menghapus baris audit — batasi assertion audit ke `entity_id` milik test itu, jangan `count(*)`
  seluruh tabel. Ini sempat menggagalkan 6 test sampai pola cleanup-nya diperbaiki.
- `npm run lint -w @cdps/api` **gagal juga di tree bersih** (`apps/api` tidak punya
  `eslint.config.*`). Pre-existing, di luar CI (job `api` hanya typecheck + test). Tidak disentuh.

---

## 4. TIKET BERIKUTNYA — sisa C-04

### 4.1 Seed MSL — SELESAI, QA UI LULUS di produksi ✅

> **Lanjutan sesi ini ada di `HANDOFF_CUTOVER_SESI5.md`** — #59/#60/#61 semuanya ter-merge ke `main`.

QA final (setelah #60 ter-merge dan `main` ter-deploy):

- ✅ `/master-services` → **32 layanan** tampil.
- ✅ `/sales/kalkulator` → **200**, `Estimasi Nilai Rp. 71.330.000,00`, `Total Komisi Rp. 0,00`
  (Rp0 = nilai sah per O24).

Sebelum #60 masuk, panel "Ringkasan" sempat `internal server error` — **BUKAN cacat seed dan BUKAN
cacat branch ini.** Riwayatnya disimpan di sini supaya tidak didiagnosa ulang:

**Akar masalah (sudah diverifikasi, jangan didiagnosa ulang):** `web-internal/next.config.ts:9–13`
memproksi `/api/v1/*` ke `BACKEND_URL`; bila env itu tidak di-set khusus untuk environment Preview,
build production jatuh ke fallback **`https://agency-app-api.vercel.app`** — API **produksi** yang
dibangun dari `main`. `main` belum punya perbaikan **C03-F2** (`quoteToWire`), yang hidup di **PR #60
yang belum di-merge**. Jadi UI preview memanggil API lama yang masih 500 karena bigint.

Buktinya: route yang sama di branch ini dijalankan lewat **HTTP sungguhan** (`next start` lokal,
DB lokal berisi 32 layanan hasil seed yang sama) → **HTTP 200**, `Nano KOL qty 3 = Rp. 55.500.000,00`,
`GMV Max 8,5jt = Rp. 9.435.000,00`.

**Yang menutup ini: merge #59 → #60 — SUDAH DILAKUKAN** (`b47e273`, `1bb1b52`), dan kalkulator
terbukti 200 di produksi sesudahnya. Catatan sisa: `BACKEND_URL` tetap tidak di-set untuk environment
**Preview** di project Vercel `web-internal-mea`, jadi preview FE **selalu** memanggil API produksi —
artinya preview tidak pernah menguji API dari branch yang sama. Kalau mau QA FE↔API per-PR sungguhan,
set env itu per-environment (dicatat sebagai utang di `HANDOFF_CUTOVER_SESI5.md` §7 butir 6).

**Kalau MSL perlu direvisi nanti** (mis. koreksi anomali O25 Nano KOL): ubah
`supabase/seed/msl_kalkulator.csv`, lalu jalankan ulang `--apply`. Baris yang berubah naik versi
otomatis, versi lama tetap utuh sehingga deal yang sudah mengunci versi lama tetap bisa direkomputasi.
Jangan pernah UPDATE baris MSL langsung di SQL.

**Kalau MSL perlu direvisi nanti** (mis. koreksi anomali O25 Nano KOL): ubah
`supabase/seed/msl_kalkulator.csv`, lalu jalankan ulang `--apply`. Baris yang berubah naik versi
otomatis, versi lama tetap utuh sehingga deal yang sudah mengunci versi lama tetap bisa direkomputasi.
Jangan pernah UPDATE baris MSL langsung di SQL.

### 4.2 Yang masih memblokir pada keputusan manusia
Tidak berubah dari sesi 3 — **O34** (aktor Wave 2 + lead Marketing/BD), **O33** (roster HR riil tanpa
divisi Finance ⇒ seluruh flow M5 tanpa aktor), **O26** (NIK + email Director), **O35** (sub-tim
Creative M7 §3), **O25** (anomali kalkulator: Nano KOL min 10, basis komisi 5% Store Management,
enforcement budget GMV Max), **O9** (target periode M14, non-blocking).
**O24 sudah RESOLVED** — jangan buka lagi; komisi 0% adalah nilai final.

### 4.3 Sisa lain
- **Import lead historis (O22)** — Pilihan B: `Qualify` ATAU prospek `Hot/Warm`, 6 bulan terakhir.
- **3 SKIP C-03** — perintahnya lengkap di `HANDOFF_CUTOVER_SESI3.md` §5; butuh mesin yang boleh
  keluar internet (network policy sesi ini menolak `*.vercel.app`).
- **Konfirmasi ke pemilik:** data Railway/MySQL riil atau UAT? (asumsi tercatat: UAT / OQ-2 A1.)

**DoD C-04:** tak ada fixture UAT tersisa di jalur produksi; login riil semua role lolos;
~~MSL terisi & ber-versi~~ ✅ **terpenuhi** (32 layanan ber-versi di `CDPS SG`, aktor NIK riil).

---

## 5. Utang teknis (tidak berubah dari sesi 3, kecuali yang ditandai)

1. 🟡 **Penomoran migrasi repo (`202601…`) ≠ riwayat remote (`202607…`).** Begitu ada yang
   menjalankan `supabase db push`, CLI akan menganggap **seluruh** migrasi belum ter-apply.
   Selaraskan sebelum memakai jalur CLI. Non-blocking untuk C-04.
2. **O39** — pintu registrasi lead tanpa gate role (sudah diputuskan: dibiarkan, utang terdokumentasi).
3. `clear_must_change_password` & `employee_display_name` ada di DB tapi nol pemanggil TypeScript —
   bersihkan saat C-05 kalau memang mati.
4. **BARU:** dua salinan `msl_kalkulator.csv` (`backend/seed/` beku + `supabase/seed/` aktif). Sebuah
   test menjaga keduanya byte-identik selama keduanya ada, dan test itu auto-skip begitu `backend/`
   hilang di C-05. Hapus salinan Go saat retire, jangan sebelumnya.
5. **BARU:** `apps/api` tidak punya `eslint.config.*` ⇒ `npm run lint -w @cdps/api` selalu gagal
   (di luar CI). Kalau mau dinyalakan, itu tiket sendiri.

---

## 6. Aturan main (tidak berubah — jangan dilanggar)

1. **Jangan sentuh `backend/`** (Go beku, hanya oracle paritas). Membaca boleh; mengubah tidak.
2. Perubahan → `apps/api`, `packages/*`, `web-internal`, `supabase/`.
3. Baca PRD modul di `docs/prd/` + `STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi.
4. **Nol string BI baru** tanpa entri DECISIONS; katalog notifikasi **FROZEN 15 event**.
5. **Semua route baca WAJIB `requireActor` + `readAsActor`** — jangan pernah `db()` di handler GET (O37).
6. **Notifikasi tak pernah bisa dihapus** — jangan pernah menambah route/fungsi DELETE.
7. **Helper RLS SECURITY DEFINER hidup di schema `private`**, bukan `public` (advisor lint 0029).
8. **Setiap route yang mengembalikan objek domain WAJIB lewat wire mapper** (penyebab C03-F2).
9. **Jangan apply migrasi langsung ke `CDPS SG` lewat MCP tanpa menuliskannya ke
   `supabase/migrations/`.** Itu persis yang menciptakan blocker O38.
10. Ambiguitas/deviasi PRD ⇒ **STOP**, tulis baris **Open** di `docs/DECISIONS.md`.
11. **Seed data produksi lewat jalur domain, bukan SQL langsung.** Alasannya di §2.2: yang menjaga
    ID/audit/versi bukan skrip seed-nya, tapi `createService`/`updateService` yang dipanggilnya.
