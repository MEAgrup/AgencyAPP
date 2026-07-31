# REPORT — Backup MySQL Railway + OQ-2 (2026-07-31)

> Menutup **sisa OQ-2** (`docs/DECISIONS.md` 2026-07-29: *"terjawab untuk
> perencanaan, belum terverifikasi untuk dekomisi"*) dan menyiapkan **butir 6
> gate GO**. Runbook: `RUNBOOK_BACKUP_MYSQL_RAILWAY.md`.
>
> Nol PII di berkas ini — nama tabel, angka, checksum saja.

## 1. Provenance

| | |
|---|---|
| Tanggal (UTC) | **2026-07-31 05:13** (OQ-2) · **05:24** (dump) |
| Jalur | GitHub Actions — workflow `railway-mysql-backup.yml` |
| Run OQ-2 | `30604816629` (job `oq2`, push) — laporan: artifact `oq2-report` |
| Run dump | **`30607919027`** (job `backup`, `workflow_dispatch`, `confirm_dump=YA`) — run hijau. Empat run sebelumnya gagal di lapis 4, lihat §5.1 |
| Commit skrip | OQ-2 `23cdd89` · dump `bf524eb` (sesudah perbaikan §5.1) |
| Server MySQL | **9.4.0** (Railway) |
| Klien | mysql 8.0.46 (runner ubuntu-24.04) |
| Endpoint | `<disamarkan>.proxy.rlwy.net:26954` · `DATABASE()` = `railway` · user `root` |

## 2. OQ-2 — hitungan (`COUNT(*)` sungguhan, bukan `table_rows`)

**50 BASE TABLE · total 239 baris.** Nol selisih terhadap
`backend/migrations/*.up.sql` (49 tabel + `schema_migrations`).

### 2.1 Entitas jalur uang — yang menentukan

| Tabel | Kolom | Baris | Pembacaan |
|---|---:|---:|---|
| `clients` | 23 | **0** | ✅ kosong, dan terbukti ada (23 kolom terbaca) |
| `transactions` | 12 | **0** | ✅ kosong, dan terbukti ada (12 kolom terbaca) |
| `installments` | 14 | **0** | ✅ kosong |
| `services` | 12 | **0** | ✅ kosong |
| `qualified_forms` | 14 | **0** | ✅ kosong |
| `negotiation_proposals` | 7 | **0** | ✅ kosong |
| `payment_verifications` | 9 | **0** | ✅ kosong |

**Seluruh rantai FK `CLIENT → SERVICE → TRX → INST` kosong.** C-04 butir 1
("kalau riil ⇒ butuh rencana ekspor-impor per-entitas") **tidak aktif**.

### 2.2 Bukan-nol — dan golongannya

| Tabel | Baris | Golongan |
|---|---:|---|
| `employees` | **65** | artefak dev/UAT — **digantikan Supabase (69)**, lihat §2.3 |
| `audit_log` | 58 | artefak dev/UAT (append-only, aturan rumah #3) |
| `role_mappings` | 43 | artefak dev/UAT — Supabase punya **39** hasil O42 |
| `schema_migrations` | **26** | runner migrasi — lihat §2.3 |
| `perf_kpi_weights` | 15 | **seed migrasi** (bobot KPI default) |
| `employee_layered_roles` | 7 | artefak dev/UAT |
| `sessions` | 7 | artefak dev/UAT |
| `perf_period_targets` | 6 | **seed migrasi** |
| `id_sequences` | 5 | runner ID |
| `leads` · `prospect_attempts` | 1 · 1 | ✅ §4 — pemilik menyatakan keduanya percobaan |
| `campaigns` · `demo_tasks` · `master_services` · `master_service_versions` · `employee_credentials` | 1 masing-masing | artefak dev/UAT |

### 2.3 Dua angka yang membuktikan Railway BUKAN sumber kebenaran

1. **`employees` 65 di Railway vs 69 di Supabase `CDPS SG`.** Railway adalah
   snapshot yang lebih tua dan sudah dilewati — bukan salinan paralel yang hidup.
2. **`schema_migrations` 26 baris.** Repo Go punya **48 berkas migrasi**
   (24 pasang up/down); Supabase sudah di **44 migrasi**. Skema Railway berhenti
   jauh di belakang keduanya.

`master_services` = **1** di Railway vs **32** di Supabase menguatkan hal yang
sama: MSL riil (2026-07-28, NIK `2101180004`) tidak pernah menyentuh Railway.

## 3. Kesimpulan OQ-2

- [x] **Terverifikasi untuk dekomisi.** Rantai entitas jalur uang **nol baris**,
      dan nol-nya terbukti (tiap tabel melaporkan jumlah kolomnya, jadi ia ada
      dan terbaca; skrip keluar exit 2 kalau salah satunya hilang). 239 baris
      yang tersisa adalah seed migrasi + artefak masa pengembangan yang sudah
      digantikan Supabase.
- Batas yang dinyatakan DECISIONS 2026-07-29 — *"sebelum Railway benar-benar
  dimatikan, satu `SELECT count(*)` per tabel harus dilampirkan"* — **terpenuhi**,
  dan lebih dari yang diminta: 50 tabel, bukan 3.

## 4. ✅ `leads` = 1 · `prospect_attempts` = 1 — DITUTUP pemilik

Pemilik menyatakan **2026-07-31**: *"database yang ada masih kosong dan belum
digunakan, prospek yang ada hanya percobaan."*

⇒ **Nol entitas yang perlu dipindahkan ke Supabase sebelum Railway dimatikan.**
Ini menutup satu-satunya butir OQ-2 yang tersisa untuk mata manusia; keduanya
tetap ikut ter-backup di §5, jadi keputusan ini bisa dibatalkan selama berkasnya
masih ada.

## 5. Backup — ✅ terverifikasi 4 lapis

| | |
|---|---|
| Run | **`30607919027`** (job `backup`, commit `bf524eb`) — **success** |
| Berkas | `cdps-mysql-railway-20260731T055157Z.sql.gz.enc` |
| SHA-256 | `1b9ecffd6f0c4072cfde24b7dc25b49929480bec204c5dacd19e04a15647cb3e` |
| Ukuran | dump `.sql` 104.200 byte → artifact zip 15.098 byte |
| Artifact | ID `8784358689`, retensi **30 hari** |
| Enkripsi | aes-256-cbc · pbkdf2 600000 · sha512 · **round-trip dekripsi diuji, identik** |
| Lapis 1 struktur | ✅ **50/50** tabel, nol tabel asing |
| Lapis 2 baris | ✅ **239/239** baris cocok di seluruh 50 tabel |
| Lapis 3 trigger | ✅ **7/7** trigger imutabilitas ikut |
| Lapis 4 restore sungguhan | ✅ **LOLOS** — 50 tabel · 239 baris · 7 trigger identik sesudah restore ke MySQL 8.4 kosong |
| Perbaikan yang diterapkan ke dump | 7 × `DEFINER=` dilucuti · 7 × `;` nyasar sebelum `*/` dibuang (§5.1) |

### 5.1 🔴 Temuan yang berlaku jauh melampaui Railway

**`mysqldump` polos atas DB ini menghasilkan backup yang MySQL sendiri tolak
muat ulang.** Empat run pertama gagal di baris 257 dengan `ERROR 1064 … near ' */'`:

```
/*!50003 CREATE*/  /*!50003 TRIGGER `audit_log_no_update` … MESSAGE_TEXT =
'audit_log is append-only: UPDATE forbidden'; */;;
                                            ↑ titik koma sebelum penutup
```

Badan ketujuh trigger imutabilitas (aturan rumah #3) tersimpan **berakhir dengan
`;`**. `mysqldump` menuliskannya apa adanya di dalam komentar ber-versi; saat
dimuat ulang `;` menutup pernyataan sehingga ` */` tersisa sebagai pecahan tanpa
makna. Berkasnya lengkap dan konsisten — **hanya tidak bisa dieksekusi**.

Dua konsekuensi:

1. **Backup MySQL mana pun yang pernah diambil dari DB ini dengan `mysqldump`
   polos tidak bisa dipulihkan** — dan itu baru ketahuan pada hari ia dibutuhkan.
2. Ini persis alasan lapis 4 ada. Lapis 1–3 hijau di **kelima** run; hanya lapis
   4 yang bisa membedakan "berkas lengkap" dari "berkas yang bisa dipakai".

Perbaikan di skrip: `;` nyasar dibuang dari baris DDL trigger (ia pernyataan
kosong — nol perubahan arti trigger), dijaga invariant yang menolak dump kalau
masih tersisa.

> **Jujur soal biayanya:** temuan ini butuh **5 run**. Dua di antaranya terbuang
> pada hipotesis DEFINER yang salah, dan satu lagi pada bug di jendela diagnostik
> sendiri (regex serakah mengambil "at line" terakhir alih-alih pertama — dan uji
> lokalnya tidak bisa membedakan karena sabotasenya kebetulan di baris 1).
> Perbaikan DEFINER tetap dipertahankan: ia menyelesaikan `ERROR 1227` yang nyata
> pada restore oleh user tanpa `SUPER` — tapi ia bukan penyebab `ERROR 1064`.

## 6. Penyimpanan — ✅ **SELESAI 2026-07-31, dinyatakan pemilik**

| Butir | Status |
|---|---|
| Berkas diunduh & disimpan **di luar GitHub** | ✅ dinyatakan pemilik |
| sha256 dicocokkan | ✅ dinyatakan pemilik — cocok dengan §5 |
| Passphrase di password manager | ✅ dinyatakan pemilik |
| Jumlah salinan | **1** — di bawah pelonggaran DoD yang disetujui (§6.1) |

> **Batas yang dinyatakan, bukan ditutupi:** ketiga baris di atas adalah
> **pernyataan pemilik**, bukan sesuatu yang bisa diverifikasi dari sesi Claude —
> berkasnya ada di mesin pemilik. Itu memang bentuk yang benar untuk butir gate
> semacam ini (§ DoD C-04 juga bekerja begitu), tapi ia dicatat sebagai atestasi,
> bukan sebagai hasil pengukuran.

### 6.1 Pelonggaran DoD penyimpanan — DISETUJUI pemilik 2026-07-31

| DoD asli | Menjadi | Alasan |
|---|---|---|
| **Dua** salinan di lokasi berbeda | **Satu** salinan di luar GitHub | Isi Railway terbukti **239 baris** artefak dev + seed migrasi, **nol entitas jalur uang**, dan pemilik menyatakan lead/attempt yang ada hanyalah percobaan (§4). Nilai yang dilindungi tidak sebanding dengan ritual 3-2-1 |
| Passphrase **wajib** bisa diakses PIC kedua | Tidak wajib | Konsekuensi kehilangan passphrase = kehilangan arsip dev, bukan kehilangan data produksi |

**Yang TIDAK dilonggarkan** — dan ini yang membuat pelonggaran di atas aman:
verifikasi 4 lapis tetap syarat mutlak, sha256 tetap wajib dicocokkan, dan
berkasnya tetap wajib keluar dari GitHub. Yang dipangkas hanya redundansi
salinan, bukan bukti keutuhannya.

> Kalau kelak Railway ternyata memuat sesuatu yang lebih dari arsip dev,
> pelonggaran ini **tidak berlaku surut** — ia dibenarkan oleh angka §2, dan
> angka itu yang harus dibaca ulang lebih dulu.

## 6b. Sisa — diperbarui 2026-07-31 sesudah pemilik menutup butir 1–3

**✅ BUTIR 6 GATE GO SELESAI.** Tiga butir yang memblokirnya sudah ditutup pemilik:
berkas tersimpan di luar GitHub · sha256 cocok · passphrase di password manager ·
pelonggaran DoD disetujui (§6.1).

Yang tersisa **tidak memblokir butir 6** — ia kebersihan operasional:

| # | Butir | Kapan | Kenapa tetap dicatat |
|---|---|---|---|
| 4 | **Required reviewer di environment `railway-backup`** | sebelum run berikutnya | Gerbangnya **tidak pernah menyala** di kelima run — GitHub membuat environment tanpa proteksi, menambahkan reviewer adalah langkah tersendiri. Selama kosong, siapa pun ber-akses tulis bisa memicu dump produksi tanpa persetujuan |
| 5 | **Hapus 2 repository secret sesudah Railway dimatikan** (`RAILWAY_MYSQL_URL`, `RAILWAY_BACKUP_PASSPHRASE`) | saat C-05 | `RAILWAY_MYSQL_URL` adalah kredensial DB produksi yang tetap sah selama Railway hidup. ⚠️ **Hapus passphrase-nya BELAKANGAN** — dan hanya sesudah dipastikan ia ada di password manager, karena berkas backup-nya tidak bisa dibuka tanpa itu |
| 6 | **Opsional: hapus log run `30607290620`** | kapan saja | Jendela diagnostik sempat mencetak host `*.proxy.rlwy.net` ke log repo **publik** sebelum penyamaran dipasang. Bukan kredensial (port/user/password tidak ikut) dan berumur pendek karena Railway akan mati — tapi ia tercatat apa adanya |

> **Artifact `railway-mysql-backup` tetap boleh dibiarkan kedaluwarsa
> 2026-08-30** — salinan yang berlaku sekarang ada di tangan pemilik, dan
> artifact itu cuma saluran pengantar.
>
> **Butir 7 gate GO (rencana rollback)** kini **satu-satunya** butir gate yang
> tersisa. Dokumen resminya `RENCANA_ROLLBACK_CUTOVER.md` (PR #87) — **dua
> prasyarat 🔶-nya (#1 backup, #2 OQ-2) ditutup oleh report ini**, dan §3.1-nya
> sudah diperbarui. Sisa: satu angka N yang disepakati + prasyarat #3/#4.

## 7. Catatan operasional dari run ini

- **Environment `railway-backup` belum punya required reviewer** — job `backup`
  langsung jalan tanpa menunggu approval. GitHub membuat environment-nya otomatis
  pada run pertama **tanpa** proteksi; menambahkan reviewer adalah langkah
  tersendiri (sama seperti `c03-production` di C-03). Untuk run ini pemilik
  memang meminta eksekusi, jadi tidak ada yang terlewat — tapi gerbangnya belum
  menyala untuk run berikutnya.
- Server Railway ternyata **MySQL 9.4.0**, bukan 8.x. Klien mysql 8.0.46 di
  runner menanganinya tanpa masalah (dump + restore + hitung ulang lolos).
