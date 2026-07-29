# HANDOFF — Cutover Sesi 12

> **Pendahulu:** `HANDOFF_CUTOVER_SESI11.md` (dan lewat itu SESI10/SESI9). Yang masih berlaku
> **tidak diulang** — terutama SESI9 §0.2 (batas sandbox), §6 (aturan rumah yang menggigit),
> §7 (cara menjalankan test DB-backed — dipakai lagi sesi ini, masih akurat kecuali satu hal:
> di container ini `npm ci` **belum** pernah jalan, jadi `vitest: not found` sampai
> dependency dipasang; dan jumlah tabel sekarang **54**, bukan 53).

## 0. Posisi persis

| | |
|---|---|
| **Branch** | `claude/cdps-sg-cutover-migrasi-azzlwr` |
| **Basis** | `7bbd5e1` — **PR #72 sudah ter-merge ke `main`**, jadi keputusan §0.2 SESI11 sudah terlewati dan tidak perlu dijawab lagi |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** (naik dari 39 · 53 · 15) |

Dua task yang diminta **selesai keduanya**. Tidak ada yang tertinggal setengah jalan.

---

## 1. Migrasi `lead_delete_request` di-apply ke `CDPS SG` 🟢

Butir keempat SESI10 §2.3 — satu-satunya yang sengaja ditunda karena harus **sesudah merge**.
Prasyaratnya diverifikasi dulu, bukan diasumsikan: `HEAD` = `origin/main` = `7bbd5e1`, nol
ahead/nol behind, dan merge commit PR #72 memang ada di `main`.

**Dijalankan lewat `apply_migration`, bukan `psql -f`** (pola O38). Bedanya bukan gaya:
hanya `apply_migration` yang menuliskan baris ke `supabase_migrations.schema_migrations`.
`psql -f` mengubah skema tanpa mencatatnya — persis mekanisme yang melahirkan drift O38.

Versi yang tercatat live: **`20260729162101_lead_delete_request`**.

### 1.1 Prasyarat yang dicek SEBELUM apply

53 tabel · 15 event · `lead_delete_requests` belum ada · nol edge `[Deleted]` · nol terminal
state `lead_record`. Semua cocok dengan angka SESI11, jadi tidak ada apply ganda atau
setengah-jalan yang tersembunyi.

Satu hal yang **wajib** dicek dan mudah terlewat: keempat helper policy
(`jwt_can_read_all` · `jwt_employee_id` · `jwt_is_lead` · `jwt_division`) masih di schema
**`public`** di live. Migrasi ini memanggilnya **tanpa kualifikasi schema**, jadi kalau
keempatnya sudah ikut pindah ke `private` seperti `jwt_owns_*` (migrasi
`20260727072443`), `CREATE POLICY`-nya akan gagal. Ternyata belum pindah — aman. Kalau nanti
ada migrasi hardening lanjutan yang memindahkan sisanya, policy ini ikut harus disesuaikan.

### 1.2 Bukti pasca-apply (bukan sekadar `success: true`)

| Yang diperiksa | Hasil |
|---|---|
| Tabel `public` | 53 → **54** |
| `notif_events` | 15 → **17** |
| Edge masuk `[Deleted]` ber-`require_lead` | **4/4** |
| Edge **keluar** dari `[Deleted]` | **0** — hapus final, bukan toggle |
| `sm_terminal_states` `lead_record` `[Deleted]` | ada |
| Indeks `lead_delete_requests` | **5** (termasuk parsial `uq_ldr_one_pending`) |
| RLS | aktif, **1** policy SELECT |
| Grant | `anon` SELECT **false** · `authenticated` SELECT **true**, INSERT **false** |
| `schema_migrations` | 39 → **40** |

**Advisor keamanan dijalankan sesudahnya:** nol lint baru. `lead_delete_requests` **tidak**
muncul di `rls_enabled_no_policy` (ia punya policy). Sembilan INFO yang ada semuanya
pra-eksisting dan disengaja (tabel default-deny per `rls_baseline` §5), plus satu WARN
pra-eksisting `auth_leaked_password_protection`.

---

## 2. Penomoran versi migrasi diselaraskan 🟢

Menutup "catatan sisa" `CUTOVER_UAT_REPORT_20260728.md` §2 yang sengaja ditaruh **di luar
scope O38**: versi repo (`202601…`) tidak pernah cocok dengan riwayat remote (`202607…`),
sehingga `supabase db push` akan mencoba **meng-apply ulang 39 migrasi** di atas skema yang
sudah terisi.

