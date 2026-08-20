# HANDOFF — QA Strategi (form pembuatan Strategi) **Fase 1 MERGE (PR #200)** → **Fase 2: restrukturisasi** — Sesi 41

> Rantai: … → SESI40 (RAB-19/20, PR #180 — MERGE) → **SESI41 (ini, terbaru — QA Strategi Fase 1, PR #200 — MERGE).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK & KEPUTUSAN inti** (jangan tanya ulang).
>
> **Status: Fase 1 (bug/blocker) SELESAI & MERGE ke `main`. Fase 2 (restrukturisasi) BELUM dimulai — menunggu 1 input pemilik (contoh HTML export platform).**

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/elegant-pasteur-oecv7n` (**sudah di-merge lewat PR #200 → JANGAN dipakai lagi**). |
| **PR sesi ini** | **#200 — MERGED (squash)** ke `main` sebagai `2985e93`. |
| **Base untuk Fase 2** | `main` setelah #200. **Restart branch dari `main`** (`git fetch origin main && git checkout -B <branch-baru> origin/main`). PR #200 sudah selesai — jangan menumpuk commit di atas history yang sudah ter-merge. |

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`. **Jangan `psql -f`.**
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case HANYA lewat `apps/api/src/lib/wire.ts` (`*ToWire`). Kirim `null` eksplisit, jangan `omitempty` (kelas bug O43).
- **Rute = shell**: `requireActor` → validasi/map body → domain. Jangan taruh logika di rute.
- Setiap wire interface yang dibaca `web-internal` wajib dipasangkan di `shape-parity.test.ts` **dan** `route-parity.test.ts` `KNOWN_GAPS` **tetap kosong**.
- **`gate-reachability.test.ts`**: tiap kode gerbang yang di-emit `checkCompleteness` wajib punya baris `DOORS`, dan sebaliknya (tidak boleh baris usang). Kalau menambah/menghapus gerbang, sinkronkan file ini.
- Setiap deviasi PRD = satu baris `docs/DECISIONS.md` (tanggal, keputusan, alasan, disetujui).

### 0.2 Setup DB lokal + install deps (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install                          # root workspaces (apps/* + packages/*)
cd web-internal && npm install       # web-internal app Next MANDIRI — install terpisah
```
⚠️ Tanpa `DATABASE_URL`, tes domain `describeDb` di-SKIP (di sesi 41 mereka di-skip; gerbang divalidasi via `gate-reachability.test.ts` statis + CI). Untuk kerja Fase 2 yang menyentuh gerbang/skema, **jalankan DB lokal** supaya `packages/domain/src/strategi.test.ts` benar-benar jalan.

Perintah cek cepat yang dipakai sesi ini:
```
cd web-internal && npx tsc --noEmit && npx vitest run       # 265 tes hijau
cd /home/user/AgencyAPP && npm run typecheck                # api/core/db/domain
cd apps/api && npx vitest run src/lib/gate-reachability.test.ts src/lib/shape-parity.test.ts src/lib/route-parity.test.ts src/lib/body-parity.test.ts
```

---

## 1. Konteks: temuan QA pemilik & keputusan urutan kerja

Sumber: QA pemilik (`management@smarketing.id`) di halaman pembuatan Strategi `STRG-202608-0001`
(`/account/strategi/STRG-202608-0001`, kontrak `CTR-202608-0001`). Pemilik memilih **"bug dulu, baru restrukturisasi"**.

**Keputusan pemilik yang sudah dikonfirmasi (via pertanyaan sesi 41 — jangan tanya ulang):**
1. **Urutan:** bug/blocker dulu (Fase 1, SELESAI di PR #200), restrukturisasi menyusul (Fase 2).
2. **Section A → Interview: PENUH.** A-1/A-5/A-10/A-14 dipindah jadi bagian modul **Interview**; Strategi menariknya **read-only**; gerbang A yang dipindah **dicabut** dari Strategi. Brand/kategori & decision-maker di-prefill dari data **sales/klien**; A-9 jadi **target terukur**.
3. **Baseline Section B "tarik dari HTML platform": SUDAH SIAP di sisi pemilik** — pemilik akan **memberikan contoh format HTML export platform**. Bangun importer-nya; input channel manual **tetap** sebagai fallback (sudah ada sejak Fase 1).
4. **Target Section D:** **melengkapi/menyederhanakan** (BUKAN ganti total) — tampilkan metrik angka jelas, usulkan pemetaan ke struktur `strategi_target` yang ada dulu.

---

## 2. Yang SUDAH selesai sesi ini (Fase 1 — PR #200, jangan ulang)

Berkas: `web-internal/src/components/strategi/{SectionA,SectionB}.tsx`,
`web-internal/src/app/(shell)/account/strategi/[id]/page.tsx`,
`packages/domain/src/strategi.ts`, `apps/api/src/lib/gate-reachability.test.ts`, `docs/DECISIONS.md`
(baris **2026-08-20 "QA Strategi Fase 1"** di puncak tabel Decided).

1. **Section B kini bisa diisi (blocker utama).** Akar masalah — dikonfirmasi dari DB live: `createStrategi`
   **tidak** men-seed `strategi_channel`, **tidak ada** tabel channel di level kontrak/service, dan `SectionB`
   dulu hanya me-render `detail.channels` **tanpa tombol tambah** → Strategi baru mustahil punya channel →
   memblokir C & D (gerbang per-channel) & A-15. **Fix:** `draft` jadi sumber kebenaran channel; tombol
   **Tambah channel / Hapus channel** di `SectionB`. Nol perubahan skema (`saveChannels` sudah DELETE+INSERT
   dari daftar). Prop `detail` dilepas dari `SectionB` (tidak lagi dipakai).
2. **A-7 (plafon unit/bulan) dipensiun.** Pemilik: "hapus pencatatan plafon". Field hilang dari UI `SectionA`
   + konverter draft; check `A-7` dicabut dari `checkCompleteness` + baris `DOORS`-nya. Kolom
   `strategi.plafon_unit_per_bulan` **tetap ada** (nullable) untuk baris lama; form mengirim `null` → nilai lama
   terhapus di save berikutnya. **Tanpa migrasi.** (Field domain/wire `plafonUnitPerBulan` sengaja dibiarkan
   demi backward-compat & agar `shape-parity`/tes domain lama tak berubah.)
3. **"Isi hilang saat pindah tab" — anti-clobber autosave.** `page.tsx` menambah ref `editGen` (naik tiap
   `patch`). `saveActive` snapshot `editGen` sebelum await; echo server (`setDrafts(draftsOf(next))`) +
   `setDirty(false)` **hanya** dijalankan bila `editGen` tak bergerak selama save. Kalau AM mengetik saat save
   in-flight, draft mereka dipertahankan & `dirty` tetap true (autosave berikutnya menyimpannya).
4. **"Kurang padahal terisi" — urutan save Section D.** `saveStrategiKpi` (D-5 definisi berhasil, D-6 leading
   indicator; field header, independen) dipindah ke **awal** cabang D, sebelum rantai target→asumsi yang bisa
   melempar error saat matriks setengah terisi (dulu KPI terakhir → ikut gagal & D-5/D-6 tak pernah tersimpan).

**Catatan penting soal "kurang padahal terisi":** sebagian gap yang pemilik lihat memang **NYATA** di DB
(`STRG-202608-0001`: `decision_maker`, `definisi_berhasil_30/60/90`, `leading_indicator`, `skenario_mundur`
kosong; 0 channel). Fase 1 memperbaiki bug persistensi + membuka Section B; sisanya diselesaikan Fase 2
(prefill A-12 dari sales, dsb.).

---

## 3. Fase 2 — yang HARUS dikerjakan berikutnya (belum mulai)

> Pecah jadi PR-PR kecil per klaster (jangan satu mega-PR). Tiap deviasi PRD → baris `DECISIONS.md`.
> Baca PRD dulu: `docs/prd/CDPS_Module6A_Strategi.md` (§4 Section A–J), `docs/DATA_MODEL.md`,
> `docs/STATE_MACHINES.md` (mesin #15 Strategi), dan modul Interview
> (`packages/domain/src/interview.ts`, `web-internal/src/app/(shell)/account/interview/[id]/page.tsx`).

### 3.A Section A → Interview (PENUH) + prefill dari sales/klien
Permintaan pemilik (verbatim, diringkas):
- **A-1 Brand & Kategori** → pindah ke Interview. **Kategori** = pakai kategori yang diisi **sales saat klien daftar** (jangan ketik ulang).
- **A-2/A-4 Model bisnis & posisi harga** → sudah ada di Interview (dedup, jangan double).
- **A-3 Ruang margin** → internal saja (biarkan).
- **A-5 USP (min 3)** → pindah ke Interview.
- **A-6/A-7 Kapasitas stok & plafon** → gabung ke Interview bagian **fulfillment**. (Plafon sudah dihapus di Fase 1.)
- **A-8 Titik kirim** → (klarifikasi: kemungkinan tetap / ke fulfillment).
- **A-9 Ekspektasi klien** → jadikan **target terukur**: GMV, ROAS, Total view.
- **A-10 Riwayat agensi (hard-internal)** → pindah ke Interview.
- **A-12 Decision maker** → pakai data yang diisi **sales saat mengisi klien** (jangan ketik ulang).
- **A-14 Aset dari klien** → pindahkan semua ke **log Interview**.

**Implikasi teknis (WAJIB dipetakan sebelum coding):**
- Field yang dipindah ke Interview harus (a) ditangkap modul Interview, (b) ditarik read-only ke Strategi via
  jalur prefill yang **sudah ada**: `getStrategiPrefill` / `InterviewPrefillPanel` (advisory) atau pola
  "warisi yang bersumber" seperti `getBaselinePrefill`/`mergeBaselinePrefill` (RAB-19). Lihat DECISIONS 2026-08-20
  (baris "warisi yang bersumber saja") untuk polanya.
- Gerbang A yang dipindah harus **dicabut** dari `checkCompleteness` **dan** baris `DOORS`-nya di
  `gate-reachability.test.ts` (kalau tidak, submit jadi tak bisa lolos dari UI). Cek juga CHECK/trigger DB
  di `supabase/migrations/20260806065000_m6a_section_a.sql` — jangan sampai ada NOT NULL yang menabrak.
- **Prefill A-1 kategori & A-12 decision maker dari sales/klien:** telusuri sumbernya — tabel `clients` /
  data intake sales (lead → client). Perlu jalur baca (wire) klien→Strategi. Ini yang menutup gap "A-12 kosong".

### 3.B Section B baseline dari **HTML export platform** — **MENUNGGU INPUT PEMILIK** (lihat §4)
- Bangun importer yang mem-parse HTML export platform (Shopee/TikTok/Tokopedia Seller Center) jadi baseline
  B-0.7/B-1 (dan sebisanya B-2…B-9). Model **usulan → konfirmasi AM per angka** (RAB-19: sumber sah termasuk
  "export seller-centre yang AM tarik sendiri"; **tetap tanpa auto-pull API**).
- Input channel manual (Fase 1) tetap jadi fallback. Nilai hasil import tetap disimpan via save Section B biasa
  supaya Rule 5 + `ck_strch_eksisting` + gerbang `B-1` terpenuhi.
- **Tak bisa mulai sebelum ada contoh format HTML** — lihat §4.

### 3.C Section D — metrik angka jelas (MELENGKAPI, bukan ganti)
Metrik yang diminta pemilik: **GMV, Pengunjung, Conversion rate, AOV, ROAS minimum, ACOS maksimum, SKU winner
baru, Affiliate aktif, Jam live, Jumlah video.** Petakan ke struktur `strategi_target` yang ada (metric enum +
`nilai_floor`/`nilai_stretch`, per channel/bulan) — **usulkan pemetaan di `DECISIONS.md` dulu**, jangan buang
matriks D-2/D-4 yang ada. Vocab metric saat ini: lihat `strategi_target` (mis. `gmv`, `cr`, dst.) di
`packages/domain/src/strategi.ts` (fungsi `saveTargets`/`gmvCellsToBody`/`supportRowsToBody`) & `SectionD.tsx`.

### 3.D Buang E-11 & E-12 dari syarat pengajuan
- **E-11** (Yang TIDAK Dikerjakan / out-of-scope) dan **E-12** (Ketergantungan pada klien) → hilangkan sebagai
  **wajib**. Cabut dari `checkCompleteness` (`E-11` via `strategi_pillar jenis='tidak_dikerjakan'`, `E-12` via
  `strategi_ketergantungan_klien`) **dan** baris `DOORS` `E-11`/`E-12`. Pertimbangkan menyembunyikan/menandai
  opsional UI-nya di `SectionE.tsx`. Ini menabrak **Rule 9** (E-11 wajib) di PRD M6A → **butuh baris
  `DECISIONS.md`** (pemilik sudah setuju di QA). Cek juga `strategi.test.ts` (tes "empty draft" meng-`expect`
  `E-11`) — perbarui.

---

## 4. ⛳ AKSI PEMILIK YANG DITUNGGU — contoh HTML export platform (blokir §3.B)

**Untuk sesi berikutnya, tolong pemilik lampirkan contoh file / HTML export dari platform** supaya importer
baseline (§3.B) bisa dibangun akurat. Idealnya:

1. **File HTML mentah** (Save-As halaman) ATAU potongan HTML dari halaman ringkasan **Seller Center** tiap
   platform yang dipakai: **Shopee, TikTok Shop, Tokopedia** (mana pun yang tersedia).
2. Halaman yang paling berguna: **ringkasan penjualan/analytics** (GMV, jumlah pesanan, pengunjung, conversion
   rate per bulan), **daftar produk/SKU**, **iklan/ads**, **affiliate**, **konten/live**.
3. Sertakan **rentang periode** (mis. 3 bulan terakhir) supaya pemetaan ke B-1 per-bulan jelas.
4. Kalau ada, sekalian **satu contoh export CSV/XLSX** dari platform yang sama sebagai pembanding (lebih stabil
   untuk parsing daripada HTML).

Simpan contohnya di repo (mis. `docs/samples/platform-export/<platform>/…`) atau lampirkan langsung di chat
berikutnya, lalu minta lanjut ke **§3.B**.

---

## 5. Urutan build & catatan lain
- Wave/urutan: lihat `docs/prd/CDPS_Build_Plan.md`. Pekerjaan ini di lingkup **M6A (Strategi)** — QA/perbaikan
  form, bukan tiket wave baru.
- Jangan sentuh `backend/**` (Go/MySQL sudah pensiun; hanya oracle paritas read-only).
- Setelah tiap PR Fase 2: pastikan `route-parity`/`shape-parity`/`gate-reachability` hijau, `KNOWN_GAPS` kosong,
  dan tambah baris `DECISIONS.md` untuk tiap deviasi PRD.
