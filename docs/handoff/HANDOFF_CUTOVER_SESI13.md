# HANDOFF — Cutover Sesi 13 (Fase 0 + Fase 1 pensiun Go)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI12.md`. Yang masih berlaku tidak diulang — terutama
> SESI9 §6 (aturan rumah yang menggigit) dan SESI12 §2.4 (`scripts/db-rebuild.sh`, kini
> satu-satunya jalur yang benar untuk DB lokal).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch** | `claude/cdps-sg-cutover-migrasi-azzlwr` |
| **HEAD** | tip `claude/cdps-sg-cutover-migrasi-azzlwr` — commit **kode** terakhir `5453f69`, di atasnya hanya commit docs handoff ini. Sudah dipush, working tree **bersih**, nol pekerjaan tertinggal di disk |
| **Isi branch** | **6 commit** di atas `main@7bbd5e1`: `38fed0c` → `628bb4b` → `f25f329` → `16b2504` → `5453f69` → (docs handoff) |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** (tidak bergerak sesi ini — nol perubahan skema) |
| **Repo migrasi** | **40 berkas**, cocok 1:1 dengan riwayat live |

**Angka acuan (Postgres 16 lokal, DB dibangun ulang dari nol dengan 40 migrasi):**
`@cdps/domain` **552** (+1 skip) · `apps/api` **211** · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · keempat invariant SQL **PASS** ·
`route-parity` **5/5 dengan `KNOWN_GAPS` KOSONG** · typecheck bersih semua workspace ·
eslint `web-internal` bersih.

> Beda dari SESI12: **domain 513 → 552** (+39 test baru). Sisanya tidak bergerak.

---

## 1. Yang selesai sesi ini

Peta pensiun Go punya 6 fase (§4). **Fase 0 dan Fase 1 selesai penuh.**

### 1.1 Fase 0 — data kanonik dikeluarkan dari `backend/` 🟢

Mudah terlewat dan mahal kalau terlewat: opsi *"tag rilis lalu hapus `backend/`"* di
`CUTOVER_BACKLOG.md` §C-05 butir 2 akan **ikut menghapus data organisasi riil**.

**Disalin** ke `supabase/seed/` (+ `README.md` provenance): `role_mappings_riil.csv` (23 mapping
HRIS riil) · `layered_roles_riil.csv` · `hris_department_jabatan_pairs.csv` (28 pasangan).

> ⚠️ **Disalin, bukan dipindah — dan itu koreksi yang harganya satu CI merah.** Percobaan
> pertama memakai `git mv`, dan job `backend` gagal: **5 test `cmd/rolemapseed`** membuka kedua
> CSV riil lewat helper `FindRoleMappingsCSV()` / `FindLayeredRolesCSV()`, jadi nama berkasnya
> **tidak pernah muncul sebagai string** di berkas test — grep atas nama berkas di `*_test.go`
> mengembalikan nol dan pemindahan terlihat aman. `go vet` yang lolos juga tidak membuktikan
> apa pun: **vet tidak menjalankan test.** Sampai job `backend` dicabut di Fase 5, ketiga
> berkas harus **ada di kedua tempat**, byte-identik (md5 diverifikasi) — persis seperti
> `msl_kalkulator.csv` sejak C-04. Kalau Anda menyentuh area ini lagi: satu-satunya cara aman
> memastikan sebuah berkas data tak dirujuk Go adalah mengaudit **helper pencari berkas**
> (`grep 'func Find'` di `backend/cmd/`), bukan nama berkasnya.

`hris_department_jabatan_pairs.csv` tetap hanya di `supabase/seed/` — diaudit dengan cara di
atas: satu-satunya literal path `testdata/` di test Go adalah `testdata/employees.csv`, dan
hanya ada dua famili helper (`mslseed.FindSeedCSV` + `rolemapseed.Find*CSV`).

> ⚠️ **Yang SENGAJA tidak dipindah:** `backend/testdata/import_samples/` memuat **PII**
> (roster HR, `nik_email.csv`). Menyebarkan PII ke folder yang dibaca tooling seed bukan
> perbaikan, dan retensi data pribadi keputusan pemilik. Sebelum C-05 memilih opsi "hapus",
> putuskan: diarsipkan / dihapus / dianonimkan.

### 1.2 Fase 1 — O41 DITUTUP, `KNOWN_GAPS` kosong 🟢

Keenam route yang `web-internal` panggil tapi `apps/api` tidak layani sekarang hidup:

