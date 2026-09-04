# HANDOFF — Revisi Sales, Creative & Performa (SESI 4)

> Melanjutkan `HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md`. Dokumen itu **belum
> digantikan** — §2 (keputusan pemilik), §3 (tiket tersisa) dan §4 (gate cutover)
> **carry-over apa adanya**; sesi ini tidak menyentuh satu pun dari itu.
>
> Rencana yang dikerjakan sesi ini: dokumen rencana yang dibawa Nerissa (COO)
> 2026-09-04, dibongkar jadi backlog di
> **`docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`** — baca itu untuk
> detail per-tiket; dokumen ini hanya posisi & sisa.
>
> Branch: `claude/handoff-navigasi-mea-ai-tools-t0iw6o` · PR: **#287**

---

## 0. TL;DR — 13 dari 14 tiket selesai

| Rumpun | Tiket | Status |
|---|---|---|
| **L** Sales — lead aging | L1 state `[Unrespon]` · L2 notif v14 · L3 job harian · L4 cermin FE · L5 fix 2 metrik | ✅ 5/5 |
| **E** Sales — export | E1 `GET /leads/export` · E2 tombol + parity | ✅ 2/2 |
| **C** Creative — massal | C1 refactor `execEdgeTx` · C2 submit/start batch · C3 kartu PIC · C4 kartu AM | ✅ 4/4 |
| **P** Performa | P1 (region+indeks+`http.ts`) · P2 §6 pagination · P2 §7 N+1 · P2 §8 `canView`→SQL | ✅ 4/4 |
| **P** Performa | **P2 §5 — pangkas round-trip `withClaims`** | ⬜ **SENGAJA ditahan — lihat §3** |

Semua sudah di-merge dengan `main` terbaru (O73) dan **hijau penuh** di tree
gabungan itu.

---

## 1. Posisi teknis (verifikasi terakhir, tree gabungan)

```
bash scripts/db-rebuild.sh --yes    → 177 migrasi, gate 145/40/31/69, 4 invariant ✓
packages/domain   1845 lulus (1 skip)
apps/api           435 lulus
packages/core      559 lulus
packages/db         53 lulus
web-internal       549 lulus
tsc --noEmit       bersih di core / domain / api / web-internal
lint               1 error PRE-EXISTING di admin/employees (tidak disentuh sesi ini)
```

Gate `notif_events` naik **67 → 69** (L2, katalog v14). Tabel/prefix/mesin
**TETAP** 145/40/31.

### 1.1 ⚠️ Migrasi: BELUM di-apply ke live `CDPS SG`

Empat migrasi branch ini **pending** — sudah dicek lewat MCP Supabase
(`list_migrations` pada `egddxfcnrtecheiykhlf`), live berhenti di
`o73_commission_rule_grammar`:

| berkas | isi |
|---|---|
| `20260911030000_p1_perf_indexes.sql` | 8 indeks aditif (P1) |
| `20260911040000_m1_unrespon_state.sql` | 5 edge `[Unrespon]` (L1) |
| `20260911050000_m1_unrespon_notif.sql` | katalog notif v14, 2 event (L2) |
| `20260911060000_m1_unrespon_tick.sql` | fungsi + pg_cron 05:30 WIB (L3) |

**Apply lewat `apply_migration` MCP, JANGAN `psql -f`** (itu yang melahirkan
drift O38). Urutan wajib: 030000 → 040000 → 050000 → 060000.

**Kenapa nomornya lompat dari `20260911005000/010000/015000/020000`:** `main`
mendaratkan `20260911010000_o73_commission_rule_grammar.sql` — **nomor versi
yang persis sama** dengan `_m1_unrespon_state` milik branch ini. Punya `main`
sudah ter-apply di live; punya branch ini belum. Dua berkas dengan satu versi
akan merusak `supabase db push` (versi = kuncinya) dan membuat urutan apply
lokal beda dari live (`m1` menyortir sebelum `o73`). Jadi keempatnya
**dinomori ulang di atas** yang sudah ter-apply, urutan relatifnya dijaga.
Semua referensi di `db-rebuild.sh`, `ci.yml`, backlog, `sales.ts`, dan
`notification.ts` ikut diperbarui.

### 1.2 pg_cron belum tentu aktif

`20260911060000` membungkus jadwal pg_cron dalam `IF EXISTS (... pg_available_extensions ...)`.
Kalau ekstensinya tidak ada di `CDPS SG`, **job tidak terjadwal dan migrasinya
tetap sukses tanpa bunyi**. Setelah apply, verifikasi:

```sql
select * from cron.job where jobname like '%unrespon%';
```

Kalau kosong: jalankan manual lewat route internal
`POST /api/v1/internal/leads/tick` (butuh header secret, `tickSecretOk`
fail-closed) atau jadwalkan lewat Vercel Cron.

---

