# Tutorial — empat pekerjaan sisa sesudah PR #336/#337 (2026-09-09)

Tutorial langkah-demi-langkah untuk keempat butir yang tersisa di
`HANDOFF_M19_SCS_20260909.md` §4:

> **✅ BUTIR 1 SUDAH DIJALANKAN 2026-09-09** — hasilnya
> `UAT_M19_BROWSER_20260909.md`: 86 butir, 83 PASS, **3 FAIL yang semuanya satu
> cacat** (nama klien & nama PIC kosong untuk lead Creative — RLS membungkam
> `LEFT JOIN`). Tiga butir tutorial ini dikoreksi karena menjalankannya:
> §1.2(b)/(c), §1.5(c), §1.4(h) — dan §0.5 bertambah satu aktor. Sisanya
> (§2, §3, §4) belum dijalankan.

| # | Pekerjaan | Siapa | Bisa dari sandbox? |
|---|---|---|---|
| **1** | 🔴 Browser UAT enam layar M19 (§4.1) | Claude/dev, satu sesi bernyala | **Ya** (Chromium terpasang) |
| **2** | 🟡 Browser UAT enam butir feedback Sales (§4.2) | sama, sesi yang sama | **Ya** |
| **3** | 🟡 Isi 21 Kategori + 8 Sub Type | **pemilik / Leader Creative** | Ya (lewat layar, nol migrasi) |
| **4** | Drift check penuh sekali | **operator / CI runner** | **TIDAK** — egress Supabase diblok |

Butir 1 dan 2 berbagi SATU persiapan lingkungan (§0). Kerjakan berurutan dalam
satu sesi: menyalakan DB + dua server adalah 80% ongkosnya, dan sekali nyala ia
melayani kesembilan layar sekaligus.

Butir 3 dan 4 berdiri sendiri dan boleh dikerjakan kapan pun — **tidak ada satu
pun yang memblokir yang lain**.

Daftar pekerjaan yang belum selesai (di luar keempat ini) ada di **§5**.

---

## 0 · Persiapan lingkungan — sekali, untuk butir 1 DAN 2

> Semua perintah dijalankan dari akar repo. Jangan lewati satu langkah pun:
> setiap langkah di bawah ini pernah menjadi sumber kegagalan yang dicatat di
> handoff sebelumnya (`HANDOFF_M19_SCS_20260909.md` §7).

### 0.1 Dependency — tiga tempat, bukan satu

```bash
make install        # npm install (root) + web-internal + web-client-portal
```

⚠️ `web-internal` **BUKAN** workspace npm (`workspaces` = `apps/*`,
`packages/*`). `npm install` di akar TIDAK memasang deps-nya — itulah sumber
banjir *"Cannot find module 'xlsx'"* yang berulang kali disebut handoff. Target
`make install` sudah melakukan ketiganya; kalau menjalankan manual, jangan lupa
`cd web-internal && npm install`.

### 0.2 Postgres lokal — beri password dulu

Di sandbox, user `postgres` tidak punya password walau `pg_isready` hijau, dan
`db-rebuild.sh` gagal dengan *"password authentication failed"*:

```bash
service postgresql start 2>/dev/null || pg_ctlcluster 16 main start
su postgres -c "psql -c \"alter user postgres with password 'postgres';\""
pg_isready
```

### 0.3 Bangun ulang DB dari nol

```bash
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
make db-rebuild        # = bash scripts/db-rebuild.sh --yes  (DROP DATABASE!)
```

Yang harus terlihat di akhir: gate **155 tabel · 43 entity_prefix ·
34 sm_machines · 73 notif_events**, plus empat invariant SQL hijau. Angka lain
= migrasi tidak semuanya jalan; **berhenti di sini**, jangan lanjut ke UAT.

> ⚠️ `DATABASE_URL` yang tidak di-set adalah jebakan paling berbahaya di repo
> ini: seluruh tes DB/RLS di-skip **diam-diam** dan `make test` tetap lapor
> hijau. Patokan jumlah tes yang benar-benar jalan: core 985 · db 98 ·
> domain 2355 (+1 skip) · apps/api 496 · web-internal 736.

### 0.4 Fixture browser-tour — supaya layarnya punya baris untuk dirender

```bash
DATABASE_URL="$DATABASE_URL" npx tsx scripts/seed-browser-tour.ts > /tmp/tour-ids.json
cat /tmp/tour-ids.json     # simpan: berisi CLI-…, TRX-…, SVC-…, BRF-… yang dipakai di bawah
```

Jalankan **sekali** per `db-rebuild` — skrip ini tidak idempotent (run kedua
mendaftarkan lead baru dengan nomor telepon baru; tidak merusak, cuma mubazir).

`CLI-…` dari berkas ini dipakai di form slot produksi (§1.1) dan di form baris
SCS ber-klien (§1.4). Baris SCS "Semua klien" justru **tidak** membutuhkannya.

### 0.5 Tujuh aktor — dan kenapa seed saja tidak cukup

