# HANDOFF — Cutover Sesi 26 (titik mulai berikutnya)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI25.md` — masih sahih seluruhnya.
> Berkas ini adalah **titik mulai**, bukan pengulangan: ia mencatat posisi
> sesudah PR #86 di-merge dan apa yang harus dikerjakan selanjutnya.
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4
> (`npm run db:rebuild`) · SESI19–24 daftar "jangan dikerjakan" · SESI24 §1.4
> (**repo publik ⇒ jangan tambah NIK/PII ke berkas repo**).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | ⚠️ **BUAT BARU dari `main`.** Branch lama `claude/backup-mysql-railway-9kf557` **sudah ter-merge lewat PR #86** — jangan menumpuk commit di atasnya |
| **`main`** | merge commit PR #86. Rantai: … → #84 → #85 → **#86** |
| **PR** | **#86 MERGED.** Nol PR terbuka saat berkas ini ditulis |
| **Live `CDPS SG`** | **TIDAK dibaca sesi 25** dan **tidak disentuh** — jangan salin angka dari handoff mana pun, **baca dari live** |
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
[~] C-03 — sisa SKIP-2 saja (badge notifikasi, ~3 menit di browser)
[~] C-04 — sisa O50 · O34/O26/O35/O9
[x] Backup MySQL Railway + OQ-2        ← ditutup 2026-07-31
[ ] Rencana rollback (butir 7)         ← SATU-SATUNYA butir gate yang murni keputusan
```

**Sesudah gate GO → C-05** (cabut `backend/`, arsipkan Go, matikan Railway).

### 1.1 Butir 7 — tinggal satu angka

Draf lengkap: `RUNBOOK_BACKUP_MYSQL_RAILWAY.md` §7. Usulan **N = 14 hari**, dengan
alasan yang perlu dibaca sebelum menyetujui: **sesudah cutover data baru hanya
masuk Supabase**, jadi "rollback ke Railway" berarti kembali ke keadaan hari GO
**plus** kehilangan apa pun sesudahnya. N besar **menaikkan** biaya rollback,
bukan menurunkan.

Yang dibutuhkan: satu persetujuan Yohan+Nerissa (OQ-1), atau satu angka pengganti.

### 1.2 🔴 Urutan yang TIDAK boleh dibalik

**O50 → walk C-03 dijalankan ulang → baru C-04 ditutup.**

Walk C-03 2026-07-31 mengisi slot `finance_staff` dengan **fixture QA** (O50).
Hasilnya sah — yang diuji gate permission, dan gate-nya bekerja — tapi begitu
fixture dinonaktifkan, discovery tidak akan menemukan aktor Finance lagi dan baris
itu **jatuh jadi SKIP**. Menutup C-04 lebih dulu berarti menutupnya di atas walk
yang sudah tidak berlaku. Detail: `CUTOVER_UAT_REPORT_20260731.md` §5.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| 1 | **C-03 SKIP-2** — badge notifikasi, mata di browser ~3 menit ⇒ C-03 `[x]`, gate C-04 terbuka | **pemilik** |
| 2 | **Butir 7** — setujui/ubah N rencana rollback (§1.1) | **pemilik** |
| 3 | **O50** — 10 akun `99000000xx` masih aktif & bisa login; DoD C-04 mensyaratkan nol fixture. Efeknya: "69 karyawan" sebenarnya **59 riil + 10 fixture** | **pemilik** (izin) → Claude |
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