## 2. Yang perlu KEPUTUSAN Nerissa/Yohan

Empat deviasi PRD sudah tercatat di `docs/DECISIONS.md` §Open sebagai
**REV-1..REV-4** — semuanya sudah dikerjakan dengan default yang dipilih
rencana, jadi ini **konfirmasi, bukan blocker**:

| # | Inti | Default yang sudah dibangun |
|---|---|---|
| REV-1 | `[Unrespon]` menggerakkan STATUS, sementara M1-OA-7 memutuskan penuaan = FLAG | Dua mesin status berbeda (`prospect_attempts` vs `leads.record_status`) — bukan kontradiksi harfiah |
| REV-2 | `[Unrespon]` tidak ada di enumerasi status M1 §2/§9.3 | Ditulis sebagai "DEVIASI PRD" di `STATE_MACHINES.md` §1, pola yang sama dengan `[Deleted]` |
| REV-3 | M1-OA-8 bilang *Sales* yang mencatat alasan NQ; job menulis `created_by='SISTEM'` | `junkBreakdown` **mengecualikan** baris SISTEM dari junk campaign |
| REV-4 | Mode "1 link folder" Creative ditunda | Hanya mode "30 kolom" dibangun; folder = tiket sendiri |

Plus tujuh pertanyaan operasional di backlog §"Perlu dikonfirmasi Nerissa"
(cap export 50.000, delimiter `;`+BOM, isi export, 2 event vs 1, junk
breakdown, audit export, `record_status` saat auto-NQ) — semuanya sudah
dijalankan dengan default rencana.

---

## 3. Satu-satunya tiket tersisa: P2 §5

**Pangkas round-trip `withClaims`** (`packages/db/src/client.ts`) — pola
`onconnect`+`RESET` supaya tiap baca tidak lagi dibungkus `BEGIN…COMMIT`.

**Sengaja TIDAK dikerjakan**, dua alasan yang berdiri sendiri:

1. **Ini menyentuh mekanisme penegak RLS di SETIAP request baca.** CLAUDE.md:
   "Penegakan aturan ada di DB… RLS memikul row-scope". Melepas pembungkus
   transaksi berarti `SET LOCAL` jadi `SET` biasa, dan butuh jaminan
   `RESET ROLE`/`RESET ALL` yang **tidak pernah** gagal termasuk di jalur
   error — kalau bocor, klaim/role request sebelumnya terbawa ke request
   berikutnya yang memakai ulang koneksi yang sama di pooler transaction-mode.
   Itu kelas bug keamanan, bukan kelas bug performa.
2. **Pembenarannya belum terukur.** Alasan langkah ini adalah latency, dan
   angka p95 produksi belum bisa dilihat dari sandbox (butuh dashboard Vercel /
   `x-vercel-id`). Kalau ternyata dampaknya kecil, menyentuh jalur keamanan
   demi itu tidak sepadan.

**Urutan yang disarankan:** ukur dulu (§4 di bawah) → kalau ada dampak nyata,
kerjakan sebagai PR sendiri dengan tes yang membuktikan `RESET` jalan di jalur
error dan tidak ada kebocoran lintas-reservasi koneksi.

Catatan: pipelining preamble (`SET` + klaim dalam satu round-trip) **sudah ada
sejak sebelum sesi ini** — diagnosis "4 round-trip" sudah memperhitungkannya.
Yang tersisa adalah `BEGIN`+`COMMIT`-nya.

---

## 4. Yang perlu diukur setelah deploy (syarat handoff P1 yang belum lunas)

Rencana P1 mensyaratkan pengukuran before/after; **yang belum bisa** dari
sandbox:

- **Region:** `apps/api/vercel.json` kini `"regions": ["sin1"]` (sebelumnya
  tanpa kunci `regions` ⇒ default `iad1`, sementara DB di `ap-southeast-1`).
  Konfirmasi region AKTUAL lewat header `x-vercel-id` setelah deploy, lalu
  bandingkan p95.
- **Indeks:** 8 indeks P1 sudah cocok ke `ORDER BY` yang benar-benar dipakai,
  tapi tabel lokal terlalu kecil untuk planner memilih index scan — nilainya
  baru terlihat di volume produksi. Sengaja tidak dipaksakan `EXPLAIN` palsu.
- **Baseline P2** ada di `bench/README.md` (`bench.ts`, `claims-bench.ts`, DB
  sintetis `cdps_bench`) — pembanding "before" untuk P2 §5.

---

## 5. Peta perubahan sesi ini (untuk orientasi cepat)

### Mesin baru yang dipakai lintas modul

- **`packages/core/src/page.ts`** — keyset pagination atas urutan rumah
  `created_at desc, id desc`. Cursor buram base64url, probe
  over-fetch-by-one, `LIMIT NULL` = unbounded.
  **Tanpa page request = unbounded, dan itu menanggung beban**:
  `marketing.dashboard` menghitung metrik atas SETIAP campaign — halaman
  default di sana bukan bikin cepat, tapi bikin **salah**. Hanya jalur request
  yang meminta halaman.