Seed Sprint-0 punya Creative **staff** (`EMP-0003`) dan Director
(`EMP-0008`), tapi **tidak punya** Creative **lead**, **OD murni**, maupun
**staff Creative kedua**. Ketiganya wajib ada: gerbang tampilan M19 berbeda
persis di dua peran pertama, dan §1.4(h) mustahil diuji tanpa yang ketiga.

```bash
psql "$DATABASE_URL" <<'SQL'
-- Creative LEAD. role_mappings sudah punya ('Creative','Creative Lead') → lead,
-- jadi cukup satu baris employees; nol perubahan skema, nol layered role.
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
VALUES ('EMP-0011', 'Lia Kusuma', 'lia@mea.co.id', 'Creative', 'Creative Lead', true, 'SYSTEM')
ON CONFLICT (employee_id) DO UPDATE SET divisi = EXCLUDED.divisi, jabatan = EXCLUDED.jabatan;

-- OD MURNI (od = true, director = false). Jabatannya sengaja TIDAK ada di
-- role_mappings: employee_claims lalu mengembalikan division '' + level '',
-- yang memang bentuk klaim OD sungguhan. Jangan "rapikan" jadi 'Management'.
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
VALUES ('EMP-0012', 'Rama Aditya', 'rama@mea.co.id', 'Management', 'Operational Director', true, 'SYSTEM')
ON CONFLICT (employee_id) DO UPDATE SET divisi = EXCLUDED.divisi, jabatan = EXCLUDED.jabatan;

INSERT INTO employee_layered_roles (employee_id, role, enabled, created_by)
VALUES ('EMP-0012', 'od', true, 'SYSTEM')
ON CONFLICT (employee_id, role) DO UPDATE SET enabled = true;

-- Staff Creative KEDUA. Tanpa ini §1.4(h) mustahil diuji: "baris milik PIC
-- lain" tidak bisa dibuat kalau hanya ada satu staff Creative (EMP-0003).
INSERT INTO employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
VALUES ('EMP-0013', 'Sari Melati', 'sari@mea.co.id', 'Creative', 'Creative Designer', true, 'SYSTEM')
ON CONFLICT (employee_id) DO UPDATE SET divisi = EXCLUDED.divisi, jabatan = EXCLUDED.jabatan;
SQL
```

Verifikasi klaim keempatnya SEBELUM mencetak token — satu klaim yang salah
menghasilkan laporan bug palsu (ini persis yang terjadi saat harness B2 pertama
kali menebak `division: 'Management'` untuk Director):

```bash
for e in EMP-0003 EMP-0013 EMP-0011 EMP-0012 EMP-0008 EMP-0001 EMP-0006; do
  echo -n "$e  "; psql "$DATABASE_URL" -tAc "select employee_claims('$e')"
done
```

Yang harus keluar:

| Aktor | `employee_id` | division | level | od | director |
|---|---|---|---|---|---|
| Creative staff | `EMP-0003` | `Creative` | `staff` | false | false |
| Creative staff #2 | `EMP-0013` | `Creative` | `staff` | false | false |
| Creative lead | `EMP-0011` | `Creative` | `lead` | false | false |
| OD murni | `EMP-0012` | `''` | `''` | **true** | false |
| Director | `EMP-0008` | `''` | `''` | false | **true** |
| Sales staff | `EMP-0001` | `Sales` | `staff` | false | false |
| Head Sales | `EMP-0006` | `Sales` | `lead` | false | false |

### 0.6 Cetak tujuh token

`SUPABASE_JWT_SECRET` harus **sama persis** dengan yang dibaca `apps/api`
(`apps/api/.env.local`). Set keduanya dari satu variabel supaya tidak bisa
menyimpang:

```bash
export SUPABASE_JWT_SECRET='local-dev-harness-secret-do-not-use-in-prod'
mkdir -p /tmp/uat
for e in EMP-0003 EMP-0013 EMP-0011 EMP-0012 EMP-0008 EMP-0001 EMP-0006; do
  node scripts/dev-jwt.mjs --employee "$e" > "/tmp/uat/$e.jwt"
done
wc -c /tmp/uat/*.jwt      # ketujuh berkas harus > 200 byte
```

Ini bukan jalan pintas melewati otorisasi — hanya melewati **login**. Setiap
rute di balik cookie tetap menjalankan RLS + gerbang domain sungguhan terhadap
DB lokal.

### 0.7 Nyalakan dua server

`web-internal` (:3000) mem-proxy `/api/v1/*` ke `apps/api` (:3001) — lihat
`web-internal/next.config.ts`. Keduanya WAJIB hidup; kalau hanya :3000 yang
hidup, setiap halaman merender kerangka kosong dan UAT-nya tidak membuktikan
apa pun.

```bash
# terminal A
cd apps/api && cp -n .env.example .env.local 2>/dev/null; \
  DATABASE_URL="$DATABASE_URL" SUPABASE_JWT_SECRET="$SUPABASE_JWT_SECRET" npx next dev -p 3001

# terminal B
cd web-internal && npx next dev -p 3000

# terminal C — bukti keduanya nyambung, bukan cuma nyala
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/v1/creative/studios
```

### 0.8 Uji harness sekali sebelum UAT sungguhan

