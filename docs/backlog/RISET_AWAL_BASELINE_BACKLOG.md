# Backlog — Riset Awal Baseline Engine + M6B Route Surface

> Dibuat 2026-08-17 dari keputusan pemilik (7 keputusan, `docs/DECISIONS.md` 2026-08-17).
> Handoff: **`docs/handoff/HANDOFF_M6ABC_SESI31.md`** — baca §0 dan §4 sebelum tiket pertama.
> Arsip tool: `docs/design/BASELINE_TOOL_TIKTOK_v1.html` (rujukan port, satu arah).
>
> **Status: nol kode.** Melanjutkan "bagian 2" yang SESI30 §3 tinggalkan.
> Masuk **M6 / Wave 2** — tak ada wave digeser (`CDPS_Build_Plan.md:81-87`).

## 0. Prasyarat & gerbang

- **Migrasi HANYA** lewat `supabase/migrations/**` + `apply_migration`. Jangan `psql -f` (O38).
- Gerbang CI naik: tabel **114 → 118** (`.github/workflows/ci.yml:275` **dan**
  `scripts/db-rebuild.sh:143`). Mesin tetap **23**. Event baru ⇒ versi katalog baru (O55, kini 57).
- `route-parity.test.ts` hijau, **`KNOWN_GAPS` tetap kosong**. Jalur STR- tetap dilayani.
- Dua ketidakpastian diselesaikan **sebelum** RAB-02/RAB-05: lisensi SheetJS, satuan
  `median_6m` vs `B1-5` (handoff §5).

---

## 1. Wave A — Riset awal punya isian

### RAB-01 · Empat tabel + RLS + gerbang CI
Semua `bigint GENERATED ALWAYS AS IDENTITY` (pola `client_platforms`) supaya registry prefix
tidak berubah.

