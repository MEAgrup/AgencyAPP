# HANDOFF — C-03 dilanjutkan di mesin ber-akses Vercel

> **Untuk siapa:** pemilik / siapa pun di mesin dengan **akses internet ke `*.vercel.app` + secret
> produksi**. Claude tidak bisa menjalankannya: gateway sandbox menolak CONNECT ke `*.vercel.app` dan
> sesi ini nol kredensial live (`HANDOFF_CUTOVER_SESI9.md` §0.2).
>
> **Runbook tekniknya sudah ada dan masih akurat: `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`.** Berkas ini
> **tidak menggantikannya** — ia hanya menyatakan *apa yang berubah sejak runbook itu ditulis
> (2026-07-29)* supaya Anda tidak menjalankan langkah dengan asumsi basi.

## 0. Yang berubah sejak runbook ditulis — baca sebelum eksekusi

| Hal | Saat runbook ditulis (2026-07-29) | **Sekarang (2026-07-30)** |
|---|---|---|
| `main` | `efd59aa` | **`a38e241`** (merge PR #82) |
| Live `CDPS SG` | 40 migrasi | **42 migrasi** — O46 di-apply **dan terbukti menyala** |
| Repo vs live | — | ✅ **42 = 42**, nama berkas = versi live 1:1 |
| `apps/api` test | 301 | **310** |
| Ledger | `RFC3339_PENDING_DECISION` 1 entri | ✅ **ketiganya KOSONG** |

**Artinya deployment yang akan Anda uji memuat keadaan yang benar-benar akan rilis** — ini justru
waktu yang tepat, karena sebelum #82 arm RLS O46 masih mati di produksi.

⚠️ **`git pull` dulu.** Runbook §3 menulis `git checkout main && git pull origin main`; itu tetap
benar, tapi kalau Anda sudah punya clone lama, pastikan ia sampai ke **`a38e241`** — bukan `efd59aa`.

## 1. Yang harus dijalankan

Ikuti **`CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`** apa adanya. Ringkasnya:

```bash
git checkout main && git pull origin main    # harus sampai a38e241
npm ci                                       # ⚠️ WAJIB dari ROOT repo (aturan rumah #6)

export BASE=https://<url-agency-app-api>     # BUKAN localhost
export SUPABASE_JWT_SECRET='<secret produksi>'   # salin dari env Vercel, JANGAN ditebak
export BYPASS='<token bypass>'               # kosongkan bila deployment tidak ter-proteksi

node apps/api/scripts/cutover-houserules-walk.mjs   # target 22/22  → menutup SKIP-1
node apps/api/scripts/wave3-contract-smoke.mjs      # target 34/34
node apps/api/scripts/auth-smoke.mjs                # target 13/13  → menutup SKIP-3
```

Lalu **QA manual** (runbook §4) untuk **SKIP-2**: badge notifikasi di FE ter-deploy — jumlah unread
muncul, klik → tandai terbaca, jumlah turun, refresh tetap konsisten.

### ⚠️ Jebakan yang paling mahal, diulang di sini karena ia menghasilkan FAIL PALSU di semua baris

Kalau deployment ber-proteksi dan **`BYPASS` tidak diisi**, Vercel menjawab **setiap** path dengan
halaman challenge. Itu terbaca seperti routing-404 dan akan dilaporkan sebagai *path drift* —
seluruh baris FAIL padahal aplikasinya sehat. Isi `BYPASS`, atau matikan proteksi sementara.

## 2. Satu verifikasi TAMBAHAN yang layak dijalankan sekali (baru, tidak ada di runbook)

Sesi ini membuktikan arm RLS O46 menyala **di lapisan DB** (probe 8 skenario, `DECISIONS.md`
2026-07-30). Yang **belum** pernah dilihat: apakah ia menyala **lewat aplikasi ter-deploy** — yaitu
apakah JWT yang benar-benar dikeluarkan login membawa `level=lead` sampai ke policy.

**Cara termurah:** minta **Head of Sales `2101180004`** login ke FE ter-deploy dan buka halaman
riwayat/audit.

| Hasil | Artinya |
|---|---|
| melihat **> 32** entri (harusnya **36**) | ✅ arm menyala end-to-end |
| melihat **tepat 32** | 🔴 arm tidak menyala di jalur aplikasi — periksa **`trg_sync_claims_mapping`**, **bukan** policy-nya (policy sudah terbukti benar) |
| melihat **0** | 🔴 masalah auth/route, bukan RLS |

Angka 32 vs 36 itu bukan hiasan: `2101180004` menulis **32** entri sendiri sementara divisi Sales
punya **36**, jadi kedua angka itu membedakan *"arm menyala"* dari *"arm mati"* tanpa ambiguitas.
**Jangan pakai Head of Account `2305100275`** — divisi Account punya **0** entri audit, jadi hasilnya
`0` baik arm menyala maupun mati; ia tidak membedakan apa pun. (SESI21/SESI22 sempat
menyarankannya — itu saran yang sudah dicabut.)

## 3. Kalau ada yang FAIL

- **Jangan** perbaiki dengan mengubah policy RLS. Semua policy yang tersentuh C-03 sudah diverifikasi
  di lapisan DB sesi ini; kegagalan di sini hampir pasti **auth/klaim/route**, bukan policy.
- Hasilnya ditulis ke **report baru** `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md`.
  DoD-nya: **FAIL = 0 TANPA SKIP** (runbook §6).
- Kirimkan output ketiga skrip apa adanya. Claude bisa mendiagnosis dari situ tanpa akses Vercel.

## 4. Sesudah C-03 hijau — urutan sisa pekerjaan

| # | Butir | Catatan |
|---|---|---|
| 1 | **A4 roster** — `O34_O26_O35_WORKSHEET_ROSTER_V2.md` §3.1–§3.6 | Daftar pertanyaan **tertutup**; §5 memuat verifikasi live-nya |
| 2 | **O48** — `O48_ANALISIS_KEPUTUSAN.md` | **Sesudah A4**, dan alasannya mengikat (di bawah) |
| 3 | Backup MySQL Railway + OQ-2 · rencana rollback | |
| 4 | Gate GO → **C-05** (cabut `backend/`) | |

> **Kenapa A4 mendahului O48, dan ini bukan selera:** diukur di live hari ini, **Ads (11 karyawan),
> KOL (5), dan Marketing (1) punya NOL pemegang `level=lead`**, plus **7 karyawan tidak terpetakan** —
> total **24 dari 69**. Menyapu arm divisi ke 32 policy sebelum itu dijawab menghasilkan migrasi yang
> **tidak bisa dibuktikan bekerja** di tiga divisi tersebut: policy-nya benar, pemegangnya nol,
> hasilnya terlihat selesai. Itu persis kelas kesalahan O46.

**Dua hal yang tetap terbuka dan sengaja tidak ditutup diam-diam:**

- **`transactions` KOSONG di live (0 baris)** — arm-nya bersandar pada helper bersama + `rls_checks`,
  belum terbukti oleh data riil. Probe ulang begitu ada transaksi.
- **`formatDate` di `clients/[id]/page.tsx`** memakai `toLocaleString`, bukan `toLocaleDateString`,
  jadi kolom tanggal merender jam `07.00.00`. Salah sebelum maupun sesudah O49 (b) dan **bukan**
  disebabkan olehnya — butuh tiket FE sendiri.

**Titik masuk umum sesi berikutnya tetap `HANDOFF_CUTOVER_SESI23.md`** (nomor tertinggi dibaca
pertama, aturan `CLAUDE.md`). Berkas ini khusus untuk orang yang menjalankan C-03.
