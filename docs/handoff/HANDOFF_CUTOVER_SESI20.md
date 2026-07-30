# HANDOFF — Cutover Sesi 20 (apply migrasi O46 ke live · audit merge/commit/PR)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI19.md` (O47 + retensi PII). Yang masih berlaku tidak
> diulang — terutama SESI9 §6 (aturan rumah yang menggigit), SESI12 §2.4 (`npm run db:rebuild`,
> satu-satunya jalur benar untuk DB lokal), dan SESI19 §3.1 (daftar "jangan dikerjakan").

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **`main`** | **hasil merge PR #81** (memuat `548ad91`). Verifikasi: `git log --oneline -1 origin/main`. Rantai: #75 → #77 → #76 → #79 → #78 → #80 → **#81** |
| **Branch aktif** | **TIDAK ADA.** `claude/go-retirement-progress-eq0855` sudah ter-merge lewat #81 ⇒ mulai sesi berikutnya dari `main`, branch baru |
| **PR terbuka** | **NOL.** #73 & #74 ditutup tanpa merge (sesi 19); #78/#79/#80/#81 merged |
| **Repo vs live** | 🔴 **BEDA — inilah pekerjaan utama sesi berikutnya.** Repo **41 migrasi**, live `CDPS SG` masih **40**. Migrasi `20260730091540` (O46) **belum di-apply** |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** — belum disentuh sesi 19 maupun 20 |

**Angka acuan di `main` pasca-#81** (Postgres 16 lokal, DB dibangun ulang dari nol, **41/41** migrasi):
`apps/api` **301** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** (54 tabel · 14 `sm_machines` · 17 `notif_events`) ·
**4 invariant SQL PASS, `rls_checks` kini 23 check** (naik dari 17) ·
`route-parity` **5/5 `KNOWN_GAPS` KOSONG** · `NESTED_INLINE_UNCHECKED` **KOSONG** ·
typecheck bersih · lint `@cdps/api --max-warnings 0` **0/0** · Go: `vet`+`build`+`test ./cmd/...` hijau.
CI #81: **11/11 hijau** termasuk `db-and-migrations` ⇒ rangkaian 41 migrasi lolos di CI, bukan hanya lokal.

```bash
git fetch origin main && git checkout main && git log --oneline -1
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""
npm ci && npm run db:rebuild -- --yes          # harus bilang "dari 41 migrasi"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

---

## 1. ~~🔴 PEKERJAAN UTAMA: apply migrasi O46 ke live~~ → ✅ **SUDAH DIEKSEKUSI**

> ### ✅ SELESAI 2026-07-30 — jangan jalankan lagi
> Pemilik memberi persetujuan per-apply di sesi yang sama, dan migrasi **sudah di-apply ke live
> `CDPS SG`**. Live kini **41 migrasi · 54 tabel · 17 event**. Runbook di bawah tetap disimpan
> sebagai catatan cara mengerjakannya, **bukan** sebagai instruksi terbuka.
>
> **Posisi terkini ada di `HANDOFF_CUTOVER_SESI21.md`** — baca itu, bukan §0 di atas.
>
> 🔴 **Satu hal yang berubah dan mengubah runbook ini:** `apply_migration` **menetapkan versinya
> sendiri dari waktu apply**, bukan dari nama berkas repo. Ia mencatat `20260730091540`, sedangkan
> berkas repo bernama `…073000`. Repo ini menjaga invariant **nama berkas = versi live 1:1** (semua
> 40 migrasi sebelumnya cocok persis), jadi berkasnya **diganti nama** ke
> `20260730091540_rls_o46_lead_division_arms.sql` dan **7 rujukan** ikut diperbarui. Sesi berikutnya
> yang meng-apply migrasi: **baca versi yang benar-benar tercatat, lalu ganti nama berkas repo
> supaya cocok** — kalau tidak, `supabase db push` dari clone bersih akan mencoba meng-apply versi
> yang tidak ada di ledger live, dan itu drift kelas O38.

Teks asli tiket (arsip): `supabase/migrations/…_rls_o46_lead_division_arms.sql` sudah di `main`,
sudah lolos CI, **belum di live** — selama belum di-apply, lead divisi di produksi tetap tidak
melihat data divisinya.

### 1.1 Yang di-apply

Dua arm `Lead/SPV = division-wide` (PRD Role Matrix §6) + dua helper di schema `private`:

| Objek | Perubahan |
|---|---|
| `private.jwt_same_division(text)` | **BARU** — apakah karyawan X sedivisi dengan aktor JWT. Fail-closed |
| `private.jwt_division_owns_client(text)` | **BARU** — versi divisi dari `jwt_owns_client`; 4 kolom PIC-nya sengaja identik |
| `transactions_select` | **DROP + CREATE**, tambah arm `jwt_is_lead() AND private.jwt_division_owns_client(client_id)` |
| `audit_log_select` | **DROP + CREATE**, tambah arm `jwt_is_lead() AND private.jwt_same_division(actor_employee_id)` |

**Nol tabel baru · nol event baru · nol kolom baru · nol policy TULIS disentuh.** Karena itu gate
`54 tabel` / `17 event` tetap valid tanpa perubahan. Sifatnya **memperluas baca**, tidak pernah
menyempitkan ⇒ nol risiko kebocoran arah sebaliknya.

### 1.2 Cara apply — dan cara yang SALAH

```
mcp__Supabase__apply_migration
  project: CDPS SG
  name:    rls_o46_lead_division_arms
  query:   <isi 20260730091540_rls_o46_lead_division_arms.sql apa adanya>