- **`riset_awal_analisa`** — satu baris per **(riset awal × platform)**, di-anchor ke
  `client_platforms` yang `active`: `interview_id` · `platform` · `metode_baseline`
  (`analisa_penuh|analisa_tipis|manual`) · `periode_referensi` · `payload jsonb` ·
  `kondisi_toko` (CHECK **5** nilai) · `skor` · `benchmark_versi` · `parser_versi` ·
  `cakupan_riwayat` · `kelengkapan_file jsonb`.
  - `payload` **immutable** (trigger, aturan rumah #3).
  - CHECK: `metode_baseline='manual'` ⇒ `kondisi_toko='belum_dapat_diukur'` **DAN** `skor IS NULL`.
- **`riset_awal_sumber_berkas`** — `nama_berkas` · `sha256` · `ukuran_bytes` · `tipe_terdeteksi` ·
  `tipe_override` · `jumlah_baris` · `periode` · `tanggal_ambil`. Inilah yang mengisi
  `sumber_data` + `lampiran` M6A secara sah.
- **`interview_riset_awal_isian`** — pola `interview_answer`
  (`20260811030000_interview.sql:230`): baris per field, kolom bertipe, plus `sumber`
  (`analisa|manual|sales`) · `nilai_usulan jsonb` (usulan asli, **immutable**) · `dikonfirmasi`.
- **`riset_awal_benchmark`** — berversi, Director-only.

RLS **cermin `interview_riset_awal`**: scope Account, **Sales tidak melihat** (tes sudah ada di
`interview.rls.test.ts`).

**DoD:** `scripts/db-rebuild.sh` hijau di 118 · tes RLS (Sales melihat verdict, TIDAK melihat
isian/analisa/sumber berkas) · tes immutability (`payload`, `nilai_usulan` tanpa jalur
UPDATE/DELETE) · tes CHECK manual⇒null menggigit di DB.

### RAB-02 · Mesin baseline ke `packages/core/src/baseline/`
`sheet.ts` (baca + deteksi header) · `detect.ts` (12 tanda-tangan) · `metrik.ts` (modul `C.*`) ·
`skor.ts` · `temuan.ts` · `payload.ts`. Rumus pemilik dipindah **apa adanya**. Di core, bukan FE,
supaya bisa dites tanpa DOM — pola `apps/api/scripts/mslseed/{csv,validate,engine}.ts`.

**JANGAN ubah:** `n(v,raw)` (Seller Center titik=ribuan vs Ads Manager titik=desimal) · heuristik
deteksi header · ambang tayangan adaptif · median-bukan-rata-rata + penanda campaign 1,8× ·
guardrail ads-overlap · bobot 5 pilar sadar-cakupan · seluruh string nama kolom.

**Yang diperbaiki (handoff §2.2):**
1. `mul(x,100)` di **semua** situs panggil — `null*100` jadi `0` membatalkan penjagaan null;
   `meter()` mengembalikan `''` untuk null.
2. Pisahkan **"kolom tidak ada"** (⇒ `null`, **gagal keras** kalau wajib, pesan `[...]` menyebut
   kolomnya) dari **"nilainya nol"** (⇒ `0`). Daftar kolom wajib per tipe file.
3. `detect()` ambang toko-vs-afiliasi dari jumlah akun tertaut CDPS, bukan `<=2`.
4. Benchmark jadi **parameter**, bukan global yang bisa diedit browser.

**DoD:** fixture per tipe file **dari export asli** (bagian deliverable, bukan tambahan — ia
pengganti loop browser) · kolom wajib hilang → gagal keras, bukan 0 · pembagian nol → `—` ·
metrik null ⇒ meter **tidak dirender** (tes khusus `refundRate` null) · benchmark+payload sama ⇒
skor identik (aturan rumah #4).

### RAB-03 · `belum_dapat_diukur` + pengaman kosakata
Nilai kelima Kondisi Toko. **Tidak boleh dilebur** dengan `mesin_belum_terbangun`, dan **tidak
boleh** memicu TANTANGAN. Kolom `kondisi_toko` (**bukan** `verdict`).

**DoD:** tes irisan kosakata (enum Blok C ∩ Kondisi Toko = ∅) · tes Kondisi Toko tak pernah
memicu `kualifikasi_tidak_siap` atau gerbang Blok C · tes `belum_dapat_diukur` ⇒ nol TANTANGAN.

### RAB-04 · Halaman riset awal per-platform + konfirmasi per angka
`RisetAwalPanel.tsx`. Sub-bagian **diturunkan dari `client_platforms` aktif** — **jangan buat
tombol pilih platform** (pertanyaan ulang; platform sudah di `qualified_forms.platform`).

- Registry adapter: `TikTok Shop`=`analisa_penuh` · `Tokopedia`=`analisa_tipis` · lainnya=`manual`.
- **Entri manual minimal** (keputusan 5): GMV/bulan · order · AOV · jumlah SKU · belanja iklan ·
  ROAS. Tetap tunduk **Rule 5** (periode + sumber + tanggal ambil).
- SheetJS + font **bundel npm**, bukan CDN.
- **Prefill** identitas + riwayat GMV 6 bulan dari `clients`/`qualified_forms`/riset awal
  sebelumnya. Tanda `campaign`/`belum`/`masalah` tetap milik AM.
- Output **POST**, bukan clipboard/download.
- Submit **memerlukan setiap field berskor terkonfirmasi** (keputusan 1).
- Kirim `null` eksplisit, **jangan** `omitempty`.
- Klien multi-platform: total baseline **wajib membawa penanda** platform mana yang manual.

**DoD:** klien multi-platform ⇒ satu baris `riset_awal_analisa` per platform aktif · baris audit
per penulisan analisa (aturan #3) · waktu dari modul `tz` WIB server, bukan `new Date()` klien.

### RAB-05 · Field yang terisi otomatis
`toko.aov`→`B2-9` · `produk.sku_total`→`B2-3` · `gmv_baseline.median_6m`/`runrate_3m`→baseline GMV ·
`iklan.roas`→baseline ROAS · `arah_strategi`→catatan arah (**bertanda usulan**, bukan sumber kedua
narasi Strategi).

⚠️ **`B3-3` (ruang harga) & `B7-3` (kesiapan akses) TETAP pertanyaan interview** — penilaian
manusia. ⚠️ Pemetaan `median_6m`→`B1-5` **dicek satuannya dulu** (handoff §5.2).

### RAB-06 · Tutup kebocoran provenance skor
`SCORED_FIELD_KEYS` **jangan disentuh** (15 kunci). `hitungKualifikasi` **nol perubahan**.
Yang berubah: `scoreInterview` (`packages/domain/src/interview.ts:747`) + `POST …/score` merakit
`KualifikasiInput` dari **kedua** tabel dan **mengabaikan** nilai kunci riset awal dari body.

**DoD — tes terpenting di seluruh backlog:** fixture Alpha Digital menghasilkan skor + verdict
Blok C **IDENTIK** sebelum/sesudah RAB-05/RAB-06. Plus: `POST …/score` yang mengirim angka berbeda
untuk kunci riset awal **diabaikan**.

### RAB-07 · Gerbang prasyarat (menjawab SESI30 §3 pertanyaan 3)

> ⚠️ Ini **bukan** RA-1. `RA-1` sudah ditutup 2026-08-13 dan isinya **SLA** (riset awal 2–3 hari
> kerja). Yang dijawab di sini adalah pertanyaan terbuka **tak bernomor** di `HANDOFF_M6ABC_SESI30.md`
> §3 no. 3: *"Riset awal jadi prasyarat interview atau tidak? Sekarang tidak memblok apa pun."*

Interview tak bisa dimulai sebelum riset awal disubmit. Gerbang di transisi mesin Interview,
pesan BI `[...]`.

⚠️ **"Selesai" per-platform, bukan per-analisa:** setiap baris `client_platforms` aktif punya
baseline (analisa **atau** manual).

**DoD:** **tes anti-deadlock** — klien Shopee-only menyelesaikan riset awal manual lalu memulai
interview. Tanpa tes ini, mayoritas klien (Shopee 156× vs TikTok 16× di seed) terkunci.

---

## 2. Wave B — Interview berhenti bertanya ulang

### RAB-08 · Dedup pertanyaan
Pintu Interview membaca `clients` + `qualified_forms` + isian riset awal; sembunyikan/tandai
pertanyaan yang sudah terjawab, **dengan tombol "berbeda dari data"**. Hilangkan pengetikan ulang,
**jangan** hilangkan kemampuan mengoreksi.

### RAB-09 · Hidupkan `PREFILL_MAPPING` + `handoffKeStrategi`
Sudah ditulis & diuji (`packages/core/src/interview.ts:1058`) tapi **nol pemanggil produksi**.
Sambungkan ke jalur Interview→Strategi. **Jangan tulis ulang.**

### RAB-10 · Enam seksi belum dibangun
B0, B5, B8–B11 (`interview-fields.ts:161-174`) diselesaikan **atau** dinyatakan sengaja keluar
cakupan di PRD Interview yang baru. Jangan menggantung tanpa status.

---

## 3. Wave C — Baseline mengalir ke Strategi (`STRG-`)

### RAB-11 · Isian → `strategi_channel` + `strategi_baseline_bulan`
Memenuhi CHECK Rule 5 yang **sudah ada** (`20260806064000_m6a_strategi.sql:278-296`):
`periode_baseline_bulan` (1–6) · `periode_mulai/akhir` · `sumber_data` · `tanggal_ambil_data` ·
`lampiran`. **`cakupan_riwayat='kurang'` (<3 bulan) ⇒ `alasan_periode_pendek` wajib.**

**DoD:** baseline <3 bulan tanpa `alasan_periode_pendek` **ditolak DB**.

### RAB-12 · `gmv_mix` disimpan sebagai rincian, BUKAN kanal
⚠️ `gmv_mix` = atribusi di *dalam* satu platform (video afiliasi / LIVE afiliasi / video toko /
LIVE toko / kartu produk). `strategi_channel` = per-marketplace. Memetakan satu ke yang lain
**merusak baseline kanal**. Simpan sebagai rincian di bawah kanal TikTok Shop.

### RAB-13 · Gerbang ACC pakai mesin #15 yang sudah ada
Jangan buat gerbang kedua.

---

## 4. Wave D — M6B dibuka

### RAB-14 · `createPlanRow` + rute
Satu-satunya lubang nyata di M6B. `plan_row` hari ini hanya di-insert di `plan.test.ts` lewat SQL
mentah.

### RAB-15 · Rute untuk fungsi domain M6B yang sudah ada
`generatePlanPeriods` · `submitPlanPeriode` · `approvePlanPeriode` · `returnPlanPeriode` ·
`activatePlanPeriode` · `adjustPlanTarget` · `approveTargetAdjustment` ·
`deriveWeeklyDistribution` · `setWeeklyDistribution` · `recordManualActual` · `fileSengketa` ·
`contractDeficit`.

**Menulis rute, bukan logika.** Pola: `requireActor` → validasi → domain.

⚠️ **12 rute sekaligus = risiko O43.** Badan respons **snake_case lewat
`apps/api/src/lib/wire.ts`**. Route yang mengirim objek domain mentah ⇒ halaman blank walau route
menjawab 200. Kunci HILANG lebih berbahaya daripada null.

**DoD:** tes bentuk wire per rute · `route-parity.test.ts` hijau · `KNOWN_GAPS` kosong.

### RAB-16 · `brief-inherit.ts` + UI satu klik
`packages/domain/src/brief-inherit.ts` — pemetaan `plan_row` → Brief (klien, service, divisi PIC,
kanal, pilar, kuota, satuan, hasil diharapkan, baseline, lampiran sumber) di **satu** tempat.

UI: plan ter-`activate` → semua Brief dibuat sekaligus → AM hanya mengisi **jatuh tempo +
prioritas** di satu daftar (keputusan 3).

### RAB-17 · Jalur STR- tetap dilayani
Sampai UI `web-internal` pindah. 4 Brief yang sudah ada **tetap di tempatnya** — nol migrasi.
Pensiun STR- = entri `DECISIONS.md` tersendiri, **di luar backlog ini**.

---

## 5. Wave E — Dokumen (menyertai Wave A–D di PR yang sama)

### RAB-18 · BUAT `docs/prd/CDPS_Module6_Interview.md`
Modul Interview **tidak punya PRD** — spek tersebar di `DECISIONS.md`, `STATE_MACHINES.md`,
handoff SESI27–31. **Akar drift yang pemilik terus rasakan.** Muat: alur 5 langkah · riset awal
berisian + prasyarat · dedup pertanyaan · 12 seksi berstatus jelas · batas tegas Skor Kondisi Toko
vs verdict Blok C.

### RAB-19 · Koreksi PRD (satu entri `DECISIONS.md` untuk ketiga baris M6A)

| Berkas | Sekarang | Jadi |
|---|---|---|
| `M6A:38` D5 | "Baseline: **mandatory manual numeric entry**" | Angka boleh **dari analisa**; yang wajib = **konfirmasi** AM per angka |
| `M6A:51` D18 | "**Manual entry. No auto-pull** from report engines" | Sumber sah bertambah: **export seller centre yang AM tarik sendiri** (bukan auto-pull API) |
| `M6A:435` OA-9 | "auto-population **explicitly out of scope**" | Masuk cakupan, model usulan→konfirmasi |
| `M6A` Rule 5 | `sumber_data` + `lampiran` wajib | **TIDAK dilonggarkan** — justru akhirnya terpenuhi |
| `M6B_Plan:37` P3 | "AM creates Briefs **manually** (**no auto-Brief**)" | **Satu klik warisi-semua** dari `plan_row` |

Ketiga baris M6A adalah **satu keputusan ditulis di tiga tempat**. Kalau hanya satu dikoreksi, dua
sisanya akan dipakai tiket berikutnya untuk membatalkan pekerjaan ini.

### RAB-20 · Build Plan + dokumen registry
`CDPS_Build_Plan.md:81-87` — tambahkan klaster tiket (Riset Awal Baseline Engine + M6B Route
Surface) di Wave 2 + satu baris **exit criteria** (hari ini berhenti di "Service → Briefs → Tasks",
belum menyebut riset awal). Juga `DATA_MODEL.md` (4 tabel) · `STATE_MACHINES.md` §6f (gerbang
prasyarat).

---

## 6. Yang TIDAK dikerjakan

- **Mesin analisa Shopee & Lazada** — sistem serupa dibangun **lebih dulu** (arahan pemilik);
  butuh export contoh Shopee, peta kolom tak boleh ditebak. Di backlog ini hanya **entri manual
  minimal** + **registry adapter** supaya menambah mesin Shopee = memasang adapter. **Tiket
  perluasan field manual saat mesin Shopee jadi didaftarkan di PRD Interview (RAB-18).**
- **Pensiun STR-** — butuh UI pindah + entri `DECISIONS.md` tersendiri.
- **Perbandingan skor lintas platform** — selama Shopee manual, Skor Kondisi Toko hanya ada untuk
  TikTok Shop. Jangan bangun rata-rata/peringkat lintas platform di atas data setengah manual.
- **Pengarsipan biner file asli** — butuh Supabase Storage (belum dikonfigurasi) + keputusan
  tersendiri. Yang disimpan: `sha256` + payload terstruktur.
