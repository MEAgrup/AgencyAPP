# HANDOFF — Cutover Sesi 15 (T1: paritas field-by-field 66 converter `wire.ts`)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI14.md`. Yang masih berlaku tidak diulang —
> terutama SESI9 §6 (aturan rumah yang menggigit), SESI12 §2.4
> (`scripts/db-rebuild.sh`, satu-satunya jalur yang benar untuk DB lokal), dan
> SESI14 §3 (`collate "C"` di `engine.ts` LOAD-BEARING — jangan dilepas).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/cdps-sg-cutover-sesi14-09k1my` |
| **Base** | commit `966a1b3` dari `claude/cdps-sg-cutover-sesi13-2kmgy4` (isi PR **#76**) |
| **PR #76** | ⚠️ **masih terbuka & draft, head-nya branch sesi13** — lihat §1 |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** (tidak bergerak sesi ini — nol perubahan skema) |

**Cara melanjutkan:**
```bash
git fetch origin claude/cdps-sg-cutover-sesi14-09k1my
git checkout claude/cdps-sg-cutover-sesi14-09k1my
```

**Angka acuan (Postgres 16 lokal, DB dibangun ulang dari nol dengan 40 migrasi):**
`@cdps/domain` **566** (+1 skip) · `apps/api` **253** (246 → +7 sesi ini) ·
`@cdps/core` **113** · `@cdps/db` **9** · `web-internal` **26** ·
`route-parity` **5/5 dengan `KNOWN_GAPS` KOSONG** · typecheck bersih semua
workspace · eslint `web-internal` bersih · nol perubahan di `backend/**`.

**Setup sandbox** (tidak persisten antar sesi):
```bash
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run web-internal          # web-internal BUKAN npm workspace — lihat §4
```

---

## 1. ⚠️ Branch sesi 14 ≠ head PR #76 — perlu keputusan Anda

Sesi ini ditugaskan ke branch **`claude/cdps-sg-cutover-sesi14-09k1my`**, sementara
**PR #76 masih terbuka dengan head `claude/cdps-sg-cutover-sesi13-2kmgy4`** (belum
di-merge, masih draft). Branch sesi 14 sudah ada di remote tapi isinya cuma
`main@a37e432` — nol pekerjaan #76.

Yang saya lakukan: `git checkout -B claude/cdps-sg-cutover-sesi14-09k1my
origin/claude/cdps-sg-cutover-sesi13-2kmgy4`, lalu commit di atasnya. Pola yang sama
dipakai SESI13→14 (branch berganti nama tiap sesi, di-reset ke HEAD sebelumnya lalu
dilanjutkan). Force-push aman karena branch itu hanya membawa riwayat yang sudah
ter-merge.

**Konsekuensinya, dan ini butuh tindakan Anda:** commit sesi ini **tidak akan muncul
di #76**, karena #76 melacak branch sesi13. Dua pilihan:

1. **Ganti head #76** ke `claude/cdps-sg-cutover-sesi14-09k1my` — satu PR berisi
   Fase 2 + Fase 3 + T1. Paling rapi.
2. Merge #76 apa adanya, lalu buka PR baru dari branch sesi14 (isinya akan tampak
   memuat ulang commit #76 sampai #76 di-merge).

Saya **tidak membuka PR baru** — belum diminta.

---

## 2. T1 SELESAI — 66 converter disisir, 1 divergensi nyata

### 2.1 Temuan: `remindersToWire.due_date` mengirim RFC3339, Go mengirim tanggal

| | |
|---|---|
| **Go** | `reminderViews` → `r.DueDate.Format("2006-01-02")` ⇒ `"2026-07-30"` |
| **TS (sebelum)** | `r.dueDate.toISOString()` ⇒ `"2026-07-30T00:00:00.000Z"` |
| **Halaman** | `finance/reminders/page.tsx:108` → `{r.due_date}` **mentah, tanpa `formatDate()`** |

Jadi setiap baris tabel pengingat pembayaran mencetak stempel waktu penuh di kolom
"Jatuh Tempo". Bukan halaman blank — **halaman yang salah cetak**, yang justru lebih
sulit ketahuan daripada blank.

**Perbaikannya `tz.dateString(r.dueDate)`, BUKAN `toISOString().slice(0,10)`.**
`due_date` adalah kolom `date` Postgres; node-postgres memparsenya jadi `Date` pada
tengah malam **timezone proses**, jadi memotong string UTC bisa menggeser hari.
`tz.dateString` membucket di WIB — bucketing yang **sama** yang sudah dipakai domain
pada kolom itu (`tz.daysBetween(r.due_date, today)` yang menghitung `daysOverdue`),
jadi tanggal yang ditampilkan dan hitungan hari terlambat tidak bisa berbeda.
Dikunci test *"buckets due_date in WIB, not UTC"* (`2026-07-30T18:00Z` → `2026-07-31`),
yang **juga gagal** pada varian `toISOString().slice(0,10)`.

> ### ⚠️ Kontras yang JANGAN diseragamkan
> `InstallmentWire.due_date` **tetap RFC3339 penuh**: `instViews` Go meneruskan
> `*time.Time` tanpa format, dan halaman transaksi membungkusnya `formatDate()`.
> **Kolom yang sama (`installments.due_date`), dua kontrak wire berbeda**, karena
> dua view Go memformatnya beda. Keduanya kini dipatok test + komentar di
> `wire.ts`. Siapa pun yang "merapikan" ini jadi satu format akan merusak salah
> satu halaman.

Ketiga test baru **diverifikasi gagal** terhadap implementasi lama sebelum
dipertahankan (3 gagal / 82 lolos) — bukan test yang lolos dua arah, jebakan yang
sudah memakan sesi 12 (`toThrow(undefined)`).

### 2.2 Sisa 65 converter: nol divergensi

Tiga sisiran mekanis atas **seluruh** 66 converter, bukan sampel:

| Sisiran | Cakupan | Hasil |
|---|---|---|
| Kunci kondisional (`...(x ? {k} : {})`) lawan ada/tidaknya `omitempty` pada tag Go | **50 kunci** | semua cocok |
| Field domain bertipe `Date` tanpa `.toISOString()` | **46 pemakaian** | semua cocok |
| Arah FE: tipe FE mendeklarasikan kunci yang tak pernah dikirim wire (kelas peng-blank halaman) | 147 interface FE | nol temuan nyata |

Lalu klaster paling ramai disisir **manual** lawan struct/view Go-nya:
`board` (`cardToWire`, `dependencyToWire`) · `task`/`creative` (`metricsToWire`,
`assetToWire`, `briefToWire`, `blockRequestToWire`, `pendingBlockRequestToWire`) ·
`portal` (ketiganya + `MgmtRow`/`ClientShortcut` bersarang) · `finance`
(`installmentToWire`, `transactionToWire`, `remindersToWire`) · `client`
(`clientDetailToWire`, `ServiceLine`) · `kol` (`creatorListToWire`) ·
`performance` · `campaign`. Semua cocok kunci-per-kunci.

### 2.3 🔑 Pelajaran metode — oracle-nya lapisan **view**, bukan struct modul

Menyamakan converter langsung ke `type X struct` menghasilkan **6 "diff" yang
semuanya palsu**. Sebabnya: di mana `httpapi` punya view (`map[string]any`),
**view itulah** yang sampai ke browser.

`module4_client.Client` menandai **seluruh** field uang `json:"-"` — lalu
`clientView` justru mengirim keempatnya (`gmv_baseline`, `target_gmv`,
`total_sales`, `marketing_budget`) dalam format IDR rumah, dan **tidak** mengirim
`lead_id`/`winning_attempt_id`/`created_at` yang ada di struct. Disamakan ke
`clientView`, `ClientDetailWire` cocok **persis**.

Selain itu, `omitempty` pada struct modul **tidak berlaku** untuk field yang
dirender via view `map[string]any` — map selalu memancarkan setiap kuncinya.

Daftar view Go yang ada: `clientView`, `serviceViews`, `trxView`, `instViews`,
`reminderViews`, `outstandingViews`. Sisa handler membangun respons inline di
`writeJSON`, jadi oracle-nya harus dibaca di handler-nya.

**Sumber palsu yang lain, tetap terbuka:** `TransactionWire` mengaku mem-port
`module5_finance.TransactionRecord` — struct itu **tidak ada** di Go (oracle
sebenarnya `trxView`, dan bentuknya cocok). Kelas yang sama dengan residu Fase 2
(`/commission`, `/payment`). Komentar provenance yang salah **belum** dikoreksi
di sini; kalau ada yang menyisir komentar provenance, ini titik mulainya.

### 2.4 Apa yang sisiran ini TIDAK buktikan

Supaya tidak terbaca lebih kuat dari yang sebenarnya:

- Yang dibandingkan **bentuk + format**, bukan **asal nilai**. Converter yang
  mengisi kunci benar dari field domain yang **salah** (mis. `speed_score` diisi
  dari `revision_speed_score`) lolos semua sisiran ini. Butuh membaca query domain
  lawan query Go — pekerjaan yang jauh lebih besar dan belum dikerjakan.
- Skrip sisirannya ada di scratchpad sesi (tidak persisten), **sengaja tidak
  di-commit**: ia parser regex sekali-pakai, bukan gate yang layak dirawat, dan
  akan mati sendiri begitu `backend/` diarsipkan di C-05.
- `ClientListRowWire` **memang** lebih sempit dari `handleListClients` Go — itu
  divergensi lama yang sudah disengaja dan sudah tercatat (O43), bukan temuan baru.

---

## 3. Yang TIDAK dikerjakan sesi ini

- **T2 (`apps/api` tanpa eslint config)** — belum dikerjakan. Bukan karena besar,
  tapi karena ada **keputusan** di dalamnya yang bukan milik saya: begitu config-nya
  ada, apakah job `api` di CI ikut memanggil lint? Kalau ya, gelombang temuan
  pertama atas ~250 berkas TS harus dibereskan dulu supaya CI tidak langsung merah.
  Perlu diputuskan **sebelum** config-nya mendarat, bukan sesudah. Catatan:
  **CI belum memanggil `lint` sama sekali** untuk workspace mana pun.
- **T3 (adapter CSV/dry-run atas `POST /leads/bulk`)** — tetap diblokir **O47**,
  persis seperti kata SESI14. Kalau jawabannya "klien+ledger juga", desainnya beda.
- **`backend/**`** — nol perubahan (`git diff` terhadap `main` di `backend/` kosong).
- **`KNOWN_GAPS`** — tetap kosong.

## 4. Jebakan baru yang ketemu sesi ini

- **`web-internal` BUKAN npm workspace.** `workspaces` di root cuma
  `["apps/*","packages/*"]`, jadi `npm test --workspaces` **melewatkan** ke-26
  test-nya dan `npm run lint -w web-internal` gagal dengan *"No workspaces found"*.
  Jalankan `npx vitest run web-internal` dari root, atau `npm run lint` dari
  dalam `web-internal/`. Angka "web-internal 26" di handoff sebelumnya benar —
  tapi hanya kalau dijalankan terpisah. Mudah salah lapor "semua hijau" padahal
  satu paket tidak pernah jalan.
- **`next lint` sudah tidak ada** di versi Next repo ini (`npx next lint` mengira
  `lint` itu direktori proyek). Script `lint` web-internal memanggil `eslint`
  langsung — pakai itu.

## 5. Lanjut dari sini

Fase 4 (gate manusia) dan Fase 5 (C-05) **tidak bergerak** — lihat SESI14 §5,
seluruh tujuh gate-nya masih butuh akses atau otoritas pemilik. Yang masih terbuka:
**O47** (memblokir C-05), **O46**, **O45**, retensi **PII** di
`backend/testdata/import_samples/`.

### TASK BERIKUTNYA
1. **T2** — begitu pertanyaan CI-lint di §3 dijawab.
2. **Paritas asal-nilai** untuk converter yang read model-nya paling rumit
   (`attemptDetailToWire`, `clientDetailToWire`, `perfSnapshotToWire`,
   `healthSnapshotToWire`) — §2.4 menjelaskan kelas yang belum tersentuh. **Masih
   butuh `backend/`**, jadi nilainya nol setelah C-05, sama seperti T1.
3. **Koreksi komentar provenance palsu** (§2.3) — kecil, dan mencegah sesi
   berikutnya mengejar oracle yang tidak ada.

### Yang JANGAN dikerjakan
- **Jangan sentuh `backend/**`** kecuali menjaga job `backend` hijau.
- **Jangan mulai C-05** sebelum gate GO **dan** O47 dijawab.
- **Jangan menambah baris ke `KNOWN_GAPS`.**
- **Jangan menyeragamkan kedua `due_date`** (§2.1) — dua kontrak itu memang beda.
