# HANDOFF — Cutover Sesi 19 (#78 & #80 masuk `main` · O47 dijawab · PII dihapus)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI18.md` dan `…SESI17.md` — keduanya sekarang **di `main`**.
> Yang masih berlaku tidak diulang: SESI9 §6 (aturan rumah yang menggigit), SESI12 §2.4
> (`npm run db:rebuild`, satu-satunya jalur benar untuk DB lokal), SESI17 §3.3 (daftar
> "jangan dikerjakan" — **satu butirnya dicabut**, lihat §3).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **`main`** | **`61f357b`** = Merge PR #80. Berisi #75 → #77 → #76 → #79 → **#78** → **#80**. |
| **Branch aktif** | `claude/go-retirement-progress-eq0855` — di-reset dari `main@61f357b`, **docs saja** |
| **PR terbuka** | **#73** & **#74** — keduanya direkomendasikan **DITUTUP tanpa merge**, belum dieksekusi (keputusan pemilik) |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** — tidak disentuh. Nol `apply_migration`, nol DDL, nol INSERT. |

**Angka acuan (Postgres 16 lokal, DB dibangun ulang dari nol, 40/40 migrasi bersih) —
diverifikasi ulang independen di sesi ini, bukan disalin dari handoff:**
`apps/api` **301** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** (54 tabel · 14 `sm_machines` · 17 `notif_events`) ·
4 invariant SQL **PASS** · `route-parity` **5/5, `KNOWN_GAPS` `[]` KOSONG** ·
`NESTED_INLINE_UNCHECKED` **`[]` KOSONG** · typecheck bersih semua workspace ·
`npm run lint -w @cdps/api -- --max-warnings 0` **0 error 0 warning** ·
`web-internal` `tsc --noEmit` + lint bersih.
**Sisi Go pasca-penghapusan PII:** `go vet ./...` · `go build ./...` ·
`go test ./cmd/... ./internal/seed/...` **hijau**.

