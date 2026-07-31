# CUTOVER UAT REPORT — C-03 terhadap DEPLOYMENT (2026-07-31)

> **Menutup SKIP-1 dan SKIP-3** dari `CUTOVER_UAT_REPORT_20260728.md`. Report
> 20260728 **tidak disunting** — ia bukti historis dari sandbox; yang ini adalah
> eksekusi terhadap **deployment Vercel sungguhan**.
>
> **FAIL = 0. Tidak ada SKIP di ketiga skrip.** Sisa C-03 tinggal **SKIP-2**
> (badge notifikasi, manual di browser) — §4.

## 1. Provenance

| | |
|---|---|
| Run | **`30600363211`** — job `probe` ✅ · job `uat` ✅ (`success`) |
| Job `uat` | `91061496685` · disetujui environment `c03-production` 03:13 UTC · selesai 03:18 UTC |
| Commit | **`437ac24`** (Merge PR #84) |
| BASE | `https://agency-app-api.vercel.app` |
| BYPASS | kosong — deployment tidak ber-proteksi (probe: path tak dikenal → 404) |
| Roster terbaca | **69 karyawan aktif · 39 role_mapping** (identik di ketiga skrip) |
| Dibaca oleh | Claude, dari **job log** run tersebut |

> **Cara ini dibaca tanpa mengunduh artifact.** Artifact `c03-output` tidak bisa
> diunduh dari sesi Claude (gateway menolak penyimpanan blob GitHub, 403), **tapi
> job log bisa** — dan ketiga skrip mencetak seluruh hasilnya ke stdout. Artifact
> tetap ada sebagai arsip (ID `8781965829`, kedaluwarsa **2026-10-29**).

### 1.1 Aktor terpakai — dan kenapa NIK/nama TIDAK ditulis di sini

Skrip mencetak blok `aktor terpakai` lengkap dengan **NIK + nama** keenam orang.
`HANDOFF_CUTOVER_SESI24.md` §1.4 melarang menambah NIK/PII baru ke berkas repo
selama repo masih **publik**. Dua aturan itu bertabrakan, jadi diselesaikan
begini: **peran, divisi, dan cara resolusinya dicatat** (itulah yang membuat run
reproducible), **identitasnya tidak** — ia hidup di job log run `30600363211` dan
di live, keduanya bisa dibuka kapan saja.

| Slot | Divisi/role | Resolusi | NIK |
|---|---|---|---|
| `sales_staff` | Sales / staff | `[role-match]` | `23…0294` |
| `sales_lead` | Sales / lead | `[role-match]` | `21…0004` |
| `account_staff` | Account / staff | `[role-match]` | `24…0431` |
| `finance_staff` | Finance / staff | `[role-match]` | `99…0007` — ⚠️ **fixture QA**, lihat §5 |
| `director` | Management / lead **+director** | `[layered:director]` | `20…0002` |
| `od` | Management / lead **+od** | `[layered:od]` | `25…0493` |

Keenamnya **diresolusi dari environment**, bukan di-hardcode — itu perbaikan
2026-07-29 yang membuat walk mungkin lolos di live sama sekali.

## 2. Hasil — ketiganya hijau

| Skrip | Target | Hasil | Menutup |
|---|---|---|---|
| `cutover-houserules-walk.mjs` | 22/22 | ✅ **22/22 checks passed** | **SKIP-1** |
| `wave3-contract-smoke.mjs` | 34/34 | ✅ **34/34 endpoints wired** | — |
| `auth-smoke.mjs` | 13/13 | ✅ **13/13 checks passed** | **SKIP-3** |

### 2.1 Walk aturan rumah — 22/22

Aktor: keenam slot §1.1. Yang terbukti **terhadap deployment**, bukan sandbox:

- **R1 ID** — `LEAD-202607-0004` dan `PRSP-202607-0004` cocok `PREFIX-YYYYMM-NNNN`
- **R2 pesan BI** — lead tanpa field wajib → 400 `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` **verbatim**
- **R3 state machine** — transisi ilegal `New Lead→Qualified` ditolak · transisi sah `New Lead→Contacted` 200 · pengulangan → 409 `[transisi status tidak diizinkan]`
- **R4 imutabilitas** — `audit_log`/`notifications` tanpa jalur UPDATE/DELETE (diverifikasi terpisah oleh `supabase/tests/immutability_checks.sql`)
- **R5 field turunan** — `total_sales` tidak bisa ditulis lewat PATCH klien
- **R6 MSL + IDR** — **32 layanan** terbaca; quote-preview merender `Rp. 6.000.000,00 | Rp. 0,00 | Rp. 6.000.000,00`
- **R7 div-by-zero** — rollup tim kosong → `"average_display":"—"`, bukan error
- **PERM** — Account staff ditolak di Sales Pool (403 `[anda tidak memiliki akses untuk melakukan transisi ini]`) · Sales staff boleh baca · **Sales lead baca lead staff se-divisi (scope divisi)** · OD baca lintas divisi · Director akses penuh
- **O37** — pemilik lead bisa baca; aktor lintas-scope **404** (deviasi yang disetujui, bukan 403)
- **PARITY** — pintu registrasi lead tak ber-gate role, **sama seperti Go** (dinyatakan eksplisit sebagai bukan regresi)
- **C-02 notifikasi** — tanpa auth → 401 · kontrak `{ data, unread_count }` terpenuhi · id malformed → 400 `[id tidak valid]`

> Baris **`PERM Sales lead … (scope divisi)`** adalah cek yang ditambahkan
> 2026-07-29 (target naik 21→22) karena tingkat `lead` belum pernah diuji walau
> C-03 mengklaim mencakup Role Matrix. Ia **lulus terhadap deployment**.

### 2.2 Wave 3 contract smoke — 34/34

Aktor: `director` (`[layered:director]`). Seluruh 34 endpoint M11/M13/M14 +
Live-Stream + health + performance menjawab **respons domain**, bukan 404 routing:
`marketing/campaigns` (9), `performance-dashboard`, `briefs`/`sessions` (9),
`brief-queue`, `health` (6), `performance` (8).

Yang menjawab **200** (jalur hidup dengan data nyata): `GET marketing/campaigns` ·
`performance-dashboard` · `divisions/Live Stream/brief-queue` ·
`health/snapshots/scan` · `performance/snapshots/scan` · `staff/…/performance/trend` ·
`performance/teams/Creative` · `config/weights` · `config/targets`.

Sisanya 404/400 **domain response** — entitas contoh (`CMP-…0001`, `BRF-…0001`,
`LSS-…0001`, `CLI-…0001`) memang belum ada di produksi. Itu yang diharapkan:
yang diuji adalah route-nya terpasang dan lapisan domainnya menjawab.

### 2.3 Auth smoke — 13/13

Aktor: `sales_staff` (`[role-match]`). **Tujuh dari 13 adalah cek negatif** —
yang membuktikan pintunya benar-benar terkunci, bukan cuma terbuka untuk yang benar:

no token · garbage token · **wrong-secret signature** · expired · **alg:none
(algorithm confusion)** · valid signature tanpa klaim `employee_id` · `GET /me`
tanpa sesi → semuanya **401**. Lalu: token sah lolos (201) · `/me` dengan cookie
sah (200) · login body kosong → 400 · logout 200 · **logout membersihkan cookie**
(`Max-Age=0; HttpOnly; SameSite=Lax; Secure`).

## 3. Jejak tulis yang ditinggalkan di produksi

Walk **menulis** ke `CDPS SG` — disetujui pemilik lewat `confirm_write: YA`:

- `LEAD-202607-0004` + `PRSP-202607-0004` (dan lead kedua dari cek PARITY)
- Baris `audit_log` yang **append-only** (aturan rumah #3) ⇒ **permanen**
- Satu transisi `New Lead→Contacted` pada prospek uji

Ini disengaja dan tercatat. Proporsinya: sebelum run, live berisi 3 lead · 0
client · 0 transaksi.

## 4. Yang MASIH tersisa dari C-03 — SKIP-2

**SKIP-2 (badge notifikasi) belum tertutup.** Ia butuh mata di browser (~3 menit)
dan tidak bisa diotomatiskan tanpa menyimpan password user produksi sebagai
secret. Ketiga cek C-02 di walk (§2.1) menguji **kontrak API**-nya, bukan
**badge-nya di UI**.

Karena itu `CUTOVER_BACKLOG.md` §2 C-03 tetap **`[~]`** — bukan karena ada yang
gagal, tapi karena satu butir belum diperiksa. Setelah SKIP-2 dicentang, C-03
boleh `[x]` dan **gate C-04 terbuka**.

## 5. 🟠 Satu hal yang harus dibaca bersama DoD C-04

Slot `finance_staff` diisi **`99…0007`** — akun **fixture QA** (`QA-SEED`, O50).
Artinya jalur Finance di walk ini lulus **memakai aktor fixture**, bukan karyawan
Finance sungguhan.

Itu tidak membatalkan hasil C-03 (yang diuji adalah gate permission, dan gate-nya
bekerja), **tapi ia bersinggungan langsung dengan DoD C-04**: *"tak ada fixture
UAT tersisa di jalur produksi"*. Dua konsekuensi:

1. **O50 belum selesai** — 10 akun `99000000xx` masih aktif & bisa login.
2. Ketika O50 dieksekusi (fixture dinonaktifkan), **walk ini harus dijalankan
   ulang** supaya slot `finance_staff` teresolusi ke karyawan Finance riil. Kalau
   tidak, discovery akan gagal menemukan aktor Finance dan baris itu jadi SKIP —
   persis kelas cacat yang C-03 ada untuk mencegahnya.

## 6. Perbandingan dengan report 2026-07-28

| | 20260728 (sandbox) | **20260731 (deployment)** |
|---|---|---|
| Target | 22 · 34 · 13 | 22 · 34 · 13 |
| FAIL | 0 | **0** |
| SKIP | **3** (SKIP-1/2/3) | **1** (SKIP-2 saja) |
| Dijalankan terhadap | Postgres lokal + sandbox | **deployment Vercel + `CDPS SG`** |

Yang berubah bukan hasilnya — melainkan **terhadap apa** ia dijalankan. Itulah
seluruh alasan C-03 ditahan sebagai `[~]` sejak 2026-07-28.
