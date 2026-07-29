# RUNBOOK — apply migrasi RLS `0009` → `0010` ke `CDPS SG`

> Dibuat 2026-07-29. Untuk dijalankan **manusia dari mesin yang punya akses** (pola sama dengan
> seed MSL sesi 4 yang dijalankan Yohan dari Mac-nya).
>
> **Kenapa bukan Claude yang menjalankan:** sandbox sesi ini tidak bisa mencapai `CDPS SG`.
> Diverifikasi ulang 2026-07-29 01:49Z, tiga penghalang independen:
> 1. Gateway proxy **menolak CONNECT** ke `supabase.com:443` dan `*.vercel.app:443` (403,
>    tercatat sendiri di `$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`);
>    `selective: false`, jadi ini kebijakan jaringan environment, bukan sesuatu yang bisa
>    dinyalakan dari dalam.
> 2. **Tidak ada kredensial** `DATABASE_URL`/Supabase di environment sesi.
> 3. **Tidak ada Supabase MCP** di sesi ini.

---

## 0. ⚠️ URUTAN YANG BENAR — baca dulu sebelum apply

**`20260102000010` belum ada di `main`** — file itu hidup di branch `claude/handoff-sesi-5-inmsq9`
(PR **#62**). Kalau di-apply ke live **sebelum** PR-nya merge, live jadi **lebih maju daripada
`main`** — persis pola drift yang dulu menciptakan blocker **O38** dan menghabiskan satu sesi penuh
untuk dibereskan.

**Urutan yang disarankan:**

| # | Langkah | Kenapa |
|---|---|---|
| 1 | **Merge PR #62 ke `main`** | supaya `0010` ada di `main` sebelum menyentuh live (aturan main #9) |
| 2 | `git checkout main && git pull` | apply **dari file repo apa adanya**, jangan SQL ad-hoc |
| 3 | Apply **`0009`** | urutan wajib: `0010` tidak bergantung ke `0009`, tapi keduanya menyentuh policy dan riwayatnya harus urut |
| 4 | Apply **`0010`** | |
| 5 | Verifikasi (§3) | |

**`0009` sendiri boleh di-apply lebih dulu kapan saja** — file itu **sudah ada di `main`** sejak
merge #59/#60/#61. Kalau mau menutup regresi Marketing (§1 handoff sesi 5) tanpa menunggu #62,
jalankan langkah 3 saja, lalu ulangi runbook ini untuk `0010` setelah #62 merge.

---

## 1. Ambil `DATABASE_URL` (jangan salah sumber)

- Ambil dari **env var Vercel** project **`agency-app-api`** → tombol **Reveal**.
- **JANGAN** dari Supabase dashboard: di sana password muncul sebagai `[YOUR-PASSWORD]`, dan tombol
  **reset password akan mematikan API produksi**.

Masukkan tanpa bocor ke shell history:

```bash
# copy nilainya dulu, lalu jalankan baris ini DARI HISTORY (panah atas) —
# jangan menyalin perintah ini dari chat/dokumen, karena itu justru menimpa clipboard
export DATABASE_URL="$(pbpaste)"
```

Verifikasi tanpa menampilkan isinya:

```bash
echo "${#DATABASE_URL}"          # harap ~111
echo "${DATABASE_URL:0:13}"      # 13 karakter pertama saja
```

> **Jangan paste blok multi-baris yang memuat prompt interaktif.** `read -s` akan menelan baris
> BERIKUTNYA sebagai nilainya — tiga percobaan pertama sesi 4 gagal karena ini.

---

## 2. Pre-check: apa yang SUDAH ter-apply

Jalankan satu per satu (bukan sebagai blok):

```bash
# 0009 ter-apply? 0 = belum, 1 = sudah
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname = 'jwt_owns_lead_campaign';"
```

```bash
# 0010 ter-apply? cari 'jwt_is_lead' di policy transactions_select.
# ADA 'jwt_is_lead()' + 'Finance'  => BELUM di-apply (masih lead-only)
# ADA 'Finance' TANPA 'jwt_is_lead' => SUDAH di-apply
psql "$DATABASE_URL" -tAc "SELECT pg_get_expr(polqual, polrelid) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = 'transactions' AND polcmd = 'r';"
```

Catat kedua hasilnya sebelum lanjut.

---

## 3. Apply — berurutan, dari file repo

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260102000009_rls_leads_campaign_scope.sql
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260102000010_rls_finance_staff_queue_scope.sql
```

> `0009` pernah **gagal** di percobaan lama dengan
> `ERROR: function jwt_owns_lead(character varying) does not exist`. Itu sudah diperbaiki (versi di
> repo memanggil `private.jwt_owns_lead` dan membuat helper di schema `private`). Kalau error itu
> muncul lagi, **berhenti** — berarti file yang dijalankan bukan versi repo terbaru.

---

## 4. Verifikasi sesudahnya

### 4.1 Struktural (cepat)

```bash
# harus 1
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private' AND p.proname = 'jwt_owns_lead_campaign';"
```

```bash
# jumlah policy harus TETAP 44 (0010 hanya mengganti 3 policy, tidak menambah)
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_policy;"
```

```bash
# jumlah tabel harus TETAP 53
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
```

### 4.2 Fungsional — probe RLS Finance staff

Ini yang membuktikan `0010` benar-benar berfungsi. Simpan sebagai `/tmp/probe_0010.sql` lalu
`psql "$DATABASE_URL" -f /tmp/probe_0010.sql`. **Read-only + `ROLLBACK`** — tidak menulis apa pun,
dan tidak mengarang data (memakai transaksi yang sudah ada; kalau belum ada transaksi sama sekali,
lewati §4.2 dan andalkan §4.1 + §4.3).

```sql
\echo '--- kontrol: total transaksi terlihat service-role'
SELECT count(*) AS total FROM transactions;

BEGIN;
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"PROBE-FIN","division":"Finance","level":"staff","od":false,"director":false}}', true);
SET LOCAL ROLE authenticated;
\echo '--- Finance STAFF: harus SAMA dengan total di atas (sebelum 0010: 0)'
SELECT count(*) AS finance_staff FROM transactions;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims',
  '{"app_metadata":{"employee_id":"PROBE-AM","division":"Account","level":"staff","od":false,"director":false}}', true);