- **`apps/api/src/lib/csv.ts`** — BOM + delimiter `;` + escaping (E1).

### Enam pembacaan daftar yang kini dibatasi (P2 §6)

| Domain | Route | FE |
|---|---|---|
| `leads.leadsDatabase` | `GET /leads` | tab Lead Saya + Database |
| `leads.poolBoard` | `GET /leads/pool` | tab Pool |
| `client.listClients` | `GET /clients` | halaman Klien |
| `sales.listAttempts` | `GET /attempts` | Sales Workspace |
| `campaign.listCampaigns` | `GET /marketing/campaigns` | halaman Marketing |
| `renewal.listRenewals` | `GET /renewals` | inbox Persetujuan |

Sengaja **tidak** dipaginasi, dengan alasannya: `GET /leads/export` (export
"100 baris pertama" bukan export — batasnya `EXPORT_ROW_CAP` sendiri),
`marketing.dashboard`, inbox Persetujuan + lookup campaign di Marketing
Performance (keduanya minta `MAX_PAGE_LIMIT` sekali tarik; inbox mengatakan di
layar kalau masih terpotong — baris antrean yang tak pernah tampil tak pernah
disetujui).

### Penjaga regresi yang ditambahkan

`apps/api/src/lib/page-parity.test.ts` — memindai keenam route tetap memenuhi
**dua** sisi kontrak (`page.parseRequest` DAN `next_cursor`). Balik ke
pembacaan unbounded itu lolos typecheck dan lolos semua tes lain; di produksi
ia cuma muncul sebagai halaman lambat.

---

## 6. Ranjau yang ditemukan sesi ini (jangan diulang)

1. **Filter klien di atas daftar yang dipaginasi.** Sales Workspace menyaring
   status **di klien** atas array yang sudah diambil. Dipaginasi tanpa
   diperbaiki = tab status tampak kosong padahal barisnya di halaman
   berikutnya. Dipindah ke server (`?status=`). Aturan ini sudah tertulis di
   komentar tab Pool sejak lama — **kalau menambah paginasi ke daftar lain,
   cek dulu apakah ada filter/search klien di atasnya.**
2. **Lookup yang dijoin ke data unbounded.** Marketing Performance memasangkan
   nama campaign ke baris metrik lewat `campaignMap`; metriknya unbounded, jadi
   lookup yang dipaginasi akan membuat baris kehilangan nama **tanpa error**.
3. **Perbandingan row butuh NOT NULL.** `(created_at, id) < (…)` jadi NULL —
   dan diam-diam membuang baris — kalau salah satu kolom nullable. Sudah dicek:
   NOT NULL di kelima tabel yang dipakai. **Cek lagi untuk tabel baru.**
4. **`'infinity'` sebagai string bind ditolak postgres.js.** Sentinel "tanpa
   cursor" memakai `Date` tahun 9999, bukan string.
5. **Flakiness `client.test.ts` / `admin.test.ts` yang BUKAN bug.** Keduanya
   memakai ID literal deterministik (`SVC-HOLD-${seq++}`, reset tiap proses)
   yang bentrok dengan baris `audit_log`/`notifications` sisa run sebelumnya —
   tabel itu immutable jadi `afterEach` tidak bisa membersihkannya.
   **Selalu `bash scripts/db-rebuild.sh --yes` sebelum menganggap kegagalan
   suite itu nyata.** Di CI tidak pernah terjadi (selalu DB baru).
6. **Jangan seed data uji ber-`created_by='ZZ-%'` sambil suite jalan.** Pola
   `ZZ-%` itu yang dipakai `afterEach` semua suite; sesi ini sempat mencemari
   satu run karena itu, run-nya dibuang dan diulang bersih.

---

## 7. Kalau melanjutkan: mulai dari sini

1. **Baca** `docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md` (tabel
   "Urutan Pengerjaan" = status per tiket) dan §Open `docs/DECISIONS.md`
   (REV-1..REV-4).
2. **Kalau PR #287 sudah merge:** apply 4 migrasi ke `CDPS SG` lewat
   `apply_migration` (urutan §1.1), lalu verifikasi pg_cron (§1.2).
3. **Kalau mau lanjut P2 §5:** ukur dulu (§4). Jangan mulai tanpa angka.
4. **Sisa proyek lain** (SESI3 §3, gate cutover C-05, PR #281 draft, PR #171
   terbuka sejak 15 Agu) **tidak disentuh sesi ini** — carry-over apa adanya.

### Perintah verifikasi penuh

```bash
service postgresql start
bash scripts/db-rebuild.sh --yes
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test --workspaces --if-present
( cd web-internal && npx vitest run && npm run lint )
```
