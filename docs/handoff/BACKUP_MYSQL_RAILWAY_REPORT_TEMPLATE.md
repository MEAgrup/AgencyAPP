# TEMPLATE — Report backup MySQL Railway + OQ-2

> Salin ke `BACKUP_MYSQL_RAILWAY_REPORT_<YYYYMMDD>.md` lalu isi. Runbook:
> `RUNBOOK_BACKUP_MYSQL_RAILWAY.md`. Menutup gate GO butir 6 + sisa OQ-2.
>
> **Nol PII di berkas ini.** Nama tabel, angka, dan checksum saja — repo publik.
> **Jangan** menempelkan isi dump, URL koneksi lengkap, atau passphrase.

## 1. Provenance

| | |
|---|---|
| Tanggal (UTC) | |
| Dijalankan oleh | |
| Jalur | GitHub Actions run `<id>` / laptop |
| Commit skrip | `<sha>` |
| Server MySQL | `<versi>` |
| Database | `railway` |

## 2. OQ-2 — hitungan

Tempel tabel dari `oq2-railway-mysql.md` (bagian "Tabel inti" + "TOTAL"):

| Tabel | Kolom | Baris |
|---|---:|---:|
| `leads` | | |
| `clients` | | |
| `transactions` | | |
| `installments` | | |
| `prospect_attempts` | | |
| **TOTAL seluruh tabel** | | |

- BASE TABLE terbaca: `___` (diharapkan 49)
- Selisih terhadap `backend/migrations/*.up.sql`: `___`

**Kesimpulan OQ-2** *(pilih satu, coret yang tidak dipakai)*:

- [ ] **Terverifikasi kosong.** Nol baris di seluruh tabel entitas ⇒ dekomisi Railway tidak menghilangkan entitas apa pun. Batas yang dinyatakan DECISIONS 2026-07-29 ("belum terverifikasi untuk dekomisi") **tertutup**.
- [ ] **Ada data riil.** ⇒ C-04 butir 1 aktif kembali: butuh rencana ekspor-impor per-entitas mengikuti rantai FK `LEAD → ATTEMPT → CLIENT → SERVICE → TRX → INST`. **Gate GO belum boleh lewat.**

## 3. Backup

| | |
|---|---|
| Berkas | `cdps-mysql-railway-<stamp>.sql.gz.enc` |
| SHA-256 | `` |
| Ukuran | |
| Enkripsi | aes-256-cbc · pbkdf2 600000 · round-trip dekripsi diuji |
| Lapis 1 struktur | ✅ / 🔴 |
| Lapis 2 baris | ✅ / 🔴 |
| Lapis 3 trigger | `__/7` |
| Lapis 4 restore | ✅ / 🔴 / tidak dijalankan |

## 4. Penyimpanan

| Salinan | Lokasi | Diverifikasi sha256 |
|---|---|---|
| 1 | | |
| 2 | | |

- Passphrase tersimpan di: `___` — bisa diakses PIC kedua: ya / belum

## 5. Sisa

- Butir 7 (rencana rollback): disepakati / belum — N = `___` hari
- Tanggal rencana Railway dimatikan: `___`
