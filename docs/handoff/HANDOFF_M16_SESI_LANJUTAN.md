# HANDOFF — Mulai dari sini untuk melanjutkan M16/M17

> ### ⚠️ Ada handoff bernomor lebih tinggi
> Baca **`docs/handoff/HANDOFF_M16_PR252_20260829.md` DULU** — PR #252 (7
> keputusan §2 di bawah + 2 fix bug FE Ads) dibuka sesi 2026-08-29 dan
> statusnya (CI/merge) berubah cepat. Dokumen ini tetap referensi utuh untuk
> teks asli 11 pertanyaan §2, tapi bukan lagi yang paling mutakhir soal PR.

> **Baca dokumen ini SEBELUM menyentuh apa pun terkait M16/M17.** Ia adalah
> ringkasan navigasi ke dokumen yang sudah ada di repo — tidak menduplikasi
> isinya, hanya memberi tahu urutan baca, apa yang benar-benar tersisa, dan
> (baru di revisi ini) **pertanyaan konkret yang menunggu jawaban pemilik**,
> lengkap contoh dan rekomendasi supaya menjawabnya cepat.

---

## 0. TL;DR

**M16 (Lead Time per Tahapan Divisi) dan M17 (AI Optimizer) sudah selesai
dibangun, sudah di-review, sudah merge ke `main`, dan sudah di produksi
(`CDPS SG`).** Tiga putaran kerja sesudahnya — **LT-60** (input tahapan Live
oleh tim internal), **O61** (back-port 2 migrasi hardening keamanan), **O62**
(verifikasi migrasi `m6a_section_d` — ternyata BUKAN duplikat, sudah
direkonsiliasi 2026-08-08 lewat O59) — **semuanya selesai, merge lewat
[PR #250](https://github.com/MEAgrup/AgencyAPP/pull/250) ke `main`.**

**Tidak ada satu pun sisa pekerjaan M16/M17 yang berupa kode.** Yang tersisa
murni menunggu keputusan Anda: **11 pertanyaan** (`LT-1`..`LT-11`, §2 di
bawah) plus satu item terblokir spec keamanan (`LT-61`, jangan disentuh) dan
satu item implementasi yang menunggu tim mulai memakai fiturnya (halaman FE
Ads/Permintaan). Nol yang mendesak — semuanya punya default aman sudah
berjalan di produksi hari ini.

> ### ✅ Pembaruan 2026-08-29 (dua putaran) — 7 dari 11 pertanyaan SUDAH DIJAWAB & DIPASANG
>
> Pemilik menjawab **LT-1 (sebagian), LT-3, LT-4, LT-5, LT-6, LT-7, LT-9**
> lewat dua putaran percakapan sesi ini; semuanya sudah diimplementasi —
> migrasi data untuk LT-1/3/4/5 (`20260901010000`..`20260901040000`), satu
> perubahan kode TS untuk LT-9 (`performance.ts`, portofolio skor AM), dan
> LT-6/LT-7 murni konfirmasi tertulis (nol kode). Semua disertai test +
> entri `DECISIONS.md` masing-masing. **§2 di bawah dipertahankan apa adanya
> sebagai teks pertanyaan aslinya** — status tiap baris ada di kepala baris
> itu. Yang benar-benar masih menunggu Anda: **LT-2 & LT-8** ("menyusul",
> sengaja dijawab bersamaan), **LT-10, LT-11**, plus dua sisa LT-1:
> konfirmasi angka target 24 jam dan bobot `role_type` AI Optimizer + Store
> Operation. Status tiket otoritatif: `docs/backlog/LEADTIME_BACKLOG.md`
> Fase 6.

---

## 1. Urutan baca

1. **§2 di dokumen ini** — 11 pertanyaan yang butuh jawaban Anda, dengan
   contoh + rekomendasi. Baca ini dulu kalau tujuan Anda menjawab, bukan
   membangun.
2. **`docs/handoff/RENCANA_INDUK_M16_M17.md`** — konteks/desain lengkap kalau
   Anda ingin tahu *kenapa* modul ini dirancang begini sebelum menjawab.
3. **`docs/backlog/LEADTIME_BACKLOG.md`** — status tiket **otoritatif**.
   Setiap baris ✅ menyebut nama migrasi dan nama test persis.
4. **`docs/DECISIONS.md`, cari `M16`** — rasional penuh tiap keputusan
   termasuk teks asli ke-11 pertanyaan di §2 (dicari dengan kode `LT-1`
   dst. di bagian `## Open`), plus baris "LT-60 SELESAI" dan "O61/O62
   DITUTUP" untuk kerja sesi ini.

---

## 2. Pertanyaan yang butuh keputusan Anda (11, diurut dari paling penting)

Format tiap baris: **apa yang dipilih hari ini** (default aman, sudah
berjalan) → **pertanyaannya** → **contoh konkret** → **rekomendasi saya**.
Menjawab salah satu TIDAK memblokir yang lain — bisa dicicil.

### LT-1 — Bobot skor AM/divisi baru (perlu COO)

> ✅ **DIJAWAB SEBAGIAN 2026-08-29** — Anda menjawab "jalankan rekomendasi".
> Bobot ditetapkan **10%** (lantai rentang 10–15% yang direkomendasikan, sama
> persis preseden RM-9a yang dikutipnya); profil AM kini 40,5 / 20,25 / 20,25
> / 9 / **10**. Menaikkannya ke 15% = satu migrasi, nol kode — bilang saja.
> **Dua hal masih menunggu Anda:** (a) bobot saja ternyata tidak cukup —
> komponennya dikecualikan selama tak ada baris target, jadi diseed target
> **24 jam** ber-flag PLACEHOLDER; angka itu **belum Anda konfirmasi**.
> (b) bobot `role_type` AI Optimizer + Store Operation tetap Σ=0.

**Sekarang:** `kecepatan_review_am` (skor AM) dan `role_type` AI
Optimizer + Store Operation semua berbobot **0** — lead time-nya sudah
terukur dan terlihat, tapi belum menggerakkan skor siapa pun.

**Pertanyaan:** Berapa bobot `kecepatan_review_am` di profil skor AM?
(Profil AM sekarang: Health 45 / Complaint Resolution Speed 22,5 / Revision
Escalation 22,5 / Weekly-Recap Discipline 10 — total 100.)

**Contoh:** Kalau Kecepatan Review diberi bobot **15%**, profil AM jadi
Health ~38 / Complaint Resolution ~19 / Revision Escalation ~19 /
Weekly-Recap ~9 / Kecepatan Review 15 (proporsional, Σ=100 tetap ditegakkan
server). Efeknya: AM yang Health-nya kuat tapi lambat membuka brief (mis.
rata-rata 2 hari sebelum dibuka) skornya **turun**; AM dengan Health biasa
tapi selalu membuka hari itu juga skornya **naik** — walau perilaku
klien-nya sendiri tidak berubah.

**Rekomendasi:** Mulai dari **10–15%**, mengikuti pola carve RM-9a
sebelumnya (Weekly-Recap Discipline dapat 10% dari redistribusi
proporsional). Angka lebih kecil dari komponen existing (bukan mengambil
porsi besar dari Health) supaya perubahan rangking tim tidak drastis di
gelombang pertama — bisa dinaikkan lagi setelah dilihat sebulan.

---

### LT-2 — Daftar & urutan kerja Store Operation

> ⏳ **MENUNGGU ANDA 2026-08-29** — "akan saya berikan menyusul". Pipeline
> `STORE_OPS` sengaja tetap kosong sampai daftarnya ada. LT-8 (alasan
> pengembalian brief Store Operation) sengaja ditahan agar dijawab bersamanya.

**Sekarang:** Divisi terdaftar, brief bisa didispatch, tapi pipeline
kosong (tanpa tahapan) — sudah disebut tanpa urutan: **Banding
Pelanggaran**, **Setup Promo Toko**, **QC Konten Toko**.

**Pertanyaan:** (a) Urutan ketiganya? (b) Target hari kerja tiap tahap?
(c) Ada tahapan lain yang belum disebut?

**Contoh:** Kalau urutannya `Terima Kasus → Banding Pelanggaran → Setup
Promo Toko → QC Konten Toko → Selesai` dengan target 1 hk tiap tahap
(pola sama Creative), itu **satu migrasi seed** `stage_pipeline` +
`stage_definition` + `sm_edges` — nol kode TS berubah (sudah dibuktikan
Rule 12 di M16).

**Rekomendasi:** Kalau belum ada preferensi kuat, pakai pola Creative (1 hk
per tahap, linear tanpa cabang) sebagai draf pertama — mudah diubah lewat
migrasi susulan begitu ada pengalaman nyata dari tim Store Operation.

---

### LT-3 — Target 14 hk KOL: per-tahap atau gabungan?

> ✅ **DIJAWAB & SELESAI 2026-08-29** — "14 hari kerja hanya untuk follow up
> memastikan video di post, sisanya buat sesuai standar". Terpasang:
> `Follow up Video Creator` **14 hk**, `QC & Approval Video Creator` **1 hk**
> (standar QC internal CDPS). PRD §4.3 + `STATE_MACHINES.md` §18 disesuaikan.

**Sekarang:** `Follow up Video Creator` DAN `QC & Approval Video Creator`
masing-masing target **14 hk** (jadi total bisa sampai 28 hk kalau
keduanya penuh).

**Pertanyaan:** Apakah 14 hk itu untuk **masing-masing** tahap (sekarang),
atau untuk **gabungan** kedua tahap itu?

**Contoh:** Kalau maksudnya gabungan, Creator yang follow-up-nya makan 10
hk hanya tersisa 4 hk untuk QC — beda jauh dari 14 hk penuh per tahap.

**Rekomendasi:** 14 hk untuk QC internal terasa longgar dibanding QC lain
(semua 1 hk) — kemungkinan besar maksudnya **jendela gabungan** menunggu
Creator. Kalau benar, saya rekomendasikan ganti jadi 14 hk gabungan (satu
angka di seed, nol perubahan desain).

---

### LT-4 — Brief yang dikembalikan ke AM: perlu jalur kirim-ulang otomatis?

> ✅ **DIJAWAB & SELESAI 2026-08-29** — "jalankan rekomendasi B". Edge balik
> `Brief Dikembalikan ke AM → Cek Brief AM` terpasang di 4 pipeline, dan yang
> menekan tombolnya adalah **AM pemilik klien** (atau Director), bukan divisi
> yang menolak — itu butuh satu baris `stage_definition` ber-`gate_pihak='AM'`
> di luar edge-nya, kalau tidak justru kebalikannya yang terjadi.

**Sekarang:** `Brief Dikembalikan ke AM` adalah dead-end — begitu masuk
situ, Brief mandek permanen di tahap itu. Divisi tetap bisa menulis alasan
penolakan (`brief_review`), AM tetap bisa lihat kenapa ditolak; hanya
"kirim ulang otomatis ke divisi" yang belum ada.

**Pertanyaan:** Kalau AM memperbaiki Brief yang dikembalikan, alurnya
sekarang gimana secara bisnis? Buat Brief baru? Atau perlu tombol
"kirim ulang" yang membawa Brief yang sama balik ke `Cek Brief AM`?

**Contoh:** (a) AM buat Brief baru dengan referensi ke yang lama (nol kode
tambahan, sudah bisa hari ini). (b) Edge baru `Brief Dikembalikan ke AM →
Cek Brief AM` (satu migrasi `sm_edges`, Brief yang sama dipakai ulang).

**Rekomendasi:** (b) — satu migrasi kecil, dan lebih intuitif bagi AM
daripada harus membuat Brief baru untuk pekerjaan yang sama.

---

### LT-5 — Live Stream sengaja tanpa `Cek Brief AM`?

> ✅ **DIJAWAB & SELESAI 2026-08-29** — "Live Stream buat Cek Brief AM /
> Terima Brief AM (nama baru yg lebih relevan)". Terpasang: checkpoint
> pertama Live tetap `stage_code='Cek Brief AM'` (supaya mesinnya digerakkan
> lewat kontrak `reviewBrief` yang sama, nol kode TS), tapi tampil sebagai
> **"Terima Brief AM"** — kasus pertama label berbeda dari kode (LT-7).
> Edge kirim-ulang LT-4 ikut dipasang untuk Live juga.

**Sekarang:** Live Stream langsung mulai di `Terima Sampel`, tidak pernah
melewati state `Cek Brief AM` — walau PRD menulis gerbang itu "wajib di
semua divisi". `brief_review` (keputusan terima/tolak) tetap bisa diisi
untuk Live Stream, hanya tidak menggerakkan mesin tahapan.

**Pertanyaan:** Ini pengecualian yang disengaja (karena Live dikerjakan
vendor, bukan tim internal), atau kelalaian tabel yang perlu ditambal?

**Contoh:** Kalau perlu ditambal, tinggal tambah state `Cek Brief AM` di
awal pipeline Live (`Cek Brief AM → Terima Sampel → Briefing Klien Live →
Live Start`) — satu migrasi seed, nol kode TS.

**Rekomendasi:** Biarkan seperti sekarang (pengecualian disengaja). Live
dikerjakan vendor lewat tim internal yang menginput datanya (LT-60) —
`Cek Brief AM` di kasus lain adalah keputusan divisi "terima/tolak kerja",
dan itu kurang bermakna untuk sesi vendor yang sudah dijadwalkan lewat
proses booking terpisah.

---

### LT-6 — Konfirmasi arti `gate_pihak='AM'`

> ✅ **DIKONFIRMASI 2026-08-29** — "jalankan rekomendasi" (rekomendasinya
> sendiri murni konfirmasi). Betul: gerbang PERAN, tahap TETAP terhitung
> lead time. Nol kode berubah, didokumentasikan di `STATE_MACHINES.md` §18.

**Sekarang:** `gate_pihak='AM'` diperlakukan sebagai gerbang **peran**
(hanya AM pemilik klien/Director yang boleh menjalankan transisi keluar
dari tahap itu) — bukan pengecualian dari lead time. Contoh: tahap
"Approve" AI Optimizer SKU tetap terhitung lead time-nya walau hanya AM
yang bisa memindahkannya.

**Pertanyaan:** Konfirmasi — betul begitu maksudnya, bukan "tahap ini
tidak dihitung lead time seperti gate KLIEN"?

**Rekomendasi:** Interpretasi konservatif (tetap terukur) sudah dipilih dan
sudah aman — kalau salah, dampaknya cuma under-count (bukan over-count),
jadi ini pertanyaan konfirmasi murni, bukan sesuatu yang perlu diubah
segera kalaupun jawabannya "ya sudah benar".

---

### LT-7 — Label tampil tahap ≠ kode tahap?

> ✅ **DIKONFIRMASI 2026-08-29** — "aman dibiarkan kosmetik". Tetap identik
> di mana pun, kecuali SATU pengecualian yang kini benar-benar memakainya:
> checkpoint intake Live Stream (LT-5), kode `Cek Brief AM` / label
> `Terima Brief AM`.

**Sekarang:** `stage_definition.label` (nama yang tampil di UI) diisi
identik dengan `stage_code` (kode internal) — mis. "Script" tampil sebagai
"Script".

**Pertanyaan:** Ada tahap yang labelnya perlu beda dari kodenya untuk
tampilan ke user (mis. bahasa lebih formal/panjang)?

**Rekomendasi:** Putuskan **sebelum** divisi pertama benar-benar
mengandalkan tahapan (sekarang masih awal) — mengubah `stage_code` setelah
Brief berjalan lebih mahal (migrasi data) daripada mengubah `label` (nol
biaya). Kalau tidak ada kebutuhan sekarang, aman dibiarkan — kosmetik.

---

### LT-8 — Alasan pengembalian brief untuk divisi tanpa daftar terstruktur

**Sekarang:** Live Stream, AI Optimizer, Store Operation memakai satu kode
umum **"Brief kurang jelas"** sebagai alasan penolakan (Creative punya 5
pilihan, KOL punya 2).

**Pertanyaan:** Perlu daftar alasan lebih spesifik untuk ketiga divisi
itu?

**Contoh:** Untuk Store Operation mungkin relevan: "Data pelanggaran tidak
lengkap", "Bukti foto/video tidak ada", dll — mirip pola Creative.

**Rekomendasi:** Tunggu sampai daftar kerja Store Operation (LT-2) selesai
diputuskan — alasan penolakan biasanya mengikuti bentuk pekerjaannya.
Jawab bersamaan dengan LT-2, bukan terpisah.

---

### LT-9 — Perluas skor AM ke portofolio AI Optimizer/Store Operation?

> ✅ **DIJAWAB & SELESAI 2026-08-29** — "Ya perlu diperluas". Portofolio
> `amPortfolioApprovedInPeriod` (dipakai `revision_escalation_rate` DAN
> `kecepatan_review_am`) sekarang mencakup Brief Ads + AI Optimizer + Store
> Operation. KOL dan Live Stream tetap di luar (entitas/mesin berbeda). Ini
> perubahan KODE (bukan migrasi data) — lihat `performance.ts`.

> ⏳ **MASIH MENUNGGU ANDA** — LT-1 sudah dijawab tetapi ini tidak disinggung,
> jadi cakupan portofolio dibiarkan apa adanya. Taruhannya kini lebih besar:
> `kecepatan_review_am` sudah berbobot 10% (bukan 0), jadi memperluas
> portofolio sekarang menggerakkan **dua** komponen skor AM, bukan satu.

**Sekarang:** `kecepatan_review_am` (bobot 0, LT-1) sengaja BELUM
mencakup Brief AI Optimizer/Store Operation, walau keduanya sejak M16
sudah lewat mesin approval yang sama.

**Pertanyaan:** Setelah bobot LT-1 ditetapkan, apakah portofolio yang
dinilai perlu diperluas ke dua divisi baru ini juga?

**Rekomendasi:** Jawab bersamaan dengan LT-1 — memperluas portofolio
mengubah komponen skor AM LAIN (`amRevisionEscalation`, bobot 22,5%
existing) untuk setiap AM yang kliennya punya Brief AI Optimizer/Store
Operation, jadi lebih aman diputuskan sekali bersama angka bobot LT-1,
bukan dua keputusan terpisah di waktu berbeda.

---

### LT-10 — Ads Management Date: kolom + satuan hari

**Sekarang:** Kolom BARU (bukan `end_date` `ADC-` lama), dan hitungannya
pakai **hari KALENDER** (bukan hari kerja seperti lead time M16 lainnya).

**Pertanyaan:** Konfirmasi satuannya — kalender atau hari kerja? (Kalau
salah tebak, perbaikannya butuh migrasi DATA pada `additional_days`/
`end_date` yang sudah terhitung — lebih mahal daripada mengubah sekarang.)

**Contoh:** Iklan hold 3 hari (termasuk 1 akhir pekan) — kalender: End
Date maju 3 hari; hari kerja: End Date maju 2 hari (akhir pekan tidak
dihitung).

**Rekomendasi:** Pertahankan kalender — iklan berjalan 24/7 termasuk
akhir pekan (beda dari kerja tim internal yang memang Sen-Jum), jadi
kalender lebih masuk akal untuk "berapa lama iklan idle".

---

### LT-11 — Routing Permintaan (`REQ-`) selalu ke AM?

**Sekarang:** Ketiga jenis Permintaan (Top-up Saldo, Contract Creator,
Creator Payment Approval) semuanya di-routing default ke AM pemilik
klien.

**Pertanyaan:** Apakah AM tepat untuk semua tiga jenis, atau ada yang
perlu routing berbeda (mis. Contract Creator ke tim legal/procurement)?

**Rekomendasi:** AM selalu punya akses baca/proses kliennya jadi default
ini tidak pernah salah-403 — aman dibiarkan kalau tidak ada kebutuhan
spesifik. Hanya perlu diubah kalau ada tim/role lain yang secara bisnis
harus memproses salah satu jenis Permintaan itu.

---

## 3. Sisa pekerjaan non-keputusan

| # | Isi | Butuh apa | Mendesak? |
|---|---|---|---|
| — | Halaman FE penuh untuk Ads/Permintaan | Implementasi baru — PR #247 baru bawa type declaration wire, belum ada UI | Kalau tim mulai memakai fitur Ads/Permintaan |
| LT-61 | Login vendor sendiri (realm auth eksternal) | 🔴 **Terblokir** — butuh spec keamanan client-portal-style yang belum ditulis | **Jangan mulai** sampai spec itu ada |

**Kalau Anda ditugaskan modul CDPS lain (bukan M16/M17):** dokumen-dokumen
di atas tidak relevan untuk Anda — cek `docs/prd/CDPS_Build_Plan.md` dan
`docs/DECISIONS.md` entri terbaru untuk konteks modul itu.

---

## 4. Jebakan yang sudah ditemukan — jangan diulangi

1. **Jangan jalankan `npx vitest run` dari root repo.** Melewati
   `packages/domain/vitest.config.ts` (`fileParallelism: false`, sengaja
   menyerialkan test karena berbagi satu koneksi Postgres) → ratusan
   false-failure. Pakai `npm run test --workspaces --if-present` dari root,
   atau `cd packages/domain && npx vitest run`.
2. **Menjalankan full suite berkali-kali di DB lokal yang sama (tanpa
   rebuild) menghasilkan flaky palsu** — beberapa test (mis.
   `client.test.ts`, `admin.test.ts`) meng-COUNT baris berdasar ID yang
   dibuat `Date.now() % 100000` per proses; rerun cepat berturut-turut
   bisa collide dengan sisa baris run sebelumnya. Kalau lihat kegagalan
   count-mismatch, `./scripts/db-rebuild.sh --yes` dulu sebelum menyimpulkan
   ada bug — jangan panik duluan.
3. **Sebelum push ke branch designated manapun, `git fetch` dan cek riwayat
   remote lebih dulu.** `git log origin/main` adalah kebenaran, bukan
   asumsi dari chat sebelumnya — migrasi produksi bisa berubah status
   cepat di repo yang aktif seperti ini.
4. **Setelah `apply_migration` ke Supabase live ATAU menemukan drift
   live-only (O61/O62-style), selalu jalankan `mcp__Supabase__get_advisors`
   (security) dan baca `schema_migrations.statements` langsung — jangan
   menerka dari nama migrasi.** O62 sesi sebelumnya salah diagnosis
   ("duplikat") justru karena tidak membaca `statements`-nya sampai tuntas;
   isinya ternyata dua migrasi BERBEDA yang sudah direkonsiliasi migrasi
   lain (O59) yang sudah ada di repo.
5. **Kalau back-port migrasi riwayat live-only, nama berkas HARUS
   version+name persis dari `schema_migrations`** (query
   `select version, name from supabase_migrations.schema_migrations`),
   **BUKAN** timestamp "seharusnya" yang disebut di komentar migrasi asli.
   Salah pilih nama membuat `supabase db push` mengira itu migrasi baru dan
   meng-apply-nya kedua kali dengan version terpisah — persis kelas drift
   yang back-port itu dimaksudkan menutup (lihat
   `20260815094622_harden_job_execute_surface.sql` untuk contoh lengkap).

---

## 5. Kontak/otorisasi

Pemilik: Nerissa (nerissa.arv@meagency.co.id) dan Yohan
(yohanagustian@meagency.co.id, juga akun GitHub yang merge PR #247/#248/#250).
Keduanya berwenang menjawab §2 (`LT-1`..`LT-11`).
