# HANDOFF — Cutover Sesi 6 (O41 ditemukan & 3 gap ditutup · gating sidebar #58 di-port · 2 migrasi RLS SUDAH di-apply)

> **Dokumen standalone.** Mulai chat berikutnya dari file ini.
> Tanggal: 2026-07-29. Pendahulu: `HANDOFF_CUTOVER_SESI5.md`.

---

## 0. MULAI DI SINI — posisi branch & PR

| Item | Nilai |
|---|---|
| **Branch kerja** | ~~`claude/handoff-sesi-5-inmsq9`~~ → **sudah merge**. Sesi 2026-07-29 lanjut di **`claude/handoff-sesi-6-cutover-ysut7c`** |
| **PR** | ~~#62~~ **✅ MERGED 2026-07-29** (`2c82f89`, merge commit, CI 11/11 hijau) — https://github.com/MEAgrup/AgencyAPP/pull/62 |
| **Base** | `main` @ **`2c82f89`** (sebelumnya `3d3896a`) |
| **Commit di branch (5, terbaru dulu)** | `d1d4043` runbook apply RLS · `8c39933` migrasi RLS 0010 · `6cddf11` port `attempts/{id}/lost` · `2dbc5fd` route reminder M5 + test paritas · `7e3bb83` gating sidebar |
| **Semua ter-push?** | ✅ ya — tidak ada commit/berkas tertinggal |
| **PR lain yang terbuka** | ~~#58~~ **✅ DITUTUP 2026-07-29** (keputusan pemilik) — bagian sidebar sudah masuk lewat #62; scope Sales staff + kolom "Didaftarkan oleh" pindah ke **issue #64** (O40, dieksekusi **setelah** gate C-04) |

```bash
git fetch origin main
git checkout main && git pull origin main   # sudah memuat keempat cluster sesi 6
npm ci                                     # node_modules TIDAK ada di clone baru
cd web-internal && npm ci && cd ..          # web-internal punya lockfile sendiri
```

> **PR #62 membawa EMPAT cluster** (gating sidebar FE · route reminder M5 + test paritas · port
> `attempts/{id}/lost` · migrasi RLS 0010) — menyimpang dari konvensi "PR kecil per cluster"
> `CLAUDE.md` karena branch sesi itu dipatok. **Sudah ditanyakan: pemilik memilih merge apa adanya**
> (2026-07-29), dengan merge commit supaya keempat commit per-cluster tetap terbaca di riwayat dan
> bisa di-revert satu-satu. Memecah jadi 4 PR dinilai tidak menghasilkan temuan baru — keempatnya
> sudah hijau dan tidak saling bergantung — sementara menahan merge menahan apply migrasi 0010.

---

## 1. ✅ SELESAI — 2 migrasi RLS sudah di-apply ke `CDPS SG` (2026-07-29)

**Dieksekusi sesi 2026-07-29 sesuai `docs/handoff/RUNBOOK_APPLY_RLS_0009_0010.md`.** Urutan wajib
ditaati: **#62 di-merge dulu** (`2c82f89`) → apply **0009** → apply **0010**.

| Migrasi | Versi tercatat di live | Status |
|---|---|---|
| `20260102000009_rls_leads_campaign_scope` | `20260729031525_rls_leads_campaign_scope` | ✅ ter-apply |
| `20260102000010_rls_finance_staff_queue_scope` | `20260729032805_rls_finance_staff_queue_scope` | ✅ ter-apply |

Live kini **38 migrasi**. Di-apply lewat MCP `apply_migration` (bukan `psql -f` seperti tertulis di
runbook) supaya **tercatat** di `supabase_migrations.schema_migrations` — `psql -f` tidak menulis
baris ledger dan akan mengembalikan live ke keadaan "schema tanpa jejak" yang justru sedang dibereskan.

**Verifikasi:** jumlah policy tetap **44**, tabel tetap **53**, `private.jwt_owns_lead_campaign` ada,
`leads_select` ber-5 arm, ketiga policy M5 kini `jwt_division() = 'Finance'` tanpa `jwt_is_lead()`.
Probe klaim `authenticated` dengan kontrol: Director **3** · pembuat 2 lead **2** · Marketing staff
tanpa kepemilikan **0** — sekaligus membuktikan arm baru **dievaluasi tanpa error** (mode gagal yang
menggagalkan percobaan sebelumnya: `function jwt_owns_lead(...) does not exist`, akar O38).

> ⚠️ **BATAS VERIFIKASI — jangan dibaca sebagai "terbukti dengan data nyata".** Live masih kosong
> secara operasional: `transactions` **0**, `clients` **0**, `campaigns` **0**, `leads` **3** (semua
> buatan akun QA, `origin_campaign_id` NULL). Jadi probe §4.2 runbook (antrean Finance dengan TRX
> nyata) **tidak bisa dijalankan**, dan arm own-campaign 0009 belum pernah kena baris nyata. Keduanya
> terbukti di PG16 lokal + `rls_checks.sql` §14-17 di CI. **Konfirmasi ulang pada TRX pertama yang masuk.**

