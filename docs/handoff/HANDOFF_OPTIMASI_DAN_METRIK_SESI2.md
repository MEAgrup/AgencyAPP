# Handoff — Optimasi Kecepatan (SESI 2 / **P-1 SELESAI**) + status T-1…T-4

**Tanggal:** 2026-08-14 · **Branch:** `claude/website-speed-optimization-je9w5q`
**Pendahulu:** `HANDOFF_OPTIMASI_DAN_METRIK_SESI1.md` (rencana). Baca ini dulu — ia
menggantikan §P-1 di sana.

> **Ringkas:** P-1 dikerjakan penuh dan mendarat. Akar yang didiagnosis SESI1 (N+1,
> latency-bound) **terkonfirmasi dengan pengukuran**, bukan hanya dibaca: satu
> pembacaan performa AM menembak **679 query**; sekarang **10**. T-1…T-4 **tidak**
> disentuh — keempatnya masih menunggu KEPUTUSAN PEMILIK (daftar di §5).

---

## 1. Baseline yang diukur (bukan tebakan)

Harness ada di `bench/` (lihat `bench/README.md`). Beban sintetis: 25 klien, 50
layanan, 150 brief, 450 asset, 50 booking KOL, 100 komplain, 350 metric entry,
900 baris transisi `audit_log` — kecil, persis kondisi yang dikeluhkan pemilik
("lambat walau data sedikit").

Metrik utamanya **jumlah query per pembacaan**, bukan stopwatch. Alasannya di
`bench/README.md`: Postgres lokal menjawab ~0.05 ms lewat socket, jadi wall-clock
lokal justru menyembunyikan masalahnya. Satu query = satu round-trip ke pooler.

| Pembacaan | Query SEBELUM | Query SESUDAH | Turun |
|---|---:|---:|---:|
| `performance.previewCurrent` — **AM** | **679** | **10** | −98.5% |
| `performance.previewCurrent` — Creative | 481 | 7 | −98.5% |
| `performance.previewCurrent` — Ads | 135 | 10 | −92.6% |
| `performance.previewCurrent` — KOL | 81 | 7 | −91.4% |
| `health.preview` (satu klien) | 27 | 9 | −66.7% |
| `health.portfolio` (D-12) | 1 | 1 | sudah set-based |
| `performance.teamRollup` | 1 | 1 | sudah set-based |

Wall-clock lokal ikut turun (AM 337 ms → ~15-26 ms), tapi **jangan** kutip angka
itu sebagai p95 produksi — lihat §6.

**Arti angkanya di produksi.** Jalur nyata `browser → web-internal → apps/api →
pooler Supabase` punya RTT belasan milidetik ke DB. Pada 15 ms/round-trip,
halaman performa AM sebelumnya menghabiskan ±10 detik **hanya menunggu jaringan**;
sekarang ±0,15 detik. Itu yang dirasakan pemilik sebagai "lambat walau data
sedikit": bukan volume, tapi jumlah percakapan.

---

## 2. Yang diubah

### 2.1 N+1 → set-based (dampak terbesar)

Modul baru **`packages/domain/src/transitions.ts`**: `loadTransitions(q, entityType,
ids, order)` membaca log transisi BANYAK entity dalam SATU query (`entity_id =
any(...)`) lalu mengelompokkannya di memori.

Dua urutan dipertahankan apa adanya (`'id'` untuk M14, `'created_at'` untuk
M13/M12) karena menyeragamkannya akan mengubah hasil pada baris ber-`created_at`
backdate — dan P-1 wajib nol perubahan perilaku.

Pemanggil yang dipindahkan ke jalur ter-batch:

