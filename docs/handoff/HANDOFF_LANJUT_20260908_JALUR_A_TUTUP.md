# Handoff — Jalur A TUTUP, Feedback OD tinggal Store Ops. Titik lanjut chat berikutnya.

> **Ditulis 2026-09-08, sesudah PR #316 di-merge.** Ini titik mulai. Baca §1 dan
> §2 sampai habis sebelum menyentuh apa pun — §2 berisi satu kesalahan yang
> sudah dibayar mahal dan tidak boleh terulang.

---

## 1. Posisi — persisnya

| Apa | Nilai |
|---|---|
| **`main`** | `5257b4ca` — *Merge PR #316: pensiunkan STR- (STRG- kanonik) + A-req-1/2/3* |
| Migrasi di pohon | **202** |
| Gate | **146** tabel · **40** entity_prefix · **31** sm_machines · **73** notif_events |
| Live (`CDPS SG`, `egddxfcnrtecheiykhlf`) | mutakhir **kecuali** `20260922100400` — lihat §4 |
| PR yang sudah selesai | [#310](https://github.com/MEAgrup/AgencyAPP/pull/310) · [#312](https://github.com/MEAgrup/AgencyAPP/pull/312) · [#315](https://github.com/MEAgrup/AgencyAPP/pull/315) · [#316](https://github.com/MEAgrup/AgencyAPP/pull/316) |

```bash
cd /home/user/AgencyAPP
git fetch origin && git checkout main && git reset --hard origin/main

service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # 202 migrasi, semua gate hijau

npm install
npm run typecheck --workspaces --if-present   # BACA keluarannya
(cd web-internal && npm install)
```

---

## 2. ⛔ SATU KESALAHAN YANG SUDAH DIBAYAR MAHAL — jangan ulangi

A-3 mendarat di PR #315 di atas premis **salah**: gw baca
`SHOW_LEGACY_STR_PATH = false` di `account/services/[id]/page.tsx` lalu
menyimpulkan jalur `STR-` mati. Flag itu **hanya** menyembunyikan form **BUAT**
di satu halaman. Pintu **APPROVE**-nya hidup penuh di:

- `nav.ts:153` → `/persetujuan`, menu **AKTIF** untuk Sales/Account/Finance/KOL
- seksi "Review Strategi & Plan" di halaman itu, confirm-nya **mengiklankan**
  "Service lanjut ke `[Strategy Approved]` dan Brief boleh dibuat"
- tombol kedua di `/account/strategies/[id]`
- `POST /api/v1/strategies/[id]/approve`

Jadi selama sehari ada **dua penulis hidup** ke `services.status`. Terukur:
STRG- disetujui lebih dulu ⇒ persetujuan STR- untuk Service yang sama gagal
`[transisi status tidak diizinkan]` **dan ter-rollback penuh**, SPV terkunci
permanen. Nol instance di produksi, jadi laten. Ditemukan Jalur B.

> ### Aturan yang lahir dari itu
> **Flag `false` cuma membuktikan SATU pintu tertutup.** Sebelum menyimpulkan
> sebuah jalur mati: **grep route DAN nav**, bukan satu halaman. Ditulis juga di
> header `packages/domain/src/strategi.ts`.

Sudah dibetulkan di #316 (ketokan pemilik: **`STRG-` kanonik**, STR- dipensiunkan
sungguhan). **Jangan bangunkan lagi jalur tulis `STR-`** — lima route-nya 410,
alasannya di `apps/api/src/lib/retired-str.ts`.

---

## 3. Jawaban atas "apa Jalur A sudah selesai semua?"

**Jalur A: SELESAI, lima-limanya.** Feedback OD sebagai satu blok: **sembilan
dari sepuluh keluhan tertutup**; yang tersisa satu — Store Ops — dan itu memang
dari awal diketok sebagai **wave terpisah** (K-4, K-7).

