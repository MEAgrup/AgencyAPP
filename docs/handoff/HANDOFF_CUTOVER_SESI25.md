# HANDOFF — Cutover Sesi 25 (butir 6 gate GO: perkakas backup MySQL Railway + OQ-2)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI24.md`. Masih sahih **kecuali** §2
> ("SATU HAL YANG MENGGANTUNG") — run C-03 yang di sana berstatus `waiting`
> **sudah disetujui dan hijau**. Lihat §1.1.
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4
> (`npm run db:rebuild`) · SESI19–24 daftar "jangan dikerjakan" · SESI24 §1.4
> (repo publik ⇒ **jangan tambah NIK/PII ke berkas repo**).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/backup-mysql-railway-9kf557`** |
| **`main`** | **`df3dddb`** = Merge PR #85. Rantai: … → #84 → **#85** |
| **PR** | nol PR terbuka saat sesi ini mulai |
| **Live `CDPS SG`** | **tidak dibaca sesi ini, tidak disentuh sesi ini** — jangan salin angka dari handoff mana pun, baca dari live |
| **Run C-03 `30600363211`** | **`success`** — `probe` ✅ + `uat` ✅ (disetujui 2026-07-31 03:13 UTC, selesai 03:18) |

**Nol perubahan pada:** live Supabase · migrasi · `backend/**` · `apps/**` ·
`packages/**` · `web-internal/**`. Sesi ini menambah **skrip + workflow + docs**.

---

## 1. Yang dikerjakan sesi ini

### 1.1 ✅ Run C-03 ternyata SUDAH HIJAU — SESI24 §2 tidak lagi menggantung

`30600363211` sekarang `conclusion: success`, kedua job hijau, dan ketiga langkah
skrip **exit 0**:

| Langkah | Status |
|---|---|
| `walk house-rules` (SKIP-1) | ✅ |
| `wave3 contract smoke` | ✅ |
| `auth smoke` (SKIP-3) | ✅ |

**Apa yang boleh disimpulkan dari itu, tepatnya:** `cutover-houserules-walk.mjs`
keluar 0 **hanya bila `pass === results.length`** ⇒ walk-nya **seluruh** cek
lulus. `wave3-contract-smoke.mjs` dan `auth-smoke.mjs` keluar 0 bila `failed === 0`.
Jadi **FAIL = 0 terbukti dari exit code**; angka persisnya (22/22 · 34/34 · 13/13)
dan blok **`aktor terpakai`** ada di artifact `c03-output`, **yang tidak bisa
diunduh dari sesi Claude** — gateway sandbox menolak CONNECT ke penyimpanan
artifact GitHub (403), kelas hambatan yang sama seperti `*.vercel.app`.

**Sisa C-03 karena itu tinggal satu langkah manusia + satu langkah Claude:**
unduh artifact → tempel isinya di sesi berikutnya → Claude menulis
`CUTOVER_UAT_REPORT_20260731.md` (salin blok `aktor terpakai` ketiga skrip —
provenance = syarat reproducible) → centang `CUTOVER_BACKLOG.md` §2 C-03 `[~]`→`[x]`.
**SKIP-2 (badge notifikasi) tetap manual, ~3 menit di browser.**

> Artifact kedaluwarsa **2026-10-29**. Sesudah itu buktinya hilang dan run harus
> diulang — jangan ditunda sampai dekat tanggal itu.

### 1.2 ✅ Butir 6 gate GO: perkakasnya jadi, eksekusinya milik pemilik

Butir 6 selama ini tercatat *"butuh akses Railway"* ⇒ menunggu laptop dengan
klien MySQL terpasang. Premis itu patah oleh alasan yang sama seperti C-03
(SESI24 §1.3): Railway mengekspos MySQL lewat **TCP proxy publik**, jadi yang
benar-benar kurang cuma kredensial — **satu repository secret**.

| Berkas | Isi |
|---|---|
| `scripts/lib/railway-mysql-common.sh` | urai URL (tahan '@' di password), option file 0600 (password tak pernah lewat argumen proses), hitungan baris |
| `scripts/railway-mysql-oq2.sh` | OQ-2, read-only, keluaran Markdown |
| `scripts/railway-mysql-backup.sh` | dump + verifikasi 4 lapis + enkripsi |
| `.github/workflows/railway-mysql-backup.yml` | job `oq2` (read-only) + job `backup` (environment ber-reviewer) |
| `docs/handoff/RUNBOOK_BACKUP_MYSQL_RAILWAY.md` | langkah pemilik, dua jalur (Actions / laptop), + **draf butir 7** |
| `docs/handoff/BACKUP_MYSQL_RAILWAY_REPORT_TEMPLATE.md` | report yang diisi sesudah eksekusi |

**Dump tidak dianggap selesai pada `mysqldump`.** Empat lapis:

1. **struktur** — `CREATE TABLE` di dump ⇄ `information_schema`
2. **baris** — `--skip-extended-insert` ⇒ 1 baris = 1 `INSERT`; dihitung per
   tabel lawan `COUNT(*)` yang diambil **sebelum** dump
3. **trigger** — 7 trigger imutabilitas (aturan rumah #3) wajib ikut
4. **restore sungguhan** (opsional) — dimuat ke MySQL kosong, dihitung ulang

**Ketiga lapis pertama divalidasi mutasi**, bukan diklaim: menghapus satu
`INSERT` ⇒ lapis 2 merah; mengganti nama satu `CREATE TABLE` ⇒ lapis 1 merah;
menghapus satu `CREATE TRIGGER` ⇒ lapis 3 merah. Ketiganya exit **3**.

Diuji end-to-end terhadap MySQL sungguhan (MariaDB 10.11 lokal, 49 tabel dari
`backend/migrations/*.up.sql`, 7 trigger, 24 baris termasuk nilai ber-kutip,
koma, dan newline): **4/4 lapis hijau**, enkripsi + round-trip dekripsi identik.
Password uji sengaja `p@ss word#1` (percent-encoded) untuk menguji jalur urai
yang paling mudah salah.

### 1.3 🔴 Lapis 4 langsung menemukan cacat nyata — dan itu alasan ia ada

Restore **GAGAL** pada percobaan pertama:

```
ERROR 1227 (42000) at line 200: Access denied; you need (at least one of)
the SUPER, SET USER privilege(s) for this operation
```

`mysqldump` menempelkan `DEFINER=root@localhost` pada ketujuh trigger. Dipulihkan
oleh user yang bukan `root`, MySQL menolak — **sesudah sebagian tabel sudah
masuk**. Ini kelas kegagalan yang, tanpa lapis 4, baru ketahuan **pada hari
backup-nya dibutuhkan**, dan pada hari itu tidak ada waktu untuk mendiagnosis.

Skrip sekarang melucuti `DEFINER` secara default (`--keep-definer` untuk
fidelitas persis). Aman untuk CDPS: ketujuh trigger hanya `SIGNAL` menolak
UPDATE/DELETE — identitas definer tidak memikul apa pun. Tercatat `DECISIONS.md`
2026-07-31.

### 1.4 Enkripsi wajib, dan alasannya bukan kebiasaan umum

Repo ini **publik** (SESI24 §1.4). Artifact Actions pada repo publik bisa diunduh
siapa saja — dump produksi polos di sana **kebocoran, bukan backup**. Karena itu:
skrip berhenti tanpa `RAILWAY_BACKUP_PASSPHRASE` (kecuali `--no-encrypt`
eksplisit), dekripsi diuji **sebelum** berkas polos dihapus, dan workflow punya
langkah terpisah yang membuat run MERAH kalau ada berkas polos tersisa.

Batas job di workflow karena itu **bukan** "menulis vs tidak" — terhadap Railway
keduanya read-only. Yang membedakan: keluaran `oq2` adalah nama tabel + angka
(nol PII), keluaran `backup` adalah seluruh isi DB.

---

## 2. Yang harus dilakukan pemilik — semuanya di runbook

`docs/handoff/RUNBOOK_BACKUP_MYSQL_RAILWAY.md`. Ringkasnya:

1. Railway → service MySQL → Variables → salin **`MYSQL_PUBLIC_URL`**
   (⛔ **bukan** `MYSQL_URL` — host `*.railway.internal` tidak hidup di luar Railway)
2. Buat passphrase acak, **simpan di password manager lebih dulu**
3. Pasang 2 repository secret: `RAILWAY_MYSQL_URL`, `RAILWAY_BACKUP_PASSPHRASE`
4. Settings → Environments → `railway-backup` → tambah **required reviewer**
5. Actions → *Backup MySQL Railway* → Run (`run_backup=false`) → baca artifact `oq2-report`
6. Run lagi (`run_backup=true`, `confirm_dump=YA`) → approve → unduh artifact
7. **Simpan dump + manifest di DUA tempat di luar GitHub**, cocokkan sha256
8. Isi report dari template → centang backlog → entri `DECISIONS.md`

> Langkah 7 yang benar-benar menutup butir 6. Artifact kedaluwarsa **30 hari**;
> selama berkasnya cuma ada di sana, butir 6 **belum** selesai.

**Butir 7 (rencana rollback)** — draf usulan ada di runbook §7 (N = **14 hari**,
lengkap dengan alasan kenapa N besar justru **menaikkan** biaya rollback: sesudah
cutover data baru hanya masuk Supabase). Tinggal disetujui/diubah Yohan+Nerissa.

---

## 3. Sisa pekerjaan

> **⚠️ Diperbarui 2026-07-31 sore — §1.2/§2 sudah DIEKSEKUSI, bukan lagi "siap dijalankan".**
> OQ-2 **terverifikasi** (run `30604816629`) dan dump **terverifikasi 4 lapis**
> (run `30607919027`). Hasil + temuan lengkap: `BACKUP_MYSQL_RAILWAY_REPORT_20260731.md`.
> **Yang tersisa dari butir 6 hanya penyimpanan** — berkasnya masih artifact
> ber-retensi 30 hari.
>
> **Untuk sesi berikutnya, satu hal teknis yang mengubah banyak:** artifact
> GitHub memang tak bisa diunduh dari sesi Claude (403 ke penyimpanan blob),
> **tapi job log BISA** lewat `get_job_logs`. Semua yang dicetak skrip ke stdout
> terbaca dari sana — begitulah seluruh tabel OQ-2 dan baris 257 yang bermasalah
> didapat. Konsekuensi langsung: **C-03 (butir 1) tidak lagi butuh pemilik
> mengunduh apa pun.**

| # | Butir | Siapa |
|---|---|---|
| 1 | **C-03** — hasil ketiga skrip bisa dibaca langsung dari job log run `30600363211` ⇒ report + centang backlog **tanpa** unduhan pemilik | **Claude** |
| 2 | **Butir 6** — ✅ OQ-2 + dump SELESAI & terverifikasi. ❌ sisa: simpan berkasnya di luar GitHub + cocokkan sha256 (+ setujui pelonggaran DoD penyimpanan) | **pemilik** |
| 3 | **Butir 7** — setujui/ubah draf rollback | **pemilik** |
| 4 | **O50** — 10 akun `99000000xx` masih aktif; DoD C-04 mensyaratkan nol fixture di produksi | **pemilik** |
| 5 | **O35** · **O9** · divisi dasar 3 orang OD (SESI24 §1.1) | **pemilik** |
| 6 | **O48 Grup A/B/E** | **pemilik + head dev** → Claude |
| 7 | **Visibility repo** → privat, lalu tinjau ulang **O47b** | **pemilik** |
| 8 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |

**Progress pensiun Go: ~93%.** Engineering sisi Claude tetap **100%** sejak sesi
19; yang bergerak sesi ini adalah Fase 4 — C-03 hijau (tinggal pelaporan) dan
butir 6 turun dari "butuh akses" jadi "tinggal dijalankan". Fase 4 tetap **bukan
angka terukur**; butir gate tidak punya satuan yang bisa dijumlah.

## 4. Yang JANGAN dikerjakan

Seluruh daftar SESI19–24 masih berlaku. Tambahan yang relevan sekarang:

- **Jangan commit dump ke repo** — terenkripsi sekalipun. Repo publik, dan histori
  git tidak bisa ditarik kembali (pelajaran O47b).
- **Jangan pasang `RAILWAY_MYSQL_URL` sebagai variable** (Settings > Variables) —
  ia **secret**; variable tercetak apa adanya di log.
- **Jangan centang butir 6** sebelum berkasnya tersimpan di luar GitHub dan
  sha256-nya dicocokkan. Artifact yang kedaluwarsa diam-diam meninggalkan
  checklist yang tercentang tanpa backup di baliknya.
- **Jangan jalankan `backup` dari trigger otomatis** — job itu `workflow_dispatch`
  saja, dan gerbang approval-nya ada supaya dump produksi butuh klik manusia.
