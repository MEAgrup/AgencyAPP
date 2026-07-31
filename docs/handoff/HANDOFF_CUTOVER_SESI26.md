# HANDOFF — Cutover Sesi 26 (residu lead dibersihkan · run ulang C-03 menunggu approval)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI25.md`. Masih sahih **kecuali** angka data bisnis
> (`leads`/`prospect_attempts` kini **0**, lihat §1.1) dan premis bahwa "38 notifikasi"
> bisa dihapus (**tidak bisa** — §1.2).
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4 (`npm run db:rebuild`) ·
> SESI19–22 §3.1 (daftar "jangan dikerjakan") · SESI23 §1.1 (baris tentang live WAJIB dibaca
> dari live) · SESI24 §1.4 (**jangan tambah NIK/PII baru ke repo** — repo masih publik).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | **`claude/cutover-handoff-cleanup-9wddra`** — di-restart dari `main` sesudah PR #87 merged |
| **Keadaan branch** | Lihat `git log --oneline main..HEAD` dan `git status --short`. Jangan percaya sha di berkas ini |
| **`main` saat sesi ini MULAI** | `3dfb5bb` = Merge PR #87. Rantai: … → #85 → **#87** |
| **PR sesi ini** | dibuka dari branch di atas — **nol perubahan kode**, hanya dokumen + tulis ke live |
| **Live `CDPS SG`** | **44 migrasi · 54 tabel · 17 `notif_events`** — dibaca dari live sesi ini |
| **Karyawan** | **65 baris · 59 aktif** · 6 fixture tombstone permanen (tak berubah sesi ini) |
| **Data bisnis** | **0 lead · 0 attempt · 0 klien · 0 transaksi** · 32 MSL |
| **Residu tak-terhapuskan** | **38 `performance_snapshots` + 38 notifikasi** — dijaga trigger, permanen |
| **Run ulang C-03** | **`30620591321`** — `probe` ✅ success, `uat` **`waiting`** di `c03-production`. **Butuh 1 klik pemilik** |

**Angka acuan** tidak berubah dari SESI24/25 (sesi ini **nol perubahan kode**):
`apps/api` **313** · `@cdps/domain` **567** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed PASS · 4 invariant SQL PASS · `route-parity` 5/5, ketiga
ledger **KOSONG** · typecheck & lint bersih.

> ⚠️ **`npm test --workspaces` TIDAK menjalankan `web-internal`** — ia bukan anggota
> `workspaces`. Jalankan terpisah: `npx vitest run --root web-internal`.

---

## 1. Yang dikerjakan sesi ini

### 1.1 ✅ Residu lead C-03 dibersihkan — `leads` 6 → 0, `audit_log` utuh

Dihapus **keenam-enamnya**, bukan hanya 3 residu run `30600363211`:

| Lead | Nama | Asal |
|---|---|---|
| `LEAD-202607-0004` · `0005` | `ZZC03 Alpha …` · `ZZC03 OD …` | walk C-03 |
| **`LEAD-202607-0006`** | **`Smoke`** | `auth-smoke.mjs` — **tanpa marker `ZZC03`** |
| `LEAD-202607-0001`–`0003` | `test nama` · `prospek1` · `prospek2` | dibuat fixture `9900000001`/`9900000004` |

Ketiga yang terakhir **sudah tercatat** masuk daftar bersih-bersih C-04 di `DECISIONS.md`
2026-07-31 (entri O50 langkah 1, butir b) — jadi ini **mengeksekusi cakupan yang sudah
disepakati**, bukan memperluasnya sendiri.

**Diverifikasi dari live sesudahnya:** `leads` 0 · `prospect_attempts` 0 · `clients` 0 ·
`transactions` 0 · **`audit_log` tetap 64** · **`id_sequences` LEAD/PRSP tetap `next_n=6`**.

Dua hal yang sengaja **tidak** dilakukan, dan keduanya penting:

1. **`id_sequences` tidak di-rewind** ⇒ lead berikutnya **`LEAD-202607-0007`**, bukan `0001`.
   Aturan rumah #1: ID **tidak pernah dipakai ulang**.
2. **`audit_log` tidak disentuh.** 13 baris kini menunjuk ke lead/attempt yang sudah tidak
   ada. Itu **benar**: riwayat mencatat bahwa data uji itu pernah ada dan siapa pembuatnya.
   Yang hilang datanya, bukan jejaknya.