```

> ⛔ **JANGAN `psql -f`.** Hanya `apply_migration` yang mencatat baris di
> `supabase_migrations.schema_migrations`; menulis skema tanpa mencatatnya persis penyakit yang
> melahirkan **O38**. Ini aturan `CLAUDE.md`, bukan preferensi.
>
> ⚠️ **`42P07 relation already exists` BUKAN benign** — di #77 ia menandakan penulis kedua (sesi
> paralel meng-apply di detik yang sama). Kalau muncul: **STOP dan lapor**, jangan ulangi.
>
> 🔴 **Butuh persetujuan pemilik per-apply.** Pemilik menyetujui **arah O46** (DECISIONS
> 2026-07-30), itu bukan persetujuan menulis ke produksi. Minta konfirmasi eksplisit lebih dulu.

### 1.3 Verifikasi sesudah apply — jangan diasumsikan

```sql
-- 1. jumlah migrasi harus 40 -> 41
select count(*) from supabase_migrations.schema_migrations;

-- 2. kedua helper ada di schema private (BUKAN public — kalau di public, itu permukaan RPC bocor)
select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.proname in ('jwt_same_division','jwt_division_owns_client');
-- harus: private | jwt_division_owns_client  /  private | jwt_same_division

-- 3. kedua policy memuat arm barunya
select c.relname, pg_get_expr(polqual, polrelid) from pg_policy p
join pg_class c on c.oid=p.polrelid
where c.relname in ('transactions','audit_log') and p.polcmd='r';
-- keduanya harus memuat jwt_is_lead()

