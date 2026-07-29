# HANDOFF — Cutover Sesi 6 (O41 ditemukan & 3 gap ditutup · gating sidebar #58 di-port · 2 migrasi RLS menunggu apply)

> **Dokumen standalone.** Mulai chat berikutnya dari file ini.
> Tanggal: 2026-07-29. Pendahulu: `HANDOFF_CUTOVER_SESI5.md`.

---

## 0. MULAI DI SINI — posisi branch & PR

| Item | Nilai |
|---|---|
| **Lokasi kerja** | **`main`** @ `2c82f89` — **PR #62 SUDAH DI-MERGE** (2026-07-29 03:21Z oleh pemilik, CI 11/11 hijau). Tidak ada PR jalur ini yang menggantung. |
| **Buat branch baru dari `main`** | Jangan lanjut di `claude/handoff-sesi-5-inmsq9` untuk pekerjaan #62 — riwayatnya sudah habis (ter-merge) |
| **Isi merge #62** | 4 cluster: gating sidebar (port #58) · route reminder M5 + test paritas FE↔API · `POST /attempts/{id}/lost` · **migrasi RLS `0010`** |
| **PR lain yang terbuka** | **#58** — sudah dikomentari dengan penunjuk ke #62, **sengaja tidak ditutup** (keputusan pemilik). Isinya sudah tidak relevan; tinggal ditutup. |

```bash
git fetch origin main && git checkout main && git pull origin main
npm ci                                    # node_modules TIDAK ada di clone baru
cd web-internal && npm ci && cd ..        # web-internal punya lockfile sendiri
```

> **Konsekuensi merge yang paling penting: `20260102000010` SEKARANG SUDAH ADA DI `main`.**
> Artinya penghalang urutan di §1 **hilang** — apply `0009` → `0010` ke live sekarang boleh langsung
> dijalankan dari `main`, tidak perlu menunggu merge apa pun lagi.

---

## 1. 🔴 TINDAKAN PALING MENDESAK — 2 migrasi RLS menunggu apply ke `CDPS SG`

**Runbook lengkap sudah ada: `docs/handoff/RUNBOOK_APPLY_RLS_0009_0010.md`.** Jangan menulis ulang.

