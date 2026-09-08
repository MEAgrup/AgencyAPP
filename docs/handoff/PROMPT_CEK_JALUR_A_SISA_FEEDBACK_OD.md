# Prompt untuk sesi AKUN A — cek sisa kebutuhan Feedback OD

> Tempel isi blok di bawah apa adanya ke sesi Akun A (branch
> `claude/cdps-user-feedback-account-a-igix3n`).
>
> Dibuat oleh sesi Jalur B, 2026-09-07, sesudah PR #312 dibuka.
> Konteks lengkapnya: `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md`.

---

Kamu AKUN A (Jalur A) pada perbaikan "Feedback Final - OD"
(`docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md`). Jalur B sudah selesai dan
membuka **PR #312** (`claude/cdps-user-feedback-70vbho-b` → `main`, sudah
disejajarkan dengan `main` sesudah PR #310/#311 kamu merge DAN sesudah PR #309
Gelombang D merge).

Baca dulu, jangan dilewati:
1. `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md` — SELURUHNYA. Di situ ada
   `A-req-1..3` dan satu bekas bloker yang sudah Jalur B tambal sendiri.
2. `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_A.md` — punyamu sendiri, untuk
   memastikan yang kamu catat "belum" masih akurat.

## Tugas 1 — jawab enam pertanyaan ini dengan BUKTI, bukan ingatan

Jawab satu-satu, sebutkan berkas + baris atau keluaran perintah:

1. **A-3** (Status CRO mentok `[Awaiting Onboarding]` — jahitan STRG- ke gerbang
   Brief). Sudah? Kalau sudah, mana **tes jahitannya** — satu tes yang memanggil
   KEDUA sisi sungguhan (setujui STRG- → buat Brief → tidak 409)? §6 rencana
   minta itu eksplisit, karena dua tes unit di kedua sisi bisa hijau sementara
   jahitannya putus.
2. **A-4** (Durasi kerja sama pindah dari CRO ke closing Sales, ketokan K-2).
   Sudah? Kalau sudah: apakah `tanggal_akhir` lewat `tz.addMonthsToDate`
   (kalender-aware, clamp akhir bulan) dan **bukan** `+30 hari`? Apakah override
   menang dan alasannya WAJIB? Mulai tanggal 31 diuji?
3. **A-req-1** — `BriefInput` + `insertBrief` menerima
   `tanggalMulai`/`tanggalAkhir`/`budget`, dan `Brief` + `briefToWire`
   memproyeksikannya. **Ini yang mengunci sisa B-3.** Kolomnya sudah ada dari
   F-4; yang belum ada jalur tulis dan baca TS-nya.
   ⚠️ `brief-inherit.planRowToBriefInput` (berkas Jalur B) SUDAH siap
   mengisinya — hari ini budget cuma "nyangkut" sebagai teks di dalam
   `instructions`. Jangan sentuh berkas itu; cukup buka `BriefInput`-nya.
4. **A-req-2** — `account.createBrief` mengisi `briefs.source_creative_brief_id`
   saat AM membuat Brief **Ads**, plus pickernya di form Brief AM.
   **Ini yang mengunci sisa B-5.** Sisi BACA-nya sudah jalan penuh di PR #312
   (`ads.Campaign.sourceCreativeBriefId` → `AssetPicker`), jadi begitu kolomnya
   terisi, filter K-3 langsung hidup tanpa perubahan di Jalur B.
5. **A-req-3** — satu field jumlah anak (mis. `created_count`) pada baris
   antrean divisi (`account.listDivisionQueue` + `wire.ts`). **Ini yang mengunci
   sisa B-1a**: progres "n dari N" di ANTREAN. Halaman Brief-nya sudah dapat
   panelnya di PR #312; memanggil `GET /briefs/{id}/rollup` per baris antrean
   adalah N+1, jadi butuh satu field, bukan satu rute baru.
6. **Utang UAT mata manusia A-1** yang kamu catat sendiri di handoff-mu — sudah
   dibayar atau belum?

## Tugas 2 — dua hal yang HARUS kamu ketahui dari Jalur B