**Prosedur ditulis sebagai runbook: `docs/handoff/RUNBOOK_BERSIH_RESIDU_UAT.md`.** Ia
**menggantikan** prosedur *"cari prefix `ZZC03`"*, yang cacat dan sudah terbukti gagal
(lead `Smoke` lolos). Aturan penggantinya tidak bergantung konvensi penamaan skrip mana pun:

> Sebelum go-live `leads` **seharusnya kosong** ⇒ **daftar SEMUA lead, buktikan satu per satu
> bahwa ia data uji.** Marker dipakai *menjelaskan* asal baris, bukan *menemukannya*.

### 1.2 🔒 Temuan — 38 notifikasi TIDAK BISA dihapus; yang benar adalah MENANDAI TERBACA

Daftar bersih-bersih C-04 menyebut *"38 notifikasi"* seolah bisa dibuang. **Tidak bisa:**
`notifications_no_delete` → `forbid_mutation()`, penegakan langsung aturan rumah #8
(*"Never deletable, only read/unread"*). **Dibuktikan empiris, bukan dibaca dari DDL saja:**

```
DELETE FROM notifications  ⇒  ERROR: notifications is append-only/immutable: DELETE forbidden
```

ter-rollback utuh, 38 tetap 38. Ini **kembar** dari blokade `performance_snapshots` di O50 —
artinya **dua dari tiga butir** daftar bersih-bersih C-04 sejak awal tidak bisa dieksekusi
apa adanya, dan hanya butir lead yang benar-benar bisa.

**Yang BISA, dan itu memang jalur yang aturan #8 sediakan:** tak ada trigger `no_update` di
tabel itu ⇒ `read_at` boleh ditulis.

**Kenapa layak dikerjakan:** penerima ke-38 notifikasi = **34 karyawan RIIL + 4 fixture
nonaktif** (38 = 34 staf eligible + 4 fixture — cocok persis dengan hitungan `snapshots/scan`).
Jadi **34 orang riil kini memegang badge** berisi notifikasi performa yang dihitung dari
produksi nol-klien-nol-transaksi.

> ⚠️ **URUTAN WAJIB — jangan tandai terbaca sebelum QA badge (eks-SKIP-2) selesai.** Ke-38
> baris belum-dibaca ini **satu-satunya bahan uji badge** yang pernah ada di produksi; sebelum
> 2026-07-31 tabelnya kosong. Karena tak bisa dihapus, bahan itu **tidak hilang** oleh
> bersih-bersih lead — tapi hilang maknanya begitu ditandai terbaca.

SQL-nya ada di runbook §7. **Belum dijalankan.**

### 1.3 🕐 Run ulang C-03 dipicu — dan biayanya bergantung JAM APPROVAL

Run **`30620591321`** (`workflow_dispatch` di `3dfb5bb`, `run_uat=true`, `confirm_write=YA`).
Job `probe` ✅ **success** (deployment sehat · `SUPABASE_JWT_SECRET` benar · roster terbaca);
job `uat` **`waiting`** di gerbang `c03-production`. **Claude tidak meng-approve sendiri.**

**Temuan yang membuat waktu approval penting.** `POST /performance/snapshots/scan` idempoten
**per PERIODE, bukan per run** — ia menskor bulan WIB terakhir yang sudah tutup
(`UNIQUE (staff_id, period_start)` + re-check; notifikasi terbit di transaksi yang sama ⇒
fire-once):

| Approve | Periode diskor | Baris permanen baru |
|---|---|---|
| **sebelum 2026-07-31 17:00 UTC** (= 2026-08-01 00:00 WIB) | **2026-06** — ke-34 staf eligible sudah punya snapshot | **0** ✅ |
| **pada/sesudah** itu | **2026-07** — masih kosong | **34 snapshot + 34 notifikasi, permanen** |

**Menunggu tidak memperbaiki apa pun** — setiap hari di bulan berikutnya berbiaya sama.
Jendela nol-biaya itu hanya hari ini.

**Sesudah run selesai:** walk menulis ~3 lead baru ⇒ **jalankan runbook sekali lagi**,
`leads` harus kembali **0**.

### 1.4 Catatan kecil: `id_sequences` CLI = 2 padahal `clients` = 0

