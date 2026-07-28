# HANDOFF — Cutover Sesi 1 (C-00 + C-01/O37 selesai)

> ⚠️ **SUPERSEDED oleh `HANDOFF_CUTOVER_SESI2.md`** (2026-07-28). Sesi 2 menutup
> kedua butir §3 di bawah — deviasi 404 **dikonfirmasi dipertahankan** — dan
> menyelesaikan C-02. Mulai dari dokumen sesi 2, bukan yang ini.

> **Dokumen standalone.** Lanjutkan chat berikutnya dari file ini.
> Tanggal: 2026-07-28. Sesi: eksekusi build plan cutover.

---

## 0. LOKASI TERAKHIR — mulai dari sini

| Item | Nilai |
|---|---|
| **Branch kerja** | `claude/cdps-supabase-migration-enh0gp` |
| **HEAD** | `a2cc852` |
| **Base** | `main` @ `b8347ff` |
| **PR** | **#59** (draft, → `main`) — CI **hijau 5/5**, Vercel **Ready** 2/2 |
| **Rencana induk** | `docs/backlog/CUTOVER_BACKLOG.md` ⟵ **baca ini dulu** |
| **Log keputusan** | `docs/DECISIONS.md` (entri Decided 2026-07-28 = O37) |
| **Tiket berikutnya** | **C-02** — endpoint `notifications` di `apps/api` |

Commit di branch (terbaru dulu):
```
a2cc852 fix(api)!: C-01/O37 — jalur baca lewat RLS (opsi c) + tutup GET tanpa auth
946164b docs(backlog): C-00 tindak lanjut selesai — re-run main hijau
02a4fbc docs(backlog): C-00 SELESAI — CI hijau kembali setelah upgrade billing
5546078 docs(backlog): tambah C-00 — CI mati (runner tidak teralokasi) sbg prasyarat
35fc522 docs(backlog): build plan penyelesaian migrasi + cutover Go -> Supabase/Vercel
```

**PR #59 belum di-merge.** Putuskan dulu: merge ke `main` sebelum lanjut C-02
(disarankan — C-01 adalah perbaikan keamanan), atau tumpuk C-02 di branch yang sama.

---

## 1. Status besar CDPS

Port Go → TypeScript/Supabase **sudah selesai & ter-merge** di `main`:
`apps/api` (159 route), `packages/core` (7 engine) + `packages/domain` (20 modul),
Supabase **`CDPS SG`** (`egddxfcnrtecheiykhlf`, ap-southeast-1, PG17) live, dan
**dua project Vercel** jalan (`agency-app-api`, `web-internal-mea`).
Go **DI-FREEZE** (DECISIONS 2026-07-22) — **jangan sentuh `backend/`**.

Sisa pekerjaan = **finishing + cutover**, bukan rewrite:

~~C-00~~ ✅ → ~~C-01~~ ✅ → **C-02** → C-03 → C-04 → (gate go/no-go manusia) → C-05
(C-06 = portal klien, ditunda by design.)

---

## 2. Yang selesai sesi ini

### C-00 — CI mati (runner tidak teralokasi) ✅
Seluruh run CI repo gagal 2–4 detik tanpa runner (`runner_id: 0`, log 404) sejak
2026-07-27, **termasuk di `main`** — jadi PR #55/#56/#57 dulu masuk **tanpa CI**.
Bukan kegagalan kode: kuota/billing GitHub Actions. **Pemilik meng-upgrade akun**,
runner kembali normal. Re-run `main` (`30278802079` att.2) → **success**, sehingga
PR #55–#57 kini tervalidasi.

### C-01 — O37 otorisasi jalur baca ✅ (opsi c)
**Masalah:** semua route baca `apps/api` memakai koneksi service-role (BYPASSRLS),
jadi policy RLS tidak pernah berjalan. **Temuan tambahan yang lebih berat:** 13
handler GET pembawa data (`/clients`, `/reminders`,
`/transactions/{id}/commission`, `/transactions/{id}/payment`, `/attempts`,
`/leads`, `/leads/{id}`, `/master-services`, dll.) **tidak memanggil
`requireActor` sama sekali** dan tak ada middleware global ⇒ terbaca **tanpa
autentikasi**.

**Yang dibangun:**
- `packages/db/src/client.ts` → **`withClaims(sql, claimsJson, fn)`**: transaksi
  yang mem-publish `request.jwt.claims` lalu `SET LOCAL ROLE authenticated`
  (transaction-local ⇒ aman di pooler transaction-mode).
- `apps/api/src/lib/db.ts` → **`readAsActor(actor, fn)`** + **`actorClaims(actor)`**.
  **61 handler GET + `getMe` di `POST /auth/login`** dikonversi dari `db()`.
  **Tulis tidak berubah** (tetap `db()` + RPC `SECURITY DEFINER`).