| Keluhan | Item | Status | Diverifikasi ke |
|---|---|---|---|
| Finance #1 | A-1 | ✅ | `finance.ts` menyebut `toko` |
| Finance #2 + KOL | A-2 | ✅ | migrasi lengan Finance `creator_payment_requests_select` |
| Account #1 (K-2) | A-4 | ✅ | `sales.close` mencetak baris `contracts` |
| Account #2 (K-1, sisi AM) | A-5 | ✅ | `MSG_PIC_BUKAN_WEWENANG_AM` |
| Account #5 | A-3 | ✅ | `approveStrategi` → `driveServicesToStrategyApproved` |
| Account #3 & #4 | B-1 | ✅ | `task.ts:1101` emit `BriefSiapReviewAm`/`BriefSelesai` |
| Creative #3 | B-2 | ✅ | `private.brief_client_toko` di `briefCols` |
| Creative #2 (K-1, sisi leader) | B-4 | ✅ | edge `brief_task [Submitted]→[Revision Requested]` |
| Ads (K-3) | B-5 + **A-req-2** | ✅ | `private.brief_source_creative_id` + sisi tulis |
| KOL #1 | B-3 + **A-req-1** | ✅ | `kol_reminder_tick` + kolom jendela/budget |
| **Store Ops (K-4/K-5/K-6)** | **Wave 3** | ❌ **BELUM** | nol PRD, satu baris registry |

Plus tiga A-req yang diminta Jalur B — semuanya selesai di #316.

---

## 4. ⚠️ Satu migrasi sengaja BELUM di-apply ke live

`20260922100400_a3_backfill_service_strategy_approved.sql` — satu-satunya yang
mengubah **DATA**, bukan skema. Di live ia **no-op** (0 baris memenuhi
kriterianya, diverifikasi). Aman di-apply kapan pun, dan aman **tidak**
di-apply. Pemeriksanya:

```sql
select count(*) from services sv
  left join service_plan_gate g on g.service_id = sv.id
 where sv.status = '[Awaiting Onboarding]'
   and exists (select 1 from strategi s
                where s.contract_id = sv.contract_id and s.status = 'Aktif')
   and case when sv.requires_strategy_plan_override is not null
                 then sv.requires_strategy_plan_override
            when g.keputusan_am is not null then g.keputusan_am = 'butuh_plan'
            else sv.plan_tier = 'plan_wajib' end;
-- 0 hari ini. Kalau > 0, backfill-nya baru ada gunanya.
```

**Aturan live yang berlaku:** hanya lewat `apply_migration`, **per berkas**,
urut nama. **JANGAN `supabase db push`** — ledger live memakai stempel waktu
APPLY, bukan nama berkas repo (O65), jadi push membandingkan dua hal yang
memang berbeda wholesale.

---

## 5. Pilihan pekerjaan berikutnya — tiga, dengan untung-ruginya

### (a) Wave 3 — modul Store Operation ⟵ rekomendasi gw
Satu-satunya keluhan divisi yang belum dijawab, dan K-7 memang menaruhnya
terakhir ("bug dulu → alur → Store Ops"). Sekarang bug dan alur sudah selesai,
jadi urutannya sampai di sini.

Hari ini Store Ops adalah **satu baris registry**
(`packages/core/src/division.ts:83`) — nol PRD, nol domain, nol rute, nol
halaman. Sepuluh butirnya di `PARALEL_FEEDBACK_OD_DUA_AKUN.md` §3; ringkasnya:
PRD → prefix SKU baru → tabel anak `briefs` (1 Brief → n SKU, K-5) → mesin
status + rollup → pipeline `STORE_OPS` (menutup LT-2) → pasang
`StageTimelinePanel` di `/tasks/[id]` → halaman `store-ops/` → rapikan dua
katalog yang bertengkar → bobot KPI → **naikkan gate di `db-rebuild.sh` DAN
`ci.yml`**.

- **Untung:** menutup Feedback OD sepenuhnya; sebagian besar berkas baru ⇒
  konflik rendah; butir 6 memperbaiki gerbang intake untuk **semua** divisi
  tanpa halaman sendiri, bukan cuma Store Ops.