SET LOCAL ROLE authenticated;
\echo '--- Account staff bukan-AM: harus TETAP 0 (pelebaran tidak boleh melebar ke divisi lain)'
SELECT count(*) AS account_staff_nonowner FROM transactions;
ROLLBACK;
```

### 4.3 Regresi Marketing (`0009`)

Buka satu lead yang berasal dari campaign milik seorang **Marketing staff**, login sebagai staff itu
→ lead **harus terbaca**. Sebelum `0009` lead itu hilang dari Database-nya.

---

## 5. Rollback

`0010` — kembalikan ketiga policy ke bentuk lead-only:

```sql
DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
USING (jwt_can_read_all() OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND jwt_division() = 'Finance')
       OR private.jwt_owns_client(client_id));

DROP POLICY IF EXISTS installments_select ON public.installments;
CREATE POLICY installments_select ON public.installments FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (verified_by, created_by)
       OR (jwt_is_lead() AND jwt_division() = 'Finance')
       OR private.jwt_owns_transaction(transaction_id));

DROP POLICY IF EXISTS payment_verifications_select ON public.payment_verifications;
CREATE POLICY payment_verifications_select ON public.payment_verifications FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_employee_id() IN (verified_by, created_by)
       OR (jwt_is_lead() AND jwt_division() = 'Finance'));
```

> Kalau rollback dipakai, **catat alasannya di `docs/DECISIONS.md`** — rollback yang tidak tercatat
> akan tampak seperti drift repo↔live di sesi berikutnya (pelajaran O38).

`0009` — rollback praktisnya tidak perlu: ia hanya **menambah** satu arm baca yang memang ada di
sistem Go. Kalau tetap perlu, `DROP POLICY` + recreate `leads_select` tanpa arm
`private.jwt_owns_lead_campaign(id)`, dan `DROP FUNCTION private.jwt_owns_lead_campaign(text)`.

---

## 6. Sesudah apply — kabari repo

1. Tandai di `docs/handoff/HANDOFF_CUTOVER_SESI5.md` §1 bahwa `0009` **dan** `0010` sudah ter-apply
   (§1 sekarang masih menyebut `0009` sebagai delta repo↔live yang tersisa).
2. Tambahkan satu baris ke `docs/DECISIONS.md`: tanggal apply + hasil probe §4.2 (angka sebelum →
   sesudah). Itu yang membuat sesi berikutnya tidak perlu menerka status live.
3. **Jangan pakai `supabase db push`** sampai utang teknis §7.1 handoff selesai: penomoran migrasi
   repo (`202601…`) ≠ riwayat remote (`202607…`), jadi CLI akan menganggap SEMUA migrasi belum
   ter-apply dan mencoba apply ulang.

---

## 7. Konteks kenapa `0010` perlu

Policy baseline memberi baca transaksi ke Finance hanya lewat
`jwt_is_lead() AND jwt_division() = 'Finance'` — **lead saja**. Go `trxVisibility()` memberi
Finance **staff/lead → semua** ("they own the queue"), `canVerifyPayment` (M5 §8.1) mengizinkan
Finance **staff** menetapkan Payment Status, dan `PERMISSIONS.md` M5 menulis "Pre-verification
records visible to **Finance only**" tanpa batasan level.

Akibat yang **sudah berlaku sekarang**: tulis lewat RPC `SECURITY DEFINER` tidak ter-RLS, jadi
seorang Finance staff bisa **mem-verifikasi pembayaran yang tidak bisa ia baca**. Dan begitu
`GET /finance/queue` di-port (sisa O41), antreannya akan **kosong tanpa error** untuk Finance staff.

Blast radius apply hari ini: **nol** — **O33**, belum ada satu pun aktor Finance di roster riil.
Itu justru menjadikan sekarang window yang aman.

Bukti + assertion penjaga: entri Decided 2026-07-28 di `docs/DECISIONS.md`, dan
`supabase/tests/rls_checks.sql` §14-17.
