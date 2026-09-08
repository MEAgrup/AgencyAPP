# Handoff — Penutup Revisi OD: Jalur A TUTUP PENUH, B1/B2 selesai, lanjut B3/B4/B5

> **Ditulis 2026-09-08**, sesudah PR ini: https://github.com/MEAgrup/AgencyAPP/pull/324
> (`claude/handoff-penutup-revisi-od-rjfm0w` → `main`, **belum di-merge** saat
> handoff ini ditulis). Ini titik mulai chat berikutnya.
>
> Pendahulunya: `HANDOFF_PENUTUP_REVISI_OD_20260908.md` (rencana A→B yang
> handoff ini menyelesaikan) — baca dulu §0-nya untuk konteks penuh kalau
> perlu, tapi **jangan kerjakan ulang A2/A3/B1/B2**, sudah tutup (§1 di bawah).

---

## 0. Posisi & rekomendasi urutan

| Apa | Nilai |
|---|---|
| Jalur A (tutup: A1/A2/A3) | ✅ **SELESAI PENUH** |
| B1 (Makefile) | ✅ **SELESAI** |
| B2 (harness peramban) | ✅ **SELESAI** — 10 dari 11 layar dibuka, 1 bug ditemukan+diperbaiki |
| B3 (gerbang drift repo↔live) | ⬜ belum dikerjakan |
| B4 (`withClaims` round-trip) | ⬜ belum dikerjakan — **ada catatan risiko, baca sebelum mulai** |
| B5 (X-12 KPI point log buruk) | ⬜ **menunggu pemilik**, bukan pekerjaan sesi |
| PR #324 | 🟡 **terbuka, belum di-review/merge** — cek statusnya dulu di awal sesi |
| Migrasi di repo | **209** |
| Gate | 149 tabel · 41 entity_prefix · 33 sm_machines · 73 notif_events |
| Live (`CDPS SG`, `egddxfcnrtecheiykhlf`) | **211 migrasi** — cocok dengan repo (209 file + 2 anomali, lihat §2) |

### Mulai dari mana

1. **Cek PR #324 dulu.** Kalau sudah merge, mulai branch baru dari `main` tip
   terbaru (`git fetch origin main && git checkout -B <branch> origin/main`).
   Kalau belum, dan tidak ada perubahan konflik, lanjutkan di branch yang sama
   atau cabang baru dari situ — tapi **cek CI-nya dulu**, jangan asumsikan hijau.
2. **Cek ulang kondisi repo DAN live sebelum menjalankan apa pun** yang
   menyentuh migrasi — sesi ini mengalami repo/live bergerak DUA KALI di
   tengah pengerjaan karena sesi lain berjalan paralel. Pola yang terbukti:
   `git fetch origin main` + diff repo↔live per-slug nama migrasi (bukan
   per-nomor) SEBELUM menyimpulkan apa pun tentang migrasi mana yang
   tertinggal — lihat §6 `A2-DRIFT` di `DECISIONS.md` untuk cara persisnya.
3. **B3 lebih dulu dari B4.** B3 murah (½ sesi) dan menutup kelas cacat yang
   baru saja terbukti nyata (A-req-3 hilang dari live berbulan-bulan tanpa
   satu sinyal merah pun). B4 menyentuh mekanisme RLS produksi dan py sendiri
   menyatakan perlu data produksi (p95 region Vercel) yang tidak tersedia dari
   sandbox — kemungkinan besar tetap `⬜` sesudah sesi ini juga, dan itu bukan
   kegagalan, itu keputusan yang sudah tertulis di rencananya sendiri.
4. **B5 JANGAN dikerjakan** — menunggu pemilik membangun "rumah" KPI-nya
   (`docs/backlog/M6ABC_BACKLOG.md` X-12). Tidak memblokir apa pun.

---

## 1. Apa yang SELESAI sesi ini (jangan dikerjakan ulang)

### A2 — empat migrasi tertinggal di-apply ke live `CDPS SG`

