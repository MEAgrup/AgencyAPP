# M16 / M17 — Eksekusi Paralel 2 Akun Claude — ✅ SELESAI DIPAKAI, jangan mulai kerja dari sini

> **Pekerjaan yang direncanakan dokumen ini SUDAH DIEKSEKUSI, DIGABUNG, dan
> MERGE ke `main`** lewat PR #247 (2026-08-29 08:13:54Z, commit `d231a71`).
> Akun A benar-benar memakai branch `claude/m16-akun-a-tahapan-metrik`
> (LT-20..LT-33); pekerjaan Akun B (LT-40..LT-55) masuk lewat commit
> langsung ke branch integrasi. Satu keputusan tertunda (**LT-13**)
> diputuskan pemilik di tengah jalan dan sudah masuk PR yang sama.
>
> **Untuk konteks/status M16/M17 sekarang, baca
> `docs/handoff/RENCANA_INDUK_M16_M17.md` dan
> `docs/backlog/LEADTIME_BACKLOG.md`** — dokumen ini dipertahankan hanya
> sebagai catatan historis (rasional desain Tahap F di §0-§1 masih akurat).
> **Jangan pakai dokumen ini untuk memulai pekerjaan baru** — keputusan
> pemilik 2026-08-29: pekerjaan M16/M17 selanjutnya dikerjakan
> single-track, tidak dipecah ke akun paralel lagi.

# M16 / M17 — Eksekusi Paralel 2 Akun Claude

> Spec: `docs/prd/CDPS_Module16_Lead_Time.md`, `CDPS_Module17_AI_Optimizer.md`
> Backlog: `docs/backlog/LEADTIME_BACKLOG.md`
> Mesin: `STATE_MACHINES.md` §18–§19

Dokumen ini membagi M16+M17 menjadi dua stream yang bisa dikerjakan **dua akun Claude secara bersamaan** lalu digabung. Pembagiannya disusun dari **kepemilikan berkas**, bukan dari besar pekerjaan — supaya penggabungan di akhir tidak menjadi sesi merge-conflict.

---

## 0. Aturan emas

1. **Tahap F (Fondasi) WAJIB mendarat lebih dulu.** Kedua stream bercabang dari commit F. Memulai sebelum F selesai = dua stream menulis ulang berkas yang sama.
2. **Sebuah berkas hanya punya SATU pemilik.** Kalau Anda butuh menyentuh berkas milik stream lain, tulis di file handoff Anda, jangan diedit.
3. **Jangan sentuh `docs/DECISIONS.md`.** Temuan/keputusan baru ditulis di file handoff stream masing-masing; langkah penggabungan yang memindahkannya. Dua stream menulis di tabel yang sama = konflik pasti, dan DECISIONS adalah berkas yang paling mahal kalau salah merge.
4. **Jangan menjalankan migrasi ke Supabase live (`CDPS SG`).** Kedua stream hanya memakai DB lokal (`scripts/db-rebuild.sh`). Hanya langkah penggabungan yang push ke live, dalam urutan nama berkas.
5. **Jangan sentuh `backend/**`** (Go sudah dipensiunkan).

---

## 1. Tahap F — Fondasi (satu akun, sebelum split)

Semua yang di bawah ini adalah **choke point global**: berkas tunggal dengan invariant yang pecah kalau dua stream menyentuhnya.

