# RUNBOOK — Backup MySQL Railway terakhir + OQ-2

> **Menutup:** gate GO butir 6 (`docs/backlog/CUTOVER_BACKLOG.md` §2 —
> *"Backup MySQL Railway terakhir tersimpan"*) **dan** sisa OQ-2
> (`docs/DECISIONS.md` 2026-07-29 — *"terjawab untuk perencanaan, belum
> terverifikasi untuk dekomisi"*).
>
> **Bukan** menutup: butir 7 (rencana rollback) — dokumen resminya
> `RENCANA_ROLLBACK_CUTOVER.md`. Backup + OQ-2 di sini **menutup dua prasyarat**
> dokumen itu (§3.1 #1 dan #2).

---

## 0. Kenapa dua hal ini dikerjakan bersamaan

Keduanya menjawab pertanyaan yang sama dari dua sisi:

| | Pertanyaan | Jawaban dianggap sah kalau |
|---|---|---|
| **OQ-2** | Apa isi MySQL Railway? | Ada `COUNT(*)` sungguhan per tabel, **dan** bukti bahwa "0" berarti kosong, bukan berarti querynya salah |
| **Butir 6** | Kalau Railway dimatikan, apa yang hilang? | Ada satu berkas yang **terbukti** memuat isi itu, tersimpan di tempat yang tidak ikut mati bersama Railway |

DECISIONS 2026-07-29 sudah menandai jebakannya sendiri:

> *"'0 baris' pada DB kosong tidak bisa dibedakan dari '0 baris karena querynya
> salah', kesalahan yang sudah pernah terjadi di entri O41."*

Karena itu skrip di runbook ini **selalu** mencetak tiga hal berdampingan:
`DATABASE()` yang sedang dibaca, **jumlah kolom** tiap tabel, dan `COUNT(*)`-nya.
Tabel ber-14-kolom yang melaporkan 0 baris terbukti ada dan terbaca. Tabel yang
tidak ada tidak muncul di daftar mana pun — dan skrip berhenti dengan exit code
2 kalau `leads`/`clients`/`transactions` hilang, alih-alih melaporkan nol.

---

## 1. Yang Anda butuhkan (sekali saja)

### 1.1 URL koneksi publik Railway

Railway → proyek CDPS → service **MySQL** → tab **Variables** → salin
**`MYSQL_PUBLIC_URL`**.

Bentuknya `mysql://root:<password>@<sesuatu>.proxy.rlwy.net:<port>/railway`.

> ⛔ **Jangan pakai `MYSQL_URL`.** Yang itu memakai host
> `mysql.railway.internal` yang hanya hidup **di dalam** proyek Railway. Dari
> laptop atau runner GitHub ia gagal sebagai timeout DNS — gejala yang mudah
> dibaca sebagai "DB-nya sudah mati" padahal cuma URL-nya salah pilih. Skrip
> menolak host `*.railway.internal` dengan pesan eksplisit supaya salah-baca ini
> tidak mungkin terjadi diam-diam.

### 1.2 Passphrase enkripsi

Buat passphrase acak panjang (password manager → generate, ≥32 karakter) dan
**simpan dulu di password manager**, baru dipakai.

> Dump terenkripsi yang passphrase-nya hilang **bukan backup** — ia berkas acak.
> Urutannya penting: simpan dulu, pakai kemudian.

### 1.3 Kalau lewat GitHub Actions — dua repository secret

Settings → Secrets and variables → Actions → **New repository secret**:

| Nama secret | Isi |
|---|---|
| `RAILWAY_MYSQL_URL` | `MYSQL_PUBLIC_URL` dari §1.1 |
| `RAILWAY_BACKUP_PASSPHRASE` | passphrase dari §1.2 |

Lalu Settings → **Environments** → `railway-backup` → **Required reviewers** →
tambahkan diri Anda. (Environment-nya dibuat GitHub otomatis pada run pertama
**tanpa** proteksi — menambahkan reviewer adalah langkah tersendiri, persis
seperti `c03-production` di C-03.)

---

## 2. Jalur A — GitHub Actions (disarankan; tidak perlu instal apa pun)

Workflow: `.github/workflows/railway-mysql-backup.yml`

### 2.1 Hitungan OQ-2 dulu — read-only, aman diulang

1. Actions → **Backup MySQL Railway (OQ-2 + dump)** → **Run workflow**
2. `run_backup` biarkan **false** → **Run**
3. Sesudah hijau: buka artifact **`oq2-report`** → `oq2-railway-mysql.md`

Bacaannya ada di §4.

### 2.2 Dump penuh

1. **Run workflow** lagi, kali ini:
   - `run_backup` = **true**
   - `confirm_dump` = ketik persis **`YA`**
2. Job `backup` akan **menunggu approval** environment `railway-backup` →
   **Review deployments** → **Approve and deploy**
3. Sesudah hijau: baca **Summary** run (manifest sudah tercetak di sana), lalu
   unduh artifact **`railway-mysql-backup`** (berisi `.sql.gz.enc` + `.manifest.md`)
4. **Lanjut ke §5 — mengunduh saja belum menutup butir 6.**

> **Kenapa dump butuh approval padahal ia read-only terhadap Railway?**
> Karena yang berisiko bukan tulisnya, melainkan ke mana hasilnya pergi. Repo
> ini **publik** (SESI24 §1.4), dan artifact di repo publik bisa diunduh siapa
> saja. Karena itu dump **selalu** terenkripsi, dan workflow menolak jalan tanpa
> passphrase.

---

## 3. Jalur B — dari laptop

Butuh klien MySQL:

```bash
# Ubuntu/Debian
sudo apt-get install -y mysql-client
# macOS
brew install mysql-client
```

> Server Railway adalah MySQL 8 (auth `caching_sha2_password`). Klien MySQL 8
> resmi pasti cocok; `mariadb-client` 10.11+ umumnya juga, tapi kalau muncul
> galat autentikasi yang aneh, itu tersangka pertamanya.

```bash
export RAILWAY_MYSQL_URL='mysql://root:...@...proxy.rlwy.net:PORT/railway'

# 1) OQ-2 — read-only
./scripts/railway-mysql-oq2.sh --out ~/oq2-railway-mysql.md

# 2) Dump + verifikasi + enkripsi
export RAILWAY_BACKUP_PASSPHRASE='...'          # dari §1.2
./scripts/railway-mysql-backup.sh --outdir ~/cdps-backup
```

Punya MySQL lokal untuk uji restore? Tambahkan lapis ke-4 (§4.2):

```bash
mysql -e "CREATE DATABASE verify_restore"       # HARUS kosong; skrip menolak yang berisi
./scripts/railway-mysql-backup.sh --outdir ~/cdps-backup \
  --verify-restore-into 'mysql://root:PASSWORD@127.0.0.1:3306/verify_restore'
```

> Backup yang tidak akan pernah meninggalkan laptop boleh `--no-encrypt`. Begitu
> ia menyeberang ke cloud drive, chat, atau CI — enkripsi wajib.

---

## 4. Membaca hasilnya

### 4.1 Laporan OQ-2

| Yang dilihat | Artinya |
|---|---|
| `DATABASE()` sama dengan yang diminta URL | kita membaca DB yang dimaksud, bukan DB lain |
| **49 BASE TABLE** terbaca | schema CDPS memang ada di sana (49 tabel dari `backend/migrations/*.up.sql`) |
| `leads`/`clients`/`transactions` muncul **dengan jumlah kolom** | ketiganya ada dan terbaca — jadi angka barisnya bisa dipercaya |
| Total baris **0** | Railway memang kosong ⇒ dekomisi tidak menghilangkan entitas apa pun ⇒ OQ-2 naik dari "terjawab" jadi **terverifikasi** |
| Total baris **bukan 0** | Jangan langsung disimpulkan dua-duanya. Yang menentukan bukan totalnya, melainkan **tabel mana** — lihat di bawah |

**Total bukan-nol tidak otomatis berarti "ada data produksi".** Tiga golongan,
dan hanya satu yang memblokir:

| Golongan | Tabel | Artinya |
|---|---|---|
| **Seed migrasi** | `perf_kpi_weights`, `perf_period_targets`, `schema_migrations`, `id_sequences` | diisi oleh migrasi/runner, bukan oleh pemakaian. **Nol pengaruh** pada keputusan |
| **Artefak pemakaian dev/UAT** | `employees`, `role_mappings`, `employee_*`, `sessions`, `audit_log`, `notifications` | jejak masa pengembangan. Sudah digantikan Supabase (yang berwenang). **Tidak memblokir** — tapi ikut hilang saat Railway mati, jadi ia alasan backup-nya diambil |
| **Entitas jalur uang** 🔴 | `clients`, `transactions`, `installments`, `services`, `qualified_forms` | kalau **ini** bukan-nol ⇒ ⛔ **STOP.** `CUTOVER_BACKLOG.md` §C-04 butir 1: butuh rencana ekspor-impor mengikuti rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`. Jangan improvisasi, catat keputusannya dulu |

`leads` dan `prospect_attempts` duduk di antara golongan 2 dan 3: satu-dua baris
hampir pasti rekaman uji, puluhan baris berarti orang benar-benar memakainya.
**Kalau angkanya kecil, buka barisnya dan pastikan** — itu satu `SELECT`, dan ia
memisahkan "rekaman uji" dari "prospek yang benar-benar hilang saat Railway mati".

### 4.2 Empat lapis verifikasi backup

Skrip tidak menganggap `mysqldump` selesai = backup selesai:

| Lapis | Yang dibuktikan | Cara |
|---|---|---|
| 1 · struktur | setiap tabel di server ada di dump, dan tidak ada tabel asing | daftar `CREATE TABLE` ⇄ `information_schema` |
| 2 · baris | jumlah baris per tabel di dump = `COUNT(*)` server | dump diambil `--skip-extended-insert` ⇒ 1 baris = 1 `INSERT`, bisa dihitung dari berkasnya sendiri |
| 3 · trigger | **7 trigger imutabilitas** ikut (aturan rumah #3: `audit_log`, `notifications`, `*_snapshots` tanpa jalur UPDATE/DELETE) | hitungan `CREATE TRIGGER` ⇄ `information_schema.triggers` |
| 4 · restore *(opsional)* | dump-nya benar-benar **bisa dieksekusi**, bukan cuma terlihat benar | dimuat ulang ke MySQL kosong, lalu seluruh tabel dihitung ulang dan dibandingkan |

Kalau ada satu saja yang merah, skrip keluar dengan **exit 3** dan manifest-nya
menuliskan yang gagal. **Jangan catat butir 6 selesai dari run seperti itu.**

Ketiga lapis pertama sudah **divalidasi mutasi**: dump yang kehilangan satu baris
`INSERT`, satu `CREATE TABLE`, dan satu `CREATE TRIGGER` masing-masing membuat
lapis yang bersangkutan **MERAH** — jadi hijaunya bukan hijau yang hampa.

> **Temuan lapis 4 yang sudah terpakai:** `mysqldump` menempelkan
> `DEFINER=root@localhost` pada setiap trigger, dan restore oleh user tanpa
> privilege `SUPER` **mati di tengah jalan** (ERROR 1227) — sesudah sebagian
> tabel masuk. Ini ketahuan karena lapis 4 dijalankan, bukan karena diperkirakan.
> Skrip sekarang melucuti `DEFINER` secara default (identitas definer tidak
> memikul apa pun di CDPS: ketujuh trigger hanya `SIGNAL` menolak UPDATE/DELETE).
> `--keep-definer` untuk yang butuh fidelitas persis.

---

## 5. Mengunduh & menyimpan backup — di sinilah butir 6 benar-benar tertutup

Artifact GitHub **kedaluwarsa dalam 30 hari** dan hidup di repo publik. Selama
berkas itu hanya ada di sana, butir 6 **belum** selesai.

### 5.0 Tutorial unduh — langkah demi langkah

> **Backup yang sudah ada:** run **`30607919027`** · artifact
> **`railway-mysql-backup`** · **kedaluwarsa `2026-08-30 05:54 UTC`**.

**Langkah 1 — buka halaman run-nya**

https://github.com/MEAgrup/AgencyAPP/actions/runs/30607919027

(Atau lewat menu: repo → tab **Actions** → workflow *Backup MySQL Railway (OQ-2 +
dump)* → pilih run yang **hijau** paling atas.)

**Langkah 2 — gulir ke bawah sampai kotak `Artifacts`**

Kotaknya ada di **paling bawah** halaman run, di bawah daftar job. Klik nama
**`railway-mysql-backup`** → browser mengunduh **`railway-mysql-backup.zip`**
(±15 KB).

> Harus **login GitHub** dengan akun yang punya akses repo. Kalau kotak
> `Artifacts` tidak muncul sama sekali, artifact-nya sudah kedaluwarsa — lihat §5.3.

**Langkah 3 — ekstrak**

Isinya **dua** berkas:

| Berkas | Isi |
|---|---|
| `cdps-mysql-railway-20260731T055157Z.sql.gz.enc` | dump terenkripsi — **ini backup-nya** |
| `cdps-mysql-railway-20260731T055157Z.manifest.md` | checksum + hitungan + cara restore |

**Langkah 4 — cocokkan sha256 (jangan dilewati)**

Ini yang membedakan "punya berkas" dari "punya berkas yang utuh". Hitung
checksum berkas **`.enc`** (bukan `.zip`-nya):

```bash
# macOS / Linux
shasum -a 256 cdps-mysql-railway-20260731T055157Z.sql.gz.enc
```
```powershell
# Windows PowerShell
Get-FileHash -Algorithm SHA256 .\cdps-mysql-railway-20260731T055157Z.sql.gz.enc
```

Harus **persis** sama dengan:

```
1b9ecffd6f0c4072cfde24b7dc25b49929480bec204c5dacd19e04a15647cb3e
```

Beda satu karakter ⇒ berkasnya rusak saat transfer. **Unduh ulang, jangan simpan.**

**Langkah 5 — simpan**

Taruh **`.enc` + `.manifest.md` berdampingan** di tempat yang Anda kendalikan
(Google Drive perusahaan folder terbatas, dan/atau drive lokal). Simpan
**terenkripsi apa adanya** — jangan didekripsi lalu diunggah dalam bentuk polos.

**Langkah 6 — pastikan passphrase-nya ada di password manager**

Isinya `RAILWAY_BACKUP_PASSPHRASE` yang Anda pasang sebagai repository secret.
**GitHub tidak bisa menampilkannya kembali** — kepada siapa pun, termasuk Anda.
Kalau ia hanya hidup di sana, berkas §5.0 ini adalah **byte acak**, bukan backup.

### 5.1 Uji buka (opsional, ~1 menit — tapi ini yang membuktikan backup-nya hidup)

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha512 \
  -in cdps-mysql-railway-20260731T055157Z.sql.gz.enc -out coba.sql.gz
# openssl akan MEMINTA passphrase — mengetiknya di prompt lebih aman
# daripada menaruhnya di perintah (perintah tersimpan di shell history)

gunzip -c coba.sql.gz | head -20     # harus terbaca sebagai SQL
rm coba.sql.gz                        # hapus lagi; simpan yang terenkripsi saja
```

Passphrase salah **gagal keras** dengan `bad decrypt` — ia tidak diam-diam
menghasilkan berkas sampah. Jadi kalau perintah ini lolos, passphrase Anda benar.

> **Windows:** `openssl` tidak ada bawaan. Pakai **Git Bash** (ikut terpasang
> bersama Git for Windows) atau WSL — perintah di atas jalan apa adanya di sana.

### 5.2 Restore penuh (kalau kelak benar-benar dibutuhkan)

```bash
gunzip coba.sql.gz
mysql -h <host> -P <port> -u <user> -p <database> < coba.sql
```

Dump ini **sudah terbukti bisa dipulihkan** — lapis 4 memuatnya ulang ke MySQL
8.4 kosong dan menghitung ulang seluruh 50 tabel. Dua perbaikan yang membuatnya
mungkin ada di §4.2.

### 5.3 Kalau artifact sudah terlanjur kedaluwarsa

Jalankan ulang §2.2 — **selama Railway masih hidup**. Kalau Railway sudah
dimatikan, backup itu **tidak bisa diambil ulang sama sekali**. Karena itu
urutannya: **unduh & simpan dulu → baru matikan Railway.**

### 5.4 Checklist penyimpanan

> **✅ Untuk backup 2026-07-31 checklist ini sudah TERPENUHI** — lihat
> `BACKUP_MYSQL_RAILWAY_REPORT_20260731.md` §6. Yang di bawah berlaku untuk
> backup berikutnya, kalau kelak ada.

- [ ] `.enc` diunduh dan **sha256 cocok** (§5.0 langkah 4) — **tidak dilonggarkan**
- [ ] `manifest.md` disimpan **berdampingan** — di situ ada sha256, jumlah
      tabel/baris/trigger, dan perintah restore-nya
- [ ] Berkasnya **keluar dari GitHub** — artifact ber-retensi 30 hari bukan
      tempat penyimpanan. **Tidak dilonggarkan**
- [ ] **Satu** salinan cukup ~~dua salinan di tempat berbeda~~ — dilonggarkan
      2026-07-31 (`DECISIONS.md`), berlaku **hanya** selama isi DB yang di-backup
      terbukti bukan data produksi. Untuk DB berisi entitas jalur uang, aturan
      dua salinan kembali berlaku
- [ ] Passphrase ada di password manager ~~dan bisa diakses orang kedua~~ —
      PIC kedua dilonggarkan 2026-07-31, dengan alasan yang sama

> ⛔ **Jangan commit dump ke repo ini** — terenkripsi sekalipun. Repo publik,
> dan histori git tidak bisa ditarik kembali (pelajaran O47b, SESI24 §1.4).
> Yang boleh masuk repo adalah **laporan OQ-2** (nama tabel + angka, nol PII) dan
> **manifest** (checksum + hitungan, nol data).

---

## 6. Yang dicatat sesudahnya

1. Salin `docs/handoff/BACKUP_MYSQL_RAILWAY_REPORT_TEMPLATE.md` →
   `docs/handoff/BACKUP_MYSQL_RAILWAY_REPORT_<YYYYMMDD>.md`, isi angkanya dari
   laporan OQ-2 + manifest
2. `CUTOVER_BACKLOG.md` §2: centang **"Backup MySQL Railway terakhir tersimpan"**
3. `DECISIONS.md`: entri baru — OQ-2 **terverifikasi untuk dekomisi**, dengan
   angka totalnya. (Entri 2026-07-29 **jangan disunting**; ia append-only, dan
   entri barulah yang mencabut batas yang ia nyatakan sendiri.)

Sesudah itu gate GO tinggal butir 7 (§7) — dan sesudah GO, C-05 boleh mencabut
`backend/`.

---

## 7. Butir 7 — rencana rollback

> ⚠️ **DIGANTIKAN.** Rencana rollback resmi kini `docs/handoff/RENCANA_ROLLBACK_CUTOVER.md`
> (PR #87, ter-merge lebih dulu) — ia lebih lengkap: prasyarat, urutan eksekusi, dan
> titik tak-bisa-kembali. **Pakai berkas itu.** Yang di bawah adalah draf awal dari
> PR #86, disimpan sebagai catatan pertimbangan N, bukan sebagai rencana yang berlaku.

Butir 7 berbunyi *"Railway tetap hidup N hari pasca-cutover sebelum dimatikan"*.
Yang belum ada bukan dokumennya — melainkan **N** dan siapa yang menyatakan
"aman dimatikan". Draf usulan, ubah sesuka Anda:

| | Usulan | Alasan |
|---|---|---|
| **N** | **14 hari** sesudah tanggal GO | Menutupi satu siklus kerja penuh: closing bulanan, satu putaran penagihan cicilan, dan minggu pertama pemakaian semua role. Cacat yang lolos UAT biasanya muncul di siklus pertama, bukan di hari pertama |
| **Bentuk "hidup"** | Service Railway **berjalan tapi tidak dipakai** — nol traffic diarahkan ke sana | Rollback yang butuh restore dulu bukan rollback; ia proyek |
| **Pemicu rollback** | Cacat produksi yang memblokir jalur uang (M0/M1/M4/M5) dan tidak bisa diperbaiki dalam 1 hari kerja | Batas yang bisa diputuskan cepat saat panik |
| **Yang menyatakan aman** | Yohan **dan** Nerissa (OQ-1) | Konsisten dengan PIC gate |
| **Hari ke-N** | Backup §5 dicocokkan sha256 sekali lagi → service Railway dimatikan → C-05 dijalankan | Backup diverifikasi tepat sebelum sumbernya hilang, bukan berminggu sebelumnya |

> Catatan jujur: sesudah cutover, data baru **hanya** masuk ke Supabase. Jadi
> "rollback ke Railway" berarti kembali ke keadaan pada hari GO **plus**
> kehilangan apa pun yang tercatat sesudahnya. Semakin besar N, semakin mahal
> rollback-nya — N bukan "makin lama makin aman". 14 hari adalah titik di mana
> nilainya masih lebih besar dari biayanya; kalau CDPS dipakai berat sejak hari
> pertama, **perpendek**, jangan perpanjang.

---

## 8. Definition of Done butir 6

- [ ] Laporan OQ-2 ada, memuat `DATABASE()` + kolom + `COUNT(*)` per tabel
- [ ] `leads`/`clients`/`transactions` ketiganya muncul (bukan hilang) dan angkanya tercatat
- [ ] Dump ada, dan **4 lapis** verifikasi hijau (atau 3 lapis kalau tanpa uji restore — catat mana yang tidak dijalankan)
- [ ] Berkas + manifest tersimpan di **dua** lokasi di luar GitHub, sha256 cocok
- [ ] Passphrase ada di password manager dan bisa diakses PIC kedua
- [ ] Report `BACKUP_MYSQL_RAILWAY_REPORT_<tanggal>.md` di-commit
- [ ] `CUTOVER_BACKLOG.md` §2 dicentang + entri `DECISIONS.md`
