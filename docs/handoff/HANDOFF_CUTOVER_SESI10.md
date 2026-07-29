# HANDOFF — Cutover Sesi 10

> **Pendahulu:** `HANDOFF_CUTOVER_SESI9.md`. Yang masih berlaku dari sana **tidak diulang**
> di sini — terutama §0.2 (batas sandbox), §6 (aturan rumah yang menggigit), §7 (cara
> menjalankan test DB-backed). Baca dua dokumen berdampingan.

## 0. Posisi persis

| | |
|---|---|
| **Branch** | `claude/cdps-sg-cutover-continue-4jbfpy` |
| **HEAD** | `adbb8cb` — **sudah dipush**, working tree bersih, nol pekerjaan tertinggal di disk |
| **PR** | **#72** (draft, open) → base `main` @ `212a89a` · 3 commit · 19 berkas |
| **CI @ `adbb8cb`** | `core-engines` · `api` · `web-internal` · `db-and-migrations` **hijau di kedua run** (push + pull_request). `backend` (test Go, build arsip) masih jalan saat dokumen ditulis — durasi normalnya ~4m30s |

### 0.1 Tiga commit di branch ini

| Commit | Isi |
|---|---|
| `8c1d899` | **C-03** — resolusi identitas aktor skrip smoke dari environment (lihat §1) |
| `686439c` | **Hapus lead ber-ACC Head** — backend lengkap (lihat §2) |
| `adbb8cb` | **CI** — gate seed 15→17 event, 53→54 tabel (lihat §2.4) |

### 0.2 ⚠️ PR #72 judul & body-nya SUDAH TIDAK LENGKAP

PR dibuat sebelum fitur hapus-lead ada. Judul dan body-nya **hanya bercerita soal C-03**,
padahal branch sekarang membawa **fitur produk baru + migrasi + deviasi PRD**. Siapa pun yang
me-review dari body saja akan **melewatkan seluruh §2**. Perbaiki body PR sebelum minta review.

---

## 1. C-03 — tidak berubah dari Sesi 9, tetap menunggu pemilik

Skrip **sudah siap** dijalankan terhadap deployment (`8c1d899`); yang tersisa murni eksekusi
dari mesin ber-akses. **Langkah persisnya sudah ditulis lengkap** di
**`docs/handoff/CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`** — jangan menyusun ulang, jalankan itu.

Target: `cutover-houserules-walk` **22/22** · `wave3-contract-smoke` **34/34** ·
`auth-smoke` **13/13**, lalu 3 QA UI (badge notifikasi · `/master-services` ·
`/sales/kalkulator`).

### 1.1 Satu keputusan pemilik yang SUDAH turun sesi ini

> **Lead throwaway `ZZC03` BOLEH mendarat di `CDPS SG` live.** (Pemilik, 2026-07-29:
> *"Boleh. Lead terus ditambah, tapi tambahkan tombol delete yang harus di acc oleh head"*.)

Ini **menutup butir keputusan terbuka** runbook §3.3 — walk boleh dijalankan langsung
terhadap live, tidak perlu staging mirror. Konsekuensinya: jejak `ZZC03` permanen di
`audit_log` (append-only, tidak ada jalur hapus), **dan** pemilik meminta tombol hapus
sebagai gantinya — itulah §2.

---

## 2. Hapus lead ber-ACC Head — **backend HIJAU, UI BELUM ADA** 🟠

**Ini pekerjaan paling mendesak untuk sesi berikutnya.** Endpoint-nya hidup, tapi
**nol** yang memanggilnya ⇒ dari sudut pengguna, fitur ini **belum ada**.