`next_n` pada `id_sequences` = **nomor terakhir yang diterbitkan**, dan `ident_next` **tidak
mengonsumsi nomor saat rollback**. Maka `CLI/202607 next_n=2` berarti **2 ID klien pernah
benar-benar diterbitkan dan di-commit** (baris dibuat 2026-07-22 06:06 — hari project dibuat),
lalu baris kliennya dihapus. `clients` **0 sekarang**, jadi §0 `RENCANA_ROLLBACK_CUTOVER.md`
(*"nol data bisnis"*) tetap sahih — tapi tabel itu **tidak selalu 0**, dan
`CLI-202607-0001`/`0002` **hangus permanen** (aturan rumah #1). Bukan masalah; dicatat supaya
tidak dibaca sebagai anomali oleh sesi berikutnya.

---

## 2. Sisa pekerjaan

| # | Butir | Siapa |
|---|---|---|
| 1 | **Approve run `30620591321`** — 1 klik di `c03-production`. **Sebelum 17:00 UTC hari ini kalau mau nol biaya** (§1.3) | **pemilik** |
| 2 | **Sesudah run itu: jalankan runbook lead sekali lagi** — walk menulis ~3 lead baru, `leads` harus kembali 0 | Claude |
| 3 | **QA UI C-04** — `/master-services` · `/sales/kalkulator` · **badge notifikasi (eks-SKIP-2)**. Badge **harus lebih dulu** dari §1.2 | **pemilik** → Claude |
| 4 | **Tandai terbaca 38 notifikasi** (runbook §7) — **hanya setelah** butir 3 | Claude |
| 5 | **C-04 sisanya** — aktor produksi: **O34** (a)–(e) · **O33** Finance · **O26** NIK+email Director · **O35** sub-tim Creative (**pakai headcount 59**) · **O9** target M14 | **pemilik** |
| 6 | **Backup MySQL Railway + OQ-2** — prasyarat rollback, `RENCANA_ROLLBACK_CUTOVER.md` §3.1 | **pemilik** |
| 7 | **O48 Grup A/B/E** — Grup C+D sudah live | **pemilik + head dev** → Claude |
| 8 | **Visibility repo** → privat, lalu tinjau ulang **O47b** | **pemilik** |
| 9 | Gate GO → **C-05** (cabut `backend/`) | **pemilik** → Claude |
| 10 | Probe RLS `transactions` · `*_block_requests` — masih menunggu data riil. `performance_snapshots` punya 38 baris tapi **sintetis** | Claude, saat datanya ada |

**Progress pensiun Go: ~94%** (engineering sisi Claude **100%** sejak sesi 19; Fase 4 ~80%;
Fase 5 ~15% terkunci gate GO). Tetap **estimasi** — butir gate tidak punya satuan yang bisa dijumlah.

## 3. Yang JANGAN dikerjakan

Seluruh daftar SESI19–25 masih berlaku. Penegasan yang paling relevan sekarang:

- **Jangan hapus `notifications` atau `performance_snapshots`** — DB menolak, dan menembusnya
  berarti menonaktifkan trigger immutability di produksi. Untuk notifikasi pakai
  **tandai terbaca** (runbook §7); untuk snapshot **tidak ada** mitigasi, dan itu diterima sadar.
- **Jangan tandai notifikasi terbaca sebelum QA badge selesai** — itu membuang satu-satunya
  bahan uji eks-SKIP-2 (§1.2).
- **Jangan hapus baris `audit_log`**, termasuk 13 baris yang kini menunjuk ke lead terhapus.
- **Jangan rewind `id_sequences`** supaya nomor lead "rapi lagi" — aturan rumah #1, ID tidak
  pernah dipakai ulang. Lead berikutnya `0007` dan itu benar.
- **Jangan setujui sendiri run `uat`** — gerbang `c03-production` ada justru supaya production
  write butuh manusia.
- **Jangan pakai prosedur bersih-bersih berbasis prefix `ZZC03`** — sudah terbukti melewatkan
  lead `Smoke`. Pakai `RUNBOOK_BERSIH_RESIDU_UAT.md`.
- **Jangan apply ulang migrasi mana pun** — 44 di live, 44 di repo.
- **Jangan salin baris "Live" dari handoff mana pun** — baca dari live.
- **Jangan sunting `CUTOVER_UAT_REPORT_20260728.md`** — bukti historis.
- **Jangan bangun apa pun di `backend/`** — oracle paritas read-only sampai C-05.
- **Jangan tambah NIK/PII baru ke repo** selama status publik belum berubah.
