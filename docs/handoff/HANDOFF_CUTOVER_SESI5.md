# HANDOFF — Cutover Sesi 5 (C-04 butir MSL ✅ · #59/#60/#61 ter-merge · sisa: 1 migrasi + keputusan aktor)

> ## ⛔ SUDAH DIGANTI — mulai dari `HANDOFF_CUTOVER_SESI6.md`
> Sesi 6 sudah berjalan di atas dokumen ini. Titik masuk yang benar sekarang:
> **`docs/handoff/HANDOFF_CUTOVER_SESI6.md`** (branch `claude/handoff-sesi-5-inmsq9`, PR **#62**).
> Perubahan penting sejak dokumen ini ditulis: §1 sekarang **dua** migrasi RLS yang menunggu apply
> (0009 **dan** 0010 yang baru), dan §5 (PR #58) sudah ditindaklanjuti. File ini tetap berguna
> sebagai arsip konteks C-04.

> **Dokumen standalone.** Mulai chat berikutnya dari file ini.
> Tanggal: 2026-07-28. Pendahulu: `HANDOFF_CUTOVER_SESI3.md` → `HANDOFF_CUTOVER_SESI4.md`.

---

## 0. MULAI DI SINI — lokasi kerja

| Item | Nilai |
|---|---|
| **Branch kerja** | **`main`** — tidak ada tumpukan PR lagi |
| **PR terbuka milik jalur cutover** | **TIDAK ADA.** #59, #60, #61 semuanya **sudah di-merge** ke `main` (2026-07-28) |
| **PR terbuka lain** | **#58** — bukan jalur cutover, **butuh keputusan** (lihat §5) |
| **Rencana induk** | `docs/backlog/CUTOVER_BACKLOG.md` — §C-04 sedang jalan, §C-05 berikutnya |
| **Handoff sebelumnya** | `HANDOFF_CUTOVER_SESI4.md` (detail alat seed MSL + hasil apply) |

```bash
git fetch origin main && git checkout main && git pull origin main
npm ci                                   # node_modules TIDAK ada di clone baru
```

**Buat branch baru dari `main`** untuk pekerjaan berikutnya. Jangan lanjutkan di
`claude/c-04-master-service-list-ioh59y` — branch itu sudah habis riwayatnya (ter-merge).

---

## 1. 🔴 TINDAKAN PALING MENDESAK — 1 migrasi belum di-apply ke `CDPS SG`

**`supabase/migrations/20260102000009_rls_leads_campaign_scope.sql` sudah ada di `main` tapi
(per pengukuran sesi 3) BELUM di-apply ke project live.** Ini satu-satunya delta repo↔live yang
tersisa: fungsi `private.jwt_owns_lead_campaign` ada di repo, belum ada di `CDPS SG`.

**Kenapa mendesak.** Merge #59 sudah men-deploy **kode** jalur baca berbasis RLS (`readAsActor`),
tapi policy pendampingnya belum ada di live. Selama itu belum di-apply, `leads_select` kehilangan
satu arm: **Marketing staff tidak bisa membaca lead yang berasal dari campaign miliknya sendiri** —
lebih ketat daripada sistem Go yang sudah lolos UAT W1/W3. Bukan lubang keamanan, tapi **regresi
fungsional yang terasa oleh pengguna Marketing**.

> **UPDATE sesi 6: sekarang ADA DUA migrasi RLS yang menunggu window deploy.** Selain 0009 di
> bawah, `20260102000010_rls_finance_staff_queue_scope.sql` memulihkan paritas RLS M5 — policy
> baseline hanya memberi baca transaksi ke Finance **lead**, padahal Go `trxVisibility` + M5 §8.1
> memberi Finance **staff** juga (mereka pemilik antrean verifikasi). Efeknya hari ini: Finance staff
> bisa **mem-verifikasi pembayaran yang tidak bisa ia baca**; dan begitu `GET /finance/queue`
> di-port, antreannya akan **kosong tanpa error**. Apply **berurutan 0009 → 0010**, lalu verifikasi
> dengan probe SQL di komentar kepala tiap migrasi. Blast radius hari ini nol (O33 — belum ada aktor
> Finance). Detail + bukti empiris: entri Decided 2026-07-28 di `docs/DECISIONS.md`.

**Cara menutup** (butuh akses deployment; sandbox Claude tidak bisa menyentuh `CDPS SG` — lihat §4):

1. **Verifikasi dulu** apakah benar belum ter-apply:
   ```sql
   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private' AND p.proname = 'jwt_owns_lead_campaign';
   -- 0 = belum di-apply, 1 = sudah
   ```
2. Kalau 0 → apply **isi file repo apa adanya** (aturan main #9: jangan tulis SQL ad-hoc, dan
   apa pun yang di-apply harus sudah ada di `supabase/migrations/`).
3. Sesudahnya, cek satu lead milik campun Marketing dengan akun Marketing staff → harus terbaca.

---

## 2. Yang selesai sesi 4 (semuanya sudah di `main`)

### 2.1 C-04 butir data #4 — Master Service List: SELESAI ✅
`master_services` di `CDPS SG` **32 baris ber-versi**, dari sebelumnya **0**. Bagian
*"MSL terisi & ber-versi"* dari **DoD C-04 terpenuhi**. Closing tidak lagi terhalang MSL kosong.

- **Alat:** `apps/api/scripts/mslseed.ts` (+ `scripts/mslseed/{csv,validate,engine}.ts`) — port 1:1
  `backend/cmd/mslseed`. Tulis HANYA lewat `msl.createService`/`msl.updateService`, jadi ID pasca-
  validasi + versi immutable + audit ikut apa adanya. Dry-run default; idempoten by nama layanan.
- **Seed kanonik:** `supabase/seed/msl_kalkulator.csv` (32 layanan rate card aktif) — **bukan**
  `MSL_DRAFT_KOMPILASI.csv` (180 baris itu harga deal historis untuk W1-19, lihat DECISIONS
  2026-07-28). Salinan byte-identik dari `backend/seed/`; satu test menjaga keduanya sinkron sampai
  Go di-retire di C-05.
- **Hasil apply ke live:** dry-run `dibuat=32` (nol tulis) → apply `dibuat=32 error=0` → rerun
  `dilewati=32` (idempotensi terbukti). Aktor NIK **`2101180004`**; 32 baris audit atas NIK itu.
- **Runbook lengkap:** `docs/handoff/MSL_KALKULATOR_VALIDASI.md` § "Cara seed ke sistem".
  Detail + pelajaran operasional: `HANDOFF_CUTOVER_SESI4.md` §3.1.

**Kalau MSL perlu direvisi** (mis. koreksi anomali O25 Nano KOL): ubah CSV, jalankan `--apply` lagi.
Baris yang berubah naik versi otomatis, versi lama tetap utuh. **Jangan pernah UPDATE baris MSL
langsung di SQL** — itu memutus recompute-from-log.

### 2.2 QA UI — LULUS di produksi ✅
Dikonfirmasi pemilik setelah `main` ter-deploy:
- `/master-services` → 32 layanan tampil.
- `/sales/kalkulator` → **200**, `Estimasi Nilai Rp. 71.330.000,00`, `Total Komisi Rp. 0,00`
  (Rp0 = nilai sah per **O24**).

> Selama #60 belum di-merge, panel Ringkasan sempat `internal server error`. Akarnya **bukan** seed:
> `web-internal/next.config.ts` memproksi `/api/v1/*` ke `BACKEND_URL`, dan tanpa override untuk
> environment Preview ia jatuh ke API produksi dari `main` yang belum memuat fix C03-F2
> (`quoteToWire`). Sudah hilang setelah #60 masuk. **Jangan diagnosa ulang.**

### 2.3 Tiga PR ter-merge berurutan
| PR | Merge commit | Isi |
|---|---|---|
| **#59** | `b47e273` | C-01/O37 — jalur baca lewat RLS (`readAsActor`) + tutup 13 handler GET tanpa auth |
| **#60** | `1bb1b52` | C-02 notifications · C-03 UAT (FAIL 0) · **O38** repo↔live sinkron · fix 500 kalkulator |
| **#61** | (lihat `git log main`) | **C-04** CLI seed MSL + 69 test + dokumentasi |

Tidak ada migrasi DB yang di-apply ke `CDPS SG` di sela merge — sesuai peringatan handoff sesi 3.

---

## 3. TIKET BERIKUTNYA

### 3.1 Sisa C-04 — semuanya memblokir pada KEPUTUSAN MANUSIA, bukan kode
Tidak ada yang bisa didorong maju oleh developer/Claude sendiri. Urut dari yang paling menghambat:

| # | Isi | Butuh dari |
|---|---|---|
| **O33** | **Roster HR riil tidak punya divisi Finance sama sekali** ⇒ seluruh flow M5 (verifikasi pembayaran, routing gate) belum punya aktor. Paling serius. | Pemilik |
| **O34** | Aktor Wave 2 + lead Marketing/BD — butir (a)–(e); kini masih fixture UAT | Pemilik |
| **O26** | NIK + email Director (Yohan & Nerissa) untuk layered role | Pemilik |
| **O35** | Sub-tim Creative M7 §3 (3 keputusan berurutan) | Nerissa |
| **O25** | Anomali kalkulator: Nano KOL batas minimal 10×Rp5jt (qty 3 tetap ditagih Rp55,5jt — sudah terlihat di UI), basis komisi 5% Store Management, enforcement budget GMV Max Rp8,5jt | Sales Head / COO |
| **O9** | Target periode M14 (non-blocking, `is_placeholder`) | SPV Ads + OD |

**O24 sudah RESOLVED — jangan dibuka lagi.** `commission_rule = 0% of standard price` adalah nilai
FINAL untuk semua 32 layanan; komisi Rp0 adalah hasil sah.

### 3.2 Sisa C-04 yang bersifat pekerjaan
0. 🔴 **BARU (sesi 6) — port 7 endpoint yang masih hilang di `apps/api` (O41).** Ini **kerusakan produksi**,
   bukan utang rapi: `next.config.ts` memproksi ke `agency-app-api` (TS) dan Go sudah "archived
   read-only", jadi halaman `/finance` + detail transaksi **404 sekarang**, `Closed-Lost` M0 tidak
   bisa dicatat, dan impor massal lead Marketing tidak ada. Diukur dengan mendiff route Go (194) vs
   TS (178) vs panggilan FE, tiap kandidat diverifikasi satu per satu. Daftar lengkap + urutan
   dampak + nama handler Go pendampingnya ada di **O41**; buku besarnya dijaga test
   `apps/api/src/lib/route-parity.test.ts` (`KNOWN_GAPS`) yang gagal kalau ada gap baru **dan**
   kalau ada entri yang ternyata sudah dilayani. Mulai dari `payment-intent` → `finance/queue` →
   `transactions/{id}` (urutan hulu-ke-hilir; `schedule` sia-sia tanpa `payment-intent`).
   Sudah ditutup sesi 6: route reminder M5 yang salah path (`/reminders` → `/finance/reminders`)
   dan **`POST /attempts/{id}/lost`** (edge Closed-Lost M0 — tanpa itu attempt gagal tak bisa
   mencapai status terminal, jadi leadnya terkunci permanen ke satu sales dan pool tak pernah bebas).
   **Cara menjalankan test DB-backed di sandbox** (sesi 6 sudah membuktikannya, jangan cari-cari lagi):
   `pg_ctlcluster 16 main start` → `DROP/CREATE DATABASE cdps` → apply 36 migrasi berurutan →
   `supabase/seed.sql` → `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run`
   di `packages/domain`. Hasilnya **426 hijau**, bukan 285 skip. Catatan: notifikasi tak bisa dihapus
   (house rule #8), jadi assertion yang menghitung notifikasi **wajib** di-scope ke `entity_id` milik
   test itu — kalau tidak, run kedua di DB yang sama gagal palsu (sudah diperbaiki di `finance.test.ts`).
1. **Migrasi 0009 ke live** — §1 di atas. Paling mendesak dari sisi data.
2. **Import lead historis (O22)** — Pilihan B: `Qualify` ATAU prospek `Hot/Warm`, 6 bulan terakhir.
   Aturan sudah tertulis di DECISIONS 2026-07-10; sumber datanya belum masuk.
3. **3 SKIP C-03** — perintah lengkap di `HANDOFF_CUTOVER_SESI3.md` §5. Butuh mesin yang boleh
   keluar internet + kredensial per-role. Tutup sebelum gate go/no-go.
4. **Konfirmasi ke pemilik:** data di Railway/MySQL riil atau UAT? (asumsi tercatat: UAT, OQ-2/A1.)
   Kalau ternyata riil ⇒ butuh rencana ekspor-impor per-entitas mengikuti rantai FK
   `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`. **Jangan improvisasi — catat keputusan dulu.**

**DoD C-04:** tak ada fixture UAT tersisa di jalur produksi; login riil semua role lolos;
~~MSL terisi & ber-versi~~ ✅ **terpenuhi**.

### 3.3 Sesudah C-04 → C-05 (retire Go)
Baru boleh setelah gate go/no-go manusia. Saat itu: hapus `backend/` (termasuk salinan
`backend/seed/msl_kalkulator.csv` — test penjaga sinkronisasi auto-skip begitu file itu hilang),
plus bersihkan `clear_must_change_password` & `employee_display_name` yang ada di DB tapi nol
pemanggil TypeScript.

---

## 4. Batasan sandbox Claude (terukur, jangan diuji ulang)

Sesi Claude **tidak bisa menyentuh `CDPS SG` maupun deployment Vercel** — dua dinding, dua-duanya
sudah dites:

| Jalur | Hasil |
|---|---|
| `*.vercel.app` | `curl: (56) CONNECT tunnel failed, response 403` — diblokir proxy |
| Postgres pooler TCP 6543 | egress ditutup |
| Supabase MCP | tidak tersedia di sesi ini |

Konsekuensi praktis: **semua apply ke live (migrasi, seed, import) harus dijalankan manusia** dari
mesin yang punya akses + kredensial. Claude menyiapkan alat + runbook, memverifikasi lokal, lalu
memandu.

### Pola menjalankan yang terbukti (hemat waktu — 3 percobaan pertama sesi 4 gagal karena ini)
1. `npm run -w` **harus** dari root repo, bukan dari `~`.
2. **Jangan paste blok multi-baris** yang memuat prompt interaktif — `read -s` akan menelan baris
   BERIKUTNYA sebagai nilainya.
3. Ambil `DATABASE_URL` dari **env var Vercel** project `agency-app-api` (Reveal), bukan dari
   Supabase dashboard — di sana password muncul sebagai `[YOUR-PASSWORD]`, dan tombol reset password
   akan mematikan API produksi.
4. Masukkan tanpa bocor ke history: copy nilainya, lalu jalankan
   `export DATABASE_URL="$(pbpaste)"` **dari history (panah atas)** — jangan menyalin perintah itu
   dari chat, karena itu justru menimpa clipboard.
5. Verifikasi tanpa menampilkan isi: `${#DATABASE_URL}` (harap ~111) + 13 karakter pertama.

### Catatan environment lain
- Postgres 16 sudah terpasang sebagai cluster Debian: `pg_ctlcluster 16 main start` (bukan `initdb`).
  "Removed stale pid file" itu normal setelah container idle.
- DB fresh: `DROP DATABASE cdps; CREATE DATABASE cdps;` → apply 36 migrasi → `supabase/seed.sql`.
- **`audit_log` menolak DELETE** (house rule #3 dipasang di DB). Cleanup test tidak boleh menghapus
  baris audit — batasi assertion audit ke `entity_id` milik test itu.
- `npm run lint -w @cdps/api` **gagal juga di tree bersih** (`apps/api` tidak punya
  `eslint.config.*`). Pre-existing, di luar CI. Kalau mau dinyalakan, itu tiket sendiri.
- Job CI `backend` (Go + MariaDB) 5–12 menit tergantung runner — bukan hang.

---

## 5. ⚠️ PR #58 — SUDAH DITINDAKLANJUTI (port sidebar selesai; #58 sendiri masih terbuka)

> **UPDATE 2026-07-28 (sesi 6).** Rekomendasi opsi 1 di bawah **sudah dijalankan**: bagian
> `web-internal` #58 di-port ke `main` lewat branch `claude/handoff-sesi-5-inmsq9`
> (lihat entri Decided 2026-07-28 "Gating menu sidebar per divisi" di `docs/DECISIONS.md`).
>
> - Tabel gate pindah ke modul murni **`web-internal/src/lib/nav.ts`** (`visibleNav(role)`);
>   `Sidebar.tsx` nol logika izin. **26 test per-role** di `nav.test.ts`.
> - **`web-internal` sebelumnya tidak punya test runner sama sekali** — ditambah `vitest`
>   + script `test`/`typecheck` + step CI di job `web-internal`. Ini yang membuat DoD
>   "permission tests per role" akhirnya bisa dipenuhi di FE.
> - **Dua koreksi terhadap tabel #58** (jangan port verbatim kalau ada yang mengulang):
>   `/creative` & `/ads` di #58 terlalu KETAT (menyembunyikan dari Account lead yang
>   `listDivisionQueue` memang izinkan), `/kol` & `/livestream` terlalu LONGGAR (Account
>   semua level, padahal lead saja).
> - **Bagian `backend/` #58 diabaikan** (Go beku) dan bagian "Sales staff lihat lead sendiri"
>   **tidak** di-port — itu perubahan perilaku yang kini jadi **O40** (butuh keputusan
>   Sales Head/pemilik). Kolom "Didaftarkan oleh" ikut ke tiket O40 yang sama.
> - **#58 sengaja TIDAK ditutup oleh sesi ini** — penutupan PR orang lain diserahkan ke
>   pemilik. Sudah dikomentari di #58 dengan penunjuk ke PR pengganti.
> - **Temuan sampingan yang lebih berat: O41** — 5 endpoint M5 Finance yang dipanggil FE
>   tidak ada / salah prefix di `apps/api` (`/finance/queue`, `GET /transactions/{id}`,
>   `POST /transactions/{id}/schedule`, `/finance/reminders[/scan]`). Jalur uang. Baca O41.

### Konteks asli (arsip)

**#58** (`claude/sales-staff-access-leads-bdmk5e`, sudah ready, bukan draft): "Sales staff lihat lead
sendiri + sembunyikan menu lintas-divisi". Dibuat sesi lain, base `main` yang **sudah basi**
(`b8347ff`, sebelum ketiga merge cutover).

Masalahnya: **isinya mengubah `backend/` (Go)** — yang sudah **beku** dan akan dihapus di C-05, jadi
bagian itu sia-sia atau bahkan melanggar aturan main #1. Tapi bagian `web-internal`-nya (gating menu
sidebar per divisi) **masih relevan** dan kemungkinan besar belum ada padanannya di stack baru.

**Sudah diverifikasi di `main` (2026-07-28):** `web-internal/src/components/Sidebar.tsx` **belum**
punya gating per divisi. Yang ada hanya `showAdmin` (director/od) dan dua link portal
(`role.level === 'lead'` / director / od) — **bukan** penyembunyian menu Ads/KOL/Creative/Finance/dst
dari Sales staff yang jadi inti #58. Jadi perilaku itu **masih hilang** di stack baru.

**Rekomendasi (opsi 1):** buka PR baru dari `main` terbaru yang mem-port **hanya bagian
`web-internal`** dari #58 — tabel gate per item nav, simetris untuk semua divisi, dengan OD/Director
tetap melihat semua dan header seksi otomatis tersembunyi bila kosong. Abaikan bagian `backend/`-nya
(Go beku; padanan server-side-nya sudah ada lewat C-01 `leadListScope` + RLS). Lalu **tutup #58**
dengan komentar yang menyebut PR penggantinya.

Catatan saat mem-port: sidebar hanya menyembunyikan, **server tetap otoritas akhir** — jangan sampai
gate UI dipakai sebagai pengganti gate endpoint.

---

## 6. Aturan main (tidak berubah — jangan dilanggar)

1. **Jangan sentuh `backend/`** (Go beku, hanya oracle paritas). Membaca boleh; mengubah tidak.
2. Perubahan → `apps/api`, `packages/*`, `web-internal`, `supabase/`.
3. Baca PRD modul di `docs/prd/` + `STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi.
4. **Nol string BI baru** tanpa entri DECISIONS; katalog notifikasi **FROZEN 15 event**.
5. **Semua route baca WAJIB `requireActor` + `readAsActor`** — jangan pernah `db()` di handler GET (O37).
6. **Notifikasi tak pernah bisa dihapus** — jangan pernah menambah route/fungsi DELETE.
7. **Helper RLS SECURITY DEFINER hidup di schema `private`**, bukan `public` (advisor lint 0029).
8. **Setiap route yang mengembalikan objek domain WAJIB lewat wire mapper** (penyebab C03-F2:
   bigint mentah → 500 yang mematikan kalkulator sales di produksi).
9. **Jangan apply migrasi langsung ke `CDPS SG` tanpa menuliskannya ke `supabase/migrations/`.**
   Itu persis yang menciptakan blocker O38.
10. Ambiguitas/deviasi PRD ⇒ **STOP**, tulis baris **Open** di `docs/DECISIONS.md`.
11. **Seed/import data produksi lewat jalur domain, bukan SQL langsung.** Yang menjaga ID, audit,
    dan versi bukan skrip seed-nya, tapi fungsi domain yang dipanggilnya.

---

## 7. Utang teknis yang diketahui

1. 🟡 **Penomoran migrasi repo (`202601…`) ≠ riwayat remote (`202607…`).** Begitu ada yang
   menjalankan `supabase db push`, CLI akan menganggap **seluruh** migrasi belum ter-apply dan
   mencoba apply ulang. **Selaraskan sebelum memakai jalur CLI.** Non-blocking untuk C-04.
2. **O39** — pintu registrasi lead tanpa gate role (diputuskan: dibiarkan, utang terdokumentasi).
3. `clear_must_change_password` & `employee_display_name` ada di DB tapi nol pemanggil TypeScript —
   bersihkan di C-05 kalau memang mati.
4. Dua salinan `msl_kalkulator.csv` (`backend/seed/` beku + `supabase/seed/` aktif). Test menjaga
   keduanya byte-identik selama keduanya ada, dan auto-skip begitu `backend/` hilang di C-05.
5. `apps/api` tanpa `eslint.config.*` ⇒ `npm run lint -w @cdps/api` selalu gagal (di luar CI).
6. `BACKEND_URL` tidak di-set untuk environment **Preview** di project Vercel `web-internal-mea`,
   sehingga preview web-internal memanggil API **produksi**. Artinya preview FE tidak pernah menguji
   API dari branch yang sama. Kalau mau QA FE↔API per-PR sungguhan, set env itu per-environment.
