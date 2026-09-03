# HANDOFF — Insight Laporan Editable + Client Portal (Gelombang 1 SELESAI)

**Tanggal:** 2026-09-08, **diperbarui 2026-09-03** (migrasi sudah di-push ke live — lihat §0 dan §5.1)
**Branch:** `claude/cdps-advertiser-tools-consolidation-xxpzow` (sudah di-push)
**Pemilik permintaan:** Yohan (Director)
**Rencana penuh:** `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` · **Tiket kecil:** `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/cdps-advertiser-tools-consolidation-xxpzow` — sudah di-push, **10 commit di atas `171c72f`** |
| **PR** | Lihat §6. Kalau belum ada, **buat sebagai draft** (owner belum me-review) |
| **Migrasi baru** | **3 berkas, SEMUA SUDAH DI-PUSH ke `CDPS SG` live 2026-09-03** — `20260908010000_c1_laporan_insight_publikasi.sql`, `20260908020000_sm_transition_id_type_aware.sql`, `20260908030000_fix_complaint_rate_limit_execute_surface.sql`. Live: **168 migrasi, 139 tabel, 31 mesin**. Detail + cara push yang BENAR di §5.1 |
| **⚠ Cara push** | **JANGAN `supabase db push` di proyek ini** — ledger versi live berbeda wholesale dari nama berkas repo (isi skema sama). Pakai `apply_migration` per berkas. Lihat §5.1 dan `DECISIONS.md` 2026-09-03 / `O65` |
| **Gerbang hitungan** | tabel `139` · `entity_prefix` **37 (tak berubah)** · `sm_machines` **31** (30→31) · `notif_events` **67 (tak berubah)** — sudah dinaikkan di `ci.yml` DAN `scripts/db-rebuild.sh` |
| **Status suite** | Semua hijau, dijalankan dengan Postgres nyata — angkanya di §4. Jangan percaya baris ini, jalankan ulang |
| **Postgres lokal** | `service postgresql start` lalu `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"`. **Tanpa ini 60+ berkas tes hanya "skip", dan skip BUKAN lulus** |

---

## 1. Yang diminta pemilik, dan apa yang berubah dari asumsi awal

Permintaan aslinya: gabungkan tiga alat HTML tim advertiser (MEA SKU Screener v2, Shopee Report Engine, TikTok Report Engine) ke CDPS; parse data mentah jadi insight; insight utama mengisi laporan mingguan/bulanan supaya tidak upload manual; mulai bangun Client Portal (klien ajukan komplain + baca laporan HTML, supaya tim tak lagi kirim link embed); dan laporannya bisa **disunting bagian insight-nya, bukan bagian data**.

**Temuan audit yang mengubah rencana:** report engine **TikTok sudah ada di CDPS** dan **lebih detail** daripada HTML yang dipakai tim.

| | HTML kiriman pemilik | CDPS `packages/core/src/report` |
|---|---|---|
| Seksi | 12 | **13** (punya "TikTok Ads Manager (Brand & Upper Funnel)" yang HTML-nya tidak punya) |
| Blok internal | `display:none` — masih kebaca di View Source berkas yang diteruskan ke klien | string-nya **tidak pernah dibangun** |
| Benchmark | bisa diedit di browser ⇒ skor tak bisa dihitung ulang | `report_benchmark` berversi ⇒ recomputable |
| Nomor seksi | statis (bolong 8 → 10 kalau berkas kurang) | dinomori ulang saat render |

Engine itu lahir 2026-08-19 dari **gap audit "Kelas C1"**, bukan dari PRD — itulah kenapa `M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` §6 tidak mengetahuinya dan masih merencanakan iframe ke sistem eksternal `mea-client-reporting`.

Jadi Gelombang 1 **bukan** membangun engine, melainkan menambahkan dua hal yang hilang: **insight bisa disunting**, dan **klien punya tempat membacanya**.

---

## 2. Keputusan pemilik yang mengikat (jangan ditafsir ulang)