**(a) `briefs_select` sudah ditambal oleh Jalur B, di PR #312. Jangan tambal
lagi.**

Jalur B sempat menulisnya sebagai "BLOKER A-5" di handoff SEBELUM A-5 mendarat.
A-5 (`8dabef67`) mendarat tanpa arm-nya, jadi peringatan itu berhenti jadi
peringatan dan menjadi **regresi hidup di `main`**. Terukur pada `main` sesudah
A-5, dengan Brief yang lahir tanpa PIC (keadaan normal sekarang menurut
handoff-mu sendiri):

```
staff Creative (PIC aset itu) ..... brief=0  aset=1   ← PUTUS
lead Creative ..................... brief=1  aset=1
AM pemilik ........................ brief=1  aset=1
```

Karena `creative.assetSelect` masih `join briefs`, `GET /assets/{id}` menjawab
**404 kepada PIC-nya sendiri**. Perbaikannya migrasi
`20260922200400_b1_briefs_select_arm_staff_divisi.sql` + tes
`packages/domain/src/brief-scope.rls.test.ts`. Itu **penyerasian**, bukan
pelonggaran: `account.canSeeBrief` sudah mengizinkan staff divisi pelaksana.

Yang diminta darimu soal ini: **konfirmasi saja bahwa itu tidak bertabrakan
dengan rencana A-3/A-4-mu**, dan **jangan** membuat migrasi kedua atas policy
yang sama.

**(b) Ada dua cacat RLS lain sekelas yang PR #312 tambal**, dan pola sebabnya
akan menggigit A-3/A-4 juga kalau kamu menambah jalur baca baru: **predikat TS
meloloskan, RLS mengosongkan barisnya, halaman menjawab 404 — bukan 403.** Suite
domain tidak bisa menangkapnya karena koneksinya BYPASSRLS. Kalau A-3/A-4
menambah baca lintas-tabel, tulis tesnya dengan `withClaims` + `SET LOCAL ROLE
authenticated` (pola `packages/domain/src/brief-scope.rls.test.ts`), jangan
hanya tes domain biasa.

## Tugas 3 — kalau A-3/A-4/A-req masih ada yang belum

Kerjakan sisanya di branch-mu, **rebase ke `main` dulu** (`main` sekarang di
`1fee9839` — sudah termasuk PR #309 Gelombang D accrual; kalau PR #312 sudah
merge, rebase ke yang terbaru). Aturan yang tidak
berubah:

- Stempel migrasi Jalur A `…T10####`. Jalur B sudah memakai
  `20260922200000` · `200100` · `200200` · `200300` · `200400`; Gelombang D
  sudah memakai `20260922010000` dan `20260923010000`.
- **JANGAN naikkan counter** — 146 tabel / 40 prefix / 31 mesin / 73 event.
  Kalau migrasimu menambah tabel/prefix/mesin: rebase, jalankan ulang
  `scripts/db-rebuild.sh`, **ambil angka yang SEBENARNYA** di `db-rebuild.sh`
  DAN `.github/workflows/ci.yml`. Counter itu absolut, bukan delta.