| Route | Isi |
|---|---|
| `GET /finance/queue` | worklist verifikasi Finance ([Menunggu Verifikasi]) |
| `GET /transactions/{id}` | agregat TRX + amount turunan + jadwal |
| `POST /transactions/{id}/schedule` | mint jadwal Installment (M5 §4) |
| `GET /transactions/{id}/bermasalah` | flag + vote siklus berjalan + escalated |
| `POST /leads/bulk` | impor massal Marketing (M1 §3) + gate Campaign O13 |
| `GET /audit` | reader riwayat lintas-modul (panel Asset/lead/attempt) |

Domain baru: `finance.{financeQueue,loadTransactionAggregate,createSchedule,bermasalahStatus}`,
`leads.bulkImport`, dan modul baru `packages/domain/src/audit.ts` — **read-only by
construction** (nol jalur tulis, jadi ia tidak bisa menyentuh riwayat immutable bahkan karena
kecelakaan).

**`KNOWN_GAPS` dikosongkan tapi TIDAK dihapus.** Test *"keeps KNOWN_GAPS honest"* yang
menjaganya tetap ada: menambah satu baris ke sana berarti mengakui satu halaman tidak
berfungsi, dan itu butuh entri `DECISIONS.md`. Jangan hapus Set-nya.

### 1.3 Temuan terbesar sesi ini: **lapisan wire M5 tidak ada sama sekali** 🔴→🟢

`finance` adalah satu-satunya modul domain **tanpa converter `*ToWire`**, jadi setiap route M5
mengirim camelCase mentah atau `{ok:true}` karangan. Enam bentuk salah, semuanya diperbaiki:

| Endpoint | Klien membaca | Route mengirim (sebelum) |
|---|---|---|
| `POST /bermasalah` | body `{reason}` → `{status}` | membaca **`note`** → `{ok:true}` |
| `GET /finance/reminders` | `{reminders, outstanding_no_due_date}` | `{overdue, upcoming, outstandingNoDueDate}` |
| `POST /verify` | `{transaction}` 200 | `VerifyResult` camelCase **201** |
| `POST /bermasalah/resolve` | `BermasalahStatus` | `{resolved}` |
| `POST /contract` · `POST /scheme` | `{status}` | `{ok:true}` |

Yang paling parah baris pertama: FE mengirim `reason`, route membaca `note`, jadi alasannya
**selalu kosong** dan endpoint menjawab pesan wajib-lengkap di setiap panggilan — **tombol flag
[Bermasalah] tidak bisa dipakai sama sekali di produksi.** Ditambah `InstallmentRow` domain
tidak punya `proofOfPayment`, jadi kolom bukti bayar selalu `undefined`.

> **Satu penyimpangan disengaja dari Go:** Go menandai field ini `omitempty`, jadi tanggal null
> **menghilangkan kuncinya**. Di sini null dikirim **eksplisit**, karena tipe FE mendeklarasikan
> `string | null` dan **kunci yang HILANG-lah yang mengosongkan halaman** (pelajaran O43
> sendiri). Jangan "sederhanakan" kembali jadi omitempty.

### 1.4 Bug vote Director

`resolveBermasalah` menulis divisi `'Management'` untuk Director; reader Go mengunci
`director_vote` pada `'Director'`. Akibatnya keputusan Director **tidak pernah** tampil, dan
`escalated` bisa tetap `true` **setelah** Director menolak. Diselaraskan ke `'Director'`; aman
tanpa migrasi karena `transaction_issue_approvals` **nol baris** di `CDPS SG` (diverifikasi) dan
tabelnya tanpa CHECK pada `division`. Reader tetap menerima `'Management'` untuk baris lama.

---

## 2. O46 — divergensi RLS yang saya SENGAJA tidak putuskan sendiri

Ditemukan saat mem-port. Tiga arm visibility berbeda dari Go:

- **(a) `transactions_select` tanpa arm Sales-Lead.** Go memberi SPV Sales seluruh transaksi
  klien sales; RLS hanya kepemilikan per-orang ⇒ SPV Sales melihat **lebih sedikit**.
- **(b) `audit_log_select` = `jwt_can_read_all() OR actor_employee_id = jwt_employee_id()`.**
  Pemanggil staff hanya melihat entri yang **ia** tulis; handler Go tidak memfilter apa pun ⇒
  panel riwayat Asset menampilkan jejak **sebagian** untuk staff.
- **(c) arm Account "hanya setelah rilis" (M5 §5 Rule 2) tidak ada di policy.** Tanpa
  penanganan, AM yang ditugaskan bisa melihat uang **pra-verifikasi**.