Urut nama, persis seperti diwajibkan handoff sebelumnya:
`a3_backfill_service_strategy_approved` (no-op diverifikasi) →
`areq3_private_brief_jumlah_anak` → `m18_store_ops_sku` →
`m18_store_ops_kuota_satuan`.

Diverifikasi lewat kueri (bukan `success: true`): gate 149/41/33/73 sama
persis dengan `db-rebuild.sh` lokal; `proacl` `private.brief_jumlah_anak`
eksplisit (bukan NULL); `store_ops_skus` terbaca `authenticated`;
`get_advisors security` nol temuan baru.

**Repo dan live bergerak DUA KALI di tengah sesi** (Feedback OD F-2/F-3/F-4/A-2
dan Gelombang D D-3 di-merge + di-apply pihak lain secara paralel dengan sesi
ini) — diverifikasi ulang penuh sebelum SETIAP apply, hasilnya konsisten
kedua kali. **Pelajarannya, bukan cerita lucu:** kalau melihat migrasi live
bertambah di antara dua pengecekanmu, itu bukan berarti hitunganmu salah —
cek ulang dari nol, jangan asumsikan siapa yang benar.

### A3 — `docs/DECISIONS.md`

Empat entri per §3 handoff sebelumnya, plus satu baris `Open` baru
(`A2-DRIFT`): live punya migrasi `d3_tutup_buku_pulihkan_komentar_jaga_transisi`
(version `20260908084905`) tanpa berkas yang cocok di `supabase/migrations/**`
pada `main` — ditemukan saat diff, milik jalur D-3 paralel, **dicatat, bukan
diperbaiki diam-diam**. Kalau sesi ini melihat berkas itu sudah muncul di
`main` (di-back-port oleh pemiliknya), tutup baris Open itu; kalau belum,
biarkan terbuka dan JANGAN diperbaiki dari sini — bukan milik tiket ini.

### B1 — `Makefile`

Ditulis ulang dari nol, tidak lagi shell ke `backend/` (Go, diarsip C-05).
Target baru: `install`, `db-rebuild`, `typecheck`, `test`
(+`test-core`/`test-db`/`test-domain`/`test-api`), `build`, `lint`,
`dev-api`/`dev-web`/`dev-portal`. CI tidak pernah memanggil `make` — nol
risiko regresi pipeline dicek dan dikonfirmasi.

### B2 — harness peramban lokal

Tiga skrip baru, **sudah teruji dan siap dipakai lagi**:

| Skrip | Fungsi |
|---|---|
| `scripts/dev-jwt.mjs` | Mint JWT HS256 lokal. **WAJIB** `--employee <id>` — klaimnya diambil dari `select employee_claims('<id>')` di DB lokal sungguhan, BUKAN ditebak dari `employees.divisi`. Lihat komentar di berkas untuk kenapa ini bukan detail kosmetik (§2 di bawah, kelas cacat yang sama bisa terulang). |
| `scripts/browser-tour.mjs` | Suntik token sebagai cookie `cdps_access_token` lewat Playwright, kunjungi daftar path dari sebuah JSON, screenshot full-page tiap satu, laporkan status HTTP + console-error. Chromium di-`launch({ executablePath })` eksplisit ke `/opt/pw-browsers/chromium-*` — jangan hapus baris itu, `npx playwright install` TIDAK akan bekerja di sandbox ini (tidak ada akses unduh browser baru). |
| `scripts/seed-browser-tour.ts` | Membangun SATU rantai klien→transaksi→layanan→Strategi→Brief (Creative/KOL/Store Operation)→Asset/Booking/Payment-Request/SKU lewat panggilan domain sungguhan — bukan `INSERT` mentah, bukan Alpha Digital DoD fixture (`supabase/seed.sql` tetap minimal, jangan disentuh). **Tidak idempoten** — jalankan sekali per `db-rebuild` segar. |