```bash
cat > /tmp/uat/smoke.json <<'JSON'
[{ "path": "/creative", "name": "00-smoke-creative" }]
JSON
node scripts/browser-tour.mjs \
  --token "$(cat /tmp/uat/EMP-0011.jwt)" \
  --pages /tmp/uat/smoke.json --out /tmp/uat/shot
```

`status: 200  console-errors: 0` ⇒ harness siap. Kalau Playwright mengeluh
*"Executable doesn't exist"*, **jangan** `npx playwright install` — set
`PLAYWRIGHT_CHROMIUM_PATH` ke Chromium yang sudah terpasang.

---

## 1 · Butir 1 — 🔴 Browser UAT enam layar M19 (§4.1)

**Kenapa ini prioritas.** `next build` sukses, typecheck bersih, 736 tes
`web-internal` hijau — dan keenam layar tetap bisa salah, karena **tidak satu
pun** tes itu me-render halaman di peramban sungguhan. Ini utang verifikasi
atas kode yang SUDAH berjalan di live.

### 1.0 Tangkap dulu keenam layar untuk keempat aktor

```bash
cat > /tmp/uat/m19.json <<'JSON'
[
  { "path": "/creative/schedule",       "name": "01-jadwal" },
  { "path": "/creative/schedule/rekap", "name": "02-jadwal-rekap" },
  { "path": "/creative/ketersediaan",   "name": "03-ketersediaan" },
  { "path": "/creative/scs",            "name": "04-scs" },
  { "path": "/creative/scs/rekap",      "name": "05-scs-rekap" },
  { "path": "/creative/scs/kategori",   "name": "06-scs-kategori" }
]
JSON

for e in EMP-0003 EMP-0011 EMP-0012 EMP-0008; do
  node scripts/browser-tour.mjs --token "$(cat /tmp/uat/$e.jwt)" \
    --pages /tmp/uat/m19.json --out "/tmp/uat/shot/m19-$e"
done
```

24 PNG. `console-errors: 0` dan `status: 200` di semuanya adalah **syarat
minimum, bukan hasil UAT** — yang membuktikan adalah §1.1–§1.6 di bawah, dan
sebagian butirnya menuntut KLIK, bukan cuma tangkapan layar.

### 1.1 `/creative/schedule` — jadwal produksi harian

Peran: **lead Creative (`EMP-0011`)** untuk menyusun; ulangi sebagai
**`EMP-0003`** dan **`EMP-0012`** untuk memastikan form-nya HILANG.

| # | Langkah | Yang HARUS terlihat |
|---|---|---|
| a | Buka halaman sebagai lead | Grid menampilkan **keempat** studio: Kasuari, Rajawali, Cempaka, Luar Kantor |
| b | Perhatikan studio yang nol slot | Kolomnya **TETAP dirender** dan berisi kata **"Bebas"** — bukan hilang. "Ruangan itu bebas" adalah informasi; menyembunyikannya persis saat Leader mencari tempat adalah kehilangan gunanya |
| c | Perhatikan Luar Kantor | Ada lencana **"tanpa cek konflik"** |
| d | Isi form: Tanggal (hari ini), Klien = `CLI-…` dari §0.4, Studio = Kasuari, Mulai `09:00`, Selesai `11:00`, PIC = Rian (`EMP-0003`), Jenis pekerjaan, Target qty 1 → **Simpan** | Slot muncul di kolom Kasuari |
| e | **Simpan slot KEDUA yang bertumpang**: Kasuari, `10:00`–`12:00` | **KEDUA** slot tampil (yang kedua TIDAK ditolak), keduanya bergaris **kuning** di tepi kiri |
| f | Perhatikan pita pesan sesudah (e) | **"Tersimpan, dengan catatan:"** berlatar kuning, berisi `[studio Kasuari sudah dipakai pada rentang waktu ini]` — **BUKAN** pita galat merah |
| g | Ulangi (e) di studio **Luar Kantor** | Nol peringatan — `cek_konflik = false` memang mematikannya |
| h | Buka sebagai `EMP-0003` (staff) lalu `EMP-0012` (OD murni) | Grid tetap terbaca, tapi form "Tambah slot" **tidak ada sama sekali** |

> **(e)+(f) adalah inti UAT layar ini.** *Warn-not-block* adalah **PERILAKU**
> (D3/D4), bukan pesan. Pita merah, atau slot kedua yang tidak muncul, = GAGAL,
> walaupun HTTP-nya 200.

### 1.2 `/creative/schedule/rekap`

| # | Langkah | Yang HARUS terlihat |
|---|---|---|
| a | Buka sebagai lead | Kalimat **"Bukan KPI:"** — "…tidak masuk Team Performance (Modul 14) dan tidak punya bobot penilaian" |
| b | Buka sebagai `EMP-0003` | Kalimat **"Anda melihat baris Anda sendiri"** tampil — halaman ini **tidak punya picker PIC**; cakupannya ditentukan server (`canSeeAllPics`), dan kalimat itulah satu-satunya penanda di layar |
| c | Buka sebagai `EMP-0012` (OD) dan `EMP-0011` (lead) | Kalimat itu **TIDAK** tampil (tidak terkunci), dan barisnya memuat semua PIC |

