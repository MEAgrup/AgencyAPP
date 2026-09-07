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
di-rebase ke `main` sesudah PR #310/#311 kamu merge).

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
`e8cee053`; kalau PR #312 sudah merge, rebase ke yang terbaru). Aturan yang tidak
berubah:

- Stempel migrasi Jalur A `…T10####`. Jalur B sudah memakai
  `20260922200000` · `200100` · `200200` · `200300` · `200400`.
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