| Berkas | Dulu | Sekarang |
|---|---|---|
| `performance.ts::creativeCandidates` | 1 query per asset | 1 query untuk semua asset |
| `performance.ts::adsCandidates` | 1 query per brief | 1 query untuk semua brief |
| `performance.ts::kolCandidates` | 1 query per booking | 1 query untuk semua booking |
| `performance.ts::amResolutionHours` | 1 query per komplain | 1 query untuk semua komplain |
| `performance.ts::amRevisionEscalation` | O(klien × task) query | 4 query total |
| `performance.ts::amCandidates` (CHR) | 1 query per klien | 1 query untuk portofolio |
| `performance.ts::computeModifier` | 1 query per klien tersentuh | 1 query total |
| `performance.ts::adsCampaignMetrics` | 1 query per campaign | 1 query grouped |
| `performance.ts::targetFor` | 1–2 query **per komponen** | 1 query per (role, periode), di-memo |
| `health.ts::taskCandidates` | 1 query per task | 2 query (asset + brief) |
| `health.ts::paymentCandidate` | 1 query per installment | 1 query untuk seluruh set |

Pembacaan daftar yang per-baris juga diperbaiki, dengan mempertahankan bentuk
query-nya dan hanya menghilangkan **serialisasinya**:
`board.listDependencies` (2 query/baris → per client & per brief unik, paralel),
`kol.listBriefBookings` (2 query/booking → ter-pipeline),
`marketing.dashboard` (5 query/campaign berurutan → per-campaign paralel).

### 2.2 Biaya tetap amplop klaim RLS

`packages/db/src/client.ts::withClaims` mengeluarkan `set_config` dan `SET LOCAL
ROLE` **sebelum** salah satunya di-await, jadi postgres.js mem-pipeline keduanya
jadi satu round-trip. Urutan FIFO per-koneksi tetap dijaga — klaim tetap terbit
sebelum role diturunkan, keduanya tetap mendarat sebelum apa pun yang dikeluarkan
`fn`. Ini biaya yang dibayar **setiap** pembacaan API, jadi satu round-trip yang
hilang berlaku menyeluruh.

`createClient` juga menetapkan `max`/`idle_timeout`/`connect_timeout` eksplisit
(bisa di-override per-environment lewat `CDPS_PG_*`). Alasannya di komentar kode:
API jalan sebagai banyak instance serverless berumur pendek, masing-masing dengan
pool sendiri di atas satu pooler bersama — pool besar per-instance tidak membeli
apa pun dan justru menghabiskan slot pooler saat fan-out.

### 2.3 Route yang membuka transaksi dua kali

`GET /marketing/campaigns/[id]/performance` memanggil `readAsActor` **dua kali**
— dua siklus BEGIN → set_config → SET ROLE → … → COMMIT untuk satu GET. Sekarang
satu transaksi, dua pembacaan ter-pipeline. `attempts/[id]/activities` dan
`demo-tasks/[id]` juga dipararelkan di dalam transaksinya.

### 2.4 Indeks

Migrasi `supabase/migrations/20260814010000_p1_perf_indexes.sql` — empat indeks
untuk kolom filter panas yang **tidak punya indeks sama sekali**, masing-masing
menyebut query yang membutuhkannya:
`complaints(assigned_to)`, `briefs(assigned_pic, assigned_division)`,
`metric_entries(campaign_id, period_start)`, `optimization_logs(actor, created_at)`.

Diverifikasi dengan `EXPLAIN ANALYZE` pada dataset berskala (50 rb baris):
Seq Scan → Bitmap Index Scan. Indeks yang sudah ada **tidak** diduplikasi —
`audit_log(entity_type, entity_id)`, `assets(assigned_pic)`,
`clients(assigned_am_id)`, `client_health_snapshots(client_id, period_start)`
semuanya sudah terpasang sejak migrasi asalnya.

### 2.5 Frontend

**Waterfall auth (paling berdampak).** `(shell)/layout.tsx` menahan render
`{children}` selama `loading`, jadi halaman **belum ter-mount** — dan karena itu
belum menembak fetch-nya sendiri — sampai `GET /me` selesai. Setiap hard load =
dua permintaan berurutan, masing-masing menempuh jalur penuh ke pooler.
`auth-context.tsx` sekarang menghidrasi sesi dari `sessionStorage` lalu tetap
merevalidasi ke `/me` di latar (stale-while-revalidate), jadi muat kedua dan
seterusnya menembakkan fetch halaman **bersamaan** dengan `/me`.