Deviasi PRD lengkap terdokumentasi di **`docs/DECISIONS.md` entri 2026-07-29** ("DEVIASI PRD
DISETUJUI PEMILIK — lead kini bisa DIHAPUS"). **Baca entri itu sebelum menyentuh kodenya** —
di situ alasan setiap pilihan desain ditulis, termasuk yang sengaja ditolak.

### 2.1 Bentuknya (jangan diubah tanpa keputusan baru)

- **Tidak ada `DELETE FROM leads`.** Aturan rumah #3 + FK `prospect_attempts → leads`.
  "Hapus" = lead didorong ke state **terminal** `[Deleted]` pada machine `lead_record`.
- **Gate Head dua lapis:** keempat edge masuk `[Deleted]` ber-`require_lead = true`, jadi
  `sm_transition` **sendiri** menolak staff — service-role pun tak bisa memutari ACC.
- Gate-nya atas **divisi ASAL lead**: Sales Head tak bisa ACC lead ber-origin Marketing.
- **`[Closed-Success]` / ber-`winning_attempt_id` tidak bisa dihapus siapa pun**, termasuk
  Director — sudah klien, ada turunan uang.
- **`[Deleted]` tanpa jalur pulang.** Kalau pemilik mau bisa membatalkan hapus, itu desain
  **restore** yang berbeda dan butuh keputusan tersendiri.

### 2.2 Yang SUDAH ada (jangan dikerjakan ulang)

| Lapis | Berkas |
|---|---|
| Migrasi | `supabase/migrations/20260102000012_lead_delete_request.sql` — tabel `lead_delete_requests` (prefix `LDR-`), 4 edge + terminal state, 2 notif event, policy RLS, `uq_ldr_one_pending` |
| Domain | `packages/domain/src/leads.ts` — `decideDeleteRequest` · `canRequestDelete` · `requestDelete` · `approveDelete` · `rejectDelete` · `deleteRequestQueue` + konsekuensi `[Deleted]` di `decide`/`decideClaim`/`matchByPhone`/`leadsDatabase` |
| Katalog | `packages/core/src/notification.ts` 15 → **17** event |
| Route | `POST`+`GET /leads/{id}/delete-requests` · `GET /leads/delete-requests` · `POST /leads/delete-requests/{reqId}/{approve,reject}` |
| Wire | `apps/api/src/lib/wire.ts` — `deleteRequestToWire` · `deleteRequestQueueRowToWire` |

### 2.3 ❌ Yang BELUM — daftar kerja sesi berikutnya

1. **FE `web-internal` — ini yang membuat fitur bisa dipakai.**
   `src/lib/leads.ts` baru berisi **tipe kontrak saja** (`DeleteRequest`,
   `DeleteRequestQueueRow`, `DELETED_RECORD_STATUS`). **Fungsi client belum ditulis:**
   `requestLeadDelete` · `listLeadDeleteRequests` · `listDeleteRequests` ·
   `approveLeadDelete` · `rejectLeadDelete`.
   Lalu halamannya:
   - `src/app/(shell)/leads/[id]/page.tsx` — panel "Ajukan Hapus" (input alasan, wajib) +
     panel ACC untuk Head (Setujui / Tolak + catatan) + tampilkan request yang sudah diputus.
   - `src/app/(shell)/leads/page.tsx` — tombol Ajukan Hapus per baris tab **Database**;
     tab baru **"Permintaan Hapus"** = antrian ACC Head; tambahkan `[Deleted]` ke
     `RECORD_STATUSES` supaya Head bisa menengok yang sudah dihapus.
   - `src/lib/status.ts` — `'[Deleted]': 'darkgray'` di `EXACT_MAP` (sekarang jatuh ke `gray`).
   > **Catatan:** `apps/api/src/lib/route-parity.test.ts` memindai **seluruh** `web-internal/src`
   > untuk panggilan `api.*` dan mencocokkannya dengan route yang dilayani — jadi begitu fungsi
   > client ditulis, paritasnya otomatis terjaga. Manfaatkan, jangan dilawan.

2. **Test domain alur hapus** — belum ada satu pun.
   Unit: `decideDeleteRequest` (klien / sudah terhapus / sudah pending / lolos) ·
   `canRequestDelete` (pembuat · pemegang attempt · Head divisi lain · OD read-only).
   Integrasi (`DATABASE_URL`): request → approve menggerakkan lead ke `[Deleted]` + audit +
   notifikasi; **staff di-TOLAK `sm_transition`** (bukti gate SQL, bukan cuma TS); reject
   membiarkan lead utuh; request kedua diblokir; `[Closed-Success]` diblokir; dedup
   `matchByPhone` melewati baris terhapus. Namespace `ZZ-` + bersihkan di `afterEach`
   (ikuti pola `leads.test.ts`).

3. **Docs** — `STATE_MACHINES.md` §2 (tambahkan transisi `[Deleted]`) ·
   `DATA_MODEL.md` §1 (baris registry `LDR-`).

4. **Migrasi ke live** — `20260102000012` **belum di-apply** ke `CDPS SG`.
   Live masih **39 migrasi / 53 tabel**; repo kini **40 / 54**. Ikuti pola runbook 0009/0010:
   **merge PR dulu**, baru `apply_migration` (bukan `psql -f`, supaya tercatat di
   `supabase_migrations.schema_migrations`) — persis penyakit yang menciptakan **O38**.

### 2.4 Jebakan yang sudah memakan satu putaran CI

`.github/workflows/ci.yml` punya **dua gate angka hardcoded** yang tidak terlihat dari kode
aplikasi: `notif_events` (kini **17**) dan jumlah tabel (kini **54**). Menambah event atau
tabel **tanpa** menyetel keduanya ⇒ `db-and-migrations` merah dengan pesan
`expected 15 events` yang tidak menyebut-nyebut penyebabnya. Sudah diberi komentar sumber
angkanya di `adbb8cb`; kalau menambah lagi, setel di sana juga.

---

## 3. OQ-2 (data Railway) — **terjawab untuk perencanaan, belum terverifikasi untuk dekomisi**

Pemilik (2026-07-29) menegaskan data **real** CDPS = **69 karyawan** (sinkron HRIS
2026-07-28) + **32 layanan MSL** (diisi NIK `2101180004`, 2026-07-28). **Keduanya sudah ada di
Supabase `CDPS SG`**, bukan di Railway. Tidak ada lead/klien/transaksi historis yang disebut.

**Konsekuensi (mengecilkan scope C-04 secara signifikan):**

- Importer bulk (`POST /leads/bulk`, masih di `KNOWN_GAPS`) **bukan prasyarat** cutover.
- **O22 (impor lead historis) tidak punya subjek** — Sesi 9 §2.2 menandainya blocking C-04;
  dengan jawaban ini ia gugur, bukan tertunda.
- Task C (Sesi 9 §3) menyusut: **arsip MySQL sekali-jalan**, bukan pipeline migrasi.

**⚠️ Batas yang harus dihormati:** ini **inferensi dari apa yang TIDAK disebut**, bukan
konfirmasi eksplisit "Railway kosong". **Sebelum Railway dimatikan**, lampirkan
`SELECT count(*)` per tabel (minimal `leads`, `clients`, `transactions`). "0 baris" pada DB
kosong tidak bisa dibedakan dari "0 baris karena query salah" — kekeliruan yang sudah pernah
terjadi di entri O41. Detail di `DECISIONS.md` entri 2026-07-29 (OQ-2).

---

## 4. Masih menunggu pemilik (tidak berubah dari Sesi 9)

| # | Isi | Memblokir gate? |
|---|---|---|
| **O34 · O26 · O35** | aktor Wave 2 · NIK/email Director · sub-tim Creative | **Ya** — DoD C-04 "nol fixture" |
| **Eksekusi C-03** | jalankan runbook dari mesin ber-akses + 3 QA UI | **Ya** — gate C-03 |
| ~~Data Railway~~ | ~~riil atau UAT~~ | **Tidak lagi** — lihat §3 |
| ~~O22 impor lead~~ | ~~sumber + tabel nama→NIK~~ | **Tidak lagi** — lihat §3 |

---

## 5. Angka acuan (2026-07-29, Postgres 16 lokal, DB dimigrasi ulang dari nol)

`@cdps/domain` **470** · `apps/api` **211** · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · keempat invariant SQL (`ident`·`immutability`·`rls`·`auth_claims`)
**PASS** · **40** migrasi → **54** tabel · gate seed
(10 employees / 12 role_mappings / 14 machines / **17** events).

> Beda dari Sesi 9: `core` 112→**113**, migrasi 39→**40**, tabel 53→**54**,
> events 15→**17**. Semuanya dari `20260102000012`.

## 6. Urutan yang disarankan untuk sesi berikutnya

1. **Perbaiki body PR #72** (§0.2) — 5 menit, mencegah review yang melewatkan separuh diff.
2. **FE hapus-lead** (§2.3 butir 1) — ini yang mengubah "backend hijau" jadi "fitur ada".
3. **Test domain hapus-lead** (§2.3 butir 2) — DoD tiket mewajibkan test permission +
   immutability; sekarang belum terpenuhi.
4. **Docs** (§2.3 butir 3), lalu minta review / undraft.
5. Baru sentuh apply-ke-live (§2.3 butir 4) — **setelah** merge, bukan sebelum.
