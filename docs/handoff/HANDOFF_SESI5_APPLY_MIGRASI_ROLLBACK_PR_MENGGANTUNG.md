# HANDOFF — SESI 5: apply migrasi, rencana rollback C-04, dua PR menggantung

> Dibuat 2026-09-04 di atas `main@24dcbba`, setelah PR #287 dan #288 merge.
>
> **Baca juga** `HANDOFF_REVISI_SALES_CREATIVE_PERFORMA_20260904.md` (sesi 4 — detail
> apa yang dibangun) dan `HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md` (carry-over
> se-proyek). Dokumen ini **tidak menggantikan** keduanya; ia menjawab tiga pertanyaan
> spesifik yang diminta pemilik.

---

## 0. Kerjakan berurutan

| # | Pekerjaan | Siapa | Blocking? |
|---|---|---|---|
| **1** | **Apply 4 migrasi ke live `CDPS SG`** (§1) | Claude | 🔴 fitur `[Unrespon]` mati di produksi sampai ini jalan |
| **2** | Verifikasi pg_cron benar terjadwal (§1.3) | Claude | 🔴 bagian dari #1 — jangan dianggap selesai tanpa ini |
| **3** | Putuskan **angka N** rencana rollback (§2) | **Yohan + Nerissa** | 🟠 satu-satunya butir tersisa gate GO C-04 |
| **4** | Putuskan nasib **PR #171** dan **PR #281** (§3) | **Pemilik** | 🟡 keduanya docs/gerbang, bukan fitur |

---

## 1. TUGAS UTAMA — apply 4 migrasi ke `CDPS SG`

### 1.1 Kenapa ini nomor satu

Kode `[Unrespon]` sudah di `main` sejak PR #287, **database live belum tersentuh**.
Selama belum di-apply:

- edge state machine `[Unrespon]` **tidak ada** ⇒ job tidak bisa memindahkan attempt apa pun;
- katalog notif masih **v13** ⇒ dua event baru tidak dikenali;
- job harian **tidak terpasang** ⇒ lead mangkrak tetap tidak ketahuan.

Artinya seluruh nilai bisnis tiket L1–L5 saat ini **nol di produksi**, walaupun kodenya
sudah selesai dan teruji.

### 1.2 Cara mengerjakan

**Pakai `apply_migration` MCP per berkas. JANGAN `supabase db push`, JANGAN `psql -f`**
(O65 + O38 — `psql -f` itu yang melahirkan drift O38).

Urutan wajib, satu per satu, verifikasi di antaranya:

| # | `name` untuk `apply_migration` | Isi |
|---|---|---|
| 1 | `20260911030000_p1_perf_indexes` | 8 indeks aditif (P1) |
| 2 | `20260911040000_m1_unrespon_state` | 5 edge `[Unrespon]` (L1) |
| 3 | `20260911050000_m1_unrespon_notif` | katalog notif v14 + 2 event (L2) |
| 4 | `20260911060000_m1_unrespon_tick` | fungsi + jadwal pg_cron 05:30 WIB (L3) |

```
mcp__Supabase__apply_migration
  project_id: egddxfcnrtecheiykhlf        # CDPS SG
  name:       <nama dari tabel di atas>
  query:      <isi PERSIS berkas supabase/migrations/<nama>.sql>
```

**Gerbang sesudah keempatnya:** tabel **145** · `entity_prefix` **40** ·
`sm_machines` **31** · `notif_events` **67 → 69**. Hanya `notif_events` yang berubah.

Lalu `get_advisors security` — tidak boleh ada temuan baru.

### 1.3 ⚠️ Jangan lupa: pg_cron bisa gagal DIAM-DIAM

Migrasi #4 membungkus jadwal pg_cron dalam
`IF EXISTS (... pg_available_extensions ...)`. Kalau ekstensinya tidak tersedia di
`CDPS SG`, **migrasinya tetap sukses tanpa pesan apa pun** tapi job-nya tidak pernah
terpasang. Wajib diverifikasi terpisah:

```sql
select jobname, schedule, active from cron.job where jobname like '%unrespon%';
```

- **Ada barisnya** ⇒ selesai.
- **Kosong** ⇒ pilih salah satu: jalankan manual lewat
  `POST /api/v1/internal/leads/tick` (butuh header secret, `tickSecretOk` fail-closed),
  atau jadwalkan lewat Vercel Cron. **Catat mana yang dipilih di `DECISIONS.md`.**

### 1.4 Latar: kenapa nomor migrasinya lompat