- Gate **tingkat endpoint** di `packages/domain/src/leads.ts`: `canReadPool`,
  `leadListScope` (port 1:1 dari Go `module1_leads/reads.go`) + `ForbiddenError`
  (pakai `bi.TRANSITION_ROLE_DENIED` verbatim) → 403 di `http.ts`.
- **Migrasi `20260102000005_rls_leads_campaign_scope.sql`**: arm
  `jwt_owns_lead_campaign(id)` pada policy `leads_select` — memulihkan paritas
  dengan Go `canReadLead` (Marketing staff berhak atas lead dari campaign miliknya).
  Tanpa ini, mengaktifkan RLS justru **lebih ketat** dari sistem Go yang lolos UAT.

**Sengaja TIDAK dilakukan:** gate row-level Go `canReadLead` tidak di-port ke TS —
visibilitas baris = urusan policy RLS; dua implementasi hanya bisa divergen.

**Bukti:** `supabase/tests/rls_checks.sql` §10–13 (gate CI permanen; **gagal**
bila policy dikembalikan ke baseline), `packages/domain/src/reads_rls.test.ts`
(5 test lewat `withClaims`), `apps/api/src/lib/db.test.ts` (5 test `actorClaims`),
gate unit di `leads_reads.test.ts`. Demo empiris PG16: pembaca lintas-scope via
service-role **1** baris vs `authenticated` **0** baris.
CI run `30345268534`: **5/5 hijau** (db-and-migrations, backend Go, api,
core-engines, web-internal); tabel tetap **53**.

---

## 3. KEPUTUSAN TERBUKA untuk pemilik

1. **Deviasi 404 vs 403.** Penolakan baca **satu** lead kini muncul **404**
   (baris ter-filter RLS), bukan **403** seperti Go. Lebih aman (tak membocorkan
   eksistensi) tapi beda perilaku. Endpoint **list** tetap 403. Sudah tercatat di
   DECISIONS — konfirmasi diterima, atau minta dikembalikan ke 403.
2. **Merge PR #59 sebelum C-02?** Disarankan ya (perbaikan keamanan).

---

## 4. Tiket berikutnya — C-02 (endpoint `notifications`)

Uraian lengkap ada di `docs/backlog/CUTOVER_BACKLOG.md` §C-02. Ringkas:
- Engine sudah ada (`packages/core/src/notification.ts`, `CATALOG` **15 event
  FROZEN**, `emit()` → RPC `notify_emit`); tabel `notifications` + `notif_events`
  ada. **Route-nya belum ada sama sekali** ⇒ badge & halaman notifikasi FE rusak.
- FE memanggil: `GET /notifications?unread=1` (badge, polling 30 dtk,
  `web-internal/src/lib/use-unread-count.ts`) dan halaman
  `web-internal/src/app/(shell)/notifications/page.tsx`.
- Kontrak: `NotificationsResponse { data: NotificationItem[]; unread_count: number }`.
- Referensi perilaku: `backend/internal/httpapi/notification_handlers.go`
  (`handleListNotifications`, `handleMarkRead`) — **baca saja, jangan ubah**.
- Wajib: hanya milik `recipient_employee_id` aktor; hanya `read_at` yang boleh
  berubah; **tak ada path DELETE**; nol event katalog baru.
- **Pakai `readAsActor`** untuk GET-nya (pola C-01), dan tambah `notificationToWire`
  di `apps/api/src/lib/wire.ts`.

---

## 5. Cara verifikasi (terbukti jalan di sesi ini)

```bash
npm ci                                        # node_modules TIDAK ada di clone baru
npm run typecheck --workspaces --if-present
npm test -w @cdps/core                        # 112
npm test -w @cdps/api                         # 98
(cd apps/api && npm run build)

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
npm test -w @cdps/domain                      # 411 — WAJIB DB FRESH (drop+recreate)
for t in ident immutability rls auth_claims; do
  psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f supabase/tests/${t}_checks.sql; done
```

---

## 6. Aturan main (jangan dilanggar)

1. **Jangan sentuh `backend/`** (Go beku, hanya oracle paritas).
2. Perubahan → `apps/api`, `packages/*`, `web-internal`, `supabase/`.
3. Baca PRD modul di `docs/prd/` + `STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi.
4. **Nol string BI baru** tanpa entri DECISIONS; katalog notifikasi **FROZEN 15 event**.
5. **Semua route baca WAJIB `requireActor` + `readAsActor`** — jangan pernah
   pakai `db()` di handler GET (itulah O37).
6. Ambiguitas/deviasi PRD ⇒ **STOP**, tulis baris **Open** di `docs/DECISIONS.md`.

---

## 7. Catatan sisa untuk C-03

Gate CI `db-and-migrations` mengharapkan **53 tabel** dan lolos, sedangkan
pembacaan remote `CDPS SG` sebelumnya melaporkan lebih banyak. Cocokkan saat C-03
untuk memastikan tak ada objek manual/drift di project remote.
