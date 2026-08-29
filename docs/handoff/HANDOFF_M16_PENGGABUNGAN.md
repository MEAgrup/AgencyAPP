# HANDOFF — M16/M17 Langkah Penggabungan (Akun B menjalankan merge)

> Dibuat 2026-08-29 di akhir sesi yang menjalankan §5 `PARALEL_M16_DUA_AKUN.md`
> (menggabungkan Akun A + Akun B). **Baca dokumen ini dulu** sebelum menyentuh
> apa pun di branch ini — ia menggantikan kebutuhan membaca ulang seluruh
> histori chat sebelumnya.

## 0. TL;DR — status sekarang

- **Kedua stream SELESAI, digabung, diverifikasi, PR sudah dibuat.**
- Tidak ada kode yang "setengah jadi" menunggu — sisa pekerjaan di sesi
  berikutnya adalah **keputusan pemilik** (11 baris `DECISIONS.md` §Open baru)
  dan **babysitting PR** (CI/review), bukan implementasi baru.
- **Satu langkah sengaja BELUM dijalankan:** `supabase db push` ke proyek live
  `CDPS SG` — ini aksi produksi, ditahan sampai ada konfirmasi eksplisit dari
  pemilik. Lihat §5.

## 1. Posisi branch — PERSIS

```
Branch kerja:  claude/buildplan-lead-time-tracking-g62d2i
Remote:        origin/claude/buildplan-lead-time-tracking-g62d2i (in sync, 0 uncommitted)
HEAD:          30e27ff
PR:            https://github.com/MEAgrup/AgencyAPP/pull/247  (base: main, OPEN)
```

Histori commit relevan (baru → lama):

```
30e27ff  M16 penggabungan: gate hitung gabungan, uji lintas-stream #4, DECISIONS + backlog
9e83ed8  Merge Akun B (Divisi & Permintaan, LT-40..LT-55) into integration branch
2fdfd8f  Merge Akun A (Tahapan & Metrik, LT-20..LT-33) into integration branch
707f41c  feat(M16 Akun A): tahapan produksi Brief + lead time + metrik AM (LT-20..LT-33)
42c7795  feat(M16/M17): Akun B — Ads (LT-40..43) + Permintaan/AI Optimizer (LT-50..55)
25c9c94  docs(M16): kunci nama branch Akun A/B ke rencana paralel   ← titik cabang awal kedua stream
```

Stream asal (masih ada di remote, sudah termasuk lewat merge commit di atas —
**tidak perlu disentuh lagi**):
- `claude/m16-akun-a-tahapan-metrik` (Akun A, PRD/State Machine LT-20..LT-33)
- `claude/m16-akun-b-divisi-permintaan-36u91r` (Akun B, LT-40..LT-55 — sesi ini)

**Belum di-merge ke `main`.** PR #247 masih menunggu CI + review pemilik.

## 2. Apa yang barusan diverifikasi (jangan ulangi kecuali ada perubahan baru)

Semua dijalankan terhadap DB **hasil rebuild bersih** (`scripts/db-rebuild.sh --yes`,
139 migrasi):

| Cek | Hasil |
|---|---|
| Gate `db-rebuild.sh` | 128 tabel / 36 entity_prefix / 29 sm_machines / 65 notif_events — semua PASS |
| `npm run test --workspaces --if-present` | `@cdps/api` 383 · `@cdps/core` 290 · `@cdps/db` 53 · `@cdps/domain` 1543 (+1 skip) — semua lulus |
| `web-internal` (`cd web-internal && npm test`) | 374 lulus |
| `npm run typecheck --workspaces --if-present` | bersih |
| `cd web-internal && npm run typecheck` | bersih **kecuali** `xlsx` module gap **pre-existing**, tidak terkait M16 |
| `UAT=1 npx vitest run wave1_uat.e2e.test.ts` (di `packages/domain`) | Alpha Digital 31/31 langkah lulus |
| `route-parity.test.ts` | `KNOWN_GAPS` tetap kosong |
| Uji lintas-stream #4 (`m16_cross_stream.test.ts`, **baru ditulis sesi ini**) | lulus — Brief AI Optimizer jalan lewat pipeline nyata Akun A sampai `Terapkan`, Asset `[Approved]`-nya terhitung di `wrr_divisi` lewat `wrr_aggregate` Akun B |

### ⚠️ Jebakan yang ditemukan sesi ini — JANGAN diulangi

**Jangan jalankan `npx vitest run` dari root repo.** Itu melewati
`packages/domain/vitest.config.ts` (`fileParallelism: false`, sengaja
menyerialkan file test karena semuanya berbagi SATU koneksi Postgres) dan
menyebabkan ratusan false-failure (deadlock, FK violation) akibat banyak file
test jalan bersamaan menimpa data satu sama lain. **Selalu** pakai:

