# HANDOFF — Feedback Lapangan 2026-09-14 · SESI 2 → SESI 3

> Lanjutan `docs/handoff/HANDOFF_FEEDBACK_LAPANGAN_20260914.md` (sesi 1, PR #375
> F-1, sudah merge). Sesi ini mengerjakan F-2, F-3 (sebagian), F-4, F-6, dan
> mengoreksi diagnosis F-5. Dua migrasi sudah diterapkan lewat
> `apply_migration` per berkas seperti seharusnya — **cek `mcp__Supabase__list_migrations`
> sebelum sesi berikutnya menganggap ini belum live.**

## 1. Yang selesai sesi ini

| Butir | Status | Migrasi |
|---|---|---|
| F-2 (rate-limit login per email+IP) | ✅ selesai | `20261020010000_feedback_lapangan_20260914.sql` |
| F-3 (pesan validasi sales.ts) | ⚠️ **3 dari 4 baris prioritas** — lihat §2 | nol migrasi |
| F-4 (catatan nego wajib + harga standar) | ✅ selesai | `20261020010000_feedback_lapangan_20260914.sql` |
| F-5 (nominal Finance beda dari rencana) | 🔴 **DIKOREKSI** — nol tabel baru, lihat DECISIONS.md | `20261020010000_feedback_lapangan_20260914.sql` (1 event saja) |
| Gelombang 3 (4 butir "sudah ada") | ✅ dokumen `docs/FITUR_SUDAH_ADA_TAPI_TIDAK_TERLIHAT.md` | — |
| F-6 (Daily Activity) | ✅ selesai — pemilik menjawab "keluaran kerja" via `AskUserQuestion` | `20261021010000_f6_daily_activities.sql` |

Gerbang CI dinaikkan (`scripts/db-rebuild.sh` + `.github/workflows/ci.yml`,
commit yang sama dengan tiap migrasi): `notif_events` 74→75 (F-2/F-4/F-5
migration); `tabel public` 175→176, `entity_prefix` 44→45 (F-6 migration,
+`daily_activities` +`DACT`). `sm_machines` **TETAP** 35 sepanjang sesi ini.

Full suite hijau di DB lokal yang dibangun ulang dari nol
(`scripts/db-rebuild.sh --yes`, sequential/`--pool=forks
--poolOptions.forks.singleFork` supaya tidak deadlock di sandbox satu-core):
`core` 1174, `db` 107, `domain` 2583 (+1 skip, termasuk 6 tes
`dailyactivity.test.ts`), `api` 576 (+2 skip), `web-internal` 763.
`route-parity` `KNOWN_GAPS` tetap kosong; `shape-parity` mencakup
`DailyActivityWire`.

⚠️ **Jangan jalankan seluruh suite `domain` secara paralel (default vitest)
di sandbox ini** — banyak test file berbagi `audit_log`/baris `ZZ-` dan akan
deadlock atau salah hitung count kalau jalan bersamaan pada mesin satu-core.
Selalu tambahkan `--pool=forks --poolOptions.forks.singleFork` di sini; CI
sungguhan (runner GitHub, lebih banyak core) tidak menunjukkan ini.

## 2. F-3 — 47 lokasi lagi, belum ditelusuri

Handoff sesi 1 menandai **4 baris prioritas**. Sesi ini menyelesaikan **3**:
platform di luar checklist, jasa+platform duplikat, salesperson duplikat di
alokasi (`sales.ValidationError` + 3 konstanta BI baru). **Baris ke-4 yang
dilaporkan ternyata SUDAH BENAR** (`TooManyServicesError` vs `IncompleteError`
sudah dibedakan lewat ternary sebelum sesi ini) — dicatat sebagai koreksi di
DECISIONS.md, bukan dikerjakan ulang.

Sisa **~47 lokasi** `throw new IncompleteError()` di `packages/domain/src/sales.ts`
belum ditelusuri satu per satu untuk membedakan "field kosong" (biarkan) dari
"isi salah" (butuh pesan baru gaya `sales.ValidationError`). Ini SENGAJA
tidak dikerjakan sekali jalan (handoff sesi 1: *"Sisanya boleh menyusul"*) —
tapi kalau ada keluhan lapangan baru yang berbunyi mirip *"padahal sudah
diisi"*, curigai dulu lokasi-lokasi ini sebelum menganggapnya bug baru.

## 3. F-6 — selesai: keluaran kerja, bukan absensi

Pemilik dijawab lewat `AskUserQuestion` sesi ini: **keluaran kerja** (nyambung
M14 Team Performance), bukan absensi. Dibangun persis pola `prospect_activities`
— log append-only, nol status, taksonomi tertutup (`Meeting Klien`/`Meeting
Internal`/`Training`/`Webinar`/`Input Data`/`Lainnya`). Prefix **`DACT`**
(bukan `ACT`, sudah dipakai *Prospect activity*).

**Yang BELUM ada, dan sengaja belum** (di luar permintaan lapangan asli,
jangan tambah tanpa diminta):
- Rollup/agregat ke M14 Team Performance itu sendiri — tabel & domainnya baru
  MENCATAT, belum ada satu pun pembaca yang menjumlahkannya ke skor performa.
  Kalau pemilik minta itu berikutnya, itu tiket M14 tersendiri, bukan
  perluasan F-6 diam-diam.
- Halaman ringkasan untuk Lead/SPV (halaman `/aktivitas` yang sama menampilkan
  baris divisi lewat RLS, tapi belum ada filter/rekap per anggota tim di UI).
- Reminder/notifikasi kalau seseorang belum mencatat aktivitas — F-6 murni
  pencatatan pasif, tidak ada dorongan otomatis.

## 4. Yang masih diblokir screenshot (handoff sesi 1 §4) — belum berubah

Dua butir masih menunggu: screenshot "Kuota Deliverable" + screenshot/bunyi
galat upload "Riset Awal". Tidak diminta ulang sesi ini — status sama seperti
sesi 1.

## 5. Perintah yang dipakai sesi ini (tambahan dari sesi 1)

```bash
# Postgres lokal sandbox ini butuh password di-set manual sebelum DATABASE_URL
# TCP bisa dipakai (su postgres -c psql pakai socket, bukan password):
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes   # bangun ulang DARI NOL sebelum tes DB nyata
npx vitest run <path> --pool=forks --poolOptions.forks.singleFork   # HINDARI paralel
```

**Jebakan yang ditemukan sesi ini:** `git stash` TANPA `-u` tidak menyentuh
berkas migrasi baru (untracked), tapi tetap menstash SEMUA perubahan pada
berkas yang sudah di-track — termasuk auth.ts/sales.ts/dst. Kalau perlu
membandingkan perilaku "sebelum vs sesudah", `git stash` lalu **langsung**
`git stash pop` sesudah selesai membandingkan — jangan biarkan tergantung,
dan JANGAN jalankan `db-rebuild.sh` di antara stash dan pop (skema akan
merefleksikan kode yang salah dan membingungkan diagnosis).