-- 4. gate yang TIDAK boleh bergerak
select count(*) from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';   -- tetap 54
select count(*) from notif_events;                          -- tetap 17
```

Lalu **uji perilakunya dengan aktor nyata**, bukan hanya membaca policy: minta satu lead divisi
(mis. Head of Account `2305100275`) membuka halaman transaksi/riwayat dan pastikan ia melihat data
divisinya. Policy yang benar tapi klaim JWT yang salah menghasilkan hasil yang sama dengan policy
yang salah — dan yang membedakan hanya probe dengan akun riil.

### 1.4 Kalau harus rollback

Migrasi ini **DROP + CREATE** policy, jadi rollback = kembalikan definisi lama (dari
`20260729032805` untuk `transactions_select`, `20260723064438` untuk `audit_log_select`) lalu
`DROP FUNCTION private.jwt_same_division(text), private.jwt_division_owns_client(text)`. Karena
sifatnya hanya memperluas baca, **rollback tidak pernah wajib untuk alasan keamanan** — paling
buruk ia mengembalikan keadaan "lead tidak melihat divisinya".

---

## 2. 🔴 Hasil audit "tidak ada merge/commit/PR yang terlewat" — SATU DITEMUKAN

Audit yang diminta pemilik menemukan **satu commit yang benar-benar hilang**, dan gate mana pun
tidak akan pernah menangkapnya karena ia tidak pernah masuk `main`.

| | |
|---|---|
| Branch | **`claude/cdps-sg-cutover-sesi14-09k1my`** |
| Commit | **`46e2a6d`** — *"fix(T1): paritas field-by-field 66 converter wire.ts — remindersToWire.due_date"*, 2026-07-30 01:51 |
| PR | **tidak ada** — branch ini tidak pernah dibuatkan PR |
| Isi yang hilang | `remindersToWire.due_date`: `toISOString()` → `tz.dateString()` |
| Bukti hilang | `git log --all -S"tz.dateString(r.dueDate)"` mengembalikan **hanya** commit itu |

**Jangan cherry-pick commit itu apa adanya.** Ia bercabang sebelum #80 dan memuat `wire.ts` versi
lama — memetiknya akan **mencabut ekstraksi `LeadAttemptWire` dkk** yang #80 pasang. Yang benar:
terapkan ulang perubahan satu barisnya di atas `main` sekarang.

Sweep atas kelasnya menemukan **4 field**, bukan 1 → tercatat sebagai **O49** (§3). Empat berkas lain
di commit itu (`wire.test.ts`, `DECISIONS.md`, `HANDOFF_CUTOVER_SESI15.md`) sudah ada di `main` lewat
jalur lain; hanya perubahan `wire.ts`-nya yang hilang.

**Sisa audit bersih:**
- `claude/go-retirement-progress-08ly3d` (#80) & `…-6r14e0` (#78): **0 commit di luar `main`** ✓
- `claude/wire-parity-delivery-a-nbhiqg` (#79): **0 commit di luar `main`** ✓
- `claude/migrate-backend-data-supabase-yno0v8` (#74) & `…-continue-kvnxno` (#73): ditutup sengaja ✓
- Branch lain dengan commit "di luar `main`" berasal dari PR yang di-**squash**-merge — histori
  branch-nya menyimpang, isinya ada di `main`. **Diverifikasi satu per satu, bukan diasumsikan:**
  - `claude/port-m13-health` → `packages/domain/src/health.ts` (885 baris) ada di `main`, dan
    commit `cc0e376 "port M13 Client Health Report"` ada di histori `main` ✓
  - `claude/port-m14-team-performance-pks0kq` → `packages/domain/src/performance.ts` (1636 baris)
    ada, commit `b1044b2 "port M14 Team Performance"` ada di histori `main` ✓
  - `claude/sales-staff-access-leads-bdmk5e` → subjeknya **tidak** ada di histori `main`, jadi
    diperiksa lebih dalam. Verdict: **DIGANTIKAN, bukan hilang.** `main` menangani hal yang sama
    dengan desain berbeda dan lebih baik — `Sidebar.tsx` merender `visibleNav(role)` dari
    `@/lib/nav` (model navigasi ter-filter role, ter-test per role) alih-alih 168 baris logika
    inline; sisi *"Sales staff see own leads"* ditutup RLS `20260729031525_rls_leads_campaign_scope`;
    dan bagian `backend/**`-nya moot (read-only, dicabut di C-05) ✓
  - Branch `handoff-*` → docs saja, isinya sudah di `main` lewat PR masing-masing ✓
- Working tree bersih, nol PR terbuka.

> **Pelajaran prosedural:** `git log --oneline origin/main..origin/<branch>` menemukan branch yang
> tertinggal, tapi ia **tidak** membedakan "isinya sudah masuk lewat squash" dari "isinya hilang".
> Yang membedakan adalah `git log --all -S"<potongan kode>"`. Sesi berikutnya yang mengaudit hal
> serupa: pakai `-S`, jangan berhenti di hitungan commit.

---

## 3. Sisa pekerjaan — urutan yang direkomendasikan

| # | Butir | Siapa | Catatan |
|---|---|---|---|
| 1 | **Apply migrasi O46 ke live** (§1) | Claude, izin pemilik per-apply | menutup drift repo↔live 41 vs 40 |
| 2 | **C-03 — 3 SKIP** 🔴 *jalur kritis* | **pemilik** | `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari mesin ber-akses `*.vercel.app`. Jalankan **sesudah** butir 1 supaya walk-nya memvalidasi keadaan yang akan rilis |
| 3 | **O49** — 4 field `date` dikirim RFC3339 | Claude, tapi (b) butuh keputusan | tiga field `installments` jelas → `tz.dateString()`; **`managed_since` ambigu**, Go tidak konsisten dengan dirinya sendiri — jangan ditebak |
| 4 | **A4** — 12 mapping ambigu + lead Ads/Marketing/KOL + O35 + O9 | **pemilik** | worksheet siap: `docs/handoff/O34_O26_O35_WORKSHEET_ROSTER_V2.md` |
| 5 | **O48** — 36 dari 45 policy SELECT tanpa arm lead/divisi | keputusan pemilik, eksekusi Claude | `assets_select` & `employees_select` yang paling menggigit. Butuh mapping butir 4 lebih dulu |
| 6 | **Backup MySQL Railway + OQ-2** · **rencana rollback** | **pemilik** | prasyarat gate GO |
| 7 | **Gate GO** → **C-05** | **pemilik** → Claude | Go mati |

**O47b** (PII di histori git, cakupan 89 branch) tidak memblokir apa pun — rekomendasi tercatat:
terima risikonya dengan pemicu eksplisit, karena menghapus branch **tidak** melepas commit yang
masih dirujuk PR lama, jadi tanpa tiket GitHub Support scrub separuh hanya memindahkan PII.

### 3.1 Yang JANGAN dikerjakan

- **Jangan `psql -f`** untuk apply apa pun (§1.2).
- **Jangan menulis ke live** tanpa persetujuan eksplisit pemilik **per-apply** — persetujuan arah
  ≠ persetujuan tulis.
- **Jangan mulai C-05** sebelum **gate GO**. (O47 & retensi PII sudah tidak mengunci; gate GO ya.)
- **Jangan hapus `backend/` tanpa tag** — sejak O47 diputus "tinggalkan", tag rilis terakhir adalah
  satu-satunya tempat spesifikasi tiga alur klien `cmd/import` masih bisa dibaca.
- **Jangan cabut `POST /leads/bulk`** karena T3 gugur — ia jalur **operasional**, bukan historis.
- **Jangan cherry-pick `46e2a6d`** apa adanya (§2) — ia akan mencabut kerja #80.
- **Jangan menambah baris** ke `KNOWN_GAPS`, `NESTED_INLINE_UNCHECKED`, `ALLOWED_EXTRA`,
  `APPROVED_DIVERGENCE` — keempatnya hanya boleh menyusut, dan yang dua pertama harus tetap **kosong**.
- **Jangan melonggarkan `audit_log_select` untuk staff** tanpa entri `DECISIONS.md` — `rls_checks`
  check 23 sengaja merah kalau itu terjadi. "Staff = own entries only" adalah **perilaku PRD**,
  bukan cacat (O46, dan konsekuensinya: panel riwayat Asset Creative parsial bagi staff).
- **`backend/**` read-only** untuk fitur/bug produk.