| # | Isi | Kenapa harus di F |
|---|---|---|
| F-1 | Migrasi `division_registry` + seed (6 divisi existing + AI Optimizer + Store Operation) | Fondasi yang dibaca kedua stream |
| F-2 | `packages/core/src/division.ts` + registry test | idem |
| F-3 | Ganti 8 daftar divisi duplikat | 5 di backend (`account.ALLOWED_DIVISIONS` + `BRIEF_ASSIGNABLE_DIVISIONS`, `strategi.DISPATCH_DIVISIONS`, `recap.DIVISIONS`, `plan.PLAN_ROW_DIVISI_PIC`) + 3 di `web-internal` (`penugasan.ts`, `tasks.ts`, `strategi.ts`) — **berkas milik kedua stream**. `board.ts` dan `performance.ts` TIDAK termasuk: yang satu switch perilaku per-divisi (divisi baru jatuh ke `default` = rollup `brief_task`, justru benar), yang satu konstanta role individual |
| F-4 | Registrasi **SELURUH** event notifikasi baru (stage **dan** `REQ-`) dalam **SATU** bump `CATALOG_VERSIONS` | `notification.test.ts` meng-assert `events()` == Σ `eventCount` per versi, dan `notif_catalog.reals.test.ts` meng-assert TS `CATALOG` ≡ DB `notif_events` set-equal pada (event_type, catalog_version, resolver). Dua stream masing-masing menambah versi ⇒ invariant pecah dua kali |
| F-5 | Naikkan gate hitungan di `scripts/db-rebuild.sh` **dan** `.github/workflows/ci.yml` (tabel 122→123, entity_prefix 35→36, notif_events 58→65; sm_machines TETAP 23) | Angka yang sama hidup di DUA berkas — menaikkan salah satu saja membuat lokal hijau sementara CI merah (persis yang terjadi pada PR #170) |
| F-6 | Daftarkan prefix `REQ` di `packages/core/src/ident.ts` + tabel `entity_prefix` | `ident.registry.test.ts` memindai seluruh call site; prefix wajib terdaftar di **dua** tempat |
| F-7 | Taruh dua anchor komentar di `apps/api/src/lib/wire.ts` | Memberi tiap stream titik sisip sendiri yang berjauhan (lihat §4) |

**Catatan F-4:** mendaftarkan event tanpa emitter itu **aman** — `notif_catalog.reals.test.ts` membandingkan nama TS↔DB, bukan menuntut ada pemanggil. Emitternya dipasang stream masing-masing.

**Exit criteria F:** seluruh suite existing lulus **tanpa perubahan** (bukti refactor nol-perilaku), `ident.registry.test.ts` hijau, `notif_catalog.reals.test.ts` hijau, `scripts/db-rebuild.sh` lolos semua gate.

Setelah F di-commit dan di-push, catat SHA-nya di sini:

```
Commit fondasi F: 7fefa2d (mendarat via 2b71dba + 7fefa2d)
Branch dasar    : claude/buildplan-lead-time-tracking-g62d2i
Branch Akun A   : claude/m16-akun-a-tahapan-metrik
Branch Akun B   : claude/m16-akun-b-divisi-permintaan
```

Kedua branch di atas dibuat dari `claude/buildplan-lead-time-tracking-g62d2i`
pada commit `7fefa2d` (`git checkout -b <branch> claude/buildplan-lead-time-tracking-g62d2i`),
lalu di-push ke `origin` dengan nama itu persis — nama ini sudah dipakai di
langkah penggabungan §5 di bawah, jangan diganti tanpa memperbarui §5 juga.

**Status F: ✅ SELESAI & terverifikasi dengan DB nyata** (Postgres lokal, bukan
di-skip): `scripts/db-rebuild.sh` 128 migrasi + seluruh gate lolos
(tabel **123**, entity_prefix **36**, sm_machines **23**, notif_events **65**),
`@cdps/core` 290/290, `@cdps/db` 53/53, `@cdps/domain` **1484/1485** (1 e2e
skip), `@cdps/api` 383/383, `web-internal` 374/374, `tsc --noEmit` bersih di
kelima paket.

Dua tes existing diubah — keduanya asersi keanggotaan daftar, bukan perilaku:
- `notification.test.ts` — versi katalog 11 → 12.
- `strategi.test.ts` "keeps I-2 divisions identical…" — dulu menuntut
  `DISPATCH_DIVISIONS` sama PERSIS dengan `ALLOWED_DIVISIONS`. Registry
  memisahkan dua sifat yang ternyata memang berbeda: Store Operation adalah
  tujuan dispatch yang sah tapi belum punya `TASK_CATALOG`. Asersinya diganti
  jadi arah yang benar-benar harus dijaga: setiap divisi ber-kuota WAJIB bisa
  dipilih di I-2.

---

## 2. Pembagian stream

### Akun A — "Tahapan & Metrik" (Fase 2 + 2b)

Membangun lapisan tahapan dan seluruh matematika waktu.

| Tiket | Isi |
|---|---|
| LT-20 | Migrasi `stage_pipeline`, `stage_definition`, `brief_stage_sla`, `brief_review` + kolom `briefs` + RLS |
| LT-21 | Seed `sm_machines`/`sm_edges`/`sm_terminal_states` — **SEMUA 5 pipeline**, termasuk AI Optimizer ×2 |
| LT-22 | `packages/domain/src/stage.ts` — `advanceStage`, `reviewBrief` (Cek Brief AM), gate AM/KLIEN |
| LT-23 | `packages/domain/src/leadtime.ts` — `computeStageLeadTime` + `working_days_between` |
| LT-24 | Override SLA per brief (`isLead(division)`) |
| LT-25 | Route tahapan + `*ToWire` (anchor A) |
| LT-26 | Guard `task.submitTask` |
| LT-27 | **Emitter** event tahapan + tick harian |
| LT-28 | FE: strip tahapan, kolom lead time, panel AM |
| LT-30 | `turnaroundKerjaHours` + `waktuAmBelumBuka` + `waktuAmReview` di `computeMetrics` |
| LT-31 | Speed Score pindah + hitung ulang periode berjalan |
| LT-32 | Component key `kecepatan_review_am`, **bobot 0** |
| LT-33 | `role_type` AI Optimizer + Store Operation, **bobot 0** |

> **Kenapa A menyeed pipeline AI Optimizer** padahal AI Optimizer milik B: tabel `stage_pipeline`/`stage_definition` milik A. Seed pipeline oleh B akan menciptakan migrasi B yang bergantung pada migrasi A — satu-satunya cross-dependency di seluruh rencana ini, dan dihapus dengan memindahkannya ke A.

### Akun B — "Divisi & Permintaan" (Fase 3 + 4)

Membangun Ads, entitas Permintaan, dan sisi non-pipeline AI Optimizer.

| Tiket | Isi |
|---|---|
| LT-40 | State `Setting` pada mesin `ADC-` |
| LT-41 | Tipe Iklan (GMV Max Product / GMV Max Live / TTAM) |
| LT-42 | Ads Management Date — `end_date` turunan `start + durasi_jasa + additional_days + total_hari_hold` |
| LT-43 | Mini / Monthly / Content Analysis di atas `ads_weekly_reports` |
| LT-50 | Entitas `REQ-` + mesin + 3 jenis + **emitter** `permintaan_jatuh_tempo` |
| LT-51 | `role_mappings` AI Optimizer + Store Operation |
| LT-52 | `asset_type` `AI Video` + `Optimasi SKU` — **wajib perluas 3 fungsi agregat SQL** |
| LT-53 | Item MSL `AI Video` + `Optimasi SKU` |
| LT-54 | Sinkron SKU balik ke STRG sebagai revisi bernomor |
| LT-55 | Baris `wrr_divisi` AI Optimizer |

> Beban tidak persis 50/50 (A ≈ 55%). Penyeimbangnya: **B mengerjakan langkah penggabungan §5** dan uji lintas-stream.

---

## 3. Kepemilikan berkas (eksklusif)

| Akun A | Akun B |
|---|---|
| `packages/domain/src/stage.ts` *(baru)* | `packages/domain/src/req.ts` *(baru)* |
| `packages/domain/src/leadtime.ts` *(baru)* | `packages/domain/src/ads.ts` |
| `packages/domain/src/task.ts` | `packages/domain/src/msl.ts` |
| `packages/domain/src/performance.ts` | `packages/domain/src/strategi.ts` |
| `packages/domain/src/board.ts` | `packages/domain/src/recap.ts` |
| `apps/api/.../briefs/[id]/stage*`, `lead-time` | `apps/api/.../ads*`, `permintaan*` |
| FE panel tahapan + lead time | FE Ads + Permintaan |
| Migrasi **`20260830*`** | Migrasi **`20260831*`** |

**`packages/domain/src/account.ts`** → milik **A** (dipakai `reviewBrief` + guard). B tidak menyentuhnya.

---

## 4. Berkas bersama — aturan agar tidak bentrok

| Berkas | Aturan |
|---|---|
| `apps/api/src/lib/wire.ts` | F-7 menaruh dua anchor. A menulis **hanya** di bawah `// === ANCHOR WIRE A (M16 tahapan) ===`, B **hanya** di bawah `// === ANCHOR WIRE B (M16 ads/permintaan) ===`. Keduanya berjauhan ⇒ git merge bersih |
| `packages/domain/src/index.ts` | Masing-masing menambah baris export sendiri. Kalau konflik: **keep both**, tanpa pikir panjang |
| `apps/api/src/lib/route-parity.test.ts` | idem. **`KNOWN_GAPS` wajib tetap KOSONG** — menambah satu baris = mengakui satu halaman tidak berfungsi, dan itu butuh entri DECISIONS |
| `docs/backlog/LEADTIME_BACKLOG.md` | Hanya centang baris milik sendiri di tabel §0 dan tabel fase sendiri |
| `docs/DECISIONS.md` | **JANGAN DISENTUH** (aturan emas 3) |
| `packages/core/src/notification.ts` | **F saja.** Tidak ada stream yang menambah event |
| `packages/core/src/ident.ts` | **F saja** |
| `scripts/db-rebuild.sh` | **F saja** |

### Rentang timestamp migrasi

| Pemilik | Rentang | Contoh |
|---|---|---|
| F | `2026082900xxxx` | `20260829001000_division_registry.sql` |
| Akun A | `2026083001xxxx`–`2026083009xxxx` | `20260830010000_stage_pipeline.sql` |
| Akun B | `2026083101xxxx`–`2026083109xxxx` | `20260831010000_adc_setting_state.sql` |

Rentang terpisah ⇒ nol tabrakan nama berkas **dan** urutan gabungan deterministik (F → A → B). Sudah diverifikasi bahwa **tidak ada migrasi B yang bergantung pada migrasi A** setelah seed pipeline AI Optimizer dipindah ke A (§2).

---

## 5. Penggabungan (dikerjakan Akun B)

```bash
# 1. Kedua stream sudah push
git fetch origin

# 2. Gabung A lebih dulu (ia pemilik tabel yang di-referensikan)
git checkout claude/buildplan-lead-time-tracking-g62d2i
git merge --no-ff origin/claude/m16-akun-a-tahapan-metrik
scripts/db-rebuild.sh --yes            # 127+ migrasi, semua gate
npm test -w packages/core -w packages/domain -w packages/db
npm test -w apps/api && npm test -w web-internal

# 3. Baru gabung B
git merge --no-ff origin/claude/m16-akun-b-divisi-permintaan
scripts/db-rebuild.sh --yes
npm test -w packages/core -w packages/domain -w packages/db
npm test -w apps/api && npm test -w web-internal
```

### Uji lintas-stream (wajib setelah kedua merge)

Ini yang **tidak bisa** ditangkap salah satu stream sendirian:

1. **Tidak-tercampur** — setelah transisi tahapan (A) **dan** transisi `ADC-` (B), `computeMetrics` untuk Brief yang sama tetap mengembalikan `turnaroundHours` + `speedScoreDisplay` **identik** dengan sebelum M16 ada.
2. **Katalog notifikasi** — `notif_catalog.reals.test.ts` hijau dengan emitter A **dan** B terpasang; `notif_events` COUNT sesuai gate F-5.
3. **Registry divisi** — `division_registry` ≡ konstanta TS setelah kedua stream menambah pemakainya.
4. **Pipeline AI Optimizer (A) ↔ `asset_type` + MSL (B)** — Brief AI Optimizer bisa dibuat, jalan lewat pipeline-nya, **dan** terhitung di Rekap Mingguan.
5. **Bobot nol** — dengan `kecepatan_review_am` (A) + `role_type` divisi baru (A) terdaftar bobot 0, skor tiap AM dan tiap staff **identik** dengan sebelum M16.
6. **`route-parity.test.ts`** — `KNOWN_GAPS` kosong setelah kedua stream menambah route.
7. **Fixture Alpha Digital** (`wave1_uat.e2e.test.ts`) tetap lulus.
8. Sisa uji 4–12 di `LEADTIME_BACKLOG.md` §Uji wajib.

### Setelah hijau

1. Pindahkan temuan dari `HANDOFF_M16_AKUN_A.md` + `_B.md` ke `docs/DECISIONS.md` — **sekali, oleh satu orang**.
2. Centang tabel status `LEADTIME_BACKLOG.md` §0.
3. Baru `supabase db push` ke `CDPS SG`, dalam urutan nama berkas.

---

## 6. Protokol handoff

Tiap stream menulis **file sendiri** (nol konflik):

- `docs/handoff/HANDOFF_M16_AKUN_A.md`
- `docs/handoff/HANDOFF_M16_AKUN_B.md`

Isi minimal: apa yang selesai, apa yang tidak, **keputusan/ambiguitas baru yang ditemukan** (untuk dipindah ke DECISIONS saat merge), dan berkas milik stream lain yang menurut Anda perlu diubah (**jangan diubah sendiri** — tulis di sini).

## 7. Definition of Done tiap stream

Sama dengan DoD rumah (`CLAUDE.md`), plus:

- Validasi server-side + pesan BI `[...]` persis.
- Tes izin per role, termasuk OD/Director berlapis.
- Tes immutability (tidak ada jalur mutasi pada riwayat).
- Field turunan tercakup tes **recompute-from-log** — bukan nilai yang disimpan.
- Migrasi **hanya** lewat `supabase/migrations/**`; **jangan `psql -f`** (penyebab drift O38).
- Seluruh suite existing tetap hijau.