### 1.3 `/creative/ketersediaan`

| # | Langkah | Yang HARUS terlihat |
|---|---|---|
| a | Buka sebagai lead | Kotak **"Ini bukan pengajuan cuti."** — CDPS bukan HRIS |
| b | Catat ketidaktersediaan `EMP-0003` untuk hari ini, isi Alasan | Tersimpan; baris muncul |
| c | Kembali ke `/creative/schedule` hari itu | Nama Rian muncul di **"Tidak tersedia hari ini"** |
| d | Coba jadwalkan Rian di hari itu | Peringatan `[PIC tidak tersedia pada tanggal ini]` — **peringatan**, slotnya tetap tersimpan |
| e | Buka sebagai `EMP-0003` | Tabel terbaca, **nol** form dan nol tombol hapus (D4: mencatat ketidaktersediaan = Leader saja, bukan self-service) |

### 1.4 `/creative/scs` — antrean SMO & Content Strategist

Peran: **lead (`EMP-0011`)** untuk membuat baris; **staff (`EMP-0003`)** untuk
mengerjakan; **`EMP-0012`** untuk membuktikan OD read-only.

| # | Langkah | Yang HARUS terlihat |
|---|---|---|
| a | Sebagai lead, tambah baris: Kategori **Script**, PIC Rian, target 1, judul apa saja, **kolom Klien DIKOSONGKAN** | Baris tersimpan |
| b | Lihat kolom klien baris itu | Tertulis **"Semua klien"** — **BUKAN** sel kosong. Sel kosong terbaca seperti data yang gagal dimuat, dan baris "all client" adalah seluruh alasan modul ini berdiri sendiri |
| c | Tambah baris kedua, Kategori **Upload & Checklist** (standing) | Nama Kategorinya diikuti penanda abu-abu **"· standing"** |
| d | Tambah baris ketiga dengan Klien = `CLI-…` dari §0.4 | Nama klien tampil |
| e | Sebagai lead, lihat kolom aksi baris milik Rian | **Tidak ada "Mulai" maupun "Submit"** — lead bukan PIC. Yang ada: "Cabut" (baris `[To Do]`) |
| f | Buka sebagai **`EMP-0003`** (PIC-nya) | Baris miliknya punya **"Mulai"**; klik → status jadi `[In Progress]` |
| g | Sebagai `EMP-0003`, klik **"Submit"** | Diminta link hasil; setelah diisi → `[Submitted]` |
| h | Buat baris keempat ber-PIC `EMP-0013`, lalu lihat sebagai `EMP-0003` | Barisnya **tidak muncul sama sekali** di antrean Rian. `ownRowsOnly(actor)` mengunci query ke `assigned_pic = dirinya`, jadi baris orang lain bukan sekadar kehilangan tombol — ia tidak ada |
| i | Sebagai lead, pada baris `[Submitted]` | Muncul "Buka review" / "Minta revisi"; pada `[In Review]` → "Setujui" |
| j | Sebagai lead, pada baris `[In Progress]` | Muncul **"Blokir"** (kebalikan (e): memblokir justru lead-saja, karena waktunya dikurangkan dari turnaround) |
| k | Buka sebagai `EMP-0012` (OD murni) | Tabel terbaca penuh, **nol** tombol aksi, **nol** form "Tambah baris" |

> **(e) vs (j) adalah pasangan yang paling mudah dirusak.** `canWorkTask` LEBIH
> SEMPIT daripada gerbang M19 lain: hanya PIC baris itu, lead pun tidak — lead
> yang menandai baris orang lain `[In Progress]` memalsukan jangkar
> turnaround-nya.

### 1.5 `/creative/scs/rekap`

| # | Langkah | Yang HARUS terlihat |
|---|---|---|
| a | Buka sebagai lead | Kalimat **"Angka ini bukan KPI."** (persis; ia tidak masuk Modul 14) |
| b | Baca kolomnya | **Baris standing dihitung TERPISAH** dari deliverable — dua kolom, bukan satu jumlah |
| c | **Cek API, bukan layar.** Speed Score **tidak dirender** di antrean maupun rekap — kolomnya tidak ada di kedua halaman. Bawa SATU baris standing dan SATU baris deliverable sampai `[Approved]`, lalu: `curl -H "Cookie: cdps_access_token=$(cat /tmp/uat/EMP-0008.jwt)" .../api/v1/creative/scs/tasks/<id>` | Baris **standing** → `speed_score_display: "N/A"` **walau sudah `[Approved]`** (bukan `0%`, dan bukan sekadar efek "belum selesai"). Baris **deliverable** → persen sungguhan |

### 1.6 `/creative/scs/kategori`

