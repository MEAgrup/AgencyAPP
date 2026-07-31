# HANDOFF — Cutover Sesi 26 (titik mulai berikutnya)

> **Pendahulu: DUA berkas, keduanya wajib dibaca** — sesi 25 berjalan **paralel
> di dua akun**, dan keduanya sudah ter-merge:
> - `HANDOFF_CUTOVER_SESI25.md` (PR #87) — **C-03 ditutup · O50 selesai ·
>   DoD C-04 dirumuskan ulang · rencana rollback**
> - `HANDOFF_CUTOVER_SESI25B.md` (PR #86) — **butir 6 gate GO: backup MySQL
>   Railway + OQ-2**
>
> Nol tumpang tindih kode. Kalau keduanya berbeda soal C-03, **SESI25 (PR #87)
> yang berlaku**. Berkas ini adalah **titik mulai** yang menggabungkan keduanya.
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4
> (`npm run db:rebuild`) · SESI19–24 daftar "jangan dikerjakan" · SESI24 §1.4
> (**repo publik ⇒ jangan tambah NIK/PII ke berkas repo**).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | ⚠️ **BUAT BARU dari `main`.** Branch lama `claude/backup-mysql-railway-9kf557` **sudah ter-merge lewat PR #86** — jangan menumpuk commit di atasnya |
| **`main`** | merge commit PR #86. Rantai: … → #84 → #85 → **#87** → **#86** |
| **PR** | **#86 & #87 MERGED.** Nol PR terbuka saat berkas ini ditulis |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 event** per SESI25 — **tetap baca ulang dari live**, jangan percaya baris ini |
| **Karyawan aktif** | **59 riil** (bukan 69 — 10 fixture O50 sudah dinonaktifkan; 4 dihapus, 6 tombstone permanen). **Pakai 59** |
| **Railway MySQL** | masih **hidup**. Backup terakhir **sudah diambil & tersimpan di luar GitHub** (butir 6 `[x]`) |

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout -B claude/<nama-task-baru> origin/main
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal      # TERPISAH — bukan anggota `workspaces`
```

> ⚠️ `npm test --workspaces` **TIDAK** menjalankan `web-internal` (`package.json`
> hanya `apps/*` + `packages/*`). Mengandalkan `--workspaces` saja membuat 26 test
> itu terlihat hijau tanpa pernah dijalankan.

---

## 1. Gate GO — keadaan sekarang

```
[x] C-00   [x] C-01   [x] C-02
[x] C-03 — DITUTUP 2026-07-31 (PASS 69 · FAIL 0). SKIP-2 dipindah ke C-04
[~] C-04 — sisa: SKIP-2 badge · O34/O26/O35/O9 · walk ulang (§1.2)
[x] Backup MySQL Railway + OQ-2        ← ditutup 2026-07-31
[ ] Rencana rollback (butir 7)         ← SATU-SATUNYA butir gate yang tersisa
```

**O50 SELESAI sejauh yang mungkin** (PR #87): 4 akun fixture dihapus, **6 sisanya
tidak bisa dihapus siapa pun** — dinonaktifkan + di-ban GoTrue sebagai tombstone
permanen. DoD C-04 karena itu **dirumuskan ulang** dan disetujui pemilik:
*"nol fixture UAT yang **AKTIF atau BISA LOGIN** di produksi"*.

**Sesudah gate GO → C-05** (cabut `backend/`, arsipkan Go, matikan Railway).

### 1.1 Butir 7 — dokumennya ada, tinggal satu angka

**Dokumen resmi: `RENCANA_ROLLBACK_CUTOVER.md`** (PR #87). **Dua prasyarat 🔶-nya
sudah terpenuhi** oleh PR #86 dan §3.1-nya sudah diperbarui:

| Prasyarat | Status |
|---|---|
| #1 backup MySQL Railway | ✅ ada, terverifikasi 4 lapis, tersimpan di luar GitHub |
| #2 verifikasi OQ-2 | ✅ 50 tabel · 239 baris · jalur uang NOL |
| #3 Railway masih hidup / bisa dihidupkan | 🔶 belum diverifikasi (DB-nya terbukti hidup 2026-07-31) |
| #4 kredensial lama masih berlaku | 🔶 belum diverifikasi |

Yang dibutuhkan untuk mencentang butir 7: **satu angka N yang disepakati
Yohan+Nerissa** (OQ-1) + prasyarat #3/#4. Pertimbangan N ada di
`RUNBOOK_BACKUP_MYSQL_RAILWAY.md` §7 (usulan 14 hari, ditandai digantikan):
sesudah cutover data baru hanya masuk Supabase, jadi N besar **menaikkan** biaya
rollback, bukan menurunkan.

> 🔴 **Satu hal yang wajib dibaca sebelum rollback dieksekusi:** backup Railway
> **tidak bisa dipulihkan oleh `mysqldump` polos** — 7 trigger imutabilitas
> memicu `ERROR 1064` dan restore mati di tengah jalan. Berkas yang tersimpan
> **sudah diperbaiki dan restore-nya sudah dibuktikan**. Pakai berkas itu; kalau
> perlu dump baru, lewat `scripts/railway-mysql-backup.sh`, bukan `mysqldump`.

### 1.2 🔴 Urutan yang TIDAK boleh dibalik

**Walk C-03 WAJIB dijalankan ulang sebelum C-04 ditutup — dan sekarang, bukan nanti.**

Walk 2026-07-31 mengisi slot `finance_staff` dengan fixture O50 `9900000007`.
Hasil C-03 tetap sah — yang diuji gate permission, dan gate-nya bekerja. **Tapi
O50 sudah dieksekusi sesudah walk itu** (PR #87): fixture-nya kini nonaktif + di-ban.
⇒ Discovery tidak akan menemukan aktor Finance lagi, dan baris itu **jatuh jadi
SKIP** pada run berikutnya. Menutup C-04 tanpa walk ulang berarti menutupnya di
atas bukti yang sudah tidak berlaku.

Cara menjalankannya: Actions → *C-03 deployment UAT* → `run_uat=true`,
`confirm_write=YA` → approve environment `c03-production`. Hasilnya dibaca dari
**job log** (§3). Detail masalahnya: `CUTOVER_UAT_REPORT_20260731.md` §5.3.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| 1 | **SKIP-2** — badge notifikasi, mata di browser ~3 menit. Kini bagian **C-04**, bukan C-03 | **pemilik** |
| 2 | **Butir 7** — setujui N rencana rollback + verifikasi prasyarat #3/#4 (§1.1) | **pemilik** |
| ~~3~~ | ✅ **O50 SELESAI** (PR #87) — 4 dihapus, 6 tombstone permanen, DoD C-04 dirumuskan ulang | — |
| 4 | **O34 · O26 · O35 · O9** + divisi dasar 3 orang OD (SESI24 §1.1) | **pemilik** |
| 5 | **O48 Grup A/B/E** — Grup C+D sudah live | **pemilik + head dev** → Claude |
| 6 | **Visibility repo → privat**, lalu tinjau ulang **O47b** (PII di histori git) | **pemilik** |
| 7 | Gate GO → **C-05** (cabut `backend/`, matikan Railway) | **pemilik** → Claude |
| 8 | Probe ulang `transactions` · `performance_snapshots` · `*_block_requests` — ketiganya 0 baris di live, arm RLS-nya belum terbukti oleh data | Claude, saat datanya ada |

### 2.1 Kebersihan operasional Railway (tidak memblokir apa pun)

- **Environment `railway-backup` belum punya required reviewer** — gerbangnya tak
  pernah menyala. Selama kosong, siapa pun ber-akses tulis bisa memicu dump produksi.
- **Dua repository secret dihapus saat C-05**: `RAILWAY_MYSQL_URL`,
  `RAILWAY_BACKUP_PASSPHRASE`. ⚠️ **Passphrase paling belakangan** — berkas backup
  tidak bisa dibuka tanpanya.
- **Opsional**: hapus log run `30607290620` (host `*.proxy.rlwy.net` sempat
  tercetak ke log repo publik sebelum penyamaran dipasang).
- Artifact `railway-mysql-backup` boleh dibiarkan kedaluwarsa **2026-08-30** —
  salinan yang berlaku ada di tangan pemilik.

---

## 3. Dua teknik dari sesi 25 yang mengubah apa yang mungkin

**1. Job log BISA dibaca dari sesi Claude; artifact tidak.**
Gateway sandbox menolak penyimpanan blob GitHub (403), tapi
`get_job_logs(job_id, return_content=true, tail_lines=N)` mengembalikan stdout
penuh. Seluruh tabel OQ-2 dan diagnosis baris 257 didapat dari sana.
⇒ **Setiap workflow yang mencetak hasilnya ke stdout bisa dibaca Claude langsung** —
premis "butuh pemilik mengunduh artifact" salah. `tail_lines` perlu dicari-cari;
naikkan bertahap sampai bagian yang dicari muncul.

**2. GitHub Actions menembus apa yang sesi Claude tidak bisa.**
Runner menjangkau `*.vercel.app` **dan** `*.proxy.rlwy.net`, dan memegang secret.
Dua butir yang tercatat "butuh mesin/akses khusus" (C-03 dan butir 6) selesai
karena premis itu dipatahkan. Kalau butir berikutnya berbunyi *"butuh akses X"*,
pertanyaan pertamanya: **bisakah runner melakukannya?**

---

## 4. Yang JANGAN dikerjakan

Seluruh daftar SESI19–25 masih berlaku:

- **Jangan bangun apa pun di `backend/`** — oracle paritas read-only sampai C-05.
- **Jangan apply migrasi** tanpa membaca jumlahnya dari live lebih dulu.
- **Jangan salin baris "Live"/"Repo vs live" dari handoff mana pun** — baca dari live.
- **Jangan tulis ulang entri `DECISIONS.md` lama** — append-only; koreksi = entri baru.
- **Jangan tambah baris ke ketiga ledger** (`KNOWN_GAPS`, `NESTED_INLINE_UNCHECKED`,
  `RFC3339_PENDING_DECISION`) tanpa entri `DECISIONS.md`. Ketiganya hanya boleh menyusut.
- **Jangan tambah NIK/PII ke repo** selama status publik belum berubah.
- **Jangan menumpuk commit di `claude/backup-mysql-railway-9kf557`** — sudah ter-merge.