`main` sempat mendaratkan `20260911010000_o73_commission_rule_grammar.sql` — **nomor
versi yang persis sama** dengan `_m1_unrespon_state` versi lama. Punya O73 sudah
ter-apply di live, punya kita belum. Dua berkas satu versi merusak `supabase db push`
dan membuat urutan apply lokal beda dari live. Keempatnya karena itu dinomori ulang di
atas O73 (`030000/040000/050000/060000`), urutan relatifnya dijaga. Sudah diverifikasi
lewat `list_migrations` ke live sebelum diputuskan — bukan asumsi.

---

## 2. RENCANA ROLLBACK C-04 — penjelasan, contoh, rekomendasi

### 2.1 Kabar baik: rencananya SUDAH ADA, bukan belum dibuat

Dokumen resminya **`docs/handoff/RENCANA_ROLLBACK_CUTOVER.md`** (166 baris, PR #87).
Kerangkanya lengkap. Yang menahan gate GO bukan "belum ada rencana", melainkan **empat
butir kecil** — dan tiga dari empatnya bukan pekerjaan koding.

| Prasyarat | Status |
|---|---|
| #1 Backup MySQL Railway | ✅ ada, terverifikasi 4 lapis, disimpan di luar GitHub |
| #2 Verifikasi `COUNT(*)` per tabel MySQL | ✅ 50 tabel · 239 baris · rantai FK jalur uang NOL |
| #3 Service Go di Railway masih bisa dihidupkan? | 🔶 **belum diverifikasi** — Railway di luar jangkauan Claude |
| #4 Kredensial pengguna lama masih berlaku? | 🔶 **belum diverifikasi** |
| **Angka N** — Railway hidup berapa hari pasca-cutover | 🔶 **belum disepakati** ← inti keputusannya |

### 2.2 Yang paling penting dipahami sebelum memutuskan N

**Rollback hari ini hampir GRATIS.** Dibaca dari live:

| | |
|---|---|
| `clients` | **0** |
| `transactions` · `installments` | **0** · **0** |
| `leads` | 6 — semuanya data uji |
| `master_services` | 32 (ada CSV sumbernya, bisa di-seed ulang) |

**Tidak ada satu pun data bisnis yang hanya hidup di Supabase.** Jadi rollback sekarang
= mengarahkan orang kembali ke sistem lama. Bukan migrasi data, bukan rekonsiliasi.

🔴 **Dan ini bagian yang harus dinyatakan terang-terangan:** yang menutup jendela ini
**bukan tanggal, melainkan satu peristiwa — transaksi riil pertama.** Begitu ada
`clients` + `transactions` riil di Supabase, rollback menuntut ekspor-impor mundur
menyusuri rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`, dan **perkakas
untuk itu sengaja tidak pernah dibangun** (O47 — `cmd/import` ditinggalkan).

Artinya: sesudah transaksi riil pertama, **tidak ada rencana rollback yang jujur**
selain "bangun dulu importer mundur yang belum pernah ada".

### 2.3 Contoh konkret — dua skenario yang sering tercampur

Dokumen aslinya memisahkan dua hal yang namanya sama-sama "rollback". Ini contohnya:

**Contoh A — deploy TS baru rusak (murah, sering, bukan ini yang butuh keputusan N)**

> Jumat sore deploy `web-internal`, halaman `/leads` blank. Ini **bukan** rollback
> cutover. Buka Vercel → project → Deployments → deployment hijau terakhir → **Promote
> to Production**. Selesai dalam hitungan menit, database tidak tersentuh sama sekali.
> Frekuensi: wajar, bagian operasi normal.

**Contoh B — mundur dari stack TS sepenuhnya (mahal, sekali atau tidak sama sekali)**

> Dua minggu setelah cutover ditemukan cacat kelas data yang tidak bisa ditutup dalam
> 1×24 jam. Yohan + Nerissa memutuskan mundur. Urutannya:
> 1. **Bekukan tulis di TS** — `set_employee_banned(<nik>, true)` massal, supaya titik
>    potongnya pasti. Reversibel.
> 2. **Arsipkan Supabase apa adanya** (`pg_dump` penuh, simpan di luar Supabase) — bukan
>    untuk dipulihkan ke MySQL, tapi supaya keputusan mundur tetap bisa diaudit.
> 3. **Hidupkan lagi Go + MySQL** dari backup prasyarat #1. ⚠️ Pakai berkas yang sudah
>    tersimpan — dump `mysqldump` polos **gagal di tengah restore** karena tujuh trigger
>    imutabilitas CDPS menyimpan `;` di ujung badannya (`ERROR 1064`). Berkas tersimpan
>    sudah diperbaiki dan restore-nya sudah dibuktikan.
> 4. **Rekonsiliasi delta** — **selama `clients`/`transactions` masih 0, langkah ini
>    KOSONG dan rollback selesai di langkah 5.** Kalau sudah tidak nol, langkah ini
>    adalah proyek tersendiri.
> 5. Arahkan orang kembali (DNS/URL/bookmark) + umumkan.

**Yang TIDAK bisa dikembalikan apa pun yang terjadi** (sadari sebelum, bukan sesudah):
baris `audit_log` (append-only), nomor ID yang sudah tercetak (counter tidak mundur),
38 notifikasi yang sudah sampai ke 38 karyawan, dan **kata sandi yang sudah diubah
pengguna di CDPS TS** — itu hidup di GoTrue, bukan MySQL, jadi mundur = kembali ke
sandi lama dan itu **harus diumumkan**, bukan dibiarkan jadi kejutan.

**Siapa yang boleh memicu B:** hanya Yohan + Nerissa berdua (OQ-1). Bukan CI merah,
bukan satu bug, bukan Claude. Satu halaman error = skenario A.

### 2.4 Pilihan angka N + rekomendasi

| Opsi | Plus | Minus |
|---|---|---|
| **N = 7 hari** | Biaya Railway paling kecil; memaksa tim cepat yakin | Masalah yang muncul di minggu ke-2 (mis. saat tutup bulan) sudah tidak punya jalan mundur |
| **N = 14 hari** (draf `RUNBOOK_BACKUP_MYSQL_RAILWAY.md` §7) | Cukup untuk satu siklus operasi normal; kompromi wajar | Belum tentu menjangkau tutup bulan kalau cutover di awal bulan |
| **N = 30 hari** | Menjangkau **satu siklus tutup bulan penuh** — momen ketika bug kelas keuangan biasanya baru muncul | Biaya Railway sebulan lagi; risiko tim menunda-nunda karena merasa aman |

**Rekomendasi gw: N = 30 hari**, dengan dua alasan yang berdiri sendiri:

1. **Asimetri biayanya ekstrem.** Biaya menghidupkan MySQL Railway sebulan itu kecil
   dan terukur. Biaya salah menebak — mematikannya lalu butuh — adalah kehilangan
   satu-satunya jalan mundur, permanen. Kalau dua hal tidak sebanding sebesar ini,
   pilih yang salahnya murah.
2. **Bug kelas keuangan muncul di tutup bulan, bukan di minggu pertama.** CDPS
   memegang jalur uang (transaksi, termin, komisi). Kelas cacat yang paling layak
   ditakuti justru yang baru kelihatan saat rekap bulanan pertama. N = 7 atau 14 hari
   berisiko mematikan jaring pengaman **tepat sebelum** momen ujinya.

**Tapi — dan ini lebih penting daripada angka N-nya:** keputusan GO yang sesungguhnya
bukan "berapa hari Railway hidup", melainkan **"apakah kita menerima bahwa sejak
transaksi riil pertama, jalan mundur praktis tertutup"**. N cuma memperpanjang jendela
untuk periode ketika `clients`/`transactions` masih nol. Sebaiknya itu diputuskan
sadar sekarang, bukan ditemukan belakangan.

**Langkah konkret buat Nerissa & Yohan:**
1. Yohan cek: service Go di Railway masih bisa dihidupkan? (prasyarat #3)
2. Yohan cek: kredensial pengguna lama masih berlaku? (prasyarat #4)
3. Berdua sepakati angka N, tulis di `RENCANA_ROLLBACK_CUTOVER.md` §6 butir 1–3.
4. Berdua tanda tangani butir 5: menerima bahwa GO menutup jalan mundur.
5. Baru gate GO bisa dibuka.

---

## 3. DUA PR MENGGANTUNG — tujuan, isi, dan analisa drift

Keduanya sudah gw baca isinya dan gw verifikasi klaimnya terhadap kode di `main`.
**Kabar baiknya: tidak satu pun berisiko drift skema.** Keduanya nol migrasi baru.

### 3.1 PR #171 — gerbang keamanan yang tidak punya penjaga

- **Dibuka:** 15 Agustus 2026 · **Judul:** *"fix(security): kunci EXECUTE seluruh fungsi
  SECURITY DEFINER dari anon + gerbang yang punya gigi"*
- **7 berkas:**

| Berkas | Isi | Sudah di `main`? |
|---|---|---|
| `supabase/migrations/20260814130000_harden_job_execute_surface.sql` | +98 | ✅ **sudah**, dengan nama versi live `20260815094622_…` |
| `supabase/migrations/20260814140000_harden_secdef_execute_sweep.sql` | +135 | ✅ **sudah**, dengan nama versi live `20260815105659_…` |
| `supabase/tests/rls_checks.sql` | **+72** — invariant §44 | ❌ **BELUM** |
| `.github/workflows/ci.yml` | **+27** — gerbang CI | ❌ **BELUM** |
| `scripts/db-rebuild.sh` | **+31** — gerbang lokal | ❌ **BELUM** |
| `supabase/migrations/20260814110000_penugasan_internal.sql` | +15/−9 — **menyunting migrasi yang SUDAH ter-apply** | ⚠️ jangan di-merge apa adanya |
| `docs/DECISIONS.md` | +2 | ❌ belum |

- **Tujuannya:** menutup celah "fungsi `SECURITY DEFINER` bisa dieksekusi role `anon`".
- **Status sebenarnya (gw verifikasi sendiri):** **ACL di live sudah benar** — lubangnya
  sudah ditambal lewat migrasi yang memang sudah mendarat. Yang **tidak ada** adalah
  **penjaganya**: `grep -c "prosecdef" supabase/tests/rls_checks.sql` = **0**. Kata
  kunci itu cuma muncul di migrasi penambalnya, tidak di invariant maupun CI.
- **Artinya:** lubang ini **tidak bisa merah di CI kalau kembali**. Ia ditambal sekali,
  tanpa apa pun yang mencegahnya terulang. Itu persis isi O72.

**Analisa drift:** ⚠️ **satu butir berisiko, sisanya tidak.**
- Dua migrasinya **sudah** di `main` ⇒ merge PR ini apa adanya akan menambahkan **berkas
  migrasi duplikat** dengan nomor versi berbeda untuk isi yang sama. **Itu justru
  MENCIPTAKAN drift**, bukan menutupnya.
- Suntingan `+15/−9` pada `20260814110000_penugasan_internal.sql` — **menyunting migrasi
  yang sudah ter-apply ke live** — melanggar prinsip migrasi immutable. Repo dan live
  akan bercerita berbeda tentang berkas yang sama.
- Tiga berkas gerbang (`rls_checks.sql`, `ci.yml`, `db-rebuild.sh`) **nol risiko drift** —
  murni penambahan pemeriksaan.

**Rekomendasi: JANGAN merge #171 apa adanya. Tutup sebagai *superseded*, selamatkan
tiga berkas gerbangnya jadi satu PR kecil baru.**

Alasannya: nilai PR ini seluruhnya ada di 130 baris gerbang; dua migrasinya sudah usang
(sudah mendarat), dan satu suntingan migrasinya justru berbahaya. Merge utuh = memasukkan
duplikat + suntingan terlarang demi mendapat gerbang yang bisa diambil terpisah.

Langkahnya: branch baru dari `main` → salin **hanya** delta `rls_checks.sql` §44 +
`ci.yml` + `db-rebuild.sh` → jalankan `db-rebuild.sh` (harus tetap lolos, karena ACL live
sudah benar) → PR kecil → tutup #171 dengan komentar yang menunjuk PR penggantinya.

### 3.2 PR #281 — peta pekerjaan se-proyek + koreksi 3 backlog basi

- **Dibuka:** 4 September 2026 · **Status: masih DRAFT**
- **5 berkas, DOCS-ONLY — nol kode, nol migrasi:**

| Berkas | Isi |
|---|---|
| `docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` | **+279** — peta pekerjaan sisa se-proyek (baru) |
| `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` | +14 — koreksi status basi |
| `docs/backlog/M6D_BACKLOG.md` | +13 — koreksi status basi |
| `docs/backlog/CUTOVER_BACKLOG.md` | +15/−3 — koreksi C-06 |
| `docs/DECISIONS.md` | +1 |

- **Tujuannya:** tiga berkas backlog menyatakan status yang **sudah tidak benar**, dan
  sesi berikutnya membacanya sebagai kebenaran lalu **membangun ulang barang yang sudah
  jadi**. Preseden nyatanya sudah pernah terjadi (sesi #77 mengerjakan ulang dari nol dua
  task yang sudah ter-merge).

**Gw verifikasi ketiga koreksinya terhadap `main` — semuanya BENAR:**

| Klaim basi di `main` hari ini | Kenyataan yang gw hitung sendiri |
|---|---|
| `RISET_AWAL…md`: *"Status: nol kode"* | `packages/core/src/baseline/` **16 berkas**, `riset-awal.ts` ADA, PRD Module6 ADA |
| `M6D_BACKLOG.md`: *"SPEC-ONLY, belum ada migrasi/kode"* | **10 migrasi** `m6d_wrr` + `recap.ts` + **8 berkas tes** |
| `CUTOVER_BACKLOG.md` C-06: *"masih hanya README.md"* | `web-client-portal` punya **9 halaman** `page.tsx` |

Ketiga klaim basi itu **masih ada di `main` sampai detik ini** — belum dikoreksi lewat
jalur mana pun.

**Analisa drift:** ✅ **nol risiko drift.** Docs-only, nol migrasi, nol kode. Koreksinya
juga ditulis sebagai blockquote ber-tanggal yang **mempertahankan teks aslinya** alih-alih
menimpanya — jadi jejak "kapan drift-nya mulai" tidak hilang. Justru **membiarkan #281
menggantung adalah bentuk drift-nya sendiri**: dokumentasi yang berbohong tentang kode.

Satu-satunya yang perlu disesuaikan: handoff induknya (+279 baris) ditulis sebelum SESI2/
SESI3/SESI4, jadi beberapa bagiannya sudah dilewati kejadian — tapi dokumen itu **sudah
memuat blockquote peringatan di kepalanya** yang menunjuk ke SESI3.

**Rekomendasi: MERGE #281.** Nilainya (mencegah pembangunan ulang tiga modul besar) jauh
melebihi biayanya (nol). Kalau mau lebih rapi, tambahkan satu baris di kepala handoff
induknya yang menunjuk ke SESI4 + sesi ini sebelum merge.

### 3.3 Ringkasan keputusan dua PR

| PR | Isi | Risiko drift | Rekomendasi |
|---|---|---|---|
| **#171** | 3 berkas gerbang (berguna) + 2 migrasi usang + 1 suntingan migrasi terlarang | ⚠️ **ADA** kalau di-merge utuh | **Tutup**, buat PR kecil berisi 3 berkas gerbangnya saja |
| **#281** | docs-only: peta kerja + koreksi 3 backlog basi | ✅ **nol** | **Merge** |

---

## 4. Prompt siap tempel untuk chat berikutnya

> Baca `docs/handoff/HANDOFF_SESI5_APPLY_MIGRASI_ROLLBACK_PR_MENGGANTUNG.md`.
> Kerjakan §1: apply 4 migrasi (`20260911030000` → `040000` → `050000` → `060000`) ke
> live `CDPS SG` (`egddxfcnrtecheiykhlf`) lewat `apply_migration` per berkas — BUKAN
> `db push`, BUKAN `psql -f`. Verifikasi gerbang 145/40/31/**69** dan
> `get_advisors security` sesudahnya. Lalu §1.3: pastikan pg_cron benar terjadwal
> (`select * from cron.job where jobname like '%unrespon%'`) — kalau kosong, laporkan
> dan usulkan fallback, jangan diam-diam dianggap selesai.
>
> Jangan sentuh §2 (butuh keputusan Yohan+Nerissa) dan §3 (butuh keputusan pemilik).

---

## 5. Aturan rumah yang paling sering menggigit

1. **⛔ Jangan bangun apa pun di `backend/`** — Go + MySQL pensiun, ia oracle paritas saja.
2. **Migrasi ke live: `apply_migration` per berkas.** Bukan `db push` (O65), bukan
   `psql -f` (itu melahirkan drift O38).
3. **Gerbang hitungan ada di DUA tempat** — `.github/workflows/ci.yml` **dan**
   `scripts/db-rebuild.sh`. Menaikkan satu saja = CI merah.
4. **`KNOWN_GAPS` di `route-parity.test.ts` harus tetap KOSONG.**
5. **Wire snake_case, domain camelCase, penerjemah HANYA `apps/api/src/lib/wire.ts`.**
   Kunci yang HILANG lebih berbahaya daripada `null`.
6. **Suite `@cdps/domain` hanya hijau di DB yang baru `db-rebuild.sh`.**
   `admin.test.ts` dan `client.test.ts` memakai ID literal yang bentrok dengan
   `audit_log` immutable dari run sebelumnya. **Rebuild dulu sebelum menuduh diff sendiri.**
7. **Jangan seed data uji ber-`created_by='ZZ-%'` sambil suite jalan** — itu pola yang
   dipakai `afterEach` semua suite.
8. **Filter/search client-side di atas daftar yang dipaginasi akan rusak diam-diam** —
   sejak P2 §6, enam pembacaan daftar dipaginasi. Cek dulu sebelum menambah paginasi baru.