| # | Langkah | Yang HARUS terlihat |
|---|---|---|
| a | Buka sebagai lead | Empat Kategori seed: `SCRIPT`, `BRIEF`, `UPLOAD_CHECKLIST`, `KOORDINASI` |
| b | Perhatikan kolom SLA dua Kategori standing | Kosong, dan itu **bukan** data yang hilang |
| c | Di form, ubah **Standing (berulang harian)** = **ya** | Input **SLA (jam) langsung DIKOSONGKAN dan MATI (`disabled`)** |
| d | Kembalikan Standing = tidak | SLA hidup lagi, terisi 24 |
| e | Simpan satu Kategori uji (mis. `UJI` / "Kategori Uji", standing = tidak, SLA 24) | Tersimpan; muncul di daftar DAN di dropdown Kategori pada `/creative/scs` |
| f | Buka sebagai `EMP-0003` lalu `EMP-0012` | Daftar terbaca, **nol** form |

> **(c) adalah butir UAT-nya, bukan kosmetik.** Server menolak standing ber-SLA
> dengan `[kategori standing tidak boleh punya SLA — pekerjaan berulang tidak
> diukur kecepatannya]`; kalau input-nya tidak mati, penolakan itu datang
> sebagai kejutan sesudah Leader mengetik.

### 1.7 Catat hasilnya

Tulis `docs/handoff/UAT_M19_BROWSER_<tanggal>.md` memakai template §6. Satu
baris per butir (a…k) per layar, PASS/FAIL, dan **lampirkan PNG untuk setiap
FAIL**. Butir yang tidak sempat dijalankan ditulis **BELUM**, bukan dikosongkan.

---

## 2 · Butir 2 — 🟡 Browser UAT enam butir feedback Sales (§4.2)

Terbuka sejak sebelum M19 (`HANDOFF_FEEDBACK_SALES_TUTUP_20260909.md` §2.2).
Kodenya sudah di `main` DAN di live; yang belum ada hanyalah pembuktian di
peramban. Lingkungan §0 sudah cukup — **tidak perlu menyiapkan apa pun lagi**.

```bash
cat > /tmp/uat/sales.json <<'JSON'
[
  { "path": "/sales",            "name": "11-sales-owner" },
  { "path": "/master-services",  "name": "12-msl" },
  { "path": "/sales/kalkulator", "name": "13-kalkulator" },
  { "path": "/clients",          "name": "14-clients" }
]
JSON
node scripts/browser-tour.mjs --token "$(cat /tmp/uat/EMP-0006.jwt)" \
  --pages /tmp/uat/sales.json --out /tmp/uat/shot/sales-head
node scripts/browser-tour.mjs --token "$(cat /tmp/uat/EMP-0001.jwt)" \
  --pages /tmp/uat/sales.json --out /tmp/uat/shot/sales-staff
```

| # | Layar | Peran | Yang membuktikan |
|---|---|---|---|
| **#2** | `/sales`, kolom **Owner** | **Head Sales `EMP-0006`** | Kolom Owner memuat **nama orang**, bukan `EMP-…` |
| **#5** | `/clients/{CLI-…}`, panel Kontrak | **Sales staff `EMP-0001`** | **Nol 403**, jendela kontrak (mulai–selesai) tampil |
| **#5** | `/clients` (daftar) | Sales staff | Kolom **Durasi Kontrak** terisi; klien tanpa kontrak menampilkan **teks eksplisit**, bukan sel kosong (FS-5b) |
| **#6** | `/master-services`, form MSL | **Head Sales** | Editor **baris opsi durasi** (1/3/6/12 bulan, harga berbeda per tenor) |
| **#6 / FS-6b** | `/sales/kalkulator`, kolom **Durasi** | Sales staff | Dropdown tenor **mengubah kolom Harga DAN Ringkasan** saat dipilih |
| **#6 / FS-6b** | `/sales/{id}`, Form Qualified | Sales staff | Tenor terkirim, lalu **terbaca lagi** di tabel snapshot sesudah simpan |
| **#1** | `/sales` / Client Record | Sales staff | Tombol **WhatsApp** ada dan tautannya benar |
| **#3** | `/sales`, prospek bersama | Sales staff | Prospek bersama tampil di kedua sales |
| **#4** | Finance / transaksi | Sales staff atau Finance | Jenis **`bayar_komisi`** tersedia sebagai pilihan |

> **Kolom Owner sebagai Head Sales adalah bukti utama, dan urutannya penting.**
> Gejalanya **hanya** muncul di layar itu dengan peran itu: OD/Director lolos
> `jwt_can_read_all()` dan tidak pernah melihat bug-nya. Menguji `#2` sebagai
> Director adalah uji yang selalu lulus dan tidak membuktikan apa-apa.

Untuk `#6`/FS-6b, siapkan satu master service ber-opsi durasi lebih dulu lewat
`/master-services` sebagai Head Sales (§1 baris keempat tabel), baru buka
kalkulator — tanpa itu dropdown tenornya kosong dan hasilnya "tidak terbukti",
bukan "gagal".

---

## 3 · Butir 3 — 🟡 Isi 21 Kategori + 8 Sub Type (butuh pemilik)

**Tidak memblokir apa pun.** Modul SCS jalan penuh dengan empat Kategori seed;
ini melengkapi taksonomi, bukan menyalakan fitur. **Nol migrasi** — taksonomi
sengaja dibuat DATA yang dikelola admin, bukan skema.