⚠️ **Ini bukan otorisasi.** Semua gerbang tetap di server (cookie + RLS + gate
TS); nilai cache hanya menentukan apa yang DIGAMBAR sebelum revalidasi. Peran
basi paling jauh memunculkan menu yang API-nya tetap menjawab 403, dan
revalidasi mengoreksinya dalam satu round-trip. Dipakai `sessionStorage` (mati
saat tab ditutup), bukan `localStorage`. Hidrasi sengaja di `useEffect`, bukan
di initialiser `useState` — membaca storage saat render pertama akan membuat
klien tidak sepakat dengan HTML server dan merusak hidrasi.

**Polling badge.** `use-unread-count.ts` dulu polling 30 detik selamanya,
termasuk di tab latar; sekarang berhenti saat `document.hidden` dan menyegarkan
sekali saat tab kembali terlihat.

**Satu waterfall halaman.** `tasks/[id]` cabang brief memanggil `getBrief(id)`
lalu `listBriefAssets(id)` berurutan padahal keduanya berkunci `id` yang sama →
`Promise.all`.

---

## 3. Bukti nol regresi

| Suite | Hasil |
|---|---|
| `packages/domain` | **1246** lulus, 1 skip (1242 sebelumnya + 4 tes P-1 baru) |
| `apps/api` | **345** lulus |
| `packages/core` | **220** lulus |
| `packages/db` | **48** lulus |
| `web-internal` | **238** lulus |
| `scripts/db-rebuild.sh` | 101 migrasi, semua gate & invariant lolos |
| typecheck + eslint | bersih di semua workspace |

Parity route/shape/body hijau; `KNOWN_GAPS` tetap **kosong**.

> **Jebakan saat menjalankan suite:** `audit_log` append-only, dan beberapa test
> meng-assert **hitungan absolut** baris audit. Menjalankan suite dua kali di DB
> yang sama membuat `admin.test.ts` (hari libur) dan `recap.job.test.ts` merah
> dengan "expected 7 to be 1" — itu akumulasi antar-run, bukan regresi.
> `scripts/db-rebuild.sh --yes` dulu sebelum menyimpulkan apa pun.

### Penjaga regresi (tes baru)

`packages/domain/src/perf_n1.test.ts` — 4 tes:

1. Preview Creative: **jumlah query untuk 2 asset harus SAMA dengan untuk 8**.
2. Preview AM: **1 klien vs 4 klien**, jumlah query sama.
3. Komponen Creative dipin pada fixture yang dihitung tangan (Speed 75, Revision 60)
   — membuktikan batching tidak mengubah aritmetikanya.
4. `loadTransitions` dibandingkan **baris-per-baris** dengan pembacaan per-entity
   versi lama.

Penjaganya sudah dibuktikan menggigit: mengembalikan N+1 satu baris saja membuat
tes (1) merah (15 vs 9), dan pesan gagalnya mencetak daftar query kedua fixture
supaya jelas query mana yang berlipat.

---

## 4. Tuas kecepatan yang MASIH terbuka (belum dikerjakan, sengaja)

Diurut menurut dampak yang diperkirakan.

1. 🔴 **Rewrite proxy `web-internal` → `apps/api` menambah satu hop penuh ke
   SETIAP panggilan API.** `next.config.ts` mem-proxy `/api/v1/*` ke deployment
   `apps/api` yang terpisah, jadi tiap permintaan menempuh
   `browser → Vercel(web-internal) → Vercel(apps/api) → pooler`. Menghapus hop itu
   (panggil `apps/api` langsung) butuh CORS + cookie lintas-situs — **keputusan
   keamanan**, bukan tuning, jadi ia butuh entri `DECISIONS.md` dan tanda tangan
   pemilik. Tidak diambil sendiri. Ini kemungkinan besar tuas terbesar yang
   tersisa.
