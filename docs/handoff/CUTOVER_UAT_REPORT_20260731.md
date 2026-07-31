# CUTOVER UAT REPORT — C-03 dijalankan terhadap **deployment produksi**

> Tanggal: **2026-07-31**. Tiket: `docs/backlog/CUTOVER_BACKLOG.md` §C-03.
> Target uji: **`https://agency-app-api.vercel.app`** (Vercel) di atas Supabase **`CDPS SG`** — **bukan** lokal.
> Eksekutor: GitHub Actions, workflow `.github/workflows/c03-deployment-uat.yml`.
>
> **Report `CUTOVER_UAT_REPORT_20260728.md` TIDAK disunting.** Ia bukti historis dari
> *walk lokal* dengan 3 SKIP; berkas ini adalah eksekusi terhadap deployment yang
> menutup dua di antaranya. Keduanya berdiri sendiri-sendiri.

---

## 0. VERDICT — **FAIL = 0**, dan SKIP-1 + SKIP-3 **tertutup di deployment**

| | |
|---|---|
| **PASS** | **69** (22 + 34 + 13) |
| **FAIL** | **0** |
| **SKIP** | **1** — hanya **SKIP-2** (badge notifikasi di FE ter-deploy), lihat §4 |

Target §2 handoff SESI24 — **22/22 · 34/34 · 13/13, FAIL = 0 tanpa SKIP** — **tercapai
pada ketiga skrip**. Tidak ada satupun baris `SKIP` di output mereka.

**Yang berubah maknanya dibanding 2026-07-28.** Report itu membuktikan **kode + skema**;
ketiga SKIP-nya berakar pada satu hal yang sama — walk belum pernah menyentuh deployment.
Yang kini ikut terbukti adalah lapisan yang dulu kosong: **konfigurasi env Vercel, kunci
JWT produksi, dan perilaku pooler Supabase**. Itulah isi C-03 yang sebenarnya, dan itulah
sebabnya "lolos bersyarat" bisa dicabut.

**Sisa SKIP-2 tidak menahan C-03.** DoD C-03 berbunyi *"report tersimpan, FAIL = 0, tiap
SKIP beralasan tertulis"* — ketiganya terpenuhi. SKIP-2 adalah **QA UI browser**, sekelas
dengan QA UI `/master-services` + `/sales/kalkulator` yang memang sudah tercatat sebagai
sisa **C-04**; ia dipindahkan ke sana, bukan dihapus. Lihat §4 dan `DECISIONS.md` 2026-07-31.

🟠 **Dua temuan residu produksi — bukan FAIL, tapi jangan dilewat: §5.** Jejak tulis run ini
**lebih besar** daripada yang diumumkan sebelum approval (bukan hanya "2 lead `ZZC03`").

---

## 1. Provenance — supaya run ini bisa dipertanggungjawabkan

