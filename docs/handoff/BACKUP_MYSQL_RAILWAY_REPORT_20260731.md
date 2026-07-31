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
| Run dump | `30606686262` (job `backup`, `workflow_dispatch`, `confirm_dump=YA`) |
| Commit skrip | `23cdd89` |
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
| `leads` · `prospect_attempts` | 1 · 1 | 🟠 lihat §4 — perlu satu konfirmasi pemilik |
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

## 4. 🟠 Satu hal yang butuh mata pemilik

`leads` = **1** dan `prospect_attempts` = **1**.

Satu baris hampir pasti rekaman uji, tapi "hampir pasti" bukan bukti, dan isinya
tidak dibaca di sini (PII — repo publik). **Buka satu baris itu di Railway**
sebelum service-nya dimatikan:

```sql
SELECT id, lead_name, source, record_status, created_at, created_by FROM leads;
```

- Rekaman uji ⇒ nol tindakan, catat saja di sini.
- Prospek sungguhan ⇒ masukkan manual ke CDPS Supabase sebelum Railway mati.
  Satu lead tidak butuh importer — cukup form.

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

## 6. Penyimpanan — **belum selesai**

| Salinan | Lokasi | sha256 dicocokkan |
|---|---|---|
| 1 | ⛔ belum — masih hanya artifact run `30607919027` (kedaluwarsa 30 hari) | |
| 2 | ⛔ belum | |

- Passphrase tersimpan di: `___` — bisa diakses PIC kedua: **belum dikonfirmasi**

**Unduh:** https://github.com/MEAgrup/AgencyAPP/actions/runs/30607919027 → artifact
`railway-mysql-backup` (berisi `.sql.gz.enc` + `.manifest.md`). Cocokkan sha256 di §5.

> **Butir 6 belum boleh dicentang.** Artifact kedaluwarsa **30 hari**; selama
> berkasnya hanya hidup di GitHub, checklist yang tercentang tidak punya backup
> di baliknya.
>
> **Pelonggaran yang diusulkan** (isi Railway = 239 baris artefak dev, nol entitas
> jalur uang, dan pemilik menyatakan datanya percobaan): cukup **satu** salinan di
> luar GitHub, dan passphrase tidak wajib diakses PIC kedua. Butuh persetujuan
> pemilik + entri `DECISIONS.md` — pelonggaran butir gate bukan keputusan Claude.

## 7. Catatan operasional dari run ini

- **Environment `railway-backup` belum punya required reviewer** — job `backup`
  langsung jalan tanpa menunggu approval. GitHub membuat environment-nya otomatis
  pada run pertama **tanpa** proteksi; menambahkan reviewer adalah langkah
  tersendiri (sama seperti `c03-production` di C-03). Untuk run ini pemilik
  memang meminta eksekusi, jadi tidak ada yang terlewat — tapi gerbangnya belum
  menyala untuk run berikutnya.
- Server Railway ternyata **MySQL 9.4.0**, bukan 8.x. Klien mysql 8.0.46 di
  runner menanganinya tanpa masalah (dump + restore + hitung ulang lolos).
