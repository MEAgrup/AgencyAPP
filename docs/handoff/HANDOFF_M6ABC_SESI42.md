# HANDOFF — QA Strategi Fase 2 (semua "sebelum baseline HTML") **MERGE (PR #202)** → sisa: §3.B importer HTML + A-9 target terukur — Sesi 42

> Rantai: … → SESI40 (RAB-19/20, PR #180) → SESI41 (QA Strategi Fase 1, PR #200; rencana Fase 2, PR #201) → **SESI42 (ini, terbaru — QA Strategi Fase 2 non-HTML, PR #202 — MERGE).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK & KEPUTUSAN inti** (jangan tanya ulang), SESI41 sumber rencana Fase 2.
>
> **Status: semua item Fase 2 yang TIDAK butuh contoh HTML platform SELESAI & MERGE. Sisa dua: §3.B importer baseline HTML (menunggu contoh dari pemilik) dan A-9 (ekspektasi klien → target terukur, butuh keputusan kosakata metrik).**

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/build-before-html-baseline-0fr4z5` (**sudah di-merge lewat PR #202 → JANGAN dipakai lagi**). |
| **PR sesi ini** | **#202 — MERGED (squash)** ke `main`. |
| **Base untuk lanjutan** | `main` setelah #202. **Restart branch dari `main`** (`git fetch origin main && git checkout -B <branch-baru> origin/main`). PR #202 sudah selesai — jangan menumpuk commit di atas history yang sudah ter-merge. |

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 / SESI41 §0.1 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`. **Jangan `psql -f`.**
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case HANYA lewat `apps/api/src/lib/wire.ts` (`*ToWire`). Kirim `null` eksplisit, jangan `omitempty` (kelas bug O43).
- **Rute = shell**: `requireActor` → validasi/map body → domain. Jangan taruh logika di rute.
- Setiap wire interface yang dibaca `web-internal` wajib dipasangkan di `shape-parity.test.ts` **dan** `route-parity.test.ts` `KNOWN_GAPS` **tetap kosong**.
- **`gate-reachability.test.ts`**: tiap kode gerbang yang di-emit `checkCompleteness` wajib punya baris `DOORS`, dan sebaliknya (tidak boleh baris usang). Menambah/menghapus gerbang → sinkronkan file ini.
- Setiap deviasi PRD = satu baris `docs/DECISIONS.md` (tanggal, keputusan, alasan, disetujui).

### 0.2 Setup DB lokal + install deps (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install                          # root workspaces (apps/* + packages/*)
cd web-internal && npm install       # web-internal app Next MANDIRI — install terpisah
```

Perintah cek cepat sesi ini (semua hijau):
```
npm run typecheck                                            # api/core/db/domain
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run packages/domain/src/strategi.test.ts   # 210 hijau
cd web-internal && npx tsc --noEmit && npx vitest run        # 272 hijau
cd apps/api && npx vitest run src/lib/gate-reachability.test.ts src/lib/shape-parity.test.ts src/lib/route-parity.test.ts src/lib/body-parity.test.ts  # 25 hijau
```
⚠️ **Tes lama `packages/domain/src/interview.test.ts` "counts WORKING days: a registered national holiday…" GAGAL secara lokal** (`expected 1 to be 0`) — **tergantung tanggal**, sudah diverifikasi gagal juga di `main` bersih (di-stash lalu diuji). **BUKAN** dari perubahan sesi ini; CI `db-and-migrations` hijau (tanggal runner beda). Jangan "perbaiki" dengan mengedit tes; kalau mau ditangani, itu tiket tersendiri (mock tanggal).

---

## 1. Yang SUDAH selesai sesi ini (PR #202 — MERGE, jangan ulang)

Semua keputusan pemilik dikonfirmasi via QA 2026-08-20; tiap deviasi PRD → baris `docs/DECISIONS.md` (empat baris "QA Strategi Fase 2" di puncak tabel Decided).

### §3.D — E-11 & E-12 dipensiun sebagai syarat pengajuan
- `checkCompleteness` tak lagi emit gerbang **E-11** (out-of-scope, `strategi_pillar jenis='tidak_dikerjakan'`) & **E-12** (`strategi_ketergantungan_klien`); baris `DOORS`-nya dihapus.
- `SectionE.tsx`: kedua daftar kehilangan `min={1}`, label/hint jadi "opsional". Validasi bentuk `saveKetergantungan` (item butuh konsekuensi, `MSG_KETERGANTUNGAN_INCOMPLETE`) TETAP.
- Deviasi Rule 9 M6A dicatat. Tanpa migrasi. Konstanta `MSG_OUT_OF_SCOPE_REQUIRED`/`MSG_KETERGANTUNGAN_REQUIRED` dibiarkan terdefinisi (tak lagi di-emit).

### §3.C — metrik Section D terbaca jelas (MELENGKAPI, bukan ganti)
- **Temuan:** 10 metrik pemilik (GMV, Pengunjung, CR, AOV, ROAS min, ACOS maks, SKU winner, Affiliate aktif, Jam live, Jumlah video) = enum `TARGET_METRICS` yang ADA, 1:1. GMV→matriks D-2; sembilan sisanya→matriks pendukung D-4 (`nilai_stretch`, floor NULL). **Tanpa skema/enum baru.**
- `web-internal/src/lib/strategi.ts`: `METRIC_UNITS` (satuan + contoh per metrik, FE-only). `SectionD.tsx`: input D-4 kini menampilkan satuan (Rp/%/×/jam/bln/video/bln/SKU/akun/orang/bln) sebagai sufiks + contoh sebagai placeholder + `inputMode="decimal"`.

### §3.A — Section A → Interview (dua bagian, keduanya di PR #202)
**Bagian 1 — tangkap di form Interview:** enam field Section A (A-1 brand&kategori, A-5 USP, A-8 titik kirim, A-10 riwayat agensi, A-12 decision maker, A-14 aset) ditambah ke `web-internal/src/lib/interview-fields.ts` (`INTERVIEW_FIELDS`) sebagai **teks non-scored** di seksi wired (B1/B2/B3/B7). **Tanpa migrasi** — `interview_answer(section, field_key)` menerima key apa pun, scorer hanya baca `SCORED_FIELD_KEYS`. `getStrategiPrefill` juga emit **A-1 kategori dari `clients.kategori`** (item `klien.kategori`).

**Bagian 2 — read-only warisan + cabut gerbang** (keputusan pemilik atas bentuk field):
- **A-1, A-5, A-8, A-10, A-12** kini **read-only** di Strategi Section A (`InterviewMirror` di `SectionA.tsx`), nilai dari `inheritedKonteksOf(prefill)` (`lib/strategi.ts`), fallback ke nilai tersimpan (baris lama). A-1 = brand (dari `B2-1`, kini label "Nama brand") + kategori (dari klien).
- Gerbang **A-1/A-5/A-8/A-10/A-12 DICABUT** dari `checkCompleteness` + `DOORS`.
- **A-14 (aset) TETAP checklist & tetap gated** — keputusan pemilik ("aset tetap ceklist seperti sebelumnya").
- **USP & decision maker = teks bebas** (bukan list/struct) — keputusan pemilik.
- Panel `InterviewPrefillPanel` menyaring keluar field yang sudah read-only (biar tak ada pesan "salin" yang kontradiktif).
- **Aman tanpa write-through:** `clientView` tak memproyeksikan field Section A mana pun (hanya B/E-1/D-2/D-8), gerbang satu-satunya konsumen lain → read-only-display cukup; snapshot versi & view klien tak terdampak; `saveKonteks` tak diubah (nilai lama round-trip, tak terhapus).

Berkas inti: `packages/domain/src/strategi.ts`, `apps/api/src/lib/gate-reachability.test.ts`, `web-internal/src/lib/{strategi.ts,interview-fields.ts}`, `web-internal/src/components/strategi/{SectionA,SectionD,SectionE}.tsx`, `web-internal/src/app/(shell)/account/strategi/[id]/page.tsx`. Tes baru: `web-internal/src/lib/strategi-inherit-konteks.test.ts`.

---

## 2. Yang HARUS dikerjakan berikutnya (BELUM — pecah jadi PR kecil)

### 2.A §3.B — importer baseline dari HTML export platform ⛳ MENUNGGU INPUT PEMILIK
Sama seperti SESI41 §4: **belum bisa mulai sebelum ada contoh format HTML** export platform (Shopee/TikTok Shop/Tokopedia Seller Center). Yang dibutuhkan dari pemilik:
1. File HTML mentah (Save-As) atau potongan HTML halaman ringkasan Seller Center tiap platform.
2. Halaman paling berguna: ringkasan penjualan/analytics (GMV, pesanan, pengunjung, CR per bulan), daftar SKU, iklan/ads, affiliate, konten/live.
3. Rentang periode (mis. 3 bulan terakhir) supaya pemetaan ke B-1 per-bulan jelas.
4. Kalau ada, satu contoh CSV/XLSX dari platform yang sama (lebih stabil di-parse daripada HTML).

Simpan contohnya di `docs/samples/platform-export/<platform>/…` atau lampirkan di chat. Lalu: bangun importer **usulan → konfirmasi AM per angka** (RAB-19; tetap tanpa auto-pull API); input channel manual (Fase 1) tetap fallback; nilai hasil import disimpan via save Section B biasa supaya Rule 5 + `ck_strch_eksisting` + gerbang B-1 terpenuhi.

### 2.B A-9 — ekspektasi klien → "target terukur" (butuh keputusan kosakata metrik)
Pemilik minta A-9 jadi **target terukur: GMV, ROAS, Total view** (SESI41 §3.A). **Sengaja BELUM dikerjakan** di PR #202 karena tak memetakan bersih:
- **GMV** sudah = D-2 (matriks target).
- **ROAS** ≠ `roas_min` yang ada (semantik "minimum" vs "target ROAS"); perlu keputusan apakah pakai `roas_min` atau metrik ROAS baru.
- **"Total view"** tak ada di `TARGET_METRICS` sama sekali.
Jadi ini menuntut keputusan: perluas `TARGET_METRICS` (+ CHECK DB `ck_strtg_metric` + `LEADING_INDICATORS` mirror, satu commit) atau petakan ke yang ada. **Usulkan pemetaan di `DECISIONS.md` dulu**, lalu bangun. A-9 saat ini masih free-text gated seperti biasa (tidak rusak).

### 2.C Catatan lanjutan
- Sub-kategori (bagian A-1) kini tak punya editor di Strategi (A-1 read-only); nilai lama tetap round-trip. Kalau pemilik mau sub-kategori bisa diedit, tempatnya di form Interview (tambah field), bukan balik ke Strategi.
- Kalau nanti butuh field Interview yang **terstruktur** (mis. decision maker jadi struct lagi, atau USP jadi list min-3), katalog `interview-fields.ts` sekarang cuma dukung skalar (`enum|money|persen|angka|teks`) — perlu perluasan tipe field dulu.

---

## 3. Urutan build & catatan lain
- Wave/urutan: `docs/prd/CDPS_Build_Plan.md`. Pekerjaan ini lingkup **M6A (Strategi) + Interview** — QA/perbaikan form, bukan tiket wave baru.
- Jangan sentuh `backend/**` (Go/MySQL pensiun; oracle paritas read-only).
- Setelah tiap PR: `route-parity`/`shape-parity`/`gate-reachability` hijau, `KNOWN_GAPS` kosong, tambah baris `DECISIONS.md` untuk tiap deviasi PRD.