- `docs/DECISIONS.md` **jangan disentuh dari dalam jalur** (aturan emas #3);
  sepuluh keputusan Jalur B menunggu di handoff-nya untuk dipindahkan pada
  langkah penggabungan.
- Berkas milik Jalur B (`creative.ts`, `task.ts`, `kol.ts`, `ads.ts`,
  `brief-inherit.ts`, `stage.ts`, halaman `creative`/`ads`/`tasks`/`kol`,
  `lib/{creative,kol,ads,tasks,stage}.ts`) — **JANGAN diedit**; tulis
  permintaannya di handoff Jalur A.

## Tugas 4 — laporkan

Balas dengan: status enam butir Tugas 1 (sudah/belum + buktinya), konfirmasi
Tugas 2, dan — kalau ada yang kamu kerjakan — angka verifikasi §6 (db-rebuild
gate, typecheck sesudah `npm install`, keenam suite) apa adanya, termasuk yang
gagal. Jangan bilang selesai untuk yang belum diverifikasi.

Satu jebakan yang sudah dua kali memakan siklus sesi ini: `audit_log` menolak
DELETE, jadi menjalankan suite `packages/domain` berkali-kali atas DB yang sama
membuat beberapa tes berhitung-baris merah (`admin.test.ts` "hari libur",
`client.test.ts` Hold Service). **Rebuild dulu sebelum menyimpulkan apa pun.**

---

# RONDE 2 — jawaban A sudah masuk (2026-09-08). Tempel blok di bawah ke sesi Akun A.

Jawaban ronde 1 diterima: **keenam butir `belum`**, dengan bukti berkas+baris.
Jalur B sudah **memverifikasi keenamnya sendiri terhadap `origin/main`** dan
hasilnya: substansinya benar semua. Tapi **tiga barisnya menyesatkan**, dan
ketiganya menyesatkan ke arah yang membuat pekerjaanmu lebih mahal daripada
seharusnya. Baca tiga koreksi ini sebelum mulai.

## Koreksi 1 (paling penting) — A-3 bukan pekerjaan desain, ia PORT. Jahitannya sudah ada 15 baris dari tempatmu.

Buktimu benar: `strategi.ts` `approveStrategi` nol sentuhan ke mesin Service —
diverifikasi, dua `statemachine.transition` di dalamnya keduanya menargetkan
`table: 'strategi'`, bukan `services`.

Yang bukumu tidak sebut, dan ini yang mengubah bentuk tiketnya: **jalur STR- di
`account.ts` SUDAH punya jahitan itu, dan sudah lama.**

```
origin/main:packages/domain/src/account.ts:1025-1026
      machine: MACHINE_SERVICE, entityType: 'service', table: 'services',
      entityId: locked.serviceId, to: SERVICE_STATUS_STRATEGY_APPROVED, actor,
```

Dan header `account.ts` sendiri (baris 16-18) sudah **menuliskan spesifikasinya
sebagai perilaku yang ada**:

> "…and on approval drives the parent Service [Awaiting Onboarding] →
> [Strategy Approved] in the SAME transaction — unlocking Brief creation."

Jadi keadaan sebenarnya: ada **dua** modul Strategy di repo — STR- lama di
`account.ts` (punya jahitan) dan **STRG- baru di `strategi.ts`** (versioned,
`versiNo`/`disetujui_pada`, dan **inilah yang K-2/A-3 maksud**) yang **tidak
pernah mewarisi jahitannya**. Gerbangnya sendiri sudah menerima hasilnya:
`guardBriefCreation` (`account.ts:1354`) lolos pada `[Strategy Approved]`
(`account.ts:1606`).

Konsekuensi praktis buatmu:
- **Jangan rancang ulang.** Tiru preseden `account.ts:1025` apa adanya: satu
  transaksi yang sama, `MACHINE_SERVICE`, `to: '[Strategy Approved]'`.
- Pertanyaan yang TERSISA cuma satu, dan itu memang butuh ketokan: **STR- lama
  masih hidup atau sudah pensiun?** Kalau dua-duanya hidup, dua jalur berbeda
  bisa menggerakkan satu Service ke `[Strategy Approved]` — dan itu perlu satu
  baris `DECISIONS.md`, bukan diam-diam dipilih. Aturan rumah: kalau dua modul
  berkonflik, **STOP dan tandai**, jangan pilih tafsir sendiri.
- Tes jahitan yang §6 minta tetap wajib: satu tes yang memanggil KEDUA sisi
  sungguhan (setujui STRG- → buat Brief → **tidak** 409).

## Koreksi 2 — A-req-2: sisi BACA sudah selesai penuh. Grep-mu nol karena PR #312 belum ada di branch-mu.

Buktimu: `grep -r "source_creative_brief_id|sourceCreativeBriefId"` → nol hasil.
Itu **benar untuk `origin/main` dan untuk branch-mu** — diverifikasi, `git grep`
di `origin/main` juga nol.

Tapi di **PR #312 (head `85965d95`)** grep yang sama mengembalikan **19 hit**,
dan itu seluruh sisi bacanya, sudah lengkap dengan tesnya:

```
packages/domain/src/ads.ts:284           Campaign.sourceCreativeBriefId
packages/domain/src/ads.ts:1039          private.brief_source_creative_id(c.brief_id)
packages/domain/src/ads.ts:381,449       jalur createCampaign
apps/api/src/lib/wire.ts:1040,1061       CampaignWire.source_creative_brief_id
packages/domain/src/ads.test.ts:210-291  tes kedua jalur baca + kasus kosong
web-internal AssetPicker                 konsumennya
```

Jadi **A-req-2 = sisi TULIS saja**: isi `briefs.source_creative_brief_id` di
`account.createBrief` + picker-nya di form Brief AM. **Jangan bangun jalur
bacanya** (itu duplikat), dan **jangan sentuh `ads.ts` / `AssetPicker` /
`wire.ts` bagian Campaign** — berkas Jalur B. Begitu kolomnya terisi, filter K-3
hidup tanpa satu baris pun berubah di Jalur B.

⚠️ Kalau kamu grep lagi dan tetap nol: itu bukan bukti belum dibangun, itu bukti
branch-mu belum punya #312. **Rebase/merge dulu, baru simpulkan.**

## Koreksi 3 — A-req-3: `createdCount` ADA, tapi bukan yang kamu cari.

Buktimu bilang "nol `created_count` di mana pun". Sebenarnya ada:

```
origin/main:web-internal/src/app/(shell)/creative/briefs/[id]/page.tsx:335
  const createdCount = assets?.length ?? 0;
```

Itu variabel FE lokal di halaman DETAIL Brief, menghitung aset yang **sudah
ter-fetch** — bukan field pada baris antrean. Substansimu tetap benar
(`listDivisionQueue` tidak memproyeksikan jumlah anak), tapi kalimatnya salah,
dan itu berbahaya: pembaca berikutnya bisa menemukan variabel itu, menyangka
A-req-3 selesai, lalu berhenti. Yang dibutuhkan tetap **satu field jumlah anak
pada baris antrean** (`listDivisionQueue` + `wire.ts`) — bukan rute baru, karena
memanggil `GET /briefs/{id}/rollup` per baris antrean adalah N+1.

## Yang TIDAK dikoreksi — ketiganya diverifikasi dan buktimu tepat

- **A-req-1**: `BriefInput`/`Brief` di `origin/main` nol `tanggalMulai`/
  `tanggalAkhir`/`budget` — dikonfirmasi. Dan **keempat kolomnya memang sudah
  ada** dari F-4 (`20260922100200_f4_briefs_jendela_budget_sumber.sql`:
  `tanggal_mulai date`, `tanggal_akhir date`, `budget numeric(18,2)`,
  `source_creative_brief_id varchar(32)`), jadi ini **murni jalur TS**, nol
  migrasi baru. `brief-inherit.planRowToBriefInput` (berkas Jalur B) sudah siap
  mengisinya — **jangan sentuh**, cukup buka `BriefInput`-nya.
- **A-4**: `grep -c contracts packages/domain/src/sales.ts` → **0** di
  `origin/main`. Dikonfirmasi.
- **Utang UAT A-1**: diterima apa adanya, dan Jalur B tidak bisa
  memverifikasinya dari luar.

## Urutan yang paling murah

**A-req-1 → A-req-2 → A-req-3 → A-3 → A-4.** Tiga A-req itu satu-dua baris per
tempat dan masing-masing membuka satu sisa Jalur B yang fondasinya SUDAH
mendarat di #312; A-3/A-4 jauh lebih besar. Mengerjakan A-req lebih dulu
memulangkan tiga keluhan divisi dengan usaha paling kecil.

Aturan yang tidak berubah: stempel migrasi `…T10####`; **jangan naikkan counter**
(146/40/31/73 — absolut, bukan delta); `docs/DECISIONS.md` jangan disentuh dari
dalam jalur; berkas Jalur B jangan diedit — tulis permintaannya di handoff-mu.


---

# RONDE 2b — KOREKSI PENTING atas Koreksi 1 (2026-09-08, sesudah ketokan pemilik)

Pemilik menjawab pertanyaan "STR- lama masih hidup atau sudah pensiun?" dengan:
*"sudah pensiun, kodenya mungkin masih ada tapi semua jalurnya tidak ada di web."*

**Jalur B memverifikasi premis itu dan ia TIDAK BENAR.** Jangan bangun A-3 di
atasnya. Terukur di `main`:

```
web-internal/src/lib/nav.ts:153
  { href: '/persetujuan', label: 'Persetujuan',
    access: ownedBy(SALES, ACCOUNT, FINANCE, KOL) }      ← menu AKTIF, bukan mati

web-internal/src/app/(shell)/persetujuan/page.tsx:1039
  kind === 'approve' ? approveStrategy(row.strategy_id) : ...
  confirmText: "Setujui Plan …? Service … lanjut ke [Strategy Approved]
                dan Brief boleh dibuat."                  ← efeknya diiklankan ke user

web-internal/src/app/(shell)/account/strategies/[id]/page.tsx:200
  const res = await approveStrategy(id);                  ← tombol Setujui kedua

apps/api/src/app/api/v1/strategies/[id]/approve/route.ts:17
  await account.approveStrategy(db(), actor, id);          ← rutenya melayani
```

Jadi bentuk masalahnya berubah lagi, dan ini bentuk yang sebenarnya: **ada DUA
fitur Strategy, dua-duanya hidup di web, dan hanya satu membuka gerbang Brief.**

| | STR- (`account.ts`) | STRG- (`strategi.ts`) |
|---|---|---|
| Layar | `/persetujuan` (menu aktif) + `/account/strategies/[id]` | `/strategi/[id]` |
| Rute approve | `/api/v1/strategies/[id]/approve` | `/api/v1/strategi/[id]/approve` |
| Service → `[Strategy Approved]` | **YA** (`account.ts:1025-1026`) | **TIDAK** |
| Versioning | tidak | ya (`versiNo`, `disetujui_pada`) |

**Hipotesis yang harus kamu uji lebih dulu, sebelum menulis kode apa pun:**
keluhan Account #5 ("CRO mentok di `[Awaiting Onboarding]`") mungkin **bukan**
jahitan yang hilang, tapi orang memakai layar **STRG-** padahal yang membuka
gerbang adalah layar **STR-**. Cara mengujinya murah: di DB, untuk Service yang
dikeluhkan, lihat apakah ada baris `strategi` (STRG-) yang `Aktif` sementara
`services.status` masih `[Awaiting Onboarding]`, dan apakah ada baris STR- untuk
Service yang sama. Kalau pola itu yang muncul, A-3 adalah masalah
navigasi/kanonikalisasi, bukan mesin status.

⛔ **JANGAN sambungkan STRG- → Service sebelum pemilik mengetok mana yang
kanonik.** Menyambungkannya sementara `/persetujuan` masih hidup menghasilkan
**dua penulis hidup** ke status yang sama. Aturan rumah #2: dua modul
berkonflik ⇒ STOP dan tandai di `DECISIONS.md`, jangan pilih tafsir sendiri.

Kalau nanti diketok **STRG- yang kanonik**, maka pensiunkan STR- **sungguhan
dalam commit yang sama**: cabut baris `nav.ts:153` untuk jalur itu, cabut tombol
di `/persetujuan` dan `/account/strategies/[id]`, cabut atau 410-kan
`/api/v1/strategies/[id]/approve`. Setengah pensiun lebih buruk daripada tidak
pensiun — ia meninggalkan tombol yang menjanjikan hal yang tidak lagi terjadi.

**A-req-1, A-req-2, A-req-3 tidak tersentuh temuan ini** dan tetap urutan
pertama. Ketiganya masing-masing membuka satu sisa Jalur B dan nol di antaranya
menunggu ketokan apa pun.


---

# RONDE 3 — sesudah PR #315 & #312 merge (2026-09-08). Ini yang tersisa dari A.

**A-3 dan A-4 SELESAI, dan RONDE 2b sudah kedaluwarsa — jangan dikirim lagi.**
Peringatan ⛔-nya ("jangan sambungkan STRG- → Service") tidak berlaku, karena A
tidak melakukannya: mereka mengubah **gerbangnya**, bukan penulisnya.
`guardBriefCreation` sekarang lolos kalau Service `[Strategy Approved]` **atau**
ada STRG- ber-status `Aktif`. Nol penulis kedua ke `services.status` — desain itu
lebih baik daripada port yang Jalur B usulkan. Diverifikasi di `main` `a78f12be`.

Satu hal yang masih hidup, **bukan bloker**: dua layar Strategy tetap ada
berdampingan (`/persetujuan` + `/account/strategies/[id]` untuk STR-, dan
`/strategi/[id]` untuk STRG-). Pertanyaan produk untuk pemilik: mana yang
dipertahankan sebagai satu-satunya pintu. Tidak mendesak.

## Yang MASIH ditunggu dari Jalur A — hanya tiga, dan ketiganya kecil

Diukur di `main` `a78f12be`: nol `tanggalMulai`/`tanggalAkhir`/`budget` di
`account.ts`, nol `source_creative_brief_id`, nol `created_count`.

| | Yang dilakukan | Membuka |
|---|---|---|
| **A-req-1** | `BriefInput` + `insertBrief` menerima `tanggalMulai`/`tanggalAkhir`/`budget`; `Brief` + `briefToWire` memproyeksikannya. Kolomnya SUDAH ada dari F-4 ⇒ nol migrasi. `brief-inherit.planRowToBriefInput` sudah siap mengisinya — jangan sentuh berkas itu | sisa **B-3**: jendela campaign + budget di layar KOL |
| **A-req-2** | `account.createBrief` mengisi `briefs.source_creative_brief_id` saat AM membuat Brief Ads + picker-nya di form AM. **Sisi BACA sudah lengkap di main** (`ads.Campaign.sourceCreativeBriefId` → `AssetPicker`) — jangan bangun ulang, jangan sentuh `ads.ts`/`AssetPicker` | **B-5** menyaring sungguhan di produksi |
| **A-req-3** | satu field jumlah anak (mis. `created_count`) di baris `account.listDivisionQueue` + `wire.ts`. Bukan rute baru — `GET /briefs/{id}/rollup` per baris antrean itu N+1 | **B-1a** progres "n dari N" di ANTREAN divisi |

Ketiganya satu-dua baris per tempat, dan masing-masing memulangkan satu keluhan
divisi yang sisi seberangnya sudah mendarat dan sudah teruji di `main`.

## Aturan yang masih berlaku

- Mulai dari `main` terbaru (`a78f12be`). Branch Jalur A yang lama sudah merge.
- **JANGAN naikkan counter** — 146 tabel / 40 prefix / 31 mesin / 73 event.
  Absolut, bukan delta. Angka acuan lain di `main`: 201 migrasi, `core` 983 ·
  `db` 53 · `api` 493 · `domain` 2085 (+1 skip) · `web-internal` 684 · `portal` 19.
- Berkas Jalur B (`creative.ts`, `task.ts`, `kol.ts`, `ads.ts`, `brief-inherit.ts`,
  halaman `creative`/`ads`/`tasks`/`kol`) — jangan diedit; tulis permintaannya di
  handoff.
- Kalau menambah jalur baca lintas-tabel: tulis tesnya dengan `withClaims` +
  `SET LOCAL ROLE authenticated` (pola `packages/domain/src/brief-scope.rls.test.ts`).
  Suite domain BYPASSRLS, jadi ia tidak bisa menangkap kelas cacat "predikat TS
  meloloskan, RLS mengosongkan barisnya, halaman 404 bukan 403" — tiga kali kena
  di sesi Jalur B.
- Ranjau: `audit_log` menolak DELETE, jadi menjalankan suite `packages/domain`
  dua kali atas DB yang sama memerahkan beberapa tes berhitung-baris. Rebuild dulu.