**Kabar baik yang mengubah asumsi lama:** premis O41 *"blast radius nol karena O33 belum ada aktor
Finance"* **tidak benar** — live punya **3 karyawan Finance riil aktif** ber-akun login, semuanya
ter-mapping `Finance`. Jadi 0010 memperbaiki pengguna nyata, bukan menunggu aktor. **O33 kini SELESAI**
(ENDANG PUJI ASTUTI → `Finance`/`lead`); lihat Decided 2026-07-29 di `docs/DECISIONS.md`.

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
| ~~**O33**~~ | ✅ **SELESAI 2026-07-29.** Premisnya ternyata kedaluwarsa: live **sudah** punya divisi `FINANCE AND ACCOUNTING` — 3 karyawan riil aktif ber-akun login, ketiga jabatannya ter-mapping ke `Finance`. Yang kurang hanya level `lead`, dan pemilik menetapkan `SENIOR FINANCE, ACCOUNTING & TAX` (ENDANG PUJI ASTUTI) → `Finance`/`lead`. **M5 kini punya aktor produksi + QA.** | — |
| ~~**O40**~~ | ✅ **DIPUTUS 2026-07-29 — arah (b), eksekusi DITUNDA sampai setelah gate C-04.** Database memang harus tampil untuk Sales staff ter-scope ke lead miliknya, tapi itu perubahan perilaku di tengah cutover (preseden O39). Pekerjaannya + kolom "Didaftarkan oleh" ada di **issue #64**; PR #58 ditutup. | — |
| **O42** 🆕 | **Tidak ada jalur admin `role_mappings` di stack baru**, padahal tabel itu sumber kebenaran SELURUH permission (`employee_claims()` menurunkan division/level darinya). Mengubah peran = SQL langsung ke produksi. Plus tiga sumber mapping yang saling menyimpang: live **38** baris · `backend/seed/role_mappings_riil.csv` **23** (nol Finance, tapi punya `BUSINESS DEVELOPMENT`→Marketing yang **tidak ada** di live ⇒ divisi Marketing kini tanpa mapping di produksi) · `supabase/seed.sql` **12** (fixture dev). | Pemilik / HR / OD |
| **O34 · O26 · O35 · O25 · O9** | Aktor Wave 2, NIK/email Director, sub-tim Creative, anomali kalkulator, target M14 | lihat `HANDOFF_CUTOVER_SESI5.md` §3.1 |

**O24 sudah RESOLVED — jangan dibuka lagi.** Komisi Rp0 adalah nilai sah.

### 3.4 Sisa pekerjaan lain
Impor lead historis (O22) · 3 SKIP C-03 (`HANDOFF_CUTOVER_SESI3.md` §5) · konfirmasi data
Railway/MySQL riil atau UAT. Sesudah C-04 → C-05 (retire Go).

---

## 4. Batasan sandbox — ⚠️ SUDAH BERUBAH per 2026-07-29

> **Jangan pakai tabel di bawah sebagai alasan menolak menyentuh live.** Sesi 2026-07-29 punya
> **Supabase MCP dengan akses ke `CDPS SG`** dan memakainya untuk apply + verifikasi kedua migrasi
> RLS serta mengeksekusi keputusan O33. **Periksa dulu tool yang tersedia** sebelum menyimpulkan
> live tak terjangkau — batasan ini per-sesi, bukan sifat permanen environment.

Yang **masih** berlaku (sesi 2026-07-29): deployment Vercel tetap tak bisa disentuh, dan **tidak ada
klien HTTP ke `agency-app-api`** — jadi konfirmasi endpoint lewat HTTP nyata (utang O41) masih belum
bisa dilakukan dari dalam sesi. Yang **tidak lagi** berlaku: baris "tidak ada Supabase MCP".

Kondisi sesi 6 (arsip, diverifikasi 2026-07-29 01:49Z — konteks kenapa runbook §3 ditulis untuk manusia):

| Penghalang | Bukti |
|---|---|
| Gateway proxy menolak CONNECT | `$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures` mencatat sendiri `403 to CONNECT` untuk `supabase.com:443` dan `agency-app-api.vercel.app:443`; `selective: false` ⇒ kebijakan jaringan environment |
| Tidak ada kredensial | nol `DATABASE_URL`/`SUPABASE_*` di env sesi |
| ~~Tidak ada Supabase MCP~~ | **tidak lagi benar** — tersedia sejak sesi 2026-07-29 |

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