Ditanya lewat `AskUserQuestion`, dijawab langsung:

1. **Gerbang terbit: AM sunting DAN terbitkan sendiri** — tanpa review Head of Account. (Dua opsi lain ditolak: review HoA, atau review hanya untuk bulanan.)
2. **Shopee diport PENUH** (bukan ditunda, bukan sebagian).
3. **SKU Screener: keempat modul** masuk (A screening, B sebelum/sesudah, C Decision Log, D Tracker Optimasi).
4. **Portal klien: sekalian Service Progress + Health band**, bukan cuma laporan + komplain.
5. **Urutan: insight editable + portal klien DULU**, lalu Shopee, lalu SKU Screener.
6. **Tampilan HTML wajib semenarik output engine pemilik** — celahnya dicek dengan merender berdampingan, bukan dikira.
7. **TikTok Ads Scanner menyusul** setelah build ini; HTML-nya akan dibuat pemilik.

---

## 3. Arsitektur yang dipilih — dan alasan yang harus dipertahankan

### Insight editan TIDAK masuk `payload`
`client_reports.payload` dijaga trigger `client_reports_frozen` terhadap **UPDATE apa pun** (bukan per kolom). Jadi:

- `client_report_insight` — **append-only**, satu baris per revisi TEKS. Revisi 0 = snapshot mesin (`sumber='mesin'`, CHECK mengikat `revisi=0 ⇔ mesin`).
- `client_report_publikasi` — satu baris per laporan; `status` HANYA lewat `sm_transition` (mesin `client_report` **#31**), dan `insight_revisi` **MEMAKU** revisi mana yang dibaca klien.

**Kenapa DIPAKU, bukan "revisi terbaru menang".** Kalau terbaru menang, setiap tekan Simpan langsung jadi pengumuman — AM tak punya cara menyunting laporan yang sudah tayang tanpa klien menonton prosesnya. Dengan paku: menyimpan aman, `Terbitkan pembaruan` yang memindahkan paku (dan menolak kalau tak ada revisi lebih baru). **Pratinjau internal membaca revisi TERBARU, render klien membaca yang TERPAKU** — dua kebenaran yang memang beda.

**`reset` MENYALIN revisi 0**, bukan menjalankan mesin lagi: versi benchmark bisa sudah bergerak, dan "kembalikan ke insight mesin" harus berarti teks yang laporan ini dibangun dengannya.

### Laporan dirender SAME-ORIGIN ⇒ OQ-8 lenyap
Spec §6 menyisakan OQ-8 terbuka (cara melewatkan token ber-scope ke `mea-client-reporting` tanpa membocorkan cookie sesi Portal). Karena engine-nya di dalam CDPS, **tak ada origin kedua dan tak ada token untuk dilewatkan**. Portal memuat `GET /api/v1/client-portal/reports/{id}/html` di iframe same-origin. M15 Rule 3 ("natively embedded") tetap terpenuhi; yang menyimpang hanya MEKANISMEnya — dicatat sebagai deviasi di `DECISIONS.md`.

### Tiga temuan nyata saat mengerjakan (semuanya sudah diperbaiki)

1. **`sm_transition` cacat, bukan tabel saya.** Tanda tangannya mengaku menerima `(p_table, p_id_col, p_status_col)` apa pun, tapi `WHERE %I = $1` dengan `$1 text` hanya jalan untuk kunci teks — tak pernah terlihat karena setiap entitas CDPS berkunci `PREFIX-YYYYMM-NNNN`. `client_report_publikasi` mesin pertama berkunci surrogate `bigint` ⇒ `operator does not exist: bigint = text`. Digeneralisasi (migrasi `20260908020000`): tipe kolom dibaca dari katalog, **parameternya** yang di-cast (`$1::<tipe>`) — cast di kolom akan mengeluarkannya dari indeks. **Nol perubahan perilaku untuk 30 mesin lain, dibuktikan domain 1716/1716.**
2. **CHECK saya sendiri jadi jalan buntu.** `ck_crp_dicabut_tanpa_paku` membuat KEDUA urutan pencabutan mustahil (stamp-dulu melanggar `ck_crp_terbit_lengkap`, transisi-dulu melanggar `ck_crp_cabut_lengkap`). Dihapus — dan substansinya lebih baik tanpa: **paku DIPERTAHANKAN saat pencabutan** sebagai jejak "revisi mana yang sudah dibaca klien"; keterbacaan ditentukan `status`, yang digerbang setiap jalur baca klien.
3. **XSS di `CHART_DATA`.** Menambahkan nama produk (dikendalikan klien) ke `CHART_DATA` membuat tes escaping yang SUDAH ADA gagal: `JSON.stringify` tidak meng-escape `<`, jadi produk bernama `</script><script>…` menutup tag lebih awal. `jsonForScript()` meng-escape `<`/`>`/`&` jadi `\uXXXX`; dipasang juga pada `CHART_DATA` yang sudah lama ada, karena kelas kerentanannya di PENYEMATAN, bukan di field yang ditambahkan.

---

## 4. Verifikasi yang benar-benar dijalankan

```
db-rebuild      167 migrasi · tabel 139 · entity_prefix 37 · sm_machines 31 ·
                notif_events 67 · 4 invariant SQL (ident/immutability/rls/auth_claims) LOLOS
@cdps/api       397/397     (7 yang tadinya skip ikut jalan dengan DATABASE_URL)
@cdps/core      327/327     (+7 tes paritas visual & escaping)
@cdps/db        53/53
@cdps/domain    1716/1716 (+1 skip)   ← 49 tes baru
web-internal    427/427 · tsc bersih  (+7 tes)
web-portal      19/19 · tsc bersih · lint bersih · build 10 route  (+9 tes)
typecheck       keempat workspace bersih · lint @cdps/api bersih
```

**Uji perilaku constraint langsung di Postgres (14, semuanya menegakkan sesuatu):** revisi 0 wajib `mesin`, revisi >0 tak boleh `mesin`, `poin` wajib array JSON, ringkasan kosong ditolak, UPDATE+DELETE revisi ditolak, `[Terbit]` wajib berpaku, `[Dicabut]` wajib beralasan, komplain portal wajib berkontak, komplain WhatsApp tetap boleh tanpa kontak, rate limit ke-6 diblokir.

**Paritas visual — laporan dibuka di Chromium sungguhan** (Playwright; Chart.js dari npm karena CDN diblokir egress policy sandbox):

```
kanvas         ukuran      piksel tergambar
c_harian       1263x421     378.819  TERGAMBAR
c_kanal        1264x1264    902.758  TERGAMBAR
c_iklan        1264x842     213.502  TERGAMBAR
c_livehari     1264x926     358.088  TERGAMBAR
c_quad_rel     1264x1095     57.486  TERGAMBAR   ← baru
c_quad_bench   1264x1095     57.712  TERGAMBAR   ← baru
CHART_DATA     parsed=true, 4 produk (bukan 5 dengan satu hilang diam-diam)
meter skor     conic-gradient(rgb(180,83,9) 252deg, …)
tombol PDF     ada & terlihat
```

Piksel dihitung dari alpha `getImageData` — kanvas kosong lolos uji ukuran tapi tidak uji ini. Berbanding HTML kiriman: kanvas **6 vs 6**, FontAwesome ada di dua-duanya, html2pdf ada di dua-duanya, chart kuadran ada di dua-duanya, **meter skor hanya ada di CDPS**.

Skrip verifikasinya ada di scratchpad sesi ini (`render-check.mjs`, `parity.mjs`) — **tidak di-commit** karena butuh Playwright + Chart.js dari npm. Kalau perlu diulang, tulis ulang; polanya: render `renderReportHtml` ke berkas, intercept URL CDN, hitung piksel alpha per kanvas.

---

## 5. AKSI BERIKUTNYA — urutan wajib

### 5.1 ✅ SELESAI 2026-09-03 — 3 migrasi sudah di `CDPS SG` live

Ketiganya diterapkan lewat `mcp__Supabase__apply_migration` (proyek `egddxfcnrtecheiykhlf`), berurutan:

1. `20260908010000_c1_laporan_insight_publikasi.sql`
2. `20260908020000_sm_transition_id_type_aware.sql`
3. `20260908030000_fix_complaint_rate_limit_execute_surface.sql` — **lahir dari temuan pasca-push**, lihat di bawah

**Keadaan live setelahnya (diverifikasi, bukan diasumsikan):** 168 migrasi · **139 tabel** · **31 mesin** · `client_report` initial `[Draf]`, 3 edge, **0 terminal state** · `entity_prefix` **37** (tak berubah) · `notif_events` **67** (tak berubah) · 5 policy baru · 2 trigger append-only di `client_report_insight`.

#### Tiga hal yang ditemukan saat push — baca sebelum push berikutnya

**(a) 🔴 `supabase db push` TIDAK BOLEH dipakai di proyek ini.** Ledger versi live memakai cap detik-nyata (`20260902041244`), berkas repo bernama bulat (`20260902040000`). Keduanya hanya sama sampai `20260807120000`; sesudah itu live punya ~100 versi yang tak ada sebagai berkas dan repo punya ~100 berkas yang versinya tak ada di live. **Isi skemanya justru cocok** — sebelum push live 136 tabel / 30 mesin / 37 prefix / 67 event, identik dengan `db-rebuild.sh` lokal. Jadi `db push` akan mencoba menerapkan ULANG ~100 migrasi yang isinya sudah ada dan gagal massal. **Yang benar:** `apply_migration` untuk berkas tertentu, dan pastikan prasyaratnya ada di live lewat kueri katalog — **jangan** berasumsi "nomor lebih kecil berarti sudah jalan", nomor di dua sisi tidak sebanding. Repo juga punya **4 pasang berkas ber-versi kembar** (`20260901010000`–`20260901040000`). Semua ini jadi `O65` di `DECISIONS.md`; keputusannya milik pemilik.

**(b) 🟢 Bug keamanan di migrasi saya sendiri, ditangkap advisor Supabase.** `20260908010000` §5 menutup `check_complaint_rate_limit` dengan `REVOKE ALL … FROM anon` lalu `… FROM authenticated`. **Itu tidak mencabut apa pun**: Postgres memberi `EXECUTE` ke `PUBLIC` untuk setiap fungsi baru dan kedua role itu mewarisi lewat PUBLIC. Karena fungsinya MENULIS dan ambangnya per-kontak, pemanggil tanpa login bisa memanggil `/rest/v1/rpc/check_complaint_rate_limit` berulang dengan uuid kontak seorang klien sampai kuotanya habis — **DoS pada satu-satunya pintu komplain mandiri** (M15 Rule 5). Uuid kontak ada di klaim JWT portal, jadi bukan rahasia. Ditambal `20260908030000` dengan pola saudara kandungnya (`20260906010000` baris 69–70): `REVOKE EXECUTE … FROM public, anon, authenticated` + `GRANT … TO service_role`. Diverifikasi `has_function_privilege`: `anon=false, authenticated=false, service_role=true`.

> **Pelajaran yang berlaku umum:** setiap `SECURITY DEFINER` baru wajib `REVOKE EXECUTE … FROM public` — bukan hanya dari `anon`/`authenticated`. Kalau menulis fungsi seperti ini lagi, salin baris 69–70 `20260906010000`, jangan tulis dari ingatan.
>
> **Masih terbuka, BUKAN milik saya:** advisor juga menandai `public.working_days_between(date, date)` bisa dieksekusi `anon` (SECURITY DEFINER sejak `20260907020000`, sebelum sesi ini). Dampaknya jauh lebih kecil — ia hanya menghitung hari kerja dari `hari_libur`, nol tulis, nol rahasia — jadi **sengaja tidak saya sentuh** supaya tiket ini tidak melebar. Tapi ia kelas yang sama dan layak satu tiket sendiri.

**(c) Verifikasi transisi mesin lama dilakukan TANPA menyentuh data produksi.** Migrasi (2) mengganti `sm_transition` yang dipakai 31 mesin, jadi klaim "nol regresi" harus dibuktikan di live, bukan hanya lokal. Caranya: satu blok `DO $$ … $$` yang menjalankan transisi NYATA lalu `RAISE EXCEPTION` di akhir supaya seluruh transaksi di-rollback. Enam hal diuji dan lulus semua: (1) `service` varchar `[Awaiting Onboarding]→[Briefed]` + kolomnya benar-benar berubah, (2) `interview` varchar `Belum Dijadwalkan→Terjadwal`, (3) edge tidak sah tetap `blocked`, (4) gerbang role tetap `role_denied`, (5) `client_report` **bigint** balas `not_found` dengan rapi — inilah jalur yang dulu meledak `operator does not exist: bigint = text`, (6) actor wajib tetap ditegakkan. Sesudahnya diperiksa: `services` kembali `[Awaiting Onboarding]`, `interview` kembali `Belum Dijadwalkan`, **0 baris `audit_log` dengan `actor_employee_id='EMP-TEST'`**. Pola ini layak dipakai ulang untuk verifikasi apa pun di produksi.

### 5.2 PR + review pemilik
Draft PR (§6). Pemilik belum melihat UI-nya. Yang paling perlu dilihat langsung:
- `/clients/{id}` → panel Laporan → tombol **"insight & terbit"** → editor 6 bagian.
- Pratinjau **Klien** vs **Internal** (blok internal harus hilang di Klien).
- Login kontak klien di `/klien` → laporan tampil di iframe, chart tergambar.

### 5.3 Belum diuji end-to-end dengan data NYATA
Semua verifikasi pakai fixture. **Belum ada** laporan dari export Seller Center asli yang diterbitkan lalu dibaca kontak klien sungguhan di browser. Itu langkah UAT yang harus dijalankan pemilik/AM.

### 5.4 Kemudian: Gelombang 2 → 3 → 4
**Rencana penuh empat gelombang: `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md`** (aturan porting, pemetaan `OPT-` vs `ADL-`, kontrak Gelombang 4, verifikasi). Tiket kecil di `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`. Ringkas:
- **Gelombang 2 (Shopee):** SH-01..SH-06. Yang paling bernilai: **SH-06** — buat `MTR-` (Metric Entry, `entry_method='File Export'`) dari hasil parse. **Itulah jalur "tidak upload manual" untuk M6D RM-C**, BUKAN menulis `wrr_metrik` langsung (baris `otomatis` di sana UPDATE-blocked, itu invariant beku).
- **Gelombang 3 (SKU Screener):** **SC-00 dulu** — 10 asumsi terbuka PRD (A01–A10) wajib dikonfirmasi pemilik sebelum sprint; A08 (default ROAS Fase 1 = 3,57) dan A03 (Kode Produk sebagai primary key) paling berdampak.
- **Gelombang 4 (Ads Scanner):** tunggu HTML dari pemilik, lalu putuskan embed vs port dengan aturan: **angka cuma dibaca manusia → embed; angka menggerakkan keputusan sistem → port.**

---

## 6. PR

Kalau `mcp__github__create_pull_request` belum dipakai saat handoff ini ditulis, buat dengan:
- `owner: MEAgrup`, `repo: AgencyAPP`, `base: main`
- `head: claude/cdps-advertiser-tools-consolidation-xxpzow`
- `draft: true`
- Judul: `feat: insight laporan klien bisa disunting + Client Portal (laporan, progres, health, komplain)`

Repo **tidak punya** PR template (dicek: `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, root, `docs/` — nol).

---

## 7. Jebakan yang sudah ditemukan — jangan ulangi

- **`skip` bukan `pass`.** `npm test --workspaces` tanpa `DATABASE_URL` membuat 60+ berkas tes lewat begitu saja. Nyalakan Postgres.
- **`web-internal` dan `web-client-portal` TIDAK ikut `npm test --workspaces`** (root `workspaces` hanya `apps/*` + `packages/*`). Jalankan `npm test` di masing-masing direktori.
- **Tabel append-only tak bisa dibersihkan fixture.** `client_report_insight` dan `client_health_snapshots` menolak DELETE. Pola yang dipakai (mengikuti `activity.test.ts`): `alter table … disable trigger …` di dalam `try/finally` supaya throw tak pernah meninggalkan penjaga dalam keadaan mati.
- **`ON DELETE CASCADE` pada tabel yang menolak DELETE adalah kebohongan skema** — CASCADE tak mungkin jalan, dan mendeklarasikannya cuma menukar pesan galat yang jelas dengan yang membingungkan. Konsekuensi yang diterima: laporan yang punya revisi insight tidak bisa dihapus.
- **Gerbang `ledger O48` di `rls_checks.sql` bekerja.** Tiga policy realm klien memang tanpa arm lead/divisi, dan itu BENAR (kontak klien tak punya divisi; menambahkannya memberi setiap lead MEA jalur baca kedua yang melewati gerbang `[Terbit]`). Ledger-nya diperpanjang **dengan alasan tertulis di berkas ujinya**, sesuai jalur yang dokumen itu sendiri tetapkan.
- **1 error lint `react-hooks/static-components`** di `web-internal/src/app/(shell)/admin/employees/page.tsx` — **PRE-EXISTING**, terbukti identik saat seluruh perubahan ini di-stash. Di luar cakupan, sengaja tidak diperbaiki di sini.
- **🔴 `supabase db push` akan gagal massal di proyek ini** — ledger versi live ≠ nama berkas repo (isi skema sama). Pakai `apply_migration` per berkas, dan cek prasyarat lewat kueri katalog. Nomor migrasi di dua sisi TIDAK sebanding, jadi "nomornya lebih kecil, pasti sudah jalan" adalah kesimpulan yang salah. Detail: §5.1(a), `DECISIONS.md` 2026-09-03, `O65`.
- **`REVOKE ALL … FROM anon` TIDAK menutup fungsi baru.** Postgres memberi `EXECUTE` ke `PUBLIC`; `anon`/`authenticated` mewarisi lewat sana. Setiap `SECURITY DEFINER` baru wajib `REVOKE EXECUTE … FROM public, anon, authenticated` + `GRANT … TO service_role` — salin `20260906010000` baris 69–70. Ini bukan teori: migrasi saya sendiri kena, dan akibatnya DoS pada pintu komplain. Detail: §5.1(b).
- **Menjalankan suite penuh DUA KALI di satu DB tanpa rebuild memunculkan 2 kegagalan palsu.** `admin.test.ts > hari libur (integration)` dan `client.test.ts > Hold Service two-step` menghitung baris `audit_log`, jadi run kedua menghitung sisa run pertama ("expected 7 to be 1"). Di DB bersih keduanya lulus (domain **1716 lulus, 0 gagal, 1 skip**). Kalau melihat kegagalan berbentuk `expected N to be 1`, **rebuild dulu** sebelum mencari bug — dan jangan sebaliknya: jangan mengira ia hijau kalau belum pernah dijalankan di DB bersih.
- **Verifikasi di produksi TIDAK harus meninggalkan jejak.** Bungkus transisi/insert nyata dalam `DO $$ … RAISE EXCEPTION … $$` supaya seluruhnya rollback, lalu buktikan nol jejaknya (status kembali + `count(*)=0` di `audit_log`). Ini yang dipakai untuk membuktikan `sm_transition` baru tidak meregresi 30 mesin lama di live. Detail: §5.1(c).

---

## 8. Peta berkas (untuk orientasi cepat)

**Core:** `packages/core/src/report/insight-edit.ts` (baru) · `render.ts` (override insight, `quadBubble`, `gauge`, `jsonForScript`, `PDF_BOOT`) · `payload.ts` (`PayloadInsight`)
**Migrasi:** `supabase/migrations/20260908010000_*.sql` · `20260908020000_*.sql`
**Domain:** `packages/domain/src/report.ts` (7 verba baru) · `client-portal.ts` (baru) · `account.ts` (`insertComplaint` diekstrak)
**API:** `apps/api/src/app/api/v1/reports/[id]/{insight,insight/reset,publish,republish,revoke}` · `client-portal/{reports,reports/[id]/html,service-progress,health,complaints}` · `lib/wire.ts` · `lib/http.ts`
**web-internal:** `src/components/clients/InsightEditor.tsx` (baru) · `ReportPanel.tsx` · `lib/report.ts`
**web-client-portal:** `src/app/(portal)/{laporan,laporan/[id],progres,komplain}/page.tsx` · `page.tsx` · `layout.tsx` · `lib/portal-data.ts` (baru) · `lib/types.ts` · `next.config.ts` (CSP)
**Guard:** `apps/api/src/lib/shape-parity.test.ts` (kini memindai `web-client-portal` juga) · `supabase/tests/{immutability,rls}_checks.sql`
**Dokumen:** `docs/DECISIONS.md` (5 entri 2026-09-08) · `docs/STATE_MACHINES.md` §21 · `docs/DATA_MODEL.md` · `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` (catatan bertanggal) · `docs/backlog/CLIENT_REPORT_PORTAL_BACKLOG.md`

---

## 9. Update sesi lanjutan (2026-09-03, branch `claude/advertiser-tools-consolidation-waves-6tl68h`)

**§5.1(b) ditutup.** Item yang sengaja dibiarkan terbuka ("masih terbuka, BUKAN milik saya") — `working_days_between` SECURITY DEFINER bisa dieksekusi `anon` — ditambal migrasi `20260908040000_fix_working_days_between_execute_surface.sql`: `REVOKE EXECUTE … FROM public, anon` + `GRANT … TO authenticated, service_role` (bukan dikunci total ke `service_role` seperti `check_complaint_rate_limit`, karena fungsi ini memang perlu dipanggil `authenticated` lewat `readAsActor`). Diverifikasi lokal (db-rebuild 169 migrasi hijau, domain 1716/1716, db 53/53) sebelum `apply_migration` ke live; advisor Supabase tidak lagi melaporkan `anon_security_definer_function_executable` untuk fungsi ini. Entri `DECISIONS.md` 2026-09-03.

**Gelombang 2 (Shopee) dan Gelombang 3 (SKU Screener) BELUM DIMULAI — diblokir data, bukan diputuskan ditunda.** Dicek dulu sebelum menulis kode apa pun:

- `docs/design/README.md` hanya memuat `BASELINE_TOOL_TIKTOK_v1.html`. **Tidak ada berkas sumber Shopee Report Engine di repo** (17 modul, 12 seksi) — §5 rencana ini cuma ringkasan tanda tangan/bobot, bukan kolom asli/rumus asli. Menulis `detect.ts`/`metrik.ts`/`skor.ts` dari ringkasan itu = menebak nama kolom dan rumus, persis yang `docs/design/README.md` peringatkan eksplisit ("minta pemilik menempelkan ulang versi aslinya… jangan menebak"). **Perlu:** pemilik/tim advertiser tempel ulang HTML Shopee Report Engine (pola yang sama dengan `BASELINE_TOOL_TIKTOK_v1.html`), disimpan ke `docs/design/` sebelum SH-01 dimulai.
- **SC-00 belum bisa dikerjakan** — PRD SKU Screener v1.0 (R01–R16, asumsi A01–A10) tidak ada di repo sebagai berkas; tidak ada yang bisa dikonfirmasi tanpa teksnya. **Perlu:** pemilik tempel PRD-nya (atau daftar A01–A10 saja) supaya SC-00 bisa masuk `DECISIONS.md` sebagai `SCR-1..SCR-10` sebelum SC-01 dimulai.

Kedua hal ini ditanyakan ke Nerissa (COO) di sesi yang sama.