### 3.1 Kenapa daftarnya tidak dikarang

Dokumen sumbernya,
`CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md`, dirujuk PRD dan backlog M19
tapi **tidak ada di repo maupun di Google Drive** (dicari keduanya) — kemungkinan
diunggah ke sesi sebelumnya dan tidak pernah di-commit. Empat Kategori yang
di-seed adalah **hanya** yang benar-benar terbukti di sumber. Sisa 21 nama dan
8 label Sub Type adalah pengetahuan pemilik, dan menebaknya berarti menaruh
taksonomi karangan di tabel yang dibaca sebagai kebenaran.

### 3.2 Cara mengisinya — lewat layar, sekarang juga

1. Masuk sebagai **Leader Creative** (lead Creative) atau **Director**.
   Staff dan OD murni hanya bisa membaca.
2. Buka **`/creative/scs/kategori`**.
3. Untuk tiap Kategori, isi form:

   | Field | Aturan |
   |---|---|
   | **Kode** | HURUF BESAR, tanpa spasi, mis. `SCRIPT`, `UPLOAD_CHECKLIST`. **Permanen** — ia yang dirujuk baris SCS |
   | **Nama** | Nama yang dibaca manusia; boleh diubah kapan saja |
   | **Sub Type** | Teks bebas. Ketik salah satu dari 8 label Anda **persis sama** di semua Kategori yang memakainya |
   | **Urutan** | Angka; menentukan urutan tampil di dropdown |
   | **Standing (berulang harian)** | **ya** = pekerjaan berulang tanpa target selesai (Speed Score `N/A`, dihitung sebagai volume). **tidak** = deliverable ber-SLA |
   | **SLA (jam)** | Hanya untuk standing = tidak. Memilih standing = ya **mengosongkan dan mematikan** field ini |

4. **Simpan**. Kategori langsung muncul di dropdown `/creative/scs`.

### 3.3 Tiga hal yang paling mudah salah

1. **Salah menandai Kategori sebagai standing.** Ia lalu hilang **sepenuhnya**
   dari seri deliverable di `/creative/scs/rekap` — bukan pindah kolom, hilang.
   Kalau ragu: pekerjaan yang punya "selesai" ⇒ **tidak** standing.
2. **`sub_type` teks bebas, bukan pilihan terkunci** — dan itu disengaja
   (mengunci delapan nama berarti satu migrasi untuk setiap koreksi taksonomi).
   Konsekuensinya: `Konten` dan `konten` adalah **dua** Sub Type. Tulis daftar
   delapan label Anda di satu tempat, lalu salin-tempel.
3. **Kode tidak untuk diubah.** Salah ketik kode ⇒ nonaktifkan Kategorinya
   (`aktif` = tidak) dan buat yang baru; jangan mendaur ulang kode.

### 3.4 Jalan alternatif

Kirimkan daftar 21 Kategori + 8 Sub Type (kode · nama · sub type · standing ya/tidak ·
SLA jam) ke sesi berikutnya, dan seluruhnya di-seed sekaligus lewat satu
migrasi. Kedua jalan sah; lewat layar lebih cepat dan nol migrasi.

**Pola "Task Additional" (Gap I) menunggu dokumen yang SAMA** — kalau dokumen
itu ketemu, keduanya tertutup sekaligus.

---

## 4 · Butir 4 — Drift check penuh sekali dari operator/CI

**TIDAK BISA dari sandbox Claude Code**, dan itu bukan kekurangan skripnya:
egress proxy menolak CONNECT ke `api.supabase.com:443` (403, kebijakan
organisasi) dan koneksi TCP langsung ke `*.supabase.co:5432`/`:6543` time-out.
Jalankan dari laptop pemilik atau CI runner ber-egress nyata.

### 4.1 Jalankan

Pilih **satu** jalur koneksi — skrip tidak menebak:

```bash
# Jalur A — connection string Postgres langsung
LIVE_DATABASE_URL="postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  bash scripts/check-live-drift.sh

# Jalur B — Management API (butuh curl + jq)
SUPABASE_ACCESS_TOKEN="sbp_…" SUPABASE_PROJECT_REF="egddxfcnrtecheiykhlf" \
  bash scripts/check-live-drift.sh
```

`make check-live-drift` menjalankan yang sama tanpa argumen.

### 4.2 Hasil yang diharapkan, per 2026-09-09

```
✓ nol migrasi repo yang tertinggal dari live.

🟡 EXTRA ON LIVE — ada di live, tidak ada berkas repo yang cocok:
   - d3_tutup_buku_pulihkan_komentar_jaga_transisi   (sudah di-allowlist — lihat DECISIONS.md)

✅ GERBANG LOLOS — repo dan live sinkron (drift ter-allowlist tidak menghitung)
```

Angka pembanding yang sudah di-probe lewat MCP: ledger live **219 baris /
217 slug unik**, repo **217 berkas / 216 slug unik**, **MISSING = 0**,
**EXTRA = 1**.

### 4.3 Cara membaca hasilnya