```bash
git fetch origin main
git checkout main && git log --oneline -1        # 61f357b
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

> ⚠️ **Cek `list_pull_requests` sebelum apa pun, bukan hanya `git log`.** Sesi ini kena bentuk
> baru dari jebakan itu: handoff yang diminta dibaca (`SESI17`) mengatakan *"langkah pertama:
> merge #78"* — padahal **PR #80 sudah ada** dan sudah menutup ketiga sisa engineering yang
> SESI17 daftarkan sebagai pekerjaan berikutnya. Mengerjakan §3.2 SESI17 apa adanya berarti
> menulis ulang kerja yang sudah selesai. Handoff menggambarkan kondisi **saat ditulis**;
> daftar PR terbuka menggambarkan kondisi **sekarang**.

---

## 1. 🟢 Engineering pensiun Go SELESAI — nol butir tersisa di sisi Claude

Fase **0 · 1 · 2 · 3** semuanya **100%** dan ada di `main`. Yang tersisa hanya **Fase 5**
(pencabutan mekanis C-05), dan ia **bukan pekerjaan engineering yang belum selesai** — ia
pekerjaan yang menunggu **gate GO**.

| Fase | Status | Ditutup oleh |
|---|---|---|
| Fase 0 · 1 | 100% | #75 |
| Fase 2 (O43 paritas bentuk) | 100% | #76 (kelas-1) · #79+#78 (54 converter, nol cacat) · #80 (blind spot nested-inline) |
| **Fase 3 (4 CLI Go)** | **100% — baru** | #76 (3 CLI) · **O47 RESOLVED sesi ini** (`cmd/import` ditinggalkan) |
| Fase 4 (gate manusia) | ~45% — **5 butir**, dari 7 | 2 ditutup sesi ini: O47 · retensi PII |
| Fase 5 (C-05) | belum boleh dimulai | menunggu **gate GO saja** |

---

## 2. Yang dikerjakan sesi ini

### 2.1 Merge #78 lalu #80 — nol konflik, dan itu diverifikasi lebih dulu

Sebelum menyentuh tombol merge, dicek bahwa `main` **belum bergerak** (`e5755ff`) dan bahwa
**#80 adalah superset LINEAR** dari #78: `e5755ff` → `25a383b` (HEAD #78) → HEAD #80, dibuktikan
dengan `git merge-base --is-ancestor` dua arah. Karena itu konflik `docs/DECISIONS.md` yang
menghantui SESI17 **tiga kali** tidak muncul sama sekali kali ini — tidak ada dua sisipan
independen di baris teratas tabel append-only, hanya satu rantai.

Suite penuh dijalankan **di atas hasil gabungan** sebelum merge, bukan sesudah — angka §0 adalah
hasil run itu, dan cocok bit-for-bit dengan yang dilaporkan SESI18.

`main@d329730` = #78 · `main@61f357b` = #80.

### 2.2 O47 RESOLVED — `cmd/import` DITINGGALKAN

Keputusan pemilik (Nerissa, sesi 2026-07-30): riwayat klien pra-CDPS **tetap hidup di spreadsheet
sebagai arsip reporting**, tidak masuk CDPS. `cmd/import` + `internal/importer` (~3.700 baris Go)
tidak diport.

Empat konsekuensi yang mengikat:

1. **Fase 3 selesai 4/4** — `cmd/import` adalah CLI keempat dan terakhir.
2. **T3 GUGUR**, bukan tertunda. Ia ada semata untuk melayani impor historis lead.
   **`POST /leads/bulk` sendiri TETAP hidup & teruji** (O41 + gate Campaign O13) — ia jalur impor
   **operasional**, bukan historis. **Jangan mencabutnya** karena T3 gugur.
3. **C-05 bebas dari O47.** Spesifikasi tiga alur klien tanpa padanan (`gen-form`,
   `clients-dryrun/apply`, `dormant-dryrun/apply`) sengaja dibiarkan hilang bersama `backend/`.
   Diterima sadar: mem-port ketiganya = **jalur tulis privileged kedua** ke
   `clients`/`transactions`/`installments` yang **memintas engine M0 Closing** — melanggar house
   rule #2 demi data yang sifatnya arsip.
4. O22 (2026-07-10, Pilihan B) menjadi **moot** untuk jalur historis — ia memutuskan APA yang
   diimpor oleh tooling yang sekarang ditinggalkan.

> 🔴 **Pengaman C-05 yang jangan dilewat.** Backlog §C-05 butir 2 (*"jangan hapus tanpa tag"*)
> sekarang **lebih penting, bukan kurang**: sejak O47 diputus "tinggalkan", tag rilis terakhir
> adalah **satu-satunya tempat** spesifikasi ketiga alur klien itu masih bisa dibaca. Menghapus
> `backend/` tanpa tag membuat keputusan O47 **tidak bisa dibatalkan**.

### 2.3 Retensi PII RESOLVED — `import_samples/` dihapus dari repo

Keputusan pemilik data: **hapus**, bukan arsip, bukan anonimkan.
`git rm -r backend/testdata/import_samples` — 7 CSV + README:
`hris_karyawan.csv` (NIK, nama lengkap, tanggal join, DEPARTMENT/JABATAN) ·
`nik_email.csv` (39 email pribadi) · `employees_from_hris.csv` · `employees_cdps.csv` ·
`employees_uat.csv` · `role_mappings_uat.csv` · `layered_roles_uat.csv`.

**Aman secara operasional — diverifikasi, bukan diasumsikan:**

| Cek | Hasil |
|---|---|
| berkas kode yang merujuk folder itu (`*.go`/`*.ts`/`*.sh`/`*.yml`) | **nol** |
| `go vet ./...` · `go build ./...` · `go test ./cmd/... ./internal/seed/...` | 🟢 **hijau** ⇒ job `backend` tetap hidup sampai C-05 |
| apakah ia satu-satunya salinan data karyawan | **bukan** — live `CDPS SG` sudah 69 karyawan (69/69/69/69 di `employees`/`employee_credentials`/`auth.users`/`auth.identities`), `role_mappings` **39** |
| mapping riil yang masih dibutuhkan | **tetap ada** di `supabase/seed/` (`role_mappings_riil.csv` · `layered_roles_riil.csv` · `hris_department_jabatan_pairs.csv` — ketiganya tanpa nama/email) |
| sinkronisasi karyawan berikutnya | import CSV admin-triggered (OQ-4) dengan berkas dari HR saat itu, bukan salinan beku di repo |

**`backend/testdata/employees.csv` SENGAJA ditinggalkan** — fixture **sintetis**
(`EMP-0001 Budi Santoso`, 10 baris), bukan PII, dan ia default yang dibaca `cmd/cdps` +
`internal/seed`. Menghapusnya akan mematikan job `backend` sebelum C-05 mencabutnya.

> ### 🔴 Batas yang dinyatakan, bukan disembunyikan
> **Penghapusan ini TIDAK menghapus PII dari histori git.** Commit lama masih memuat isi
> berkasnya dan bisa dibaca dengan `git show <commit>:backend/testdata/import_samples/…`.
> Membersihkan histori butuh rewrite paksa (`git filter-repo`) + **re-clone terkoordinasi seluruh
> kontributor** — keputusan dan eksekusi pemilik, **belum dilakukan, masih terbuka**. Kalau
> kebijakan retensi menuntut PII benar-benar hilang dari repo, itu langkah terpisah dan ia
> memutus semua clone yang ada.

### 2.4 Dokumen yang diperbarui — dan yang SENGAJA tidak

**Diperbarui** (operasional / indeks kebenaran):
`docs/DECISIONS.md` (2 entri Decided + O47 ditandai RESOLVED) ·
`docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` (Fase 3→100%, Fase 4→5 butir, §5, B3 gugur) ·
`docs/backlog/CUTOVER_BACKLOG.md` (§C-05 prasyarat + butir 2 + legenda gate) ·
`supabase/seed/README.md` (§PII: dari "butuh keputusan" → "sudah dihapus", + catatan histori git) ·
`docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md` (baris "Sumber sync go-live" menunjuk berkas yang dihapus).

**Sengaja TIDAK ditulis ulang** — catatan historis, konvensi A3/`CLAUDE.md`:
handoff bertanggal (`SESI13`, `SESI14`, `HANDOFF_SESSION_2026*`) · baris `DECISIONS.md` lama ·
`W2_UAT_RUNBOOK.md`/`W3_UAT_RUNBOOK.md` (runbook UAT **stack Go** untuk gate yang sudah GO — path
prasyaratnya menunjuk berkas yang dihapus, dan itu benar sebagai catatan apa yang dulu dijalankan) ·
`WAVE1_EXTERNAL_REQUESTS.md`.

---

## 3. Lanjut dari sini — 100% di sisi pemilik

**Nol butir bisa dimajukan Claude tanpa akses atau otoritas pemilik.** Lima butir tersisa
(`PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` §5):

| # | Butir | Memblokir |
|---|---|---|
| 1 | **C-03 — 3 SKIP**: jalankan `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari mesin ber-akses `*.vercel.app`. Skrip **siap sejak 2026-07-29** — jalankan, jangan susun ulang | **gate C-04** |
| 3 | **O46** — 3 arm visibility RLS lebih sempit dari Go | klaim *"paritas Go"* (bukan cutover) |
| 4 | **O34 · O26 · O35 · O9** — aktor produksi + sub-tim Creative | **DoD C-04** |
| 6 | **Backup MySQL Railway** + **OQ-2** (`count(*)` per tabel) | **gate GO** |
| 7 | **Rencana rollback** disepakati | **gate GO** |

