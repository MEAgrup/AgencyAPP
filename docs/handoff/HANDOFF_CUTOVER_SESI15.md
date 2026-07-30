# HANDOFF — Cutover Sesi 15

> **Pendahulu:** `HANDOFF_CUTOVER_SESI13.md` (yang ada di `main`). **SESI14 belum ter-merge** —
> ia hidup di PR #76 (draft). Sesi ini **tidak** menyentuh apa pun yang dikerjakan #76.
> Yang masih berlaku dan tidak diulang: SESI9 §0.2 (batas sandbox) dan §7 (cara menjalankan
> test DB-backed — tapi lihat §4, sekarang ada `npm run db:rebuild`).

## 0. Posisi persis

| | |
|---|---|
| **Branch** | `claude/cdps-sg-cutover-migrasi-azzlwr` |
| **HEAD** | 1 commit di atas `main@a37e432` |
| **PR** | **#77** → `main` |
| **Perubahan** | **komentar + dokumentasi saja. Nol DDL, nol logika, nol migrasi baru.** |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** — tidak disentuh sesi ini |

---

## 1. ⚠️ Baca ini dulu: kedua task yang ditugaskan SUDAH selesai sebelum sesi ini

Sesi ini ditugaskan dua hal:

1. Apply migrasi `20260102000012` ke `CDPS SG` lewat `apply_migration`.
2. Selaraskan penomoran versi migrasi repo (`202601…`) vs remote (`202607…`).

**Keduanya sudah dikerjakan dan ter-merge lewat PR #75** (`a37e432`), oleh sesi yang berjalan
**paralel** dengan sesi ini:

- `38fed0c` — apply migrasi + rename 39 berkas
- `628bb4b` — back-port baris riwayat live-only + `scripts/db-rebuild.sh`

Sesi ini memulai di atas `main@7bbd5e1` yang **sudah basi saat itu** dan mengerjakan ulang
keduanya dari nol sebelum menyadarinya. Pekerjaan duplikat itu **dibuang** (di-`stash`, tidak
di-push) dan branch di-fast-forward ke `main`. Yang tersisa di PR ini hanyalah **satu temuan
nyata** yang tidak ada di `main` — §2.

### 1.1 Dua pelajaran operasional yang mahal

**(a) `git fetch` di awal sesi tidak cukup.** Fetch sesi ini mengembalikan
`3d3896a..7bbd5e1`, dan itu **benar pada saat itu** — `main` maju ke `a37e432` beberapa menit
kemudian. Yang menyingkap kekeliruan bukan git, tapi **daftar PR terbuka**: PR #76 berbasis
`main@a37e432`, sebuah hash yang belum pernah saya lihat. **Sebelum mengerjakan task dari
handoff, cek `list_pull_requests` — bukan hanya `git log`.** Handoff bertanggal menggambarkan
kondisi saat ditulis; PR terbuka menggambarkan kondisi *sekarang*.

**(b) Error `42P07 relation already exists` dari `apply_migration` sesi ini NYATA, bukan
artefak.** Urutannya: cek prasyarat pukul ~16:1x membaca live **39/53/15** dan
`lead_delete_requests` **belum ada** (benar saat itu) → sesi paralel meng-apply pukul
**16:21:01** → `apply_migration` sesi ini menabraknya dan gagal. Diagnosis pertama saya
("retry di atas transaksi yang sudah commit") **salah**, dan sempat masuk draf DECISIONS
sebelum dibuang. Versi `20260729162101` adalah milik apply sesi paralel, **bukan** milik sesi
ini. **Jangan tulis "42P07 itu benign" ke dokumen mana pun** — di sini ia menandakan penulis
kedua, yaitu justru hal yang paling perlu diketahui.

---

## 2. Yang PR ini benar-benar berisi: dua rujukan versi menunjuk migrasi yang salah