- **Rugi:** satu-satunya pekerjaan yang **menaikkan gate** tabel/prefix/mesin,
  jadi ia menyentuh `db-rebuild.sh` + `ci.yml` (berkas counter yang paling
  mudah bertabrakan). Paling besar dari tiga pilihan ini.
- **Butuh ketokan dulu:** K-6 sudah menetapkan CTR/CVR terpisah dari "selesai",
  tapi **daftar jenis SKU dan siapa yang mengisi target** belum. Tanyakan
  sebelum menulis PRD-nya, jangan ditebak.

### (b) Bayar utang 8 layar yang belum pernah dilihat mata
Nol harness peramban di repo; Chromium sudah ada di `/opt/pw-browsers/chromium`
dan `PLAYWRIGHT_BROWSERS_PATH` sudah di-set, jadi yang kurang **harness + jalur
login**.

| Layar | Yang perlu dilihat |
|---|---|
| `/finance` | nama toko baris pertama + `CLI-…` baris kedua |
| `/finance` | panel "Permintaan ke Finance" — 8 kolom, tanpa scroll horizontal |
| `/finance/transactions/{id}` | header `Klien: Nama Toko (CLI-…)` |
| `/persetujuan` | kartu "Permintaan ke Finance" — **dan** seksi Strategi yang sekarang HILANG |
| `/kol/payment-requests/{id}` | tombol "Ajukan ke Finance" |
| `/account/services/{id}` | catatan pengganti field PIC + jendela kontrak read-only + kartu `CTR-` |
| `/sales/{id}` | field durasi + kotak alasan yang muncul bersyarat (A-4) |
| `/account/strategies/{id}` | pemberitahuan pensiun baca-saja (#316) |
| `/tasks` | kolom "Unit Kerja" + badge "belum dipecah" (A-req-3) |

- **Untung:** setiap perubahan render sejak Gelombang C lolos `tsc` + `vitest` +
  `next build` **tanpa satu mata pun melihat tata letaknya**. Harness-nya sekali
  bangun, dipakai selamanya.
- **Rugi:** nol fitur baru. Dan menegakkan auth + API + dev server itu pekerjaan
  tersendiri, bukan tempelan.

### (c) ~~Satukan empat bentuk `Brief` paralel di FE~~ — SUDAH DIKERJAKAN (PR #320)

> **SELESAI 2026-09-08 oleh sesi lain.** Rumahnya sekarang
> `web-internal/src/lib/brief.ts` (satu deklarasi, keempat berkas lama
> me-re-export), dengan gerbang anti-kambuh di `shape-parity.test.ts` yang merah
> kalau ada deklarasi `Brief` kedua di `src/lib/`. `apps/api` 445 → 446.
> Aturan barunya: field Brief baru ditambahkan di `brief.ts`, **sekali**.
> Uraian di bawah ditahan sebagai catatan kenapa utang itu ada.
`lib/account.ts`, `lib/tasks.ts`, `lib/creative.ts`, `lib/kol.ts` — dan **hanya
`account.ts::Brief` yang diikat `shape-parity.test.ts`** ke `BriefWire`.
Keempatnya disuapi wire yang **sama**.

- **Untung:** menutup kelas cacat yang aktif. Field Brief baru hari ini harus
  ditambahkan di dua tempat minimal, atau halaman yang membaca bentuk
  tak-ber-anchor melihat `undefined` **sementara parity tetap hijau**. #316
  mengisi `account.ts` + `tasks.ts`; `creative.ts`/`kol.ts` **belum**.
- **Rugi:** refactor lintas empat berkas yang dipakai banyak halaman; nol
  perubahan yang terlihat pengguna.

**Rekomendasi: (a) Store Ops**, karena ia satu-satunya yang masih dinanti sebuah
divisi, dan K-7 sudah menaruhnya di posisi ini. Tapi **tanyakan ketokan jenis
SKU + pemilik target dulu** — menulis PRD di atas tebakan adalah cara termahal
memulainya. (c) layak diselipkan kapan saja; ia kecil dan mencegah cacat
berikutnya.

---

## 6. Masih menunggu ketokan pemilik

Keduanya **tidak** memblokir apa pun di §5.

- **O75 — Service tidak punya satu pun jalur untuk SELESAI.** Edge
  `[In Execution] → Done` ada di `sm_edges` tapi **nol pemanggil** di seluruh
  `packages/domain`. Setiap Service yang pekerjaannya tuntas menumpuk selamanya.
  Yang perlu diketok: **siapa** yang boleh menutup Service, dan **apa
  gerbangnya** (kontrak habis? seluruh Brief selesai? Finance lunas?).
- **O76 — dari mana floor GMV bulanan datang.** A-4 menutup separuh O57(b)
  (durasi, dari katalog, ditetapkan Sales saat closing) tapi **tidak** menutup
  floor GMV: katalog nol angka GMV dan `contracts` nol kolom GMV, jadi
  `strategi_target.sumber_floor = 'kontrak'` menunjuk sesuatu yang belum ada —
  dan selama itu benar, **Sanggahan Target (D-7) kehilangan penegaknya**: AM
  menyanggah angka yang AM sendiri ketik.

---

## 7. Jebakan yang sudah terbukti mahal — baca sebelum mulai

1. **Flag `false` ≠ jalur mati.** §2. Yang paling mahal.
2. **`noUnusedLocals` MATI di `web-internal`.** `tsc` hijau **tidak** berarti nol
   handler mati. Sesudah mencabut JSX, grep handler + state-nya sendiri.
3. **`SECTION_LABELS` di `/persetujuan` dipetakan POSISI-PER-POSISI** ke array
   `Promise.allSettled`. Mencabut satu antrian = cabut dari **keduanya**, posisi
   yang sama; kalau tidak, galat satu antrian dilabeli nama antrian lain.
4. **Subquery yang diblokir/dipersempit RLS tidak melempar** — ia diam-diam
   `NULL` atau angka yang salah. Lebih buruk dari 404 O52: halaman menjawab 200
   dengan nilai salah. Jawabannya pintu `private.*` SECURITY DEFINER (O52 opsi
   (b), diketok 2026-08-07), **bukan** melebarkan policy.
5. **Backtick di komentar SQL yang ada di template literal MEMUTUS template-nya.**
   Penjelasan SQL taruh di JSDoc, jangan di dalam string-nya.
6. **Tes yang menyeed tabel anak akan merusak SETIAP tes sesudahnya** di berkas
   yang cleanup-nya belum tahu (FK NO ACTION). Sudah kena dua kali sesi ini
   (`briefs` di `strategi.test.ts`, `assets` di `account.test.ts`).
7. **A-T4**: jalan kedua suite domain atas DB yang sama memberi FAIL palsu
   (`admin.test.ts` "hari libur", `client.test.ts` "Hold Service") — `audit_log`
   menolak DELETE jadi `afterEach` tidak bisa membersihkannya. **`db-rebuild`
   dulu, baru cari bug.** Polanya sudah ada di repo (`aktorUnik()` di
   `showcase.test.ts`).
8. **Postgres di container ini butuh password di-set sekali**, dan ia **mati
   sendiri** sewaktu-waktu. `pg_isready` dulu sebelum menyimpulkan apa pun dari
   puluhan FAIL.
9. **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`.**

---

## 8. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  202 migrasi
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 73 notif_events
        + notif_katalog_sesuai
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            2101 lulus (+1 skip) · 76 file · nol FAIL
core               983
db                  53
apps/api           445 lulus (+48 skip)   route-parity & shape-parity hijau
web-internal       684   (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

`KNOWN_GAPS` di `route-parity.test.ts` **wajib tetap kosong** — menambah satu
baris berarti mengakui satu halaman tidak berfungsi, dan itu butuh entri
`DECISIONS.md`.