| | |
|---|---|
| **Run** | `30600363211` · attempt 1 · run number 4 · `workflow_dispatch` |
| **Job `probe`** | `91061467877` — ✅ success (02:58:35 → 02:58:46 UTC) |
| **Job `uat`** | `91061496685` — ✅ success (03:13:09 → 03:18:01 UTC) |
| **Gerbang** | environment `c03-production`, required reviewer — **di-approve pemilik**; job tertahan `waiting` 02:58 → 03:13 UTC |
| **`confirm_write`** | `YA` (gerbang input workflow, dicek sebelum langkah apa pun) |
| **Commit yang diuji** | `437ac24a2510e98d20fee4ea602c315d1849f85c` (= Merge PR #84) |
| **`BASE`** | `https://agency-app-api.vercel.app` |
| **`BYPASS`** | **kosong** — deployment terbukti tidak ber-proteksi (`probe`: path tak dikenal → 404, bukan 401/403) |
| **Artifact** | `c03-output` id `8781965829`, 3 berkas `.txt`, 2623 B, sha256 `3fb42ac2…63619b`, **kedaluwarsa 2026-10-29** |
| **Node / runner** | node 22.23.1 · `npm ci` 404 paket · ubuntu-24.04 |

Pra-cek discovery sebelum skrip pertama: **`69 karyawan aktif, 39 role_mapping`** — dibaca
oleh runner dari deployment, jadi ia sekaligus membuktikan secret cocok **dan** deployment
menunjuk DB yang benar.

> ⚠️ **Artifact kedaluwarsa 2026-10-29.** Sesudah itu output verbatim ketiga skrip hanya
> hidup di log run. Kalau bukti ini harus bertahan lebih lama dari itu, unduh dan simpan
> di luar GitHub sebelum tanggal tersebut.

---

## 2. Blok `aktor terpakai` — **diredaksi sebagian, dan ini alasannya**

`HANDOFF_CUTOVER_SESI24.md` §2 meminta blok `aktor terpakai` disalin utuh (provenance =
syarat reproducible). §1.4 dokumen yang sama melarang **menambah NIK/PII baru ke berkas
repo** selama repo masih publik. **Diperiksa hari ini lewat API: repo MASIH publik**
(`"private": false`, `"visibility": "public"`, `allow_forking: true`). Larangan itu menang,
jadi blok di bawah dibawa masuk **tanpa nama orang**, dan NIK yang belum pernah ada di repo
diganti placeholder.

**Yang tidak hilang:** blok verbatim — lengkap dengan NIK dan nama — ada di artifact
`c03-output` dan di log run (§1). Dan aktor bukan konstanta yang perlu dihafal: ketiga skrip
**meresolusinya dari environment yang diuji** (`/admin/employees` ⋈ `/admin/role-mappings`),
jadi run ulang terhadap DB yang sama memilih orang yang sama tanpa membaca berkas ini.

### 2.1 `cutover-houserules-walk` — 6 slot aktor

| Slot | NIK | Jabatan HRIS | Cara resolusi |
|---|---|---|---|
| `sales_staff` | `‹NIK-A›` | Sales / staff | `[role-match]` |
| `sales_lead` | `2101180004` | Sales / lead | `[role-match]` |
| `account_staff` | `2409200431` | Account / staff | `[role-match]` |
| `finance_staff` | **`9900000007`** 🟠 | Finance / staff | `[role-match]` — **fixture O50**, lihat §5.3 |
| `director` | `200000002` | Management / lead **+director** | `[layered:director]` |
| `od` | `2501140493` | Management / lead **+od** | `[layered:od]` |

> `‹NIK-A›` = satu-satunya NIK dalam run ini yang belum pernah muncul di repo. Lima sisanya
> sudah ada di repo sebelum hari ini, jadi menuliskannya lagi tidak menambah paparan apa pun.

**Slot `od` = `2501140493` bukan kebetulan.** Ia salah satu dari tiga orang yang baru diberi
layered `director` kemarin (C-03 §7). Ia lolos cek *"OD boleh membaca di semua divisi"* **dan**
cek *"pintu registrasi lead tak ber-gate role"* dari deployment — artinya grant kemarin bukan
sekadar baris tabel, ia **merambat ke JWT dan sampai ke aplikasi**.

### 2.2 `wave3-contract-smoke` — 1 aktor

`200000002` (Management/lead **+director**) `[layered:director]`.

### 2.3 `auth-smoke` — 1 aktor

`‹NIK-A›` (Sales/staff) `[role-match]`.

---

## 3. Hasil per skrip

### 3.1 `cutover-houserules-walk.mjs` → **22/22 PASS** (menutup SKIP-1)

| # | Aturan rumah | Bukti dari deployment |
|---|---|---|
| R1 | ID `PREFIX-YYYYMM-NNNN` | `LEAD-202607-0004` · `PRSP-202607-0004` |
| R2 | Pesan BI verbatim | field wajib kosong → **400** `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` |
| R3 | Transisi diblokir **server-side** | `New Lead→Qualified` ditolak · `New Lead→Contacted` **200** · diulang → **409** `[transisi status tidak diizinkan]` |
| R4 | Riwayat append-only | didelegasikan ke `supabase/tests/immutability_checks.sql` (invariant SQL, bukan HTTP) |
| R5 | Field turunan read-only | PATCH `total_sales` ditolak **400** BI |
| R6 | IDR `Rp. X.XXX.XXX,00` | MSL **32 layanan** · quote-preview → `Rp. 6.000.000,00 \| Rp. 0,00 \| Rp. 6.000.000,00` |
| R7 | Div-by-zero → `—` | rollup tim kosong → **200** `{"team_average":null,"average_display":"—"}` |
| PERM | Role Matrix | Account staff → Pool **403** `[anda tidak memiliki akses untuk melakukan transisi ini]` · Sales staff **200** · **Sales lead baca lead staff se-divisi 200** · OD lintas-divisi **200** · Director **200** |
| O37 | Jalur baca | pemilik **200** · lintas-scope **404** (deviasi disetujui, bukan 403) |
| PARITY | Pintu registrasi lead | **201** tanpa gate role — **sama seperti Go**, O39 dipertahankan sadar |
| C-02 | Notifikasi | tanpa auth **401** · `{data, unread_count}` · id malformed **400** `[id tidak valid]` |

Cek `sales_lead` (scope divisi) adalah yang **naik dari 21 → 22** sejak 2026-07-29; ini
kali pertama tingkat `lead` Role Matrix teruji terhadap deployment sungguhan.

### 3.2 `wave3-contract-smoke.mjs` → **34/34 wired**

Seluruh 34 endpoint Wave 3 (M2 marketing · M3 live-stream/brief · M10 health · M13/M14
performance) menjawab dari domain, bukan dari 404 router. Yang **200**: list campaigns,
performance-dashboard, brief-queue, kedua `snapshots/scan`, performance trend/teams,
config weights + targets. Yang **404 domain response**: entitas contoh yang memang belum
ada di produksi bersih. Yang **400 domain response**: body sengaja tak valid.

Durasi 3m40s — terpanjang di run ini, karena `snapshots/scan` benar-benar menghitung (§5.2).

### 3.3 `auth-smoke.mjs` → **13/13 PASS** (menutup SKIP-3)

Tanpa token **401** · token sampah **401** · **tanda tangan salah-secret 401** · kedaluwarsa
**401** · **`alg:none` confusion 401** · tanda tangan sah tanpa klaim `employee_id` **401** ·
token sah → **201** · `GET /me` tanpa sesi **401**, dengan cookie sah **200** · login body
kosong **400** · logout **200** + `Max-Age=0; HttpOnly; SameSite=Lax; Secure`.

SKIP-3 di report 2026-07-28 adalah artefak seed (`EMP-202607-0001` tidak ada di seed lokal).
Terhadap deployment ia **PASS sendiri**, persis seperti yang diprediksi — dan bukan karena
skrip dilonggarkan, melainkan karena aktornya kini diresolusi dari environment.

---

## 4. SKIP

**SKIP-2 — QA badge notifikasi di `web-internal` ter-deploy. MASIH TERBUKA.**
Kontrak API-nya sudah terbukti dua kali (`{data, unread_count}`, 401 tanpa auth,
`[id tidak valid]` 400) — yang belum pernah dilihat adalah **render badge-nya di browser**.
Tidak bisa diotomatiskan tanpa menyimpan password user produksi sebagai secret, dan itu
harga yang tidak sepadan untuk satu cek ~3 menit.

**Ke mana ia pergi:** ke daftar **QA UI C-04**, berdampingan dengan `/master-services` dan
`/sales/kalkulator` yang sudah lebih dulu di sana. Ia tidak menahan C-03 (§0), tetapi juga
tidak boleh menguap.

> 🔎 **Satu hal yang justru memudahkan sekarang:** run ini meninggalkan **38 notifikasi
> belum-dibaca** di produksi (§5.2). Sebelumnya tabel `notifications` **kosong**, jadi
> badge tidak punya apa pun untuk dirender. Sekarang ada — QA badge bisa dilakukan
> **sebelum** residu §5.2 dibersihkan, dan sesudahnya jadi sulit lagi.

SKIP-1 dan SKIP-3 dari report 2026-07-28: **✅ tertutup**, §3.1 dan §3.3.

---

## 5. 🟠 Residu produksi — dibaca dari live sesudah run

Aturan rumah #3: riwayat **append-only**. Apa pun yang ditulis run ini **permanen** kecuali
ada keputusan sadar untuk membersihkannya. Pemilik menyetujui tulis (`confirm_write: YA`),
tetapi yang diumumkan sebelum approval hanya *"2 lead `ZZC03` + baris `audit_log`"`*.
**Jejaknya lebih luas.** Diukur dari `CDPS SG` sesudah run:

| Tabel | Sebelum | Sesudah | Delta |
|---|---|---|---|
| `leads` | 3 | **6** | **+3** |
| `prospect_attempts` | 3 | **6** | +3 |
| `audit_log` | 43 | **50** | +7 |
| `performance_snapshots` | **0** | **38** | **+38** 🟠 |
| `notifications` | **0** | **38** | **+38** 🟠 |
| `clients` · `transactions` · `client_health_snapshots` | 0 | **0** | nol — tak tersentuh |

### 5.1 Lead ketiga TIDAK ber-marker `ZZC03`

| Lead | Nama | Pembuat | Skrip |
|---|---|---|---|
| `LEAD-202607-0004` | `ZZC03 Alpha 7620637` | `‹NIK-A›` | walk |
| `LEAD-202607-0005` | `ZZC03 OD 7620637` | `2501140493` | walk (cek PARITY) |
| `LEAD-202607-0006` | **`Smoke`** 🟠 | `‹NIK-A›` | **auth-smoke** |

Runbook C-03 mengajarkan cara membersihkan jejak walk dengan **mencari prefix `ZZC03`**.
Prosedur itu **akan melewatkan `LEAD-202607-0006`** — `auth-smoke` memakai konvensi penamaan
sendiri (`Smoke`) untuk cek *"token sah → auth lolos (201)"*. Bukan cacat kode: skrip itu
lahir sebagai smoke lokal, di mana residu tidak berarti apa-apa. Terhadap produksi ia berarti.

**Konsekuensi untuk DoD C-04** (*"nol fixture UAT di produksi"*): daftar bersih-bersih harus
menyebut **tiga** lead + tiga `prospect_attempts`, bukan dua. Baris `audit_log`-nya
**tidak boleh** dihapus — aturan rumah #3 tidak punya pengecualian untuk data uji.

### 5.2 `snapshots/scan` menghitung sungguhan: 38 snapshot + 38 notifikasi

`POST /api/v1/performance/snapshots/scan` di §3.2 **bukan** panggilan kosong. Ia menghitung
dan menyimpan **38 `performance_snapshots`** (`PERF-202606-0001`…`0038`, periode
**2026-06-01 → 2026-06-30**, 38 staff berbeda, 4 `role_type`, `computed_by='system'`), lalu
memancarkan **38 notifikasi `m14.performance.published`** — satu per staff.

Dua hal yang perlu dinyatakan terang-terangan:

1. **38 karyawan riil kini punya notifikasi belum-dibaca** tentang skor performa periode Juni
   yang dihitung dari produksi yang **nol transaksi, nol klien**. Angkanya benar secara mesin
   dan **tidak bermakna** secara bisnis. Kalau ada yang login sebelum ini dibersihkan, itulah
   yang mereka lihat lebih dulu. (Sisi baiknya: ini yang membuat SKIP-2 bisa dikerjakan — §4.)
2. **Handoff SESI24 §3 butir 8 sudah usang.** Ia mencatat `performance_snapshots` **0 baris**
   sehingga arm RLS-nya belum terbukti oleh data. Kini ada **38 baris** — probe RLS itu bisa
   dijalankan sekarang, tapi **atas data sintetis**, jadi hasilnya membuktikan policy, bukan
   membuktikan perilaku terhadap data riil.

`POST /health/snapshots/scan` juga **200**, tetapi menulis **nol** baris — benar, karena
`clients` = 0. Perbedaan perilaku dua `scan` ini murni soal ada/tidaknya subjek.

### 5.3 Slot Finance masih dilayani fixture O50 — dan itu membuat run ini rapuh

`finance_staff` diresolusi ke **`9900000007`** ("QA Finance"), salah satu dari 10 akun
fixture `99…` yang DoD C-04 wajibkan **nol** di produksi. Roster live: **69 aktif = 59 riil +
10 fixture** (dibaca hari ini; Finance punya 4 aktif = **3 riil** + 1 fixture).

Artinya: **begitu O50 dieksekusi, run ini tidak reproducible apa adanya** — discovery akan
memilih Finance staff riil, atau gagal menemukan slot bila pemetaan role-nya belum ada.
Bukan alasan menunda O50; alasan untuk **menjalankan ulang workflow sesudah O50** dan
memperlakukan hasilnya sebagai konfirmasi akhir sebelum gate GO. Biayanya satu klik approval.

---

## 6. Keadaan `CDPS SG` — dibaca dari live 2026-07-31, bukan disalin

| | |
|---|---|
| Migrasi | **44** (repo juga 44, cocok 1:1) |
| Tabel `public` | **54** |
| `notif_events` | **17** |
| Karyawan aktif | **69** (59 riil + 10 fixture O50) |
| `role_mappings` | **39** |
| Layered role | `director` **6** · `od` **4** · `lead` **3** |
| `master_services` | **32** |
| Klien · transaksi | **0** · **0** |

`director: 6 · od: 4` cocok dengan yang dibaca runner dari deployment (§1) — 5 director riil
+ 1 fixture, 3 od riil + 1 fixture. **Nol migrasi baru** dijalankan sesi ini.

---

## 7. Cara mengulang report ini

Actions → **C-03 deployment UAT** → *Run workflow* → `confirm_write: YA` → approve
environment `c03-production`. Ketiga skrip jalan berurutan, output ter-`tee` ke
`c03-walk.txt` · `c03-wave3.txt` · `c03-auth.txt` dan terunggah sebagai artifact `c03-output`.

Tidak ada langkah lokal. Tidak butuh laptop tertentu. Yang dibutuhkan manusia hanya
**satu klik approval** — dan gerbang itu memang sengaja ada (§1).

> Jalur alternatif dari mesin ber-secret masih sahih:
> `docs/handoff/TUTORIAL_C03_LANGKAH_DEMI_LANGKAH.md` + `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`.