Penyelarasan `202601…` → `202607…` memperbarui 54 rujukan versi di komentar lewat
**substitusi nomor**. Untuk 52 rujukan itu benar. **Dua** tidak, karena ditulis **sebelum
O38** — dan O38 sendiri sudah pernah menomori ulang C-01 dari `…0005` ke `…0009`:

| | pra-O38 | pasca-O38 |
|---|---|---|
| `…0005` | **C-01 `rls_leads_campaign_scope`** | `fk_covering_indexes` |
| `…0009` | (belum dipakai) | `rls_leads_campaign_scope` |

Jadi `…0005` di komentar pra-O38 harus jadi **`20260729031525`**, bukan `20260724132631`.

| Berkas | Sebelum | Sesudah |
|---|---|---|
| `packages/domain/src/leads.ts` | `20260724132631 adds the own-campaign-origin arm…` | `20260729031525 …` |
| `supabase/tests/rls_checks.sql` check 13 | `the arm added by 20260724132631` | `…by 20260729031525` |

**Bukti, bukan tafsiran:**
- `20260729031525` **baris 22** menyatakan sendiri *"Versi pertama migrasi ini (dulu bernomor
  …0005) membuat `jwt_owns_lead_campaign`"*; **baris 44** membuatnya; **baris 66** memasang
  arm-nya ke `leads_select`.
- `20260724132631_fk_covering_indexes` berisi **3 `CREATE INDEX`, nol policy, nol rujukan
  `jwt_owns_lead_campaign`**.

**Kenapa ini layak satu PR meski cuma dua baris komentar.** Kedua komentar itu ada persis
untuk mencegah orang mereimplementasi gate RLS di TypeScript (aturan rumah: kedua sisi tidak
boleh berbeda). Menunjuk migrasi yang salah merusak tepat pekerjaan itu: pembaca yang
memverifikasi klaim `rls_checks` check 13 akan membuka `fk_covering_indexes`, tidak menemukan
policy apa pun, lalu menyimpulkan **test-nya** yang salah.

### 2.1 Rentang risiko sudah diaudit habis, bukan disampel

Hanya rujukan pra-O38 ke `0005`–`0008` yang bisa salah (di luar rentang itu O38 tidak
menomori ulang apa pun). Keenam rujukan tersisa ke keempat versi tersebut diperiksa satu per
satu dan **semuanya benar** — dua "lihat catatan di `20260724132631`" memang menunjuk header
back-port O38 di `fk_covering_indexes`, dan empat rujukan `20260727072443` memang menunjuk
migrasi yang memindahkan `jwt_owns_*` ke `private`.

### 2.2 Pencegahan, supaya tidak terulang

`docs/SUPABASE_MIGRATION_TECH_APPENDIX.md` §A.7 kini memuat peringatan tepat di bawah tabel
penerjemahnya: **tabel itu memetakan berkas dan JANGAN dipakai untuk komentar pra-O38.**
Aturannya dinyatakan positif juga — **petakan per makna, bukan per nomor**: buka migrasi
tujuan, pastikan ia benar-benar membuat hal yang dibicarakan komentar itu.

---

## 3. Verifikasi (dijalankan di atas `main@a37e432` + perubahan ini)

DB dibangun **ulang dari nol**, 40/40 migrasi apply bersih:

- **54 tabel · 17 event · 14 machine**, seed di-apply **dua kali** (idempoten): 10 employees ·
  12 role_mappings · 3 master_services · 1 demo_task
- Keempat invariant SQL **PASS**: `ident_checks` · `immutability_checks` · `rls_checks` ·
  `auth_claims_checks`
- `@cdps/domain` **552** · `apps/api` **211** · `@cdps/core` **113** · `@cdps/db` **9**
- `typecheck` bersih di semua workspace

Live `CDPS SG` juga diverifikasi langsung sesi ini (**sesudah** apply sesi paralel):
40 migrasi · 54 tabel · 17 event · 4 edge masuk `[Deleted]` semuanya `require_lead=true` ·
nol edge keluar · `[Deleted]` terdaftar terminal · 5 indeks (termasuk parsial
`uq_ldr_one_pending`) · RLS aktif + 1 policy SELECT · `lead_delete_requests` 0 baris.

