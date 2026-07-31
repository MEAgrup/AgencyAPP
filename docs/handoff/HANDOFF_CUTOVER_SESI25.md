# HANDOFF — Cutover Sesi 25 (C-03 SELESAI · gate berikutnya C-04)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI24.md`. Masih sahih **kecuali** §3 butir 8
> (`performance_snapshots` "0 baris" — kini 38, lihat §1.2 di bawah).
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4 (`npm run db:rebuild`) ·
> SESI19–22 §3.1 (daftar "jangan dikerjakan") · SESI23 §1.1 (baris tentang live WAJIB dibaca
> dari live) · SESI24 §1.4 (**jangan tambah NIK/PII baru ke repo** — repo masih publik, dicek
> ulang hari ini lewat API).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/baca-handoff-cutover-szsw80`** — di-restart dari `main` sesudah PR #85 merged |
| **Keadaan branch** | Lihat `git log --oneline main..HEAD` dan `git status --short`. Jangan percaya sha di berkas ini |
| **`main`** | **`df3dddb`** = Merge PR #85. Rantai: … → #82 → #84 → **#85** |
| **PR** | #84 & #85 MERGED. Tidak ada PR terbuka saat berkas ini ditulis |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 `notif_events`** — dibaca dari live sesi ini |
| **Repo vs live** | ✅ **44 = 44**, `main` juga 44 |
| **C-03** | ✅ **SELESAI 2026-07-31** — run `30600363211`, **PASS 69 · FAIL 0** |

**Angka acuan** tidak berubah dari SESI24 (sesi ini **nol perubahan kode** — hanya dokumen):
`apps/api` **313** · `@cdps/domain` **567** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed PASS · 4 invariant SQL PASS · `route-parity` 5/5, ketiga
ledger **KOSONG** · typecheck & lint bersih.

> ⚠️ **`npm test --workspaces` TIDAK menjalankan `web-internal`** — ia bukan anggota
> `workspaces`. Jalankan terpisah: `npx vitest run --root web-internal`.

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout -B <branch-anda> origin/main
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes                          # 44/44
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal                   # TERPISAH
```

---

## 1. Yang dikerjakan sesi ini

### 1.1 ✅ C-03 DITUTUP — UAT dijalankan terhadap deployment produksi

Pemilik meng-approve environment `c03-production`; job `uat` jalan 03:13→03:18 UTC.

| Skrip | Hasil |
|---|---|
| `cutover-houserules-walk.mjs` | **22/22** — menutup **SKIP-1** |
| `wave3-contract-smoke.mjs` | **34/34 wired** |
| `auth-smoke.mjs` | **13/13** — menutup **SKIP-3** |

**PASS 69 · FAIL 0 · nol baris SKIP di output.** Report:
**`docs/handoff/CUTOVER_UAT_REPORT_20260731.md`** (report `20260728` **tidak disunting** —
ia bukti historis walk lokal). Backlog §C-03 → ✅ SELESAI. `DECISIONS.md` 2026-07-31.

**Yang baru terbukti hari ini**, dan tidak pernah terbukti sebelumnya: konfigurasi env Vercel,
kunci JWT produksi, perilaku pooler Supabase. Itulah isi C-03 yang sebenarnya — report
2026-07-28 hanya pernah membuktikan kode + skema.

**Konfirmasi silang C-03 §7:** slot `od` walk diresolusi ke `2501140493` — salah satu dari tiga
orang yang baru diberi layered `director` kemarin. Ia lolos cek OD lintas-divisi **dari
deployment**, jadi grant kemarin merambat sampai ke aplikasi, bukan berhenti di tabel.

**SKIP-2 (badge notifikasi) TETAP TERBUKA** dan **pindah ke daftar QA UI C-04**, berdampingan
dengan `/master-services` + `/sales/kalkulator`. Ia tidak menahan DoD C-03 (*report tersimpan ·
FAIL = 0 · tiap SKIP beralasan*), tapi jangan sampai menguap.

### 1.2 🟠 Residu produksi run ini LEBIH BESAR dari yang diumumkan sebelum approval

Yang disetujui: *"2 lead `ZZC03` + baris `audit_log`"*. Yang benar-benar tertulis, diukur
dari live sesudah run:

| Tabel | Sebelum | Sesudah |
|---|---|---|
| `leads` · `prospect_attempts` | 3 · 3 | **6 · 6** |
| `audit_log` | 43 | **50** |
| `performance_snapshots` | **0** | **38** |
| `notifications` | **0** | **38** |
| `clients` · `transactions` | 0 · 0 | 0 · 0 (tak tersentuh) |

Dua hal yang perlu diketahui sesi berikutnya:

1. **Lead ketiga tidak ber-marker.** `LEAD-202607-0006` bernama **`Smoke`** (dari `auth-smoke`,
   yang punya konvensi penamaan sendiri) ⇒ prosedur bersih-bersih *"cari prefix `ZZC03`"* di
   runbook **akan melewatkannya**. Sudah masuk daftar C-04.