```bash
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm run test --workspaces --if-present     # dari root — cara BENAR
# atau per-paket:
cd packages/domain && npx vitest run       # aman, config lokal terbaca
```

Kalau Postgres berhenti (`connection refused`): `service postgresql start`.

## 3. Perubahan yang masuk sesi ini (di atas kerja Akun A + Akun B)

Commit `30e27ff`, 5 berkas:

1. **`scripts/db-rebuild.sh` + `.github/workflows/ci.yml`** — angka gate
   dinaikkan 127→**128** tabel, 28→**29** sm_machines (delta murni dari
   `permintaan`/REQ- milik Akun B), **dihitung dari rebuild nyata**, bukan
   dijumlah manual. Kedua file WAJIB selalu diubah bersamaan (aturan lama:
   menaikkan salah satu saja membuat lokal hijau tapi CI merah).
2. **`packages/domain/src/m16_cross_stream.test.ts`** (baru) — satu-satunya
   test yang menyentuh KEDUA stream sekaligus dalam satu jalur nyata (lihat
   tabel §2). Permanent, bukan skrip sekali pakai.
3. **`docs/DECISIONS.md`** — 11 baris §Open baru: **LT-4 s/d LT-14**,
   dipindahkan dari §1 `HANDOFF_M16_AKUN_A.md` (LT-4..LT-9) dan
   `HANDOFF_M16_AKUN_B.md` (LT-10..LT-14). Detail per baris di §4 bawah.
4. **`docs/backlog/LEADTIME_BACKLOG.md`** — §0 status tabel penuh (semua Fase
   0-4 ✅, Fase 5 tetap ⬜ terblokir by design), dan seluruh 14 "Uji wajib"
   ditandai lulus dengan rujukan nama test yang benar-benar ada.
5. Merge commit `9e83ed8`/`2fdfd8f` sendiri (5 konflik, semua "keep both" —
   `packages/domain/src/index.ts`, `apps/api/src/lib/{http,wire}.ts`,
   `apps/api/src/lib/shape-parity.test.ts`, `docs/backlog/LEADTIME_BACKLOG.md`)
   — kalau perlu detail resolusi konflik, `git show 9e83ed8` / `git show 2fdfd8f`.

## 4. Keputusan pemilik yang ditunggu — `docs/DECISIONS.md` §Open

Baris **LT-4 s/d LT-14** (baca langsung di file untuk teks lengkap Bahasa
Indonesia). Ringkasan prioritas:

- **LT-13 — 🔴 satu-satunya yang MEMBLOKIR klaim fitur** (bukan blocking
  merge/PR): `syncAiOptimizerSkuRevision` (LT-54) DEFER — tidak sinkron sama
  sekali — untuk klien yang punya baris `strategi_assumption`, karena Rule
  13(c) `openRevision` mewajibkan `asumsiGugur` yang tidak bisa dikarang
  otomatis. Ini praktis berarti **mayoritas klien aktif** (yang sudah pernah
  mengisi Section D asumsi) tidak tersinkron otomatis. Perlu pemilik memilih
  arah: (a) jalur baru di `openRevision` tanpa `asumsiGugur` untuk revisi
  auto-triggered, atau (b) desain ulang — manusia yang buka revisi, AI
  Optimizer hanya isi konten.
- **LT-4 s/d LT-9** (Akun A) — pertanyaan interpretasi state machine: nasib
  dead-end `Brief Dikembalikan ke AM`, Live Stream tanpa `Cek Brief AM`,
  makna `gate_pihak='AM'`, dll. Tidak memblokir apa pun — semua interpretasi
  konservatif dan sudah diverifikasi test.
- **LT-10, LT-11** (Akun B) — pilihan implementasi Ads Management Date
  (kolom baru + satuan kalender) dan default routing `Contract Creator` ke
  AM. Perlu konfirmasi tapi tidak memblokir.
- **LT-12, LT-14** — catatan struktur murni (fungsi SQL yang ternyata satu
  redefinisi 3x; 3 CHECK constraint yang lolos audit lama, sudah ditambal).
  Tidak perlu aksi pemilik, sekadar dicatat.

**Jangan pindahkan baris ini ke `## Decided` sendiri** tanpa jawaban pemilik
eksplisit — biarkan di `## Open` sampai ada jawaban tercatat.

## 5. Yang SENGAJA belum dilakukan