**Riwayat repo == riwayat remote, 40 == 40, cocok 1:1** (dibandingkan berkas-per-baris).
⇒ `supabase db push` ke `CDPS SG` melihat **nol** migrasi tertunda. Task 2 memang tertutup.

> **Catatan metode yang berguna untuk sesi berikutnya.** Sebelum menyadari pekerjaan itu
> duplikat, sesi ini membangun dua DB dari nol (39 berkas lalu 40) dan membandingkan sidik-jari
> skema **1157 baris** — 536 kolom · 127 indeks · 113 constraint · 45 policy · 45 grant ·
> 29 fungsi + ACL/`proconfig` · 24 trigger · 54 flag RLS · 98 `sm_edges` · 21 terminal ·
> 17 event · 14 machine — dan hasilnya **identik byte-per-byte**. Itu konfirmasi independen
> bahwa rename + back-port `rls_harden_execute_surface` di `main` memang no-op, dicapai lewat
> jalur berbeda dari yang dipakai PR #75. Kalau perlu diulang, polanya ada di §4.

## 4. Cara membangun ulang DB lokal (sudah ada perintahnya — jangan copy-paste blok lagi)

`npm run db:rebuild` (dari PR #75, `scripts/db-rebuild.sh`) — default **dry-run**, `--yes`
baru menulis; ia drop → apply semua migrasi urut → seed dua kali → 7 gate → 4 invariant SQL.
Blok manual SESI9 §7 masih jalan, tapi skrip ini yang otoritatif.

⚠️ **DB lokal apa pun yang dibangun sebelum rename penomoran sudah bukan cerminan repo, dan
apply selektif TIDAK bisa menambalnya** — nama berkas berubah sementara isi skemanya tidak,
jadi migrasi yang terlihat "hilang" gagal dengan *already exists*. Bangun ulang dari nol.

## 5. Yang TIDAK disentuh sesi ini

Nol perubahan pada `supabase/migrations/**` (isi maupun nama), `apps/api/src/**`,
`packages/**` selain satu baris komentar di `leads.ts`, `.github/workflows/ci.yml`, dan
`CLAUDE.md`. **Live `CDPS SG` tidak ditulis sesi ini.** Pekerjaan PR #76 (Go ditinggalkan
resmi, O43 Fase 2, O47) tidak disentuh dan tidak bertabrakan.

## 6. Yang masih terbuka (tidak berubah sesi ini)

Sesi ini **tidak** memindahkan status satu pun butir di bawah — didaftar supaya handoff ini
bisa dibaca sendiri, bukan sebagai klaim kemajuan.

1. **PR #76 (draft) menunggu review** — di dalamnya **O47** butuh keputusan pemilik (port atau
   tinggalkan `cmd/import`; memblokir C-05, bukan cutover).
2. **PR #73 & #74 masih terbuka** (#74 draft, dengan 5 butir "belum dikerjakan" di body-nya).
3. **C-03 menunggu pemilik** — jalankan `docs/handoff/CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari
   mesin ber-akses; jangan susun ulang.
4. **O34 · O26 · O35** masih memblokir DoD C-04 ("nol fixture").
5. **O46** (3 arm visibility RLS lebih sempit dari Go) · **O45** (cakupan gate
   `rls_checks.sql`) · retensi **PII** di `supabase/seed/import_samples/`.
6. **OQ-2:** sebelum Railway dimatikan tetap perlu `SELECT count(*)` per tabel (minimal
   `leads`, `clients`, `transactions`). Status **tidak bergerak** — ia inferensi dari apa yang
   tidak disebut, bukan konfirmasi.
7. **Celah UX SESI11 §1.3** (`pending_delete_request` di `LeadRow`) — butuh backend, opsional.
8. `apps/api` **tidak punya eslint config** ⇒ ~250 berkas TS tidak pernah di-lint
   (pre-existing, dicatat PR #76).