Plus dua butir kebersihan yang tidak memblokir apa pun: **tutup #73 & #74** tanpa merge
(alasan di §2 dokumen status). Dan satu butir baru dari §2.3: **scrub PII dari histori git** —
kalau kebijakan retensi menuntutnya.

**Urutan tercepat menuju Go mati:** butir 1 → butir 4 → **gate GO** → butir 6 & 7 → Fase 5 (C-05).

### 3.1 Yang JANGAN dikerjakan

- **Jangan mulai C-05** sebelum **gate GO**. (O47 sudah tidak ikut mengunci — itu satu-satunya
  butir SESI17 §3.3 yang dicabut sesi ini. Gate GO tetap berlaku.)
- **Jangan hapus `backend/` tanpa tag** — §2.2, sekarang load-bearing untuk O47.
- **Jangan cabut `POST /leads/bulk`** karena T3 gugur — ia jalur operasional (§2.2 butir 2).
- **Jangan menulis ke live `CDPS SG`** tanpa persetujuan eksplisit pemilik per-apply.
- **Jangan menambah baris ke `KNOWN_GAPS`** (`route-parity`) atau **`NESTED_INLINE_UNCHECKED`** —
  keduanya harus tetap kosong; keduanya hanya boleh menyusut.
- **Jangan menambah entri ke `ALLOWED_EXTRA`/`APPROVED_DIVERGENCE`** tanpa entri `DECISIONS.md`.
- **`backend/**` read-only** untuk fitur/bug produk. Penghapusan §2.3 adalah eksekusi keputusan
  retensi pemilik, bukan preseden untuk mengedit Go.
- **Jangan mulai memperluas gate dari bentuk → nilai** tanpa diminta (SESI18 §3 butir 3 —
  pekerjaan baru, bukan sisa).