2. **`POST /performance/snapshots/scan` menghitung sungguhan** — 38 snapshot periode 2026-06 +
   **38 notifikasi `m14.performance.published` ke 38 karyawan riil**, dihitung dari produksi
   nol-klien-nol-transaksi. Benar secara mesin, tak bermakna secara bisnis. **Ini membatalkan
   premis SESI24 §3 butir 8** (`performance_snapshots` 0 baris): probe RLS-nya bisa dijalankan
   sekarang, tapi atas data sintetis.
   🔎 **Sisi baiknya:** ini satu-satunya jendela untuk mengerjakan **SKIP-2** — badge butuh
   notifikasi belum-dibaca, dan sebelum hari ini tabelnya kosong. Kerjakan **sebelum** dibersihkan.

`audit_log` **tidak boleh** dihapus saat bersih-bersih — aturan rumah #3 tanpa pengecualian
untuk data uji.

### 1.3 🟠 Slot Finance masih dilayani fixture O50 ⇒ run C-03 wajib diulang sesudah O50

`finance_staff` diresolusi ke **`9900000007`**. Roster live: **69 aktif = 59 riil + 10 fixture**
(Finance: 4 aktif = 3 riil + 1 fixture). Begitu O50 dieksekusi, discovery memilih Finance riil —
artinya run 2026-07-31 tidak reproducible apa adanya. Bukan alasan menunda O50; alasan untuk
**menjalankan ulang workflow sekali sesudahnya** sebagai konfirmasi terakhir sebelum gate GO.
Biayanya satu klik approval.

### 1.4 Redaksi PII di report

Repo dicek ulang lewat API hari ini: **masih publik**. Blok `aktor terpakai` karena itu masuk
report **tanpa nama orang**, dan satu NIK yang belum pernah ada di repo diganti `‹NIK-A›`.
Blok verbatim tetap hidup di artifact `c03-output` + log run. Reproducibility tidak hilang:
ketiga skrip **meresolusi aktor dari environment yang diuji**, bukan dari konstanta di berkas.

> ⚠️ Artifact `c03-output` (id `8781965829`) **kedaluwarsa 2026-10-29**. Sesudah itu output
> verbatim hanya ada di log run. Kalau bukti ini harus bertahan lebih lama, unduh sebelum itu.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| 1 | **C-04** — gate berikutnya. Termasuk: bersih-bersih residu §1.2, QA UI (`/master-services`, `/sales/kalkulator`, **badge eks-SKIP-2**), aktor produksi | **pemilik** → Claude |
| 2 | **O50** — 10 akun `99000000xx` masih aktif & bisa login. DoD C-04 mensyaratkan nol fixture di produksi. Sesudahnya: **ulang run C-03** (§1.3) | **pemilik** (izin nonaktifkan/hapus) |
| 3 | **O35** (sub-tim Creative M7 §3) · **O9** (target M14) · **divisi dasar** 3 orang OD | **pemilik** |
| 4 | **Backup MySQL Railway + OQ-2** · **rencana rollback** | **pemilik** |
| 5 | **O48 Grup A/B/E** — Grup C+D sudah live | **pemilik + head dev** → Claude |
| 6 | **Visibility repo** → privat, lalu tinjau ulang **O47b** | **pemilik** |
| 7 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 8 | ~~Probe `performance_snapshots` saat datanya ada~~ — datanya ada (38), tapi **sintetis**. Probe `transactions` · `*_block_requests` masih menunggu data riil | Claude, saat datanya ada |

**Progress pensiun Go: ~94%** (engineering sisi Claude **100%** sejak sesi 19; Fase 4 naik dari
~70% ke ~80% karena C-03 tertutup — tetap **estimasi**, butir gate tidak punya satuan yang bisa
dijumlah; Fase 5 ~15% terkunci gate GO).

## 3. Yang JANGAN dikerjakan

Seluruh daftar SESI19–24 masih berlaku. Penegasan yang paling relevan sekarang:

- **Jangan apply ulang migrasi mana pun** — 44 di live, 44 di repo, cocok 1:1.
- **Jangan salin baris "Live"/"Repo vs live" dari handoff mana pun** — baca dari live.
- **Jangan sunting `CUTOVER_UAT_REPORT_20260728.md`** — bukti historis, berdiri sendiri.
- **Jangan hapus baris `audit_log`** saat membersihkan residu C-03 (aturan rumah #3).
- **Jangan tulis ulang entri `DECISIONS.md` lama** — append-only; koreksi = entri baru.
- **Jangan tambah baris ke ketiga ledger** tanpa entri `DECISIONS.md`. Ketiganya hanya menyusut.
- **Jangan bangun apa pun di `backend/`** — oracle paritas read-only sampai C-05.
- **Jangan tambah NIK/PII baru ke repo** selama status publik belum berubah.
- **Jangan setujui sendiri run `uat`** — gerbang `c03-production` ada justru supaya production
  write butuh manusia.