| Hasil | Artinya | Tindakan |
|---|---|---|
| **`MISSING ON LIVE` tidak kosong** | 🔴 **Cacat nyata.** Migrasi ada di repo tapi belum ter-apply; kode mengasumsikan skema yang live tidak punya — dan ini **tidak terlihat** dari tes (tes domain memakai service-role dan buta terhadap kelas cacat ini; persis A-req-3, yang hilang berbulan-bulan) | Apply migrasi yang disebut, **per berkas**, lewat `apply_migration`. **JANGAN** `supabase db push`, **JANGAN** `psql -f` (itu yang melahirkan drift O38) |
| **`EXTRA` = hanya `d3_tutup_buku_…`** | 🟡 Sudah dikenal — baris **A2-DRIFT** di `DECISIONS.md` §Open sejak 2026-09-08, belum di-back-port | Tidak ada tindakan di sini. Tutup lewat A2-DRIFT |
| **`EXTRA` memuat slug BARU** | 🟡 Anomali baru | Catat di `docs/DECISIONS.md` sebagai kelas A2-DRIFT **lebih dulu**, baru tambahkan ke `scripts/known-live-drift.txt`. Allowlist bukan tempat menyembunyikan drift baru |
| **Exit code ≠ 0** | Gerbang gagal | Baca dua baris di atasnya; `--strict` juga menggagalkan EXTRA yang belum di-allowlist |

### 4.4 Verifikasi tambahan yang layak sekalian (satu sesi, murah)

```sql
-- gate M19: harus 155 / 43 / 34 / 73
select (select count(*) from information_schema.tables where table_schema='public') tabel,
       (select count(*) from entity_prefix)  prefix,
       (select count(*) from sm_machines)    mesin,
       (select count(*) from notif_events)   event;

-- ledger: jumlah baris yang OTORITATIF (bukan hitungan mata atas list_migrations)
select count(*) from supabase_migrations.schema_migrations;
```

⚠️ `list_migrations` mengembalikan **daftar**, bukan hitungan. Menghitungnya
dengan mata pernah melahirkan selisih 216 vs 212 yang sempat terlihat seperti
drift.

---

## 5 · Daftar pekerjaan yang BELUM selesai (per 2026-09-09, sesudah PR #337)

Diperbarui dari `HANDOFF_M19_SCS_20260909.md` §4 + §8, dirujuk silang ke
`docs/DECISIONS.md` §Open.

### 5.1 Verifikasi — utang atas kode yang sudah berjalan

| # | Apa | Status | Butuh siapa |
|---|---|---|---|
| **UAT-M19** | Browser UAT enam layar M19 | ✅ **DIJALANKAN 2026-09-09** — 86 butir, 83 PASS, 3 FAIL (satu cacat, lihat `M19-NAMA-RLS` di §5.3). Laporan: `UAT_M19_BROWSER_20260909.md` | selesai |
| **UAT-SALES** | Browser UAT enam butir feedback Sales | 🟡 belum pernah dijalankan | sesi dev · **§2** |
| **DRIFT-FULL** | `check-live-drift.sh` penuh sekali | 🟡 belum pernah dijalankan utuh | **operator/CI** · **§4** |

### 5.2 Data — menunggu pemilik, nol yang terblokir

| # | Apa | Status |
|---|---|---|
| **M19-SCS-KATEGORI-DATA** | 21 Kategori + 8 Sub Type | 🟡 **§3** — data, bukan kode. Modul jalan penuh dengan 4 Kategori seed |
| **M19-GAP-I** | Pola "Task Additional" | 🟡 menunggu dokumen gap analysis yang SAMA dengan di atas |
| **O34 / O35** | Roster; model datanya belum ada | 🟡 pemilik mengisi langsung di sistem; model data tetap kosong |

### 5.3 Cacat & utang teknis yang sudah tercatat

| # | Apa | Status |
|---|---|---|
| **M19-NAMA-RLS** | 🔴 **BARU 2026-09-09 (dari UAT §1).** Nama klien & nama PIC kosong untuk **lead Creative** di `/creative/schedule` (kartu slot + "Tidak tersedia hari ini") dan `/creative/scs/rekap`. `left join clients/employees` di bawah `readAsActor` dibungkam RLS; FE jatuh ke `CLI-…`/`EMP-…`. Tak terlihat oleh Director/OD (`jwt_can_read_all()`) — kelas cacat yang SAMA dengan feedback Sales `#2`. Cakupan diduga lebih luas dari M19 | 🔴 menunggu ketokan: resolver `SECURITY DEFINER` sempit (pola O51) vs lengan RLS baru. Rincian `UAT_M19_BROWSER_20260909.md` §2 |
| **A2-DRIFT** | `d3_tutup_buku_pulihkan_komentar_jaga_transisi` ada di live, nol berkas di `main`; plus baris ledger ganda `m6a_section_d` | 🟡 terbuka sejak 2026-09-08. Namanya kini konkret; back-port belum dilakukan |
| **O75** | Service tidak punya jalur ke Done — edge `[In Execution] → Done` ada di `sm_edges` dengan **nol pemanggil** | ⚠️ terbuka 2026-09-07 |
| **O76** | Asal floor GMV bulanan (sisa O57 (b) yang K-2 tidak tutup) | ⚠️ terbuka 2026-09-07 |
| **O65** | Perlukah ledger migrasi live direkonsiliasi ke nama berkas repo | 🔴 terbuka 2026-09-03 |
| **O59-b** | Gerbang notifikasi mengukur JUMLAH, bukan NAMA | 🟡 terbuka |
| **O60** | Detektor ledger O48 buta terhadap arm lead/divisi di balik `SECURITY DEFINER` | 🟡 terbuka |
| **O48 / O49(b)** | 38 policy sisa; `managed_since` | 🟡 sebagian |
| **notif label** | `web-internal/src/lib/notifications.ts` ketinggalan ±50 label event (termasuk `m1.attempt.unrespon` yang menyasar sales staff) | 🟡 celah lama, layak tiket sendiri — **jangan** digabung ke pekerjaan `#6` Sales |

