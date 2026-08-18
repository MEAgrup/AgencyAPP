# HANDOFF — "Kelola Klien": **kolom isian Riset Awal + mesin baseline dari export** — Sesi 31

> Rantai: … → SESI29 (prasyarat bagian 2) → SESI30 (pengukuran waktu riset awal + SLA 3 langkah)
> → **SESI31 (ini, terbaru)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI31 mengerjakan **"bagian 2" yang SESI30 §3 tinggalkan** (kolom isian Riset Awal) — tapi
> cakupannya jauh lebih besar daripada yang SESI30 duga, karena pemilik memberi **tool analisa
> export seller centre** yang sudah jalan, dan memutuskan **entitas strategi = `STRG-` + M6B**.
>
> **Status: SPEC + KEPUTUSAN LENGKAP, nol kode.** Semua keputusan pemilik sudah diambil
> (§1). Implementasi belum dimulai. Mulai dari §3 Wave A1.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/store-management-svc-analysis-29yig4` (dari `main` @ `210ba4a`, "QA(M6 §4 / M6A): halaman banding jalur STR- vs STRG-") |
| **Mulai kerja berikut** | Kalau branch ini SUDAH merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. Kalau BELUM: lanjut di branch ini. JANGAN menumpuk di atas history yang sudah merge. |

### 0.1 Alur yang pemilik tetapkan (5 langkah)

1. Klien masuk → dikelola tim Account Service
2. **Riset awal** — AM menarik export seller centre lewat tool baseline; sebagian kolom riset awal
   **terisi otomatis**
3. **Interview** — AM menjadwalkan, menanyakan **hanya yang tidak ada di data klien**
4. **Strategi** — AM menyusun, perlu **ACC Head/SPV**
5. **Brief** — **satu klik**: strategi diwarisi jadi Brief ke divisi terkait, AM isi sisanya

### 0.2 Aturan main yang pemilik tetapkan — PENTING

> **PRD boleh salah dan ikut dikoreksi.** Kalau PRD bentrok dengan logika di atas, PRD-nya yang
> salah menuliskan maksudnya. Yang menang adalah **logika dan sistem terakhir yang pemilik
> berikan.**

Konsekuensi: aturan `CLAUDE.md` *"kalau kode dan PRD berbeda, PRD yang menang"* **TIDAK berlaku**
untuk kelima titik di §3 Wave E. Di situ PRD **dikoreksi** lewat entri `DECISIONS.md`. Jangan
berhenti dengan alasan "PRD melarang", dan jangan mencari jalan memutarinya.

### 0.3 Penyakit yang diobati

**Baseline klien ditangkap berulang dan tidak pernah mengalir.** Bukti hidup di DB:
19 sesi Kelola Klien, **4 riset awal selesai, 1 interview**; `strategi`/`contracts`/`plan`
**0 baris**; 4 Brief semuanya lahir manual.

| Fase | Keadaan | Bukti |
|---|---|---|
| Riset awal | **Nol kolom isian** — hanya stopwatch | `RisetAwalPanel.tsx` nol `<input>`; `POST …/riset-awal` tak membaca body |
| Isian riset awal | Tabel `interview_riset_awal_isian` **hanya ada di komentar** | `20260812100000_interview_riset_awal.sql:16` |
| Interview | 18 field; **6 dari 12 seksi belum dibangun** (B0, B5, B8–B11) | `web-internal/src/lib/interview-fields.ts:161-174` |
| Tanya ganda | GMV/target/budget/kategori/toko **ditanya 3×** | `clients`, `qualified_forms:8-24`, `strategi_baseline_bulan` |
| Interview→Strategi | `PREFILL_MAPPING` + `handoffKeStrategi` **ada tapi nol pemanggil produksi** | pemanggil hanya `interview.test.ts`; `packages/core/src/interview.ts:1058` |
| Strategi→Brief | **Tidak ada auto-Brief** | `prefillBriefFromTask`, `web-internal/.../services/[id]/page.tsx:355` |

---

## 1. Keputusan pemilik — sudah final, JANGAN ditanyakan ulang

| # | Keputusan | Konsekuensi |
|---|---|---|
| 1 | Angka hasil analisa = **usulan; AM konfirmasi per angka** | Yang tercatat = hasil konfirmasi. Bug parser tak bisa menggeser verdict tanpa manusia menyetujui |
| 2 | **Riset awal wajib** sebelum Interview | Menjawab pertanyaan terbuka **tak bernomor** di SESI30 §3 no. 3. ⚠️ **Bukan `RA-1`** — RA-1 sudah ditutup 2026-08-13 dan isinya **SLA** (2–3 hari kerja) |
| 3 | Brief = **satu klik, warisi semua** | AM hanya isi jatuh tempo + prioritas |
| 4 | **Port langsung**, tanpa ronde perbaikan HTML | 15 temuan diberesi di CDPS satu jalan, dengan tes |
| 5 | Platform tanpa mesin analisa → **entri manual minimal** | GMV/bulan · order · AOV · jumlah SKU · belanja iklan · ROAS. Perluasan **terdaftar di PRD** |
| 6 | **Entitas = `STRG-` (`strategi`) + M6B (`plan`)** | Rutenya yang ditulis. STR- tidak dipensiunkan di sesi ini |
| 7 | Label temuan tool = **TANTANGAN** | Blok C tetap memegang HAMBATAN MENDASAR |

---

## 2. Yang sudah diverifikasi — jangan investigasi ulang

### 2.1 Tool baseline pemilik (arsip: `docs/design/BASELINE_TOOL_TIKTOK_v1.html`)

HTML mandiri + SheetJS, **hanya TikTok Shop** (+ Tokopedia tipis). Sudah memuat hal-hal yang
**tidak boleh ditulis ulang** karena benar dan mudah rusak:

- `n(v,raw)` — Seller Center mengirim string `"Rp10.945.407"` (titik = **ribuan**), Ads Manager
  mengirim float `335164.77` (titik = **desimal**). Dibedakan lewat flag `raw`.
- Heuristik deteksi baris header — menangani header kedua ("Data harian") dan baris filter
  `"Semua","Semua",…` lewat hitungan **label unik**.
- Ambang tayangan adaptif (median VV video yang terbukti jual), membuang baris sisa histori.
- **Median, bukan rata-rata**, sebagai jangkar baseline + penanda campaign 1,8×.
- Guardrail *"pendapatan iklan tumpang tindih dengan GMV, jangan dijumlah"* — sejajar dengan
  guardrail single-source GMV M6D (RM-3).
- Bobot 5 pilar **sadar-cakupan** (pilar tanpa data → `null`, bobot dinormalisasi ulang).
- 12 tanda-tangan tipe file + seluruh string nama kolom.

Revisi kedua pemilik sudah membenahi: `div`→`null` + `—` di semua formatter · format rumah
`Rp. 10.945.407,00` · `rpS()` disisakan hanya untuk label grafik · verdict & level temuan diganti ·
`cakupan_riwayat` · cek konsistensi periode · duplikat tipe file pakai tombol pilih ·
`prod_tp`/`aff_pr` diberi badge "diterima, belum dipakai" · pesan `[...]` menyebut kolom kunci.

### 2.2 Sisa yang HARUS dibereskan saat porting

| # | Masalah | Perbaikan |
|---|---|---|
| 1 | **`null * 100` jadi `0`, membatalkan penjagaan null.** `mul()` sudah ada dan dipakai di `score()`, tapi `render()` masih `meter('Refund rate…', T.refundRate*100, …)`. `meter` menguji `val==null` sementara `null*100` sudah `0` ⇒ toko tanpa GMV menampilkan **refund 0% bar hijau "ok"**. Idem `t.ctorMed*100`, `A.rateAktif*100`, `A.top5Share*100`, `P.rate*100` | Semua situs panggil pakai `mul(x,100)`; `meter()` mengembalikan `''` untuk null |
| 2 | **`n()` mengembalikan `0` untuk kolom kosong/hilang.** Satu kolom TikTok berganti nama ⇒ `g('GMV dari LIVE akun tertaut')`=0 ⇒ memicu TANTANGAN *"LIVE toko jalan … GMV Rp. 0,00"* | Pisahkan **"kolom tidak ada"** (⇒ `null`, **gagal keras** kalau wajib) dari **"nilainya nol"** (⇒ `0`). Daftar kolom wajib per tipe file |
| 3 | `detect()` toko-vs-afiliasi pakai ambang `u.size<=2` | Pakai jumlah akun tertaut yang tercatat CDPS; ambigu ⇒ konfirmasi AM |
| 4 | **Benchmark bisa diedit AM di browser** (16 angka `BENCH`) ⇒ skor tak bisa dihitung ulang, melanggar aturan rumah #4 | Tabel benchmark **berversi**, Director-only; hasil menyimpan `benchmark_versi`. Preseden: `configVersion` di `persistKualifikasi`, `perf_period_targets` M14 |
| 5 | `new Date()` klien | Modul `tz` repo, WIB, sumber waktu server |
| 6 | SheetJS + font dari CDN | Bundel npm. **Lisensi build SheetJS diperiksa dulu** — belum diverifikasi (§5) |
| 7 | Identitas & riwayat GMV diketik AM | Prefill dari `clients`/`qualified_forms`/riset awal sebelumnya |
| 8 | Output berhenti di clipboard | POST ke CDPS |
| 9 | Nol baris audit | Audit row per aturan rumah #3 |

### 2.3 ⛔ Tabrakan kosakata — sudah dipetakan, penyelesaiannya WAJIB diikuti

Tool mengukur **kondisi toko**; Blok C (`hitungKualifikasi`) mengukur **kualifikasi klien**.
Verdict-nya nyaris bertabrakan (`packages/core/src/interview.ts:377-382`), dan `HAMBATAN`
(`:400-405`) juga.

**Contoh nyata:** GMV turun 14%, refund 6,2%, LIVE toko 3 sesi, top-5 kreator 71% ⇒ Kondisi Toko
≈38. Klien yang sama: margin 32%, produsen sendiri, rasio target 1,46×, daya tahan budget 6 bulan
⇒ Blok C ≈82 `growth_ready`. **Dua-duanya benar** — tokonya bermasalah, kliennya layak; justru itu
klien ideal MEA.

| | Blok C — **TIDAK disentuh** | Skor Kondisi Toko |
|---|---|---|
| Verdict | `growth_ready` · `bersyarat` · `risiko_tinggi` · `tidak_siap` | `mesin_jalan` · `mesin_sebagian` · `fondasi_perlu_dibenahi` · `mesin_belum_terbangun` · **`belum_dapat_diukur`** |
| Label masalah | **HAMBATAN MENDASAR** (4 kode tetap) | **TANTANGAN** · PERHATIAN · CATATAN · MODAL |
| Kualitas data | `KUALITAS_DATA` | `cakupan_riwayat` |

⚠️ **`belum_dapat_diukur` wajib ada dan tidak boleh dilebur.** `mesin_belum_terbangun` = "analisa
jalan, toko memang lemah". `belum_dapat_diukur` = "belum ada mesin analisa untuk platform ini".
Menyamakannya **memfitnah klien Shopee yang tokonya sehat**. Ia **tidak boleh** memicu TANTANGAN.

**Tiga pengaman permanen:** kolom `kondisi_toko` (**bukan** `verdict`) dengan CHECK 5 nilai ·
**tes irisan kosakata** (kedua enum tak beririsan ⇒ CI merah) · tes bahwa Kondisi Toko **tidak
pernah** memicu `kualifikasi_tidak_siap` atau gerbang Blok C.

### 2.4 Riset awal adalah **per-platform**; platform sudah diketahui

**Jangan buat tombol pilih platform** — itu pertanyaan ulang. Sudah tercatat:
`qualified_forms.platform` (+ `toko`, `link_toko`, `20260722055205_qualified_forms.sql:12-19`) dan
tabel **`client_platforms`** (`client_id` · `platform` · `store_link` · `managed_since` · `active`,
**banyak baris per klien**, `20260722053923_wave1_money_path.sql:120`).

Riset awal **menurunkan** sub-bagiannya dari baris `client_platforms` yang `active` — sejajar
dengan M6A D4 (satu sub-blok per kanal kontrak).

⚠️ **Bukan kasus pinggiran:** di seed & test `'Shopee'` muncul **156×**, `'TikTok Shop'` **16×**.
Analisa yang cuma TikTok meninggalkan mayoritas klien; digabung gerbang riset-awal-wajib,
**mayoritas klien terkunci**. **Entri manual wajib ada.**

| Platform | `metode_baseline` | Skor Kondisi Toko |
|---|---|---|
| `TikTok Shop` | `analisa_penuh` | dihitung, 5 pilar |
| `Tokopedia` | `analisa_tipis` (`C.tp`, 4 metrik) | `belum_dapat_diukur` |
| `Shopee` · `Lazada` · `Website` · lainnya | `manual` | `belum_dapat_diukur` |

### 2.5 Kenapa `STRG-` + M6B, bukan `STR-`

| | **STR-** (`strategy_plans`, `20260722055421`) | **STRG-** (`strategi`) + M6B (`plan`) |
|---|---|---|
| Model target | `objective` · `target_kpi` · `planned_brief_outline` — **teks bebas** | terstruktur: per-kanal, per-bulan, per-minggu |
| Baseline | **tidak ada tempat sama sekali** | `strategi_channel` + `strategi_baseline_bulan` |
| Multi-kanal | tidak — `UNIQUE (service_id)` | ya (M6A D4) |
| ACC | ada (`approved_by`, `status`, `revision_notes`) | lebih kaya: submit → approve → return → activate |
| Logika domain | tipis | **~25 fungsi** di `packages/domain/src/plan.ts`: `adjustPlanTarget`, `deriveWeeklyDistribution`, `recordManualActual`, `fileSengketa`, `contractDeficit` |
| Permukaan HTTP | ada | **1 rute** (`plan/[id]/rekap-rollup`) dari ~25 fungsi |
| Brief fan-out | jalan (4 Brief) | belum ada jalur |

**M6B bukan kurang lengkap — ia yang paling lengkap logikanya. Yang hilang cuma rute.**
`plan_row` hanya pernah di-insert di `plan.test.ts` lewat SQL mentah — tak ada `createPlanRow`.

Biayanya asimetris: STRG- = **menulis rute untuk logika yang sudah ada**. STR- = **membuang
struktur baseline** (karena `target_kpi` satu kolom teks), dan Brief yang mewarisi dari STR- hanya
mewarisi **teks** — versi lemah dari langkah 5 pemilik.

**Kecocokan yang rapi:** `strategi_channel` sudah menuntut persis apa yang tool hasilkan —
`periode_baseline_bulan` (1–6), `periode_mulai/akhir`, `sumber_data`, `tanggal_ambil_data`,
`lampiran`, dan `alasan_periode_pendek` yang **wajib kalau <3 bulan**, sementara tool sudah
menandai `cakupan_riwayat='kurang'` tepat di kondisi itu
(`20260806064000_m6a_strategi.sql:278-296`). Fitur ini **tidak melawan Rule 5 — ia yang pertama
benar-benar memenuhinya.**

---

## 3. Rencana kerja

Tiket per wave: **`docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md`**.

- **Wave A** — riset awal punya isian; mesin baseline masuk `packages/core/src/baseline/`;
  gerbang prasyarat; tutup kebocoran provenance skor.
- **Wave B** — Interview berhenti menanyakan yang sudah diketahui; hidupkan `PREFILL_MAPPING`.
- **Wave C** — baseline mengalir ke `strategi_channel` + `strategi_baseline_bulan`.
- **Wave D** — M6B dibuka: `createPlanRow` + rute untuk ~12 fungsi domain + Brief satu klik.
- **Wave E** — dokumen dikoreksi, **menyertai Wave A–D di PR yang sama** (jangan sesudahnya —
  supaya tak pernah ada jendela di mana teks dan kode bertentangan).

---

## 4. Jebakan yang sudah dipetakan — abaikan ini dan pekerjaannya rusak

1. **Gerbang prasyarat + analisa TikTok-only = deadlock.** "Riset awal selesai" harus berarti
   **setiap baris `client_platforms` aktif punya baseline** (analisa **atau** manual). Kalau
   diartikan "analisa sudah jalan", klien Shopee-only terkunci permanen — dan Shopee mayoritas.
   **Tes anti-deadlock wajib.**
2. **`gmv_mix` BUKAN baseline per-kanal.** Ia atribusi di *dalam* satu platform (video afiliasi /
   LIVE afiliasi / video toko / LIVE toko / kartu produk); `strategi_channel` per-marketplace.
   Memetakan satu ke yang lain merusak baseline kanal. Simpan sebagai rincian di bawah kanal
   TikTok Shop.
3. **Enam field paling layak dibaca dari export justru BERSKOR** (`B1-5`, `B2-9`, `B2-3`, `B4-9`,
   `B3-3`, `B7-3` di `SCORED_FIELD_KEYS`, `packages/core/src/interview.ts:454-470`).
   `SCORED_FIELD_KEYS` **jangan disentuh**; `hitungKualifikasi` **nol perubahan** (sudah
   storage-agnostic — menerima `KualifikasiInput`, bukan baris jawaban). **Tes anti-regresi
   terpenting: fixture Alpha Digital menghasilkan skor + verdict Blok C IDENTIK sebelum/sesudah.**
4. **Kebocoran provenance.** `scoreInterview` (`packages/domain/src/interview.ts:747`) +
   `POST …/score` menerima `KualifikasiInput` dari klien apa adanya. Server harus merakit sendiri
   dari **kedua** tabel dan **mengabaikan** nilai kunci riset awal dari body.
5. **`B3-3` (ruang harga) dan `B7-3` (kesiapan akses) TETAP pertanyaan interview** — penilaian
   manusia, tak ada di spreadsheet mana pun.
6. **12 rute baru sekaligus = risiko O43.** Badan respons wajib snake_case lewat
   `apps/api/src/lib/wire.ts`. Route yang mengirim objek domain mentah ⇒ halaman blank walau
   route menjawab 200. Kunci HILANG lebih berbahaya daripada null — kirim `null` eksplisit.
7. **Jangan matikan jalur STR-** sebelum UI `web-internal` pindah. `route-parity.test.ts` menuntut
   setiap path yang dipanggil FE dilayani `apps/api`, dan **`KNOWN_GAPS` harus tetap kosong**.
   4 Brief yang sudah ada **tetap di tempatnya** — Brief entitas sendiri begitu lahir, nol migrasi.
8. **Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`.** Jangan `psql -f` (asal
   drift O38). DB lokal dibangun ulang HANYA lewat `scripts/db-rebuild.sh`.