Pemakaian:
```
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && cd web-internal && npm install && cd ..
# terminal 1
cd apps/api && cat > .env.local <<'EOF'
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps
DIRECT_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps
SUPABASE_JWT_SECRET=local-dev-harness-secret-do-not-use-in-prod
NODE_ENV=development
EOF
npx next dev -p 3001
# terminal 2
cd web-internal && npx next dev -p 3000
# terminal 3
npx tsx scripts/seed-browser-tour.ts > /tmp/tour-ids.json   # baca stderr utk progres, JSON di stdout
node scripts/dev-jwt.mjs --employee EMP-0008 > /tmp/token.txt
# susun /tmp/pages.json — [{ "path": "/finance", "name": "01-finance" }, ...] —
# dari isi /tmp/tour-ids.json, lalu:
node scripts/browser-tour.mjs --token "$(cat /tmp/token.txt)" --pages /tmp/pages.json --out /tmp/tour-shots
```

**10 dari 11 layar** (daftar asli di handoff sebelumnya §4) dibuka dan
di-screenshot. **`/account/services/{id}`** dibuka tapi belum diperiksa
teliti terhadap dua detail spesifik yang diminta ("catatan pengganti field
PIC" + "kartu `CTR-`") — halamannya render bersih, kedua elemen itu
kemungkinan bersyarat pada state lain (mis. baru muncul sesudah Brief
pertama service itu dibuat). **Belum dibuktikan, sebut jujur** — kalau
sesi berikutnya butuh memverifikasinya, buat Brief dulu untuk service itu
sebelum membuka halamannya.

### Satu bug NYATA ditemukan dan diperbaiki

`/account/strategies/{id}` (notis pensiun `STR-`, sudah baca-saja sejak
2026-09-08) merender **"dipensiunkansejak"** — spasi hilang. Root cause:
JSX-nya benar secara sumber (`</strong> sejak` satu spasi), tapi baris
lanjutannya (`2026-09-08.`) pindah baris di source, dan algoritma
whitespace JSX MEMANGKAS spasi tunggal yang duduk di ujung baris alih-alih
menyamakannya jadi satu spasi. Diperbaiki dengan `{' '}` eksplisit.
**Ditemukan lewat `page.locator(...).innerText()`, BUKAN dari membaca
screenshot** — screenshot di zoom itu ambigu. Kalau ragu ada spasi hilang di
sesi berikutnya, baca `innerText`, jangan menyipitkan mata ke PNG.

---

## 2. Jebakan yang terbukti mahal sesi ini — baca sebelum mengulang polanya

1. **Klaim JWT sintetis WAJIB dari `employee_claims()`, tidak boleh
   ditebak.** Percobaan pertama harness B2 menebak `division: 'Management'`
   untuk Director (dari kolom HRIS `employees.divisi`) dan memicu galat
   `/persetujuan` (*"Gagal memuat satu antrian: Permintaan Block Task — M12:
   [data tidak ditemukan]"*) yang **tidak pernah terjadi pada Director
   sungguhan** — `employee_claims()` menurunkan `division` dari
   `role_mappings`, dan Director/OD tidak punya baris di sana (datang dari
   `employee_layered_roles`), jadi klaim sungguhannya `division: ''`.
   Almost-false-positive itu ketahuan justru karena diverifikasi ulang
   dengan klaim yang benar sebelum dilaporkan sebagai bug — kalau tidak,
   sesi ini nyaris melaporkan bug palsu ke pemilik. **Selalu jalankan**
   `select employee_claims('<id>')` **dulu**, jangan susun `app_metadata`
   dari tebakan kolom lain.
2. **Spasi hilang di JSX itu nyata dan tidak kelihatan dari `tsc`/`eslint`/
   `vitest`/`next build`.** Kelas cacat ini (elemen inline diikuti teks yang
   pindah baris di source) bisa terulang di berkas lain — kalau sesi
   berikutnya melihat teks yang terlihat "menempel" di sebuah halaman,
   curigai pola yang sama sebelum mengira itu masalah font/CSS.
3. **Repo↔live bisa bergerak SETIAP SAAT dari sesi lain yang paralel.**
   Jangan percaya snapshot migrasi yang lebih tua dari beberapa menit kalau
   akan mengambil keputusan apply/tidak-apply — `git fetch origin main` +
   diff live ulang.
4. **`npx playwright install` tidak bekerja di sandbox ini** (nol akses
   unduh browser). `playwright` npm terbaru mengharapkan revisi Chromium
   yang berbeda dari yang sudah ter-pasang di `/opt/pw-browsers/`. Gunakan
   `scripts/browser-tour.mjs` yang sudah menangani ini
   (`resolveChromiumPath()`), jangan panggil `chromium.launch()` polos.
5. **Postgres di container mati sendiri sewaktu-waktu** (disebutkan
   handoff-handoff sebelumnya, terbukti lagi normal di sesi ini — cek
   `pg_isready` dulu sebelum menyimpulkan kegagalan test/build adalah bug).
6. **`db-rebuild.sh` dua kali kalau data fixture manual (mis. `seed-browser-
   tour.ts`, atau baris `strategy_plans` yang disisipkan manual untuk
   memeriksa notis pensiun STR-) perlu dibersihkan** — lebih murah daripada
   menulis skrip cleanup, dan DB lokal murni disposable.

---

## 3. B3 — gerbang drift repo↔live (belum dikerjakan, direkomendasikan berikutnya)

**Masalah yang harus ditutup:** A-req-3 hilang dari live berbulan-bulan
(`private.brief_jumlah_anak` cabang Store Operation, migrasi
`20260922100500`) tanpa satu sinyal merah — ditemukan lewat pembandingan
manual repo↔live, bukan oleh tes mana pun (tes domain memakai koneksi
service-role dan buta terhadap kelas cacat "migrasi ada di repo, belum
di-apply ke live"). Hari ini nol gerbang otomatis untuk kelas ini.

**Pendekatan yang terbukti bekerja secara manual sesi ini** (jadikan basis
untuk yang otomatis):
1. `mcp__Supabase__execute_sql` (atau `psql` kalau ada kredensial CI) →
   `select version, name from supabase_migrations.schema_migrations order by
   version`.
2. Bandingkan terhadap nama berkas lokal `supabase/migrations/*.sql`
   **per-slug** (nama sesudah timestamp), BUKAN per-nomor — ledger live
   memakai stempel waktu APPLY, bukan nama berkas repo (O65), jadi
   `version` di live sering tidak cocok dengan prefix timestamp nama
   berkas repo padahal isinya sama persis.
3. Migrasi yang ada di repo tapi slug-nya tidak ada di live ⇒ tertinggal.
   Migrasi yang ada di live tapi slug-nya tidak ada di repo ⇒ drift
   sebaliknya (baris `A2-DRIFT` di `DECISIONS.md` adalah contoh nyata).

**Bentuk gerbangnya** — beberapa opsi, putuskan salah satu (atau usulkan
yang lebih baik) di awal sesi B3, JANGAN ditebak:
- Job CI terjadwal (bukan per-push, karena live berubah independen dari
  push) yang menjalankan perbandingan di atas dan gagal (atau memposting
  notifikasi) kalau ada slug yang hilang di satu sisi.
- Skrip `scripts/check-live-drift.sh` yang bisa dipanggil manual sebelum
  sesi apply-ke-live mana pun (menggantikan langkah manual §A2 di atas).
- Keduanya — skrip sebagai dasar, job CI sebagai jaring pengaman terjadwal.

**Yang perlu kredensial:** `SUPABASE_ACCESS_TOKEN`/project ref untuk MCP
Supabase (sudah tersedia di sesi ini via `mcp__Supabase__*`) — kalau CI GitHub
Actions perlu mengaksesnya sendiri, itu perlu secret terpisah, cek dengan
pemilik sebelum menambah secret baru ke repo.

---

## 4. B4 — pangkas round-trip `withClaims` (belum dikerjakan, ada risiko)

**Baca `docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md` §"Bagian 4"
penuh sebelum menyentuh apa pun** — rencana P2.5 di sana SENGAJA berhenti di
`⬜` sejak 2026-09-04, bukan lupa. Ringkasannya:

- `withClaims` (`packages/db/src/client.ts`) membungkus SETIAP baca dalam
  `BEGIN → SET LOCAL → query → COMMIT` — 4 round-trip ke DB per baca lewat
  pooler transaction-mode.
- Pola alternatif yang diusulkan (`onconnect` + `RESET` alih-alih
  `BEGIN`/`COMMIT` per request) **menyentuh mekanisme yang menegakkan RLS di
  SETIAP request** (CLAUDE.md: "Penegakan aturan ada di DB... RLS memikul
  row-scope"). Kalau `RESET ROLE`/`RESET ALL` gagal di satu jalur error,
  klaim/role sesi SEBELUMNYA bisa bocor ke request berikutnya yang memakai
  ulang koneksi yang sama — kebocoran identitas antar-request, bukan
  sekadar bug performa.
- **Prasyarat yang rencana itu sendiri sebut belum terpenuhi:** angka p95
  produksi (region Vercel aktual) yang jadi alasan langkah ini — butuh
  akses dashboard Vercel produksi, tidak tersedia dari sandbox mana pun
  yang dipakai sejauh ini.

**Rekomendasi tertulis di rencananya sendiri:** jalankan sebagai PR
tersendiri SETELAH region produksi diverifikasi memberi dampak nyata; kalau
dampaknya kecil, menyentuh mekanisme RLS demi itu tidak sepadan. **Kalau
sesi berikutnya tidak punya akses dashboard Vercel produksi (kemungkinan
besar tidak), B4 tetap `⬜` secara sah — itu bukan kegagalan sesi, laporkan
apa adanya dan lanjut ke pekerjaan lain**, jangan menebak angka p95 atau
mengerjakan langkah 5 tanpa datanya.

---

## 5. B5 — X-12 (JANGAN dikerjakan)

`docs/backlog/M6ABC_BACKLOG.md` baris X-12: **"rumahnya akan dibuat
menyusul"** — kata pemilik, 2026-08-07. Belum ada ketokan lanjutan sampai
tulisan ini. Batasnya sudah tertulis dan masih berlaku: B-09 boleh mencatat
keterlambatan ke `audit_log`, **tidak boleh** mengklaim memengaruhi
Performance Score, dan tidak boleh mengarang bobotnya. **Jangan tanyakan
ulang ke pemilik kecuali pemilik yang membawanya** (pola yang sama dengan
LT-1/LT-2, lihat `DECISIONS.md` 2026-09-08).

---

## 6. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  209 migrasi
  gate: 149 tabel · 41 entity_prefix · 33 sm_machines · 73 notif_events
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

core       985
db          64
domain    2188 (+1 skip)
api        494
web-internal 695   (+ tsc --noEmit bersih)
web-client-portal  (tidak dijalankan ulang sesi ini — tidak disentuh)

live CDPS SG: 211 migrasi (209 repo + 2 D-3 pasca-deploy/anomali,
  lihat A2-DRIFT di DECISIONS.md), gate 149/41/33/73 cocok
```

Semua angka di atas diverifikasi ULANG di akhir sesi ini (bukan disalin
dari sesi sebelumnya) — `db-rebuild.sh --yes` dijalankan sendirian, lalu
`core`/`db`/`domain` (sendirian, sesudah rebuild) /`api` dijalankan
berurutan. `web-client-portal` tidak disentuh sesi ini (nol perubahan yang
relevan), jadi tidak dijalankan ulang — asumsikan angka handoff sebelumnya
(19) masih berlaku, verifikasi kalau ragu.

---

## 7. Menunggu ketokan pemilik — tidak memblokir B3/B4

Daftar ini tidak berubah sejak handoff sebelumnya (LT-2/LT-8, LT-1, O75, O76,
peran Creative terpisah) — lihat `HANDOFF_PENUTUP_REVISI_OD_20260908.md` §7
untuk rinciannya. **Jangan tanyakan ulang** kecuali pemilik yang membawanya.

---

## 8. PR yang perlu ditindaklanjuti

**https://github.com/MEAgrup/AgencyAPP/pull/324** — `claude/handoff-penutup-
revisi-od-rjfm0w` → `main`. Berisi seluruh isi handoff ini (A2/A3/B1/B2).
Cek status CI dan review di awal sesi berikutnya; kalau ada perubahan yang
diminta reviewer, itu prioritas SEBELUM memulai B3.