1. **`supabase db push` ke proyek live `CDPS SG`** — langkah terakhir §5
   `PARALEL_M16_DUA_AKUN.md` ("Setelah hijau… 3. Baru `supabase db push`").
   **DITAHAN** karena ini aksi produksi/destruktif berpotensi tinggi (push
   139 migrasi ke DB live) — instruksi standing mewajibkan konfirmasi
   eksplisit pemilik sebelum aksi seperti ini, bukan diasumsikan dari
   instruksi rencana tertulis. **Jangan jalankan tanpa pemilik bilang
   "push"/"ya" secara eksplisit di chat berikutnya**, dan jalankan
   `mcp__Supabase__list_migrations` dulu untuk konfirmasi migrasi mana yang
   BELUM ada di proyek live sebelum push, urut nama berkas seperti diminta
   rencana.
2. **Fase 5 — Portal vendor Live** (`LT-60`/`LT-61` di `LEADTIME_BACKLOG.md`)
   — sengaja di luar cakupan, terblokir oleh spec keamanan yang belum ada
   (realm auth eksternal untuk vendor). Tidak disentuh sama sekali.
3. **Halaman FE penuh untuk Ads/Permintaan** — `web-internal` hanya punya
   type declarations minimal (`ads.ts`, `permintaan.ts` baru) untuk lolos
   `shape-parity.test.ts`; belum ada halaman `/ads/*` atau `/permintaan`
   yang benar-benar dipakai user. Dicatat di `HANDOFF_M16_AKUN_B.md` sebagai
   keputusan skala, bukan keputusan produk.
4. **Subscribe PR activity** — belum diaktifkan. Ditanyakan ke pemilik di
   akhir sesi lalu, belum dijawab saat handoff ini ditulis. Chat berikutnya
   perlu cek apakah pemilik mau PR #247 dipantau otomatis (CI/review→autofix)
   atau dipantau manual.

## 6. Next task — urutan yang disarankan untuk sesi berikutnya

1. **Cek status PR #247** — CI hijau? Ada review comment? (`mcp__github__pull_request_read`
   / `mcp__github__actions_list` pada `MEAgrup/AgencyAPP` PR 247). Kalau belum
   di-subscribe dan pemilik ingin dipantau otomatis, panggil
   `subscribe_pr_activity` (owner=MEAgrup, repo=AgencyAPP, pullNumber=247)
   lalu ikuti alur "Driving a PR to green" di system prompt — PR ini
   **dibuat sesi lalu**, jadi berlaku aturan "PR yang Anda buat = milik Anda,
   harus didorong sampai mergeable", bukan sekadar menunggu.
2. **Sodorkan baris LT-4..LT-14 ke pemilik** untuk keputusan, terutama
   **LT-13** (yang paling berdampak — batasan nyata fitur AI Optimizer→STRG).
3. **Setelah pemilik menjawab satu/lebih baris LT-*** — pindahkan jawabannya
   dari `## Open` ke `## Decided` di `docs/DECISIONS.md` (satu baris per
   keputusan, ikuti format existing), dan kalau jawabannya mengubah
   perilaku kode (mis. LT-13 arah (a)/(b)), itu tiket implementasi baru —
   jangan diimplementasikan diam-diam dari asumsi.
4. **Setelah pemilik konfirmasi "push ke Supabase live"** — jalankan §5
   langkah 3 (`supabase db push` / `mcp__Supabase__apply_migration` urut nama
   berkas ke proyek `CDPS SG`), lalu verifikasi ulang gate di DB live.
5. **Setelah PR #247 di-merge ke `main`** — Fase 5 (Portal vendor Live) adalah
   pekerjaan M16 berikutnya yang sudah diketahui, tapi **terblokir** sampai
   spec keamanan client-portal-style untuk vendor eksternal ada (lihat
   `CLAUDE.md`: Client Portal terakhir, setelah security spec). Jangan mulai
   Fase 5 tanpa itu.

## 7. Referensi cepat

- Rencana asli 2 akun: `docs/handoff/PARALEL_M16_DUA_AKUN.md`
- Detail per-tiket Akun A: `docs/handoff/HANDOFF_M16_AKUN_A.md`
- Detail per-tiket Akun B (termasuk jebakan test yang ditemukan sebelum
  sesi merge ini): `docs/handoff/HANDOFF_M16_AKUN_B.md`
- Status backlog terkini: `docs/backlog/LEADTIME_BACKLOG.md`
- Log keputusan: `docs/DECISIONS.md` (cari `LT-` untuk semua baris M16)
- DB lokal: `postgres://postgres:postgres@127.0.0.1:5432/cdps`, rebuild via
  `scripts/db-rebuild.sh --yes` (butuh `service postgresql start` dulu kalau
  container baru)