2. 🟡 **Refresh pasca-mutasi berurutan di FE.** ±40 tempat berpola
   `await load(); await loadMetrics();` — dua pembacaan independen dijalankan
   satu per satu, jadi jeda setelah tiap aksi dua kali lebih panjang dari
   perlunya. Mekanis dan aman satu per satu, tapi tersebar di banyak alur mutasi
   yang perlu dibaca dulu; sengaja tidak disapu buta.
3. 🟡 **`runSnapshotJob` (M13 & M14)** masih satu transaksi per klien/staf. Itu
   **disengaja** (idempotensi fire-once + row lock), dan ia job batch, bukan
   halaman. Kalau sweep-nya jadi lambat, perbaikannya adalah mem-batch pembacaan
   di dalam `computeFor`, **bukan** melonggarkan penguncian.
4. 🟢 **N+1 di jalur TULIS** (`plan.ts`, `strategi.ts`, `sales.ts`, `employees.ts`
   — insert di dalam loop). Tidak menyentuh kecepatan muat halaman; relevan hanya
   kalau ada keluhan pada aksi simpan yang besar.
5. 🟢 **Bundle FE** diperiksa, tidak ada yang mencolok (hanya next+react, nol
   dependency berat). Jaringan yang dominan, bukan JavaScript.

---

## 5. T-1…T-4 — TIDAK dikerjakan, semua menunggu pemilik

Sesi ini sengaja berhenti di P-1: SESI1 menetapkan urutan "P-1 dulu", dan
keempat task berikutnya bergantung pada keputusan yang belum ada. Daftar
pertanyaannya utuh, tak berubah dari SESI1 §Daftar KEPUTUSAN PEMILIK:

1. **T-1 (O9):** target bulanan per-TEAM saja, atau per-INDIVIDU staff?
2. **T-2 (RM-2 Hold Service):** klien all-hold ikut skip Health snapshot? · hold
   meng-cascade ke Brief/Asset/Campaign anak? · butuh event notif v8 baru?
3. **T-3 (M8 CTR/CVR/CPC/CPM):** definisi CVR + sumber "conversions"? (CTR/CPC/CPM
   bisa jalan lebih dulu — hanya butuh clicks/impressions.)
4. **T-4:** sumber view organik? · atribusi CPL (blended?) · Upcoming Milestones
   perlu sekarang?

---

## 6. Yang TIDAK bisa diklaim sesi ini

- **p95 produksi belum diukur.** Tidak ada akses ke deployment live dari sesi ini.
  Angka di §1 adalah jumlah round-trip + wall-clock terhadap Postgres lokal.
  Proyeksi "±10 s → ±0,15 s" adalah aritmetika round-trip × RTT, **bukan**
  pengukuran produksi. Untuk angka sungguhan: Vercel Analytics + Supabase
  `query_logs` pada deployment sebenarnya, sesudah rilis ini mendarat.
- **Sapuan N+1 belum menyeluruh.** Yang disapu adalah jalur baca panas yang
  disebut SESI1 plus temuan sendiri (§2.1). Jalur tulis (§4 poin 4) tidak
  disentuh.
- **Indeks hanya diverifikasi pada data sintetis.** Rencana query di produksi
  dengan distribusi baris sebenarnya bisa berbeda; kalau ada yang masih lambat,
  `EXPLAIN` di live dulu sebelum menambah indeks lagi.

## Ranjau repo (tetap)

- Migrasi HANYA `supabase/migrations/**` + `apply_migration` (O38); rebuild DB
  HANYA `scripts/db-rebuild.sh`. `backend/**` read-only (Go+MySQL pensiun).
- Wire snake_case `null` eksplisit (O43); `KNOWN_GAPS` route-parity tetap kosong.
- Penegakan aturan di DB (sm_transition + RLS + trigger), TS = pembungkus.
- Notif re-baseline lewat baris `notif_catalog_versions`, bukan literal (O55).
- **Baru:** `bench/` adalah harness lokal — bukan CI, bukan deploy. Jangan
  jalankan `seed-bench.sql` di DB yang dipakai test (lihat §3).
