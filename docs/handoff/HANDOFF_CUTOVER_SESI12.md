# HANDOFF — Cutover Sesi 12

> **Pendahulu:** `HANDOFF_CUTOVER_SESI11.md` (dan lewat itu SESI10 → SESI9). Yang masih berlaku
> **tidak diulang** — terutama SESI9 §0.2 (batas sandbox), §6 (aturan rumah yang menggigit),
> §7 (cara menjalankan test DB-backed, masih akurat).

## 0. Posisi persis

| | |
|---|---|
| **Branch kerja** | `claude/cdps-sg-cutover-continue-kvnxno` — **di-reset dari `main` pasca-merge** |
| **`main`** | `7bbd5e1` — **PR #72 SUDAH MERGED** (2026-07-29, disetujui pemilik) |
| **PR #72** | **merged & closed.** Jangan buka ulang, jangan buat PR baru untuk perubahan yang sama |
| **CI @ `9b1fd14`** | **5/5 hijau** (`api` · `core-engines` · `web-internal` · `db-and-migrations` · `backend`) |

### 0.1 Apa yang mendarat di `main` lewat #72

| Bagian | Isi |
|---|---|
| **A** | **C-03** — identitas aktor ketiga skrip smoke diresolusi dari environment (env override → discovery → fallback seed), `BYPASS` Vercel diterima. Walk **21 → 22** cek: slot `sales_lead` (scope divisi) akhirnya diuji |
| **B** | **Hapus lead ber-ACC Head** — backend (migrasi `20260102000012`, domain, 4 route, 2 notif event) |
| **C** | **UI hapus-lead + 43 test domain + docs** — endpoint bagian B kini punya pemanggil |

---

## 1. ⛔ SATU HAL YANG HARUS DIKERJAKAN LEBIH DULU — repo ≠ live

**Migrasi `20260102000012_lead_delete_request.sql` sudah di `main` tapi BELUM di-apply ke
`CDPS SG`.** Diverifikasi langsung ke live 2026-07-29 (bukan diasumsikan dari handoff):

| | Live `CDPS SG` | Repo `main` |
|---|---|---|
| Migrasi | **39** | **40** |
| Tabel `public` | **53** | **54** |
| `notif_events` | **15** | **17** |
| `lead_delete_requests` | **belum ada** | ada |

**Konsekuensi nyata, bukan teoretis:** fitur hapus-lead **mati di produksi**. UI-nya ada dan
akan memanggil route yang tabelnya tidak ada ⇒ error, bukan penolakan ber-pesan BI. Selesaikan
ini **sebelum** menyentuh apa pun yang lain.

### 1.1 Cara apply — ikuti persis, ini pernah salah

Pakai **`apply_migration`** (MCP Supabase), **BUKAN `psql -f`** dan **BUKAN `execute_sql`**.
Alasannya bukan gaya: hanya `apply_migration` yang mencatat baris di
`supabase_migrations.schema_migrations`. Menulis skema tanpa mencatatnya **persis penyakit yang
menciptakan O38** — 4 migrasi live-only yang tak pernah ada di repo, dan butuh satu sesi penuh
untuk di-back-port.

- `project_id`: `egddxfcnrtecheiykhlf`
- `name`: `20260102000012_lead_delete_request`
- `query`: isi berkas `supabase/migrations/20260102000012_lead_delete_request.sql` **verbatim**

### 1.2 Verifikasi sesudah apply (wajib, jangan dilewati)

```sql
select
  (select count(*) from supabase_migrations.schema_migrations)  as migrasi,   -- harus 40
  (select count(*) from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE')   as tabel,     -- harus 54
  (select count(*) from notif_events)                            as events,    -- harus 17
  (select count(*) from sm_edges
     where machine='lead_record' and to_state='[Deleted]')       as edge_hapus,-- harus 4
  (select count(*) from sm_terminal_states
     where machine='lead_record' and state='[Deleted]')          as terminal,  -- harus 1
  (select count(*) from pg_indexes
     where indexname='uq_ldr_one_pending')                       as uq_index;  -- harus 1
```

Lalu pastikan **angka lain tidak bergeser** (migrasi ini murni aditif):
`employees` **69** · `role_mappings` **39** · `master_services` **32** · `leads` **3** ·
`clients` **0** · `transactions` **0**. Kalau salah satu berubah, **berhenti** dan telusuri —
migrasi ini tidak menyentuh tabel-tabel itu.

> **Catatan pemilik:** apply ke live adalah tulis ke produksi. Sesi 11 **sengaja tidak
> menjalankannya** karena pemilik hanya menyetujui merge (butir 1), bukan apply (butir 2).
> Minta persetujuan eksplisit dulu.

### 1.3 Utang non-blocking yang bersinggungan

Penomoran versi migrasi repo (`202601…`) **belum selaras** dengan riwayat remote (`202607…`).
Tidak memblokir apply di atas, tapi **harus** diselesaikan sebelum ada yang menjalankan
`supabase db push`. Tercatat sejak C-03/O38.

---

## 2. Status task besar "Cutover + pensiun Go" — ~80%

Lingkup = **C-00 → C-05** (`docs/backlog/CUTOVER_BACKLOG.md`). C-06 client portal di luar jalur.

