# HANDOFF — Cutover Sesi 2 (deviasi 404 dikonfirmasi + C-02 selesai)

> ⚠️ **C-03 SUDAH DIJALANKAN** sesudah dokumen ini ditulis → **NO-GO, 1 blocker**.
> Baca `docs/handoff/CUTOVER_UAT_REPORT_20260728.md` dan **O38** di `docs/DECISIONS.md`
> **sebelum** merge PR #59 atau deploy migrasi ke `CDPS SG` — migrasi C-01 terbukti
> **gagal apply** ke skema live.

> **Dokumen standalone.** Lanjutkan chat berikutnya dari file ini.
> Tanggal: 2026-07-28. Sesi: eksekusi build plan cutover, lanjutan sesi 1.
> Pendahulu: `docs/handoff/HANDOFF_CUTOVER_SESI1.md`.

---

## 0. LOKASI TERAKHIR — mulai dari sini

| Item | Nilai |
|---|---|
| **Branch kerja** | `claude/handoff-cutover-sesi1-yh3o39` |
| **Base** | `claude/cdps-supabase-migration-enh0gp` @ `94513a1` (= head PR #59) |
| **PR sesi ini** | draft, base = branch PR #59 (**stacked**, bukan ke `main`) |
| **PR pendahulu** | **#59** (draft, → `main`) — **masih terbuka, belum di-merge** |
| **Rencana induk** | `docs/backlog/CUTOVER_BACKLOG.md` ⟵ **baca ini dulu** |
| **Log keputusan** | `docs/DECISIONS.md` (2 entri 2026-07-28: O37, lalu konfirmasi 404) |
| **Tiket berikutnya** | **C-03** — UAT paritas end-to-end di stack baru |

**PENTING soal urutan merge.** Sesi ini menumpuk di atas PR #59 karena C-02 memakai
`readAsActor` yang lahir di C-01. Merge **#59 dulu** ke `main`, baru PR sesi ini (atau
ganti base-nya ke `main` setelah #59 masuk). Jangan merge PR sesi ini duluan.

---

## 1. Yang selesai sesi ini

### Keputusan terbuka #1 sesi 1 — deviasi 404 vs 403 ✅ DIKONFIRMASI

Pemilik menerima rekomendasi: **404 dipertahankan**. Perilaku final terkunci:

- `GET /api/v1/leads/{id}` atas lead yang tak boleh dibaca aktor → **404** (baris
  ter-filter policy `leads_select` sebelum kode aplikasi melihatnya).
- Endpoint **LIST** (`/leads`, `/leads/pool`) tetap **403** ber-pesan BI
  `[anda tidak memiliki akses untuk melakukan transisi ini]` lewat gate endpoint
  `canReadPool`/`leadListScope` — penolakan di situ soal akses endpoint, bukan
  visibilitas baris.
- **NOL kode berubah** oleh keputusan ini; perilaku 404 sudah terpasang sejak C-01.
  Yang berubah hanya status deviasinya: *menunggu konfirmasi* → *disetujui*.
- **Konsekuensi untuk C-03:** perbedaan status code ini dicatat sebagai deviasi
  **TERDOKUMENTASI**, bukan FAIL, saat walk paritas dijalankan.

Tercatat: `docs/DECISIONS.md`, baris Decided 2026-07-28 (tepat di bawah entri O37).

### C-02 — endpoint `notifications` ✅

Badge & halaman notifikasi FE sebelumnya rusak: engine + tabel ada, **route-nya nol**.
Sekarang ada, paritas dengan Go.

**Yang dibangun:**
- **`packages/domain/src/notification.ts`** (baru) — `list`, `unreadCount`, `inbox`
  (komposisi keduanya, dipakai route supaya `data` + `unread_count` datang dari SATU
  transaksi), `markRead`, `parseId`.
- **`GET /api/v1/notifications`** (+ `?unread=1`) — lewat **`readAsActor`** (pola C-01),
  jadi policy `notifications_select` benar-benar berjalan. `?unread=1` menyaring
  **daftar saja**; `unread_count` tetap TOTAL (badge menampilkan angka yang sama di
  kedua tab — pola Go).
- **`POST /api/v1/notifications/{id}/read`** — verb & path identik Go. Lewat `db()` +
  RPC `mark_notification_read`, satu-satunya jalur UPDATE. **Tidak ada route DELETE.**
- `notificationToWire` + `inboxToWire` di `apps/api/src/lib/wire.ts` →
  `{ data: NotificationItem[], unread_count: number }`, persis `NotificationsResponse`
  di `web-internal/src/lib/types.ts`. `id` tetap **string** (kolom `bigint`; postgres.js
  kembalikan int8 sebagai string, dan tipe FE memang string).
- `notification.ValidationError` dipetakan ke **400** di `http.ts`.

**Nol tambahan yang dilarang house rules:** nol migrasi, nol event katalog baru
(tetap **15 FROZEN**), nol string BI baru — `[id tidak valid]` di-port **verbatim** dari
Go `handleMarkRead`.

**Dua perilaku yang sengaja dipilih (jangan "diperbaiki" tanpa baca ini):**
1. **Mark-read idempoten & senyap.** Id tak dikenal, milik orang lain, atau sudah dibaca
   → 0 baris berubah, tetap `200 {"status":"ok"}`. Ini paritas Go; 404/403 di sini justru
   membocorkan apakah id notifikasi orang lain ada.
2. **Modul ini mengulang predikat kepemilikan di SQL** meski C-01 memutuskan visibilitas
   baris = urusan RLS. `notifications_select` adalah satu kesamaan tunggal
   (`recipient = jwt_employee_id()`) yang merupakan *definisi* kepemilikan, bukan
   kebijakan multi-arm seperti `leads_select` yang bisa divergen — dan jalur tulis
   berjalan sebagai service-role tanpa policy sama sekali, jadi predikatnya wajib
   eksplisit di sana. Backlog §C-02 butir 1 memang meminta ini.

---

## 2. Bukti verifikasi (semua dijalankan sesi ini)

| Gate | Hasil |
|---|---|
| `npm run typecheck --workspaces` | bersih (4 workspace) |
| `@cdps/core` | **112** |
| `@cdps/db` | **9** |
| `@cdps/api` | **101** (+3 wire notifikasi; sebelumnya 98) |
| `@cdps/domain` | **422** (+11 `notification.test.ts`; sebelumnya 411) — DB fresh |
| Invariant SQL | ident · immutability · **rls** · auth_claims → **PASS** |
| Jumlah tabel | **53** (sesuai gate CI `db-and-migrations`) |
| `apps/api` `next build` | hijau; `/api/v1/notifications` + `/api/v1/notifications/[id]/read` terdaftar |
| `web-internal` `next build` | hijau |

**Isi 11 test domain baru:** own-only, urutan newest-first, idempotensi mark-read
(termasuk timestamp tidak bergeser di panggilan kedua), no-op lintas-penerima, DELETE
ditolak trigger, `?unread=1` menyaring list tapi **tidak** count, plus **3 test lewat
`withClaims`** (RLS nyata): penerima lain **0** baris, dan **Director pun 0** baris —
notifikasi itu personal, bukan data oversight.

**Smoke e2e nyata** (API `next start` → PG16 lokal, token HS256 lokal):

| # | Uji | Hasil |
|---|---|---|
| 1 | `GET /notifications` tanpa auth | **401** |
| 2 | Penerima A | 2 barisnya saja, `unread_count: 2` |
| 3 | Penerima B | 1 barisnya saja, `unread_count: 1` |
| 4 | A mark-read | `{"status":"ok"}`, badge 2 → **1** |
| 5 | A mark-read ulang | `ok`, tak ada yang berubah |
| 6 | **B menandai notifikasi A** | `ok` (senyap) — unread A **tetap 1** |
| 7 | `/notifications/abc/read` | **400 `[id tidak valid]`** |
| 8 | mark-read tanpa auth | **401** |

---

## 3. KEPUTUSAN TERBUKA untuk pemilik

1. **Merge PR #59 ke `main`** (perbaikan keamanan C-01) — masih terbuka sejak sesi 1.
   Setelah itu PR sesi ini bisa di-merge / di-rebase ke `main`.
2. Tidak ada keputusan baru dari sesi ini. Keputusan terbuka lama untuk C-04 (O33/O34/
   O26/O35, status data riil vs UAT) belum disentuh dan akan ditagih saat C-04.

---

## 4. Tiket berikutnya — C-03 (UAT paritas end-to-end)

Uraian lengkap di `docs/backlog/CUTOVER_BACKLOG.md` §C-03. Ringkas:
- Jalankan walk **W1/W2/W3** terhadap Vercel **`agency-app-api`** (bukan lokal), pakai
  akun tiap role. Bahan runbook sudah ada — **pakai ulang, jangan bikin baru**:
  `W1-20_UAT_RUNBOOK.md`, `W2_UAT_RUNBOOK.md`, `W3_UAT_RUNBOOK.md`,
  `WAVE1_EXIT_UAT_RUNBOOK.md`, `WAVE3_FE_API_CONTRACT_SMOKE_20260727.md`;
  skrip `apps/api/scripts/auth-smoke.mjs`, `apps/api/scripts/wave3-contract-smoke.mjs`.
- Verifikasi eksplisit house rules: format ID, string BI `[...]` verbatim, transisi ilegal
  ditolak server-side, audit append-only, derived field recompute-from-log, IDR
  `Rp. X.XXX.XXX,00`, div-by-zero → `—`.
- **Bawa masuk dari sesi ini:** (a) deviasi **404 vs 403** = deviasi terdokumentasi,
  jangan tulis FAIL; (b) **QA badge notifikasi di FE ter-deploy** belum dilakukan —
  smoke sesi ini membuktikan kontrak API, bukan render badge-nya.
- **Cek drift skema:** bandingkan jumlah tabel remote `CDPS SG` vs gate CI (expect **53**).
  Sisa catatan C-00: pembacaan remote sebelumnya melaporkan lebih banyak. Jangan diamkan.
- Output: `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md` (PASS/FAIL/SKIP + alasan).
  **DoD:** FAIL = 0, tiap SKIP beralasan tertulis. Ini bahan gate go/no-go manusia.

---

## 5. Cara verifikasi (terbukti jalan di sesi ini)

```bash
npm ci                                        # node_modules TIDAK ada di clone baru
npm run typecheck --workspaces --if-present
npm test -w @cdps/core                        # 112
npm test -w @cdps/api                         # 101
(cd apps/api && npm run build)
(cd web-internal && npm run build)

# Postgres lokal (16 tersedia di sandbox)
PGBIN=/usr/lib/postgresql/16/bin
mkdir -p /tmp/pgdata /tmp/pgrun && chown -R postgres:postgres /tmp/pgdata /tmp/pgrun
su postgres -c "$PGBIN/initdb -D /tmp/pgdata -U postgres --auth=trust"
su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 5433 -k /tmp/pgrun -c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
createdb -h 127.0.0.1 -p 5433 -U postgres cdps
for f in $(ls supabase/migrations/*.sql|sort); do psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -q -f supabase/seed.sql
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"
npm test -w @cdps/db                          # 9
npm test -w @cdps/domain                      # 422 — WAJIB DB FRESH (drop+recreate)
for t in ident immutability rls auth_claims; do
  psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f supabase/tests/${t}_checks.sql; done
```

---

## 6. Aturan main (jangan dilanggar)

1. **Jangan sentuh `backend/`** (Go beku, hanya oracle paritas).
2. Perubahan → `apps/api`, `packages/*`, `web-internal`, `supabase/`.
3. Baca PRD modul di `docs/prd/` + `STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi.
4. **Nol string BI baru** tanpa entri DECISIONS; katalog notifikasi **FROZEN 15 event**.
5. **Semua route baca WAJIB `requireActor` + `readAsActor`** — jangan pernah pakai `db()`
   di handler GET (itulah O37).
6. **Notifikasi tak pernah bisa dihapus** — jangan pernah menambah route/fungsi DELETE.
   Satu-satunya mutasi = `mark_notification_read`.
7. Ambiguitas/deviasi PRD ⇒ **STOP**, tulis baris **Open** di `docs/DECISIONS.md`.