**(c) saya tangani di lapisan aplikasi** (`loadTransactionAggregate`), mengikuti O37 opsi (c)
*"RLS fondasi + gate app-layer"*, dan diuji **tanpa RLS** supaya regresi ketangkap.
**(a) dan (b) dibiarkan** — melonggarkan RLS, apalagi pada tabel audit, punya blast radius
keamanan dan bukan keputusan yang pantas diambil di dalam sebuah read model. Arahnya selalu
lebih sempit, jadi **tidak ada kebocoran**; yang ada adalah data yang tidak terlihat.

**Butuh keputusan Anda:** pulihkan paritas Go (tambah arm lead-divisi + longgarkan baca audit
per divisi), atau terima perilaku lebih sempit ini sebagai baseline dan sesuaikan
PRD/`PERMISSIONS.md`. Ini **tidak** memblokir cutover, tapi **memblokir** klaim *"apps/api
paritas dengan Go"*.

---

## 3. Lanjut dari sini — Fase 2 dst.

Urutannya tetap seperti peta §4. Yang berikutnya:

### Fase 2 — paritas bentuk respons sisanya (O43)
`wire.ts` kini punya 60 converter (54 + 6 baru M5/audit). Yang sudah diperbaiki hanya M5 +
audit; **sisa modul belum disisir sistematis**. Kerjakan **selagi Go masih ada** — ini
satu-satunya jenis pekerjaan yang benar-benar perlu membaca handler Go untuk membandingkan
bentuk badan respons. Cara tercepat menemukan sisanya: untuk tiap `web-internal/src/lib/*.ts`,
diff tipe yang dideklarasikan lawan converter `*ToWire` yang melayaninya — endpoint tanpa
converter adalah tersangka utama, persis seperti `finance` tadi.

### Fase 3 — 4 CLI Go tanpa padanan
`cmd/import` (**blocker O22** — tooling impor lead historis; padanan HTTP-nya
`POST /leads/bulk` kini SUDAH ada, jadi yang tersisa adalah adapter CSV/dry-run) ·
`cmd/hrisconvert` (keputusan: port kecil atau reshape manual) · `cmd/rolemapseed` (~obsolet,
admin UI sudah ada) · `cmd/setpass` (**butuh runbook**: bootstrap Director pertama di
deployment baru = panggil `admin_set_employee_password()` lewat SQL editor; tanpa ini
deployment baru terkunci).

### Fase 4 — gate manusia (BUKAN pekerjaan code, dan bukan milik saya)
| Gate | Status |
|---|---|
| C-03 — 3 SKIP dari deployment Vercel | ⛔ butuh mesin ber-akses; skripnya **sudah siap** sejak 2026-07-29 (`CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`) |
| C-04 — O22 · O34 · O26 · O35 | ⛔ butuh data + keputusan pemilik |
| Backup MySQL Railway terakhir | ⛔ butuh akses Railway |
| Rencana rollback disepakati | ⛔ keputusan pemilik |
| **O46** (baru, §2) | ⛔ keputusan pemilik |

Saya tidak bisa menutup satu pun dari lima ini — semuanya butuh akses atau otoritas yang tidak
saya punya. Melaporkannya sebagai "selesai" akan jadi laporan palsu.

### Fase 5 — pencabutan mekanis (C-05, hanya SETELAH gate GO)
Job `backend` di CI · `Makefile` (**100% Go**, semua 11 target) · tag lalu arsipkan `backend/` ·
config mati (`railway.json` ×2, `Dockerfile`, `docs/DEPLOY_RAILWAY.md`) · **`CLAUDE.md` §Stack**
· entri DECISIONS · ~20 komentar provenance `backend/internal/...`.

> **Rekomendasi yang tidak menunggu GO, dan makin mendesak:** `CLAUDE.md` masih menyatakan
> stack-nya **Go + MySQL** dan tidak menyebut cutover sama sekali. Sesi Claude baru mana pun
> akan membacanya sebagai kebenaran dan membangun Go. Itu bukan pekerjaan pensiun — itu
> koreksi yang **sudah salah hari ini**.

---

## 4. Yang TIDAK disentuh sesi ini

Nol perubahan pada `supabase/migrations/**` (skema tidak bergerak — live tetap 40/54/17), nol
perubahan pada `backend/**` selain memindahkan 3 CSV keluar, nol perubahan pada
`.github/workflows/ci.yml`. Kedua gate angka hardcoded CI (**17** event, **54** tabel) tetap
benar dan sudah diverifikasi ulang lewat `scripts/db-rebuild.sh`.