| Gate | Progress | Sisa |
|---|---|---|
| **C-00** CI mati | ✅ 100% | — |
| **C-01** O37 RLS baca | ✅ 100% | — |
| **C-02** endpoint notifikasi | ✅ 100% | — |
| **C-03** UAT paritas | 🟠 ~90% | eksekusi walk dari mesin ber-akses + 3 QA UI |
| **C-04** data + aktor produksi | 🟠 ~60% | keputusan aktor O34/O26/O35 · verifikasi Railway |
| **C-05** pensiunkan Go | 🔴 0% | menunggu gate GO — **belum boleh dimulai** |

Pembagian yang lebih berguna dari satu angka:
**sisi engineering ~95%** (sisanya cuma C-05 yang mekanis, ~0,5 hari) ·
**sisi pemilik ~50%** — dan itulah jalur kritisnya. Persentase ini bisa diam di 80% berapa lama
pun tanpa ada yang salah secara teknis, karena yang menahan bukan kode.

---

## 3. Daftar kerja berikutnya, berurutan

**Bisa Claude kerjakan:**
1. **Apply migrasi `20260102000012` ke live** (§1) — butuh persetujuan pemilik. **Prioritas #1.**
2. **Selaraskan penomoran versi migrasi** repo vs remote (§1.3).
3. *(Opsional, butuh keputusan)* field `pending_delete_request` di `LeadRow` untuk menutup celah
   UX SESI11 §1.3: baris tab Database tidak menandakan ada permintaan hapus yang pending.

**Hanya pemilik (butuh akses / keputusan):**
4. **Eksekusi C-03** — `BASE` deployment + `SUPABASE_JWT_SECRET` produksi (+ `BYPASS` bila
   ter-proteksi). **Langkahnya sudah lengkap di `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` — jalankan
   itu, jangan susun ulang.** Target: walk **22/22** · wave3 **34/34** · auth **13/13**.
5. **3 QA UI** di FE ter-deploy: badge notifikasi · `/master-services` · `/sales/kalkulator`.
   (4+5 menutup ketiga SKIP ⇒ report C-03 jadi FAIL 0 **tanpa** SKIP ⇒ gate C-04 terbuka.)
6. **Keputusan aktor O34 · O26 · O35** — aktor Wave 2 · NIK/email Director · sub-tim Creative
   M7 §3. Ini yang menahan DoD C-04 "nol fixture UAT". (**O9** target periode M14 non-blocking.)
7. **Verifikasi Railway sebelum dimatikan** — `SELECT count(*)` per tabel (minimal `leads`,
   `clients`, `transactions`). Lihat §4.
8. **Backup MySQL Railway** terakhir + **rencana rollback** disepakati (Railway hidup N hari
   pasca-cutover).
9. **Gate go/no-go** — Yohan & Nerissa.

**Sesudah GO — C-05, Claude (~0,5 hari):**
10. Hapus job `backend` dari `.github/workflows/ci.yml`.
11. Arsipkan `backend/` — **tag dulu, jangan hapus tanpa tag.** Go satu-satunya oracle paritas.
12. Tandai deprecated: `backend/railway.json` · `web-internal/railway.json` ·
    `backend/Dockerfile` · `docs/DEPLOY_RAILWAY.md`.
13. Perbarui `CLAUDE.md` §Stack (Go→TS/Next di Vercel, MySQL→Supabase Postgres) + entri
    `DECISIONS.md` "cutover selesai, Go diarsip".
14. **Matikan service Railway** — manual, pemilik. Claude tidak punya akses.

---

## 4. OQ-2 (data Railway) — batasnya belum bergerak

Pemilik menegaskan data riil = **69 karyawan** + **32 layanan MSL**, keduanya **sudah di
Supabase**, bukan di Railway. Itu **menggugurkan O22** (impor lead historis tidak punya subjek)
dan mengecilkan scope C-04 secara signifikan.

**Tapi ini inferensi dari apa yang TIDAK disebut, bukan konfirmasi "Railway kosong".** Sebelum
Railway dimatikan tetap perlu `SELECT count(*)` per tabel. Alasannya konkret: **"0 baris" pada DB
kosong tidak bisa dibedakan dari "0 baris karena query salah"** — kekeliruan yang sudah pernah
terjadi di entri O41. Status ini **tidak berubah** sejak SESI10.

---

## 5. Angka acuan (2026-07-29, Postgres 16 lokal, DB dimigrasi ulang dari nol)

`@cdps/domain` **513** · `apps/api` **211** · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · keempat invariant SQL (`ident`·`immutability`·`rls`·`auth_claims`)
**PASS** · gate seed CI **PASS** · **40** migrasi → **54** tabel → **17** event ·
typecheck bersih di semua workspace · eslint `web-internal` bersih.

> ⚠️ Angka **40/54/17** itu **repo**. Live masih **39/53/15** sampai §1 dikerjakan.

## 6. Dua jebakan yang sudah memakan waktu — jangan kena lagi

1. **`.github/workflows/ci.yml` punya dua gate angka hardcoded** yang tidak terlihat dari kode
   aplikasi: `notif_events` (**17**) dan jumlah tabel (**54**). Menambah event atau tabel tanpa
   menyetel keduanya ⇒ `db-and-migrations` merah dengan pesan `expected 17 events` yang tidak
   menyebut penyebabnya.
2. **`toThrow(bi.KONSTANTA_YANG_TIDAK_ADA)` LULUS** — `toThrow(undefined)` cuma memastikan *ada*
   throw. Yang menangkapnya **typecheck**, bukan test. Jalankan
   `npm run typecheck --workspaces --if-present` sebelum percaya suite yang hijau.
3. Bonus: aksi audit transisi **bukan** `'transition'` tapi `'transition:<from>-><to>'` — ia
   menamai edge yang dilewati.