9. **Gerbang CI:** tabel **114 → 118** — update `.github/workflows/ci.yml:275` **dan**
   `scripts/db-rebuild.sh:143`. Mesin tetap **23**. Event baru ⇒ **wajib versi katalog baru**
   (O55, sekarang **57**); jangan menulis literal.

---

## 5. Yang BELUM pasti — selesaikan di awal, jangan ditebak

1. **Lisensi build SheetJS** yang akan ditambahkan sebagai dependensi npm. Tool memakai
   `xlsx 0.18.5` dari cdnjs. **Belum diverifikasi** — periksa sebelum menambahkannya, jangan
   menyatakan statusnya tanpa memeriksa.
2. **Satuan `median_6m` vs `B1-5`.** Tool memberi median **6 bulan** dan run-rate **3 bulan**;
   `B1-5` minta **omzet 3 bulan**, dan ia dipakai sebagai denominator C-A1 + input C-E1. Salah
   pilih ⇒ verdict bergeser. Baca definisi `B1-5` di `interview-fields.ts` dan pemakaiannya di
   `hitungKualifikasi` sebelum memetakan.

---

## 6. Sumber kebenaran

- **Backlog tiket:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md`
- **Arsip tool (rujukan port, satu arah — JANGAN dipelihara paralel):**
  `docs/design/BASELINE_TOOL_TIKTOK_v1.html`
- `docs/DECISIONS.md` — entri 2026-08-17 (7 keputusan pemilik sesi ini). ⚠️ `RA-1` **sudah**
  ditutup 2026-08-13 (SLA) — jangan bingung dengan gerbang prasyarat di RAB-07
- `docs/prd/CDPS_Module6A_Strategi.md` §38/§51/§435 (dikoreksi di Wave E) ·
  `CDPS_Module6B_Plan.md:37` (P3, dikoreksi) · `CDPS_Build_Plan.md:81-87` (Wave 2)
- **`docs/prd/CDPS_Module6_Interview.md` — BELUM ADA, dibuat di Wave E.** Modul Interview tidak
  punya PRD; speknya tersebar di `DECISIONS.md` + handoff SESI27–31. **Ini akar drift yang
  pemilik terus rasakan.**
- `packages/core/src/interview.ts` — `VERDICT:377` · `HAMBATAN:400` · `SCORED_FIELD_KEYS:454` ·
  `PREFILL_MAPPING:1058` · `hitungKualifikasi:896`
- `packages/domain/src/plan.ts` — ~25 fungsi M6B · `packages/domain/src/interview.ts:747`
  (`scoreInterview`)
- `CLAUDE.md` aturan rumah #1 (ID) · #2 (mesin) · #3 (riwayat immutable) · #4 (field terhitung
  recompute-from-log) · #5 (pesan BI `[...]`) · #6 (izin) · #7 (IDR + `—`)