### 5.4 Menunggu ketokan pemilik

| # | Apa | Status |
|---|---|---|
| **LT-2 / LT-8** | Pipeline tahapan Store Operation; alasan pengembalian brief | 🟠 **ditahan pemilik 2026-09-08 — jangan tanya ulang** |
| **LT-1** | Bobot KPI Store Operation | 🟡 masih **0** |
| **KS-4** | Gap desain OKR Sales | 🔴 terbuka |
| **B23-SHP** | Kanal `gmv_mix` Shopee mana mengisi kolom B-2.3 mana | 🔴 terbuka |
| **X-12** | Saran Claude 2026-09-05 menunggu pemilik + OD | 🟠 |
| **REV-1…REV-4** | Konsekuensi `[Unrespon]` (M1-OA-7/OA-8, enumerasi status, mode "1 link folder") | 🟡 |
| **LT-12 / LT-14** | `wrr_aggregate`; 3 CHECK constraint DB yang lolos audit F-3 | 🟡 |
| **M14 KPI SCS** | KPI Profile peran gabungan SMO & Content Strategist | 🟡 **ditunda dengan sengaja**, dan kini **dijaga tes** — `performance.ts` gagal kalau mengimpor `scs` atau `dailyops` |

### 5.5 Yang SUDAH selesai dan tidak perlu dikerjakan lagi

- **M19 LENGKAP** — kedua separuhnya (jadwal harian Gap A/D/E/F + SCS Gap
  B/G/I) sudah di `main` **dan** sudah di live (PR #334, #335).
- **Enam butir feedback Sales** — keenamnya, termasuk FS-6b (tenor sampai ke
  deal), sudah di `main` dan di live. Sisanya **hanya** pembuktian peramban.
- **Nol MISSING** repo↔live: setiap migrasi repo ada di live, kedua migrasi M19
  termasuk.

### 5.6 Urutan yang disarankan

1. ~~**§1** (UAT M19)~~ — ✅ selesai 2026-09-09. Yang lahir darinya:
   `M19-NAMA-RLS` (§5.3), dan itu kini butir paling mendesak.
2. **§2** (UAT Sales) — lingkungannya sudah nyala; ongkos tambahannya kecil.
3. **§4** (drift penuh) — paralel, oleh operator, tidak menunggu 1 dan 2.
4. **§3** (Kategori) — kapan pun pemilik sempat; nol yang menunggu.
5. Baru pilih dari §5.3.

---

## 6 · Template laporan UAT

Simpan sebagai `docs/handoff/UAT_M19_BROWSER_<YYYYMMDD>.md`:

```markdown
# UAT peramban — M19 + feedback Sales (<tanggal>)

| | |
|---|---|
| Commit | `<sha>` |
| DB | lokal, `db-rebuild` + `seed-browser-tour.ts` |
| Aktor | EMP-0003 (Creative staff) · EMP-0011 (Creative lead) · EMP-0012 (OD murni) · EMP-0008 (Director) · EMP-0001 (Sales staff) · EMP-0006 (Head Sales) |
| Tangkapan layar | `<lokasi>` |

## Hasil

| Layar | Butir | Peran | Hasil | Catatan |
|---|---|---|---|---|
| /creative/schedule | 1.1(a) empat studio | lead | PASS/FAIL/BELUM | |
| /creative/schedule | 1.1(b) "Bebas" | lead | | |
| /creative/schedule | 1.1(e) dua slot bertumpang tampil | lead | | |
| /creative/schedule | 1.1(f) "Tersimpan, dengan catatan" | lead | | |
| … | … | … | | |

## Temuan

1. **[layar] [butir]** — gejala, PNG, dan apakah ia cacat KODE atau cacat DATA.

## Yang TIDAK dijalankan, dan kenapa
```

**Aturan pelaporan:** butir yang tidak dijalankan ditulis **BELUM**, jangan
dikosongkan dan jangan diasumsikan PASS. Laporan yang jujur tentang cakupannya
lebih berguna daripada laporan yang terlihat lengkap — itu justru pelajaran
yang melahirkan koreksi PR #337.