| Migrasi | Ada di | Status live | Akibat kalau belum di-apply |
|---|---|---|---|
| `20260102000009_rls_leads_campaign_scope` | ✅ **`main`** (sejak #59-#61) | ❌ belum | Marketing staff kehilangan lead dari campaign miliknya sendiri (regresi fungsional) |
| `20260102000010_rls_finance_staff_queue_scope` | ✅ **`main`** (sejak merge #62) | ❌ belum | Finance **staff** tidak bisa membaca transaksi ⇒ `GET /finance/queue` akan mengembalikan **antrean kosong tanpa error** begitu di-port; dan sekarang Finance staff bisa **mem-verifikasi pembayaran yang tidak bisa ia baca** (tulis lewat RPC SECURITY DEFINER tidak ter-RLS) |

**Keduanya sudah ada di `main`, jadi tidak ada lagi yang perlu ditunggu.** Urutannya tetap
**0009 → 0010** (riwayat migrasi harus urut), dijalankan dari `main` yang sudah di-pull.

Pemilik **sudah memberi ack** untuk apply (sesi 6) dan **sudah me-merge #62**. Yang belum:
eksekusi apply-nya, karena butuh mesin ber-akses (lihat §4) — sandbox Claude tidak bisa.

> Peringatan drift yang dulu ada di sini (jangan apply sebelum merge, pelajaran O38) **sudah tidak
> berlaku** — #62 ter-merge 2026-07-29 03:21Z, jadi repo dan target apply sudah sejajar.

---

## 2. Yang selesai sesi 6

### 2.1 Cluster 1 — gating menu sidebar per divisi (port bagian `web-internal` #58)
- Tabel gate pindah ke modul murni **`web-internal/src/lib/nav.ts`** (`NAV_SECTIONS` + `visibleNav(role)`);
  `Sidebar.tsx` nol logika izin, markup tidak berubah (`Fragment`, bukan `div` — `.nav` flex column `gap: 2px`).
- **Aturannya:** sembunyikan HANYA bila server memang menolak (403 endpoint / gate baca tingkat-divisi).
  Halaman yang visibilitasnya cuma row-level RLS (`/clients`, `/board`, `/performance`,
  `/master-services`, `/notifications`) **tetap terlihat** — daftar kosong itu jujur, menyalin
  predikat baris ke UI hanya bisa melenceng dari RLS.
- **Dua koreksi terhadap tabel #58** (jangan port verbatim kalau ada yang mengulang): `/creative` &
  `/ads` di #58 terlalu KETAT (menyembunyikan dari Account lead yang `listDivisionQueue` izinkan);
  `/kol` & `/livestream` terlalu LONGGAR (Account semua level, padahal lead saja).
- **`web-internal` sebelumnya tidak punya test runner sama sekali** ⇒ ditambah `vitest` + script
  `test`/`typecheck` + step CI. **26 test per-role** hijau (termasuk OD/Director berlapis, dan guard
  bahwa OD berlapis TIDAK mewarisi Portal Tim).

### 2.2 Cluster 2 — route reminder M5 + test paritas FE↔API
- `GET /api/v1/reminders` → **`/api/v1/finance/reminders`**, `POST .../scan` idem. Go tidak pernah
  punya `/api/v1/reminders`; halaman Reminder Pembayaran 404 di produksi. Hanya pindah file route.
- **`apps/api/src/lib/route-parity.test.ts`** — mem-diff setiap `api.<method>('<path>')` di
  `web-internal/src/lib/*.ts` terhadap route yang `apps/api` benar-benar ekspor. Pakai scanner
  ber-penghitung kedalaman (bukan regex) karena path FE menyisipkan `${cond ? \`?${qs}\` : ''}`.
  `KNOWN_GAPS` = buku besar sisa gap; test gagal untuk gap **baru** DAN gagal bila entri
  `KNOWN_GAPS` ternyata **sudah dilayani**.

### 2.3 Cluster 3 — `POST /attempts/{id}/lost` (edge Closed-Lost M0)
- `sales.markLost` mencermin `markContacted`. **State sumber sengaja TIDAK di-hardcode** — `sm_edges`
  yang memutuskan (sama seperti Go `MarkLost`). Route mengembalikan `{ status: 'Closed-Lost' }`
  (kontrak Go + FE), bukan `TransitionResult` mentah.
- Kenapa ini yang dipilih lebih dulu dari 8 sisa: `Closed-Lost` **terminal**, dan dedup M1 menganggap
  attempt non-terminal sebagai "sedang diproses oleh sales lain" ⇒ tanpa endpoint ini lead **terkunci
  permanen** ke satu sales dan pool tak pernah bebas. Tombol "Tandai Closed-Lost" di
  `sales/[id]/page.tsx` 404 di produksi, dan Sales divisi yang jelas ADA di roster.
- Nol migrasi (edge sudah ada & ter-apply), nol string BI baru.

### 2.4 Cluster 4 — migrasi RLS `0010` (paritas Finance staff)
Detail + bukti di entri Decided 2026-07-28 `docs/DECISIONS.md`, dijaga `rls_checks.sql` §14-17
(termasuk assertion bahwa Account staff bukan-AM **tetap 0** — pelebaran Finance tidak melebar ke
divisi lain). Lihat §1 untuk status apply.

### 2.5 Verifikasi
`@cdps/domain` **426 hijau terhadap Postgres NYATA** (bukan 285 skip) · `apps/api` **177** ·
`web-internal` **26** · `core` **112** · `db` **9** · keempat invariant SQL PASS · typecheck seluruh
workspace bersih · **CI PR #62 11/11 hijau**.

---

## 3. TIKET BERIKUTNYA

### 3.1 Sisa O41 — 7 endpoint, semuanya butuh fungsi domain baru
Buku besarnya di `apps/api/src/lib/route-parity.test.ts` (`KNOWN_GAPS`) + baris O41 `DECISIONS.md`.
Urutan hulu-ke-hilir:

| # | Endpoint | Catatan |
|---|---|---|
| 1 | `POST /clients/{id}/payment-intent` | scheme + total; **hulu** dari `schedule` |
| 2 | `GET /finance/queue` | Go `Service.Queue`; gate endpoint Finance/OD/Director. **BACA §3.2 DULU** |
| 3 | `GET /transactions/{id}` | Go `LoadTransaction`. **`trxVisibility` JANGAN di-port** — visibilitas baris = RLS (O37); penolakan muncul sebagai **404**, deviasi yang sudah disetujui |
| 4 | `POST /transactions/{id}/schedule` | Go `CreateSchedule`: lock baris, guard idempotensi ada-installment/ada-verifikasi, Σ termin = total, mint `INST-` |
| 5 | `GET /transactions/{id}/bermasalah` | file route-nya ADA tapi hanya meng-ekspor POST |
| 6 | `POST /leads/bulk` | impor massal lead Marketing (bersinggungan O22) |
| 7 | `GET /audit` | jejak audit lintas-modul (panel riwayat aset Creative) |

House rule yang mengikat: baca WAJIB `requireActor` + `readAsActor` (#5); setiap objek domain lewat
**wire mapper** (#8 — penyebab C03-F2: bigint mentah ⇒ 500 yang mematikan kalkulator di produksi).

### 3.2 ⚠️ JEBAKAN untuk pekerjaan #2/#3 di atas — baca sebelum menulis kode
DB lokal sesi 6 **sudah** memuat migrasi `0010`, jadi test `finance/queue` akan **hijau lokal**
sementara produksi (yang belum di-apply) mengembalikan **antrean kosong** untuk Finance staff. Jangan
menyimpulkan "sudah beres" dari test lokal. Sebelum menganggap #2/#3 selesai di produksi,
**konfirmasi `0010` sudah ter-apply** (§1) — atau tulis eksplisit di PR bahwa endpoint-nya menunggu
migrasi.

### 3.3 Menunggu keputusan manusia (tidak bisa didorong developer)
| # | Isi | Butuh dari |
|---|---|---|
| **O33** | Roster HR riil **tidak punya divisi Finance** ⇒ seluruh flow M5 belum punya aktor, **dan tidak ada yang bisa mem-QA halaman Finance** — itu yang menjelaskan kenapa lubang O41 lolos C-03. Paling serius. | Pemilik |
| **O40** | Sales staff vs Leads Database: M1 §9.1 "sees own attempts only" vs `leadListScope` yang menolak Sales staff sepenuhnya. Bagian #58 yang sengaja TIDAK diputus. Kolom "Didaftarkan oleh" (`created_by`) ikut tiket ini. | Pemilik / Sales Head |
| **O34 · O26 · O35 · O25 · O9** | Aktor Wave 2, NIK/email Director, sub-tim Creative, anomali kalkulator, target M14 | lihat `HANDOFF_CUTOVER_SESI5.md` §3.1 |

**O24 sudah RESOLVED — jangan dibuka lagi.** Komisi Rp0 adalah nilai sah.

### 3.4 Sisa pekerjaan lain
Impor lead historis (O22) · 3 SKIP C-03 (`HANDOFF_CUTOVER_SESI3.md` §5) · konfirmasi data
Railway/MySQL riil atau UAT. Sesudah C-04 → C-05 (retire Go).

---

## 4. Batasan sandbox (diverifikasi ULANG 2026-07-29 01:49Z — jangan diuji ulang)

Sesi Claude **tidak bisa** menyentuh `CDPS SG` maupun deployment Vercel. Tiga penghalang independen:

| Penghalang | Bukti |
|---|---|
| Gateway proxy menolak CONNECT | `$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures` mencatat sendiri `403 to CONNECT` untuk `supabase.com:443` dan `agency-app-api.vercel.app:443`; `selective: false` ⇒ kebijakan jaringan environment, tidak bisa dinyalakan dari dalam |
| Tidak ada kredensial | nol `DATABASE_URL`/`SUPABASE_*` di env sesi |
| Tidak ada Supabase MCP | tidak tersedia di sesi ini |

⇒ **semua apply ke live dijalankan manusia.** Claude menyiapkan alat + runbook + verifikasi lokal.

### 4.1 ✅ Cara menjalankan test DB-backed di sandbox (BARU sesi 6 — ini mengubah banyak hal)
Sebelumnya test domain di-skip (138 lolos / 285 skip). Dengan resep ini: **426 lolos**.

```bash
pg_ctlcluster 16 main start          # "Removed stale pid file" itu normal
su postgres -c "psql -c 'DROP DATABASE IF EXISTS cdps;' -c 'CREATE DATABASE cdps;'"
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
for f in $(ls supabase/migrations/*.sql | sort); do
  su postgres -c "psql -d cdps -v ON_ERROR_STOP=1 -q -f '$f'" || echo "GAGAL $f"
done
su postgres -c "psql -d cdps -q -f supabase/seed.sql"
# harus 53 tabel:
su postgres -c "psql -d cdps -tAc \"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'\""

cd packages/domain && DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run
```

Invariant SQL: `psql` butuh file yang bisa dibaca user `postgres` — **copy dulu ke `/tmp` +
`chmod 644`**, kalau tidak dapat `Permission denied` dari scratchpad.

---

## 5. Pelajaran & jebakan sesi 6 (hemat waktu — jangan diulang)

1. **Notifikasi tak bisa dihapus (house rule #8)** ⇒ assertion yang menghitung notifikasi **wajib**
   di-scope ke `entity_id` milik test itu. `finance.test.ts` gagal pada run KEDUA di DB yang sama
   (`expected 5 to be 2`) karena tidak di-scope. Sudah diperbaiki; pola yang sama berlaku untuk
   `audit_log`. CI tidak pernah melihatnya karena selalu DB baru.
2. **Probe RLS wajib punya kontrol.** Probe pertama memberi 0 untuk SEMUA role dan terlihat seperti
   temuan dramatis — ternyata `INSERT` fixture-nya gagal (kolom `clients.platform` tidak ada), jadi
   yang diukur adalah tabel kosong. **Selalu sertakan baris kontrol** (superuser + Director) supaya
   nol-palsu tidak bisa lolos.
3. **Diff route jangan pakai regex.** Path FE menyisipkan `${cond ? \`?${qs}\` : ''}` (template
   bersarang + brace bersarang) ⇒ regex menghasilkan 13 lalu 9 false positive. Scanner
   ber-penghitung kedalaman + pencocokan per segmen yang benar.
4. **`send_later` (MCP `claude-code-remote`) hilang di tengah sesi** ketika server MCP-nya terputus.
   Penggantinya `CronCreate` one-shot, tapi itu **session-only** (mati bersama sesi) **dan hanya fire
   saat REPL idle** — satu check-in terjadwal tidak pernah fire karena itu. Jangan mengandalkannya
   untuk pemantauan lintas-sesi.
5. `npm run lint -w @cdps/api` gagal juga di tree bersih (`apps/api` tanpa `eslint.config.*`) —
   pre-existing, di luar CI.
6. Job CI `backend` 5–6 menit, `db-and-migrations` ~1,5 menit — bukan hang.

---

## 6. Aturan main (tidak berubah)

Sama seperti `HANDOFF_CUTOVER_SESI5.md` §6 — ringkasnya: jangan sentuh `backend/` (Go beku, oracle
paritas saja) · perubahan ke `apps/api`/`packages/*`/`web-internal`/`supabase/` · baca PRD +
`STATE_MACHINES.md` + `DATA_MODEL.md` sebelum implementasi · nol string BI baru tanpa DECISIONS ·
katalog notifikasi FROZEN 15 event · baca WAJIB `requireActor` + `readAsActor` · notifikasi tak
pernah bisa dihapus · helper RLS SECURITY DEFINER hidup di schema `private` · setiap objek domain
lewat wire mapper · **jangan apply migrasi ke `CDPS SG` tanpa menuliskannya ke
`supabase/migrations/`** · ambiguitas/deviasi PRD ⇒ **STOP**, tulis baris **Open** di `DECISIONS.md` ·
seed/impor data produksi lewat jalur domain, bukan SQL langsung.

---

## 7. Utang teknis yang diketahui

1. 🟡 **Penomoran migrasi repo (`202601…`) ≠ riwayat remote (`202607…`).** `supabase db push` akan
   menganggap SELURUH migrasi belum ter-apply. **Selaraskan sebelum memakai jalur CLI**; sampai itu
   selesai, apply lewat `psql -f` seperti runbook §3.
2. **O39** — pintu registrasi lead tanpa gate role (diputuskan: dibiarkan, utang terdokumentasi).
3. `clear_must_change_password` & `employee_display_name` ada di DB, nol pemanggil TS — bersihkan di C-05.
4. Dua salinan `msl_kalkulator.csv` (`backend/seed/` beku + `supabase/seed/` aktif); test penjaga
   auto-skip begitu `backend/` hilang.
5. `apps/api` tanpa `eslint.config.*`.
6. `BACKEND_URL` tidak di-set untuk environment **Preview** Vercel `web-internal-mea` ⇒ preview FE
   memanggil API **produksi**, jadi preview per-PR tidak pernah menguji API dari branch yang sama.