**Arah: repo mengikuti live** — sama seperti O38 opsi (A). Alternatifnya (`migration repair`
menulis ulang 39 baris bookkeeping produksi) tidak dipilih: rename berkas bisa diuji lokal
dan nol-risiko, menulis ulang riwayat produksi tidak. Peta lengkap old→new ada di
**`docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §A.7**.

### 2.1 Yang membuat rename ini aman, dan cara membuktikannya lagi

- **Pemetaan 1:1 berdasarkan NAMA migrasi, bukan urutan.** 39/39 cocok, nol tebakan. Kalau
  dipetakan by-urutan, baris live-only `rls_harden_execute_surface` akan menggeser seluruh
  ekornya satu langkah — salah senyap yang tidak akan ketangkap test apa pun.
- **Urutan lexicographic lestari** — diverifikasi eksplisit (`sorted(new) == new` terhadap
  urutan lama). Ini bukan detail: CI menerapkan migrasi lewat `ls supabase/migrations/*.sql |
  sort`, jadi urutan berkas **adalah** urutan apply. Rename yang mengacak urutan akan
  meruntuhkan FK/dependency antar-migrasi.
- **Rebuild dari nol** setelah rename: 39/39 apply **bersih**, menghasilkan **54 tabel · 14
  machines · 17 event**, gate seed utuh (10 employees / 12 role_mappings), keempat invariant
  SQL **PASS**.

### 2.2 Referensi versi ikut diperbarui — dan yang sengaja TIDAK

**Diperbarui (54 referensi):** komentar di `packages/**`, `apps/api/**`, `supabase/tests/**`,
`.github/workflows/ci.yml`, `docs/SUPABASE_MIGRATION_TECH_APPENDIX.md`,
`docs/backlog/CUTOVER_BACKLOG.md`, referensi silang **antar-migrasi**, dan dua pointer path di
`WAVE1_STAGING_DEPLOY_RUNBOOK.md` (runbook itu masih akan dipakai, jadi path menggantung di
sana adalah jebakan nyata).

**TIDAK diperbarui, disengaja:** `docs/handoff/**` lainnya dan entri **lama**
`docs/DECISIONS.md`. Keduanya catatan bertanggal — menulis ulangnya berarti memalsukan riwayat.
§A.7 adalah tabel penerjemahnya, dan entri Decided baru menunjuk ke sana.

> **Efek samping yang perlu Anda tahu:** karena komentar silang antar-migrasi ikut diperbarui,
> berkas repo kini berbeda tipis dari blob `statements` yang tersimpan di remote untuk migrasi
> yang **sudah** ter-apply (termasuk `20260729162101` yang baru di-apply sesi ini dengan teks
> komentar lama). Nol dampak skema. Kalau nanti ada yang mendiff berkas repo vs
> `schema_migrations.statements` untuk membuktikan paritas, **diff komentar itu diharapkan** —
> bandingkan DDL-nya, bukan byte-nya.

### 2.3 Baris live-only DITUTUP — riwayat repo kini 1:1 dengan live (40 = 40)

Semula ini sisa terakhir: live 40 baris riwayat, repo 39 berkas. Ditutup dengan **back-port
riwayat** `20260723064826_rls_harden_execute_surface`, statements diambil **verbatim** dari
`schema_migrations.statements` live (satu suntingan: referensi versi di komentarnya).

**O38 butir 3 dipersempit, bukan dibalik.** Alasannya (isinya sudah termuat `rls_baseline` §9)
tetap berlaku untuk *isi*, tapi tidak menjawab *penomoran* — yang O38 sendiri catat di luar
scope-nya. Header berkasnya menyatakan gamblang bahwa ia back-port riwayat, bukan perubahan
skema.

Arah alternatif `supabase migration repair --status reverted` **ditolak**: ia menulis ke
bookkeeping produksi dan **menghapus jejak** bahwa hardening itu pernah jalan — bertentangan
dengan aturan rumah #3, demi keuntungan nol. Back-port berkas tidak menyentuh produksi.

**Dibuktikan no-op, bukan diasumsikan.** DB dibangun dari nol dua kali (39 lalu 40 berkas),
empat snapshot dibandingkan: ACL + `proconfig` seluruh fungsi `public`+`private`, 536 kolom,
49 policy termasuk ekspresi `qual`/`with_check`, ACL 54 tabel — **identik byte-per-byte.**
Wajar: semua statements-nya REVOKE/GRANT/`ALTER FUNCTION … SET search_path`, penetapan keadaan
akhir, bukan delta.

> ⚠️ **Posisi versinya tidak boleh digeser.** `20260723064826` harus jalan SESUDAH
> `20260723064438_rls_baseline` (yang membuat `public.jwt_owns_*`) dan SEBELUM
> `20260727072443` (yang memindahkannya ke `private`). Dinomori ulang ke belakang migrasi itu,
> ia **gagal** — `public.jwt_owns_lead(text)` sudah tidak ada di sana.

### 2.4 DB lokal: `scripts/db-rebuild.sh` — satu perintah, bukan paragraf

Riwayat migrasi lokal siapa pun masih memuat versi lama, jadi berkas yang di-rename terlihat
"belum pernah di-apply". **Apply selektif tidak bisa menambalnya**: nama berkas berubah, isi
skemanya tidak, jadi migrasi yang "hilang" gagal dengan *already exists* alih-alih mengisi
kekurangan. Satu-satunya jalur benar adalah bangun ulang — dan itu kini berskrip:

```bash
scripts/db-rebuild.sh              # dry-run: laporkan rencana, nol tulis
scripts/db-rebuild.sh --yes        # drop → 40 migrasi → seed 2× → 7 gate → 4 invariant
npm run db:rebuild -- --yes
```

Mencerminkan job `db-and-migrations` CI (CI tetap otoritasnya). Dua mode koneksi
(`DATABASE_URL`, atau `su postgres` untuk pola sandbox SESI9 §7 — termasuk papercut staging
`chmod 644` yang selama ini manual). Dua pengaman, karena skrip ini **menghapus basis data**:
ia menyebut riwayat basi `202601…` **sebelum** drop, dan **menolak jalan** bila `DB_NAME`
eksplisit tidak cocok dengan basis di `DATABASE_URL` (satu env var basi cukup untuk menghapus
basis yang salah). Keduanya diuji: mode `su` dan mode URL jalan penuh, guard mismatch memang
menolak.

### 2.5 Temuan sampingan yang layak Anda tahu — O45 (dampak NOL, tapi mengoreksi satu klaim)

Saat memverifikasi back-port, `service_role` ternyata punya EXECUTE pada `private.jwt_owns_*`
di live tapi tidak di build lokal — padahal SQL-nya identik. Bukan drift: `pg_default_acl`
live memberi EXECUTE ke **`anon, authenticated, service_role`** untuk setiap fungsi baru di
`public`, jadi fungsi **lahir** dengan grant itu dan hanya hilang bila migrasi eksplisit
me-REVOKE. Postgres bare tidak punya default itu.

Konsekuensinya bukan soal satu grant, tapi soal cakupan gate: **`rls_checks.sql` tidak akan
pernah gagal karena REVOKE yang lupa ditulis.** CI bisa hijau sementara produksi terbuka.
Dampak terukur hari ini **nol** — 11 fungsi `public` bisa dipanggil `anon` dan **nol** di
antaranya `SECURITY DEFINER`, jadi RLS tetap berlaku; advisor juga bersih. Dicatat sebagai
**O45** (Open) karena yang perlu diputuskan adalah cakupan gate, bukan tambalan. Yang jangan
dilakukan: memakai invariant lokal hijau sebagai bukti permukaan EXECUTE produksi aman.

---

## 3. Angka acuan (2026-07-29, Postgres 16 lokal, DB dimigrasi ulang dari nol pasca-rename)

`@cdps/domain` **513** (+1 skip) · `apps/api` **211** · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · keempat invariant SQL (`ident`·`immutability`·`rls`·`auth_claims`)
**PASS** · gate seed (10 employees / 12 role_mappings / 14 machines / **17** event) **PASS** ·
**40** berkas migrasi → **54** tabel · typecheck bersih di semua workspace + `web-internal` ·
eslint `web-internal` bersih.

> **Identik SESI11 di setiap angka.** Itu memang intinya: sesi ini nol perubahan perilaku —
> satu apply ke live dan satu rename massal, dan angka yang tidak bergerak adalah buktinya.
> Repo **40 berkas** = live **40 baris riwayat** — §2.3 menutup selisih yang tadinya ada.

## 4. Yang BELUM — untuk sesi berikutnya

Daftar SESI11 §3 dikurangi yang sudah ditutup:

1. ~~Keputusan §0.2 (pindahkan `4jbfpy` atau PR baru)~~ ✅ **tidak relevan lagi** — PR #72 merged.
2. ~~Body PR #72 perlu bagian C~~ ✅ **tidak relevan lagi** — PR sudah tertutup lewat merge.
3. ~~Migrasi `20260102000012` belum di-apply~~ ✅ **selesai** — §1.
4. **C-03 tetap menunggu pemilik** — tidak berubah sejak SESI10 §1. Jalankan
   `docs/handoff/CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari mesin ber-akses; jangan susun ulang.
5. **O34 · O26 · O35** masih memblokir DoD C-04 ("nol fixture") — SESI10 §4.
6. **OQ-2:** sebelum Railway dimatikan tetap perlu `SELECT count(*)` per tabel (minimal
   `leads`, `clients`, `transactions`). **Tidak berubah** sesi ini — masih inferensi dari apa
   yang tidak disebut, bukan konfirmasi. Lihat SESI10 §3.
7. **Opsional (butuh backend):** field `pending_delete_request` di `LeadRow` untuk menutup
   celah UX SESI11 §1.3.

## 5. Yang TIDAK disentuh

Nol perubahan **isi** SQL — rename berkas dan komentar saja; nol perubahan pada
`packages/*/src/**` selain komentar; nol perubahan logika di `apps/api/src/**`. Kedua gate
angka hardcoded CI (**17** event, **54** tabel) **tetap benar** dan sudah diverifikasi ulang
terhadap DB yang dibangun dari berkas ber-nama baru — tidak perlu disetel.
