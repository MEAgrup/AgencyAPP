# HANDOFF — Cutover Sesi 11

> **Pendahulu:** `HANDOFF_CUTOVER_SESI10.md` (dan lewat itu, SESI9). Yang masih berlaku
> **tidak diulang** — terutama SESI9 §0.2 (batas sandbox), §6 (aturan rumah yang menggigit),
> §7 (cara menjalankan test DB-backed, masih akurat & sudah dipakai sesi ini).

## 0. Posisi persis

| | |
|---|---|
| **Branch** | `claude/cdps-sg-cutover-continue-kvnxno` ⚠️ **BUKAN** `4jbfpy` — lihat §0.2 |
| **HEAD** | `a8bbf34` — sudah dipush, working tree bersih, nol pekerjaan tertinggal di disk |
| **Isi branch** | 4 commit `4jbfpy` (PR #72) + **1 commit baru** `a8bbf34` |
| **PR** | **#72 masih menunjuk `4jbfpy` @ `14c77c2`** — commit sesi ini **TIDAK** terlihat di sana |

### 0.1 Yang dikerjakan sesi ini

Menutup **tiga dari empat** butir terbuka SESI10 §2.3 — semua yang bisa dikerjakan tanpa
akses live:

| Butir §2.3 | Status |
|---|---|
| 1. **UI hapus-lead** | ✅ selesai — fitur kini bisa dipakai pengguna |
| 2. **Test domain alur hapus** | ✅ selesai — 43 test, domain 470 → **513** |
| 3. **Docs** (`STATE_MACHINES` §2, `DATA_MODEL` §1) | ✅ selesai |
| 4. **Apply migrasi ke `CDPS SG`** | ❌ **sengaja belum** — harus SESUDAH merge (§3) |

### 0.2 ⚠️ Branch sesi ini berbeda dari branch PR #72 — perlu keputusan Anda

Harness sesi ini menugaskan branch `…-kvnxno` dengan instruksi eksplisit *"NEVER push to a
different branch without explicit permission"*, sedangkan PR #72 hidup di `…-4jbfpy`. Karena
`4jbfpy` bercabang dari `main@212a89a` dan `kvnxno` masih persis di `main`, `kvnxno`
**di-fast-forward** ke `14c77c2` lalu commit baru ditumpuk di atasnya — **nol history
ditulis ulang, nol force-push, nol commit hilang.** `kvnxno` adalah superset `4jbfpy`.

Akibatnya PR #72 **tidak** memperlihatkan pekerjaan sesi ini. Dua jalan, pilih satu:

- **(a) Paling sederhana — pindahkan `4jbfpy` ke `kvnxno`:** `git push origin
  kvnxno:claude/cdps-sg-cutover-continue-4jbfpy` (fast-forward, aman). PR #72 langsung
  membawa 5 commit dan body-nya cuma perlu tambahan bagian C. **Ini yang saya sarankan.**
- **(b) PR baru dari `kvnxno` → `main`,** lalu tutup #72 sebagai tergantikan. Lebih berisik:
  kehilangan diskusi #72 dan menduplikasi bagian A/B di body baru.

Saya **tidak** menjalankan keduanya — memindahkan head PR orang lain dan menutup PR adalah
tindakan menghadap-keluar yang butuh persetujuan Anda.

---

## 1. UI hapus-lead — **fitur kini ADA** 🟢

Endpoint yang di SESI10 punya nol pemanggil sekarang dipanggil semua. `route-parity.test.ts`
hijau (5 test), jadi kelima fungsi client benar-benar berpasangan dengan route yang dilayani.

### 1.1 Yang ditulis

| Berkas | Isi |
|---|---|
| `web-internal/src/lib/leads.ts` | `requestLeadDelete` · `listLeadDeleteRequests` · `listDeleteRequests` · `approveLeadDelete` · `rejectLeadDelete` (sebelumnya **hanya tipe kontrak**) |
| `…/leads/[id]/page.tsx` | komponen `DeletePanel`: form **Ajukan** (alasan wajib) · panel **ACC Head** (Setujui/Tolak + catatan) · tabel riwayat permintaan yang sudah diputuskan |
| `…/leads/page.tsx` | tab baru **"Permintaan Hapus"** (antrian ACC + filter status) · tombol **Ajukan Hapus** per baris tab Database dengan input alasan **inline** · `[Deleted]` masuk `RECORD_STATUSES` |
| `web-internal/src/lib/status.ts` | `'[Deleted]': 'darkgray'` |

**Kenapa input alasan inline, bukan tombol langsung:** `reason` wajib di server, jadi tombol
per baris **tidak bisa** langsung mengirim. Tombolnya membuka satu baris form di bawah lead-nya.
Jangan "sederhanakan" jadi satu klik — itu menjamin `[data tidak lengkap…]`.

### 1.2 Keputusan desain yang jangan dibalik tanpa alasan

- **Gate tetap MILIK SERVER.** Panel hanya menyembunyikan aksi yang sudah pasti mustahil
  (klien / sudah terhapus / bukan Head divisi asal). Ia **tidak** mereplikasi
  `canRequestDelete`, karena koneksi *"pembuat lead"* (`created_by`) **tidak ada di kontrak
  `GET /leads/{id}`** — form pengajuan tampil optimistis dan penolakan dirender **verbatim**
  dari server. Menebak di FE hanya melahirkan dua sumber kebenaran yang bisa berbeda.
- **Dua cermin permission sengaja TIDAK lebih ketat dari server.** Percobaan pertama saya
  memakai `!odOnly` di keduanya dan itu **salah**: `permission.canWrite` hanya menuntut
  *ada* scope divisi (OD berlapis di atas akun berdivisi memang menulis), dan
  `approveDelete` **tidak memanggil `canWrite` sama sekali** — hanya `isLead`. Jadi
  `canWrite = director || division !== ''` dan `canDecide = director || level === 'lead'`.
  Kalau nanti terasa "terlalu longgar", perbaikannya di **server**, bukan menyembunyikan
  tombol yang server terima.
- **`[Deleted]` → `darkgray` butuh entri eksplisit** di `EXACT_MAP`: heuristik substring
  `badgeTone` tidak punya cabang `delete`, jadi tanpa baris itu ia jatuh ke `gray` dan
  **terlihat sama seperti `[To Do]`**.

### 1.3 Celah UX yang saya sadari dan TIDAK tutup

Setelah pengajuan berhasil dari tab **Database**, barisnya **tidak** menandakan ada permintaan
pending — kontrak `LeadRow` tidak punya field itu. Notifikasi sukses muncul, dan halaman detail
memperlihatkan gambaran penuhnya. Klik kedua akan kena
`[permintaan hapus untuk lead ini sudah diajukan]` dari server — benar, tapi bukan yang
terbaik. **Menutupnya butuh perubahan backend** (mis. `pending_delete_request` di `LeadRow`),
jadi saya tidak menambahkannya diam-diam.

---

## 2. Test domain — DoD tiket sekarang terpenuhi

`packages/domain/src/leads_delete.test.ts`, **43 test** (domain **470 → 513**).

Dua yang paling penting, dan alasannya:

1. **Bukti gate ada di SQL, bukan cuma TypeScript.** `approveDelete` memeriksa
   `permission.isLead` lalu **throw sebelum menyentuh engine**, jadi seluruh test lewat domain
   hanya membuktikan separuh TS-nya. Klaim yang menopang keputusan pemilik lebih kuat: keempat
   edge masuk `[Deleted]` ber-`require_lead = true`, jadi **`sm_transition` sendiri** menolak
   staff. Karena itu ada satu blok test yang memanggil `statemachine.transition` **LANGSUNG,
   memutari domain** — staff ditolak `role_denied`, Head lolos, `[Deleted]` tidak punya edge
   keluar bahkan untuk Director, dan `[Closed-Success]` tidak punya edge masuk.
2. **`uq_ldr_one_pending` diuji di INDEKS** lewat `INSERT` mentah (persis yang dilakukan dua
   transaksi yang balapan setelah keduanya lolos cek `count(*)` aplikasi), **dan** dibuktikan
   **parsial** — baris `rejected` tidak menempati slot, jadi lead yang pengajuannya ditolak
   masih bisa diajukan lagi.

Selain itu: urutan blok diuji (klien **mengalahkan** pending — "sudah pending" terbaca
bisa-diulang, itu menyesatkan), `LDR-` dicetak **sesudah** validasi (alasan kosong tidak
membakar id, aturan rumah #1), penolakan `delete_request_blocked` **teraudit** (commit,
bukan ikut ter-rollback), `matchByPhone` melewati baris terhapus sehingga nomornya bisa
didaftar ulang, dan `leadsDatabase` menyembunyikan tapi tetap mengembalikan bila diminta.

> **Satu jebakan yang memakan waktu:** aksi audit transisi **bukan** `'transition'` tapi
> `'transition:active->[Deleted]'` — ia menamai **edge** yang dilewati. Assert-nya jadi lebih
> kuat (memastikan edge mana), tapi `toContain('transition')` akan gagal.

> **Jebakan kedua, lebih halus:** `toThrow(bi.INCOMPLETE)` **lulus** walau konstantanya tidak
> ada (namanya `INCOMPLETE_DATA`) — `toThrow(undefined)` cuma memastikan *ada* throw. Yang
> menangkapnya **typecheck**, bukan test. Jalankan `npm run typecheck --workspaces` sebelum
> percaya suite yang hijau.

---

## 3. Yang BELUM — untuk sesi berikutnya

1. **Keputusan §0.2** (pindahkan `4jbfpy` atau PR baru) — 1 menit, memblokir review.
2. **Body PR #72 perlu bagian C** setelah §0.2 dijalankan: UI hapus-lead + 43 test + docs.
   Blok "🟠 BELUM SELESAI" di body sekarang **sudah tidak akurat** — tiga dari empat butirnya
   selesai. Reviewer yang membaca body lama akan mengira UI-nya masih kosong.
3. **Migrasi `20260102000012` belum di-apply ke `CDPS SG`.** Live **39 migrasi / 53 tabel**;
   repo **40 / 54**. **SESUDAH merge**, lewat `apply_migration` — **bukan `psql -f`**, supaya
   tercatat di `supabase_migrations.schema_migrations`. Persis penyakit yang menciptakan **O38**.
4. **C-03 tetap menunggu pemilik** — tidak berubah dari SESI10 §1. Jalankan
   `docs/handoff/CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari mesin ber-akses; jangan susun ulang.
5. **O34 · O26 · O35** masih memblokir DoD C-04 ("nol fixture") — SESI10 §4.
6. **OQ-2:** sebelum Railway dimatikan tetap perlu `SELECT count(*)` per tabel (minimal
   `leads`, `clients`, `transactions`). Status ini **tidak berubah** sesi ini — ia inferensi
   dari apa yang tidak disebut, bukan konfirmasi. Lihat SESI10 §3.
7. **Opsional (butuh backend):** field `pending_delete_request` di `LeadRow` untuk menutup
   celah §1.3.

---

## 4. Angka acuan (2026-07-29, Postgres 16 lokal, DB dimigrasi ulang dari nol)

`@cdps/domain` **513** · `apps/api` **211** · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · keempat invariant SQL (`ident`·`immutability`·`rls`·`auth_claims`)
**PASS** · gate seed CI **PASS** (10 employees / 12 role_mappings / **17** events) ·
**40** migrasi → **54** tabel · typecheck bersih di semua workspace · eslint `web-internal` bersih.

> Beda dari SESI10: **hanya** `domain` 470 → **513** (+43 test baru). Migrasi, tabel, event,
> dan ketiga workspace lain **tidak bergerak** — sesi ini nol perubahan skema.

## 5. Yang TIDAK disentuh

Nol perubahan pada `supabase/migrations/**`, `packages/domain/src/leads.ts`,
`apps/api/src/**`, dan `.github/workflows/ci.yml`. Backend bagian B sudah lengkap di SESI10;
sesi ini hanya memberinya pemanggil, test, dan dokumentasi. Kedua gate angka hardcoded CI
(**17** event, **54** tabel) **tetap benar** dan sudah diverifikasi lokal — tidak perlu disetel.
