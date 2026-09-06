# Handoff — **Gelombang B5 SELESAI** (baris Plan tersemai dari Section E)

> **Baca `HANDOFF_GELOMBANG_B_20260906.md` dulu** untuk audit lengkap dan konteks
> keempat gelombang. Dokumen ini hanya melaporkan B5 dan apa yang berubah karenanya.
>
> Sesi ini mengerjakan **B5 saja**, atas keputusan pemilik (2026-09-06: *"cukup B5 dulu,
> B6 nanti"*), karena **B1+B2 sedang dikerjakan sesi paralel** dan **B3+B4 belum PR**.
> B5 dipilih justru karena ia yang paling kecil risikonya terhadap drift — lihat §5.

---

## 1. Posisi sesudah sesi ini

| Gelombang | Isi | Status |
|---|---|---|
| **A** | PR kecil QA | ✅ SELESAI — PR #300 (draft) |
| **B1** | Perluas payload baseline TikTok (+4 turunan) | 🔄 sesi paralel |
| **B2** | Engine baseline Shopee | 🔄 sesi paralel |
| **B3** | Section B terisi dari satu upload | ⏸️ belum PR |
| **B4** | AM Co-Pilot mengisi Section E dari server | ⏸️ belum PR |
| **B5** | **Baris Plan tersemai dari Section E** | ✅ **SELESAI (sesi ini)** |
| **C** | Showcase Klien Terbaik | ⏸️ belum |
| **D** | Laporan keuangan accrual | ⏸️ belum |

Branch: **`claude/baca-handoff-b5-b6-build-ygrsux`**.

---

## 2. Yang dibangun

### 2.1 `packages/core/src/planpillar.ts` *(baru)* — mesin pemetaan pilar → baris

Pindahan `PILAR_TO_DIVISI` + `suggestRowFromPillar` dari `web-internal`, ditambah jalur
semai server-side. Isinya:

| Ekspor | Guna |
|---|---|
| `PILAR_TO_DIVISI` | 5 jenis berdivisi tunggal: `konten`→Creative, `iklan`→Ads, `affiliate`→KOL, `live`→Live Stream, `operasional`→Ops |
| `PILAR_PILIH_DIVISI` | `sku` · `harga` · `retensi` — divisinya **dipilih AM** |
| `PILAR_BARIS` | 8 pilar kerja (cermin `ck_plan_row_pilar`, tanpa `tidak_dikerjakan`) |
| `KANDIDAT_DIDAHULUKAN` / `kandidatDivisi()` | AI Optimizer + Store Operation di depan, sisa `briefAssignableNames()` di belakang |
| `parseAngkaTarget` / `parseTargetKuota` | angka pembuka teks target E-10 |
| `satuanKanonik` | rapikan ejaan satuan ke `plantask.PLAN_TASK_CATALOG` |
| `seedRowFromPillar` | putusan semai + **alasan** kalau tidak |

Diekspor dari `packages/core/src/index.ts` sebagai `planpillar`.

### 2.2 `generatePlanPeriods` menyemai `plan_row` periode 1

Fungsi baru `seedRowsFromPillars` di `packages/domain/src/plan.ts`, jalan **di dalam
transaksi approval yang sama** (`approveStrategi`). Membaca `strategi_pillar` +
`strategi_channel`, menyerahkan putusannya ke `planpillar.seedRowFromPillar`, lalu
`insert into plan_row` langsung.

**BUKAN `createPlanRow`**, dan itu disengaja: jalur itu membuka transaksinya sendiri dan
menggerbang `canWritePlan` — dua hal yang tak bisa terjadi di sini (transaksi approval
sudah terbuka, dan aktornya SPV yang menyetujui, bukan AM pemilik). Bentuk insert-nya
sama dan menumpang DB CHECK yang sama; bedanya dicatat di aksi audit
**`baris_disemai`** (bukan `baris_dibuat`), supaya log tak pernah mengaku baris ini
diketik manusia.

Yang pilar tak sebut — `budget`, `minggu_sasaran`, `prasyarat`, `prioritas`,
`visibilitas` — dibiarkan di default kolomnya. **Nol invensi.**

### 2.3 Panel "Pilar Strategi belum jadi baris kerja"

`web-internal/src/components/plan/PilarBelumJadiBaris.tsx` *(baru)*, dirender di
`/account/plan/{id}` untuk Plan **kontrak** saat AM masih boleh menambah baris.
Menampilkan tiap pilar Section E yang belum punya baris, beserta **apa yang kurang**,
lalu membuat barisnya dengan satu tombol.

**Nol endpoint baru:** pilar dibaca dari `GET /strategi/{id}` yang sudah ada, baris
dibuat lewat `POST /plan/{id}/rows` yang sudah ada. **Nol migrasi** — jumlah migrasi
tetap **182**.

---

## 3. Tiga keadaan yang MENAHAN semai — dan semuanya ditampilkan

Ini bagian yang paling penting untuk tidak salah dibaca sebagai bug:

| Alasan | Kapan | Kenapa bukan ditebak saja |
|---|---|---|
| `butuh_divisi` | pilar `sku` / `harga` / `retensi` | Pemilik menetapkan 2026-09-06 bahwa pilar SKU/harga diberikan ke **AI Optimizer atau Store Operation dan AM yang memilih**. `retensi` **belum diketok sama sekali** (pertanyaan terbuka §8 no. 3 handoff Gelombang B) |
| `butuh_kuota` | teks target tak punya angka pembuka yang terbaca | Baris ber-`kuota = 0` adalah **baris mati**: `brief-inherit.ts` melewatinya dengan alasan `kuota_nol`, jadi ia hanya menambah baris yang tak pernah jadi Brief |
| `butuh_channel` | pilar lintas channel (`channel IS NULL`) pada Strategi >1 channel | `plan_row.channel` NOT NULL; memilihkan salah satu = klaim yang AM tak pernah tulis. Strategi **satu** channel tetap disemai — di situ tak ada yang ditebak |

Pilar `tidak_dikerjakan` tidak disemai **dan tidak muncul di panel**: itu memang bukan
pekerjaan.

Semua alasan dikumpulkan **sekaligus**, bukan berhenti di yang pertama, supaya AM
melihat seluruh kekurangan satu baris dalam satu layar.

---

## 4. Bug ikutan yang ikut diperbaiki: parser kuota salah 1000×

Parser lama (`/^(\d+(?:[.,]\d+)?)/` di `plan-row-suggest.ts`) membaca **`15.000.000`
sebagai `15`**. Di FE itu "hanya" usulan yang AM lihat dan bisa perbaiki. Di jalur semai
server-side, angka salah 1000× akan masuk DB **tanpa satu pun manusia melihatnya lebih
dulu**.

Parser baru memakai konvensi angka Indonesia yang sudah jadi aturan rumah (CLAUDE.md #7
`Rp. X.XXX.XXX,00`): **titik = pemisah ribuan, koma = desimal**.

| Masukan | Lama | Baru |
|---|---|---|
| `30` | 30 | 30 |
| `7,5` | 7.5 | 7.5 |
| `15.000` | **15** | 15000 |
| `15.000.000` | **15** | 15000000 |
| `15.000,25` | 15 | 15000.25 |
| `1.5` | 1.5 | **`null`** (bukan ribuan, bukan desimal ⇒ AM yang mengetiknya) |

`null` ⇒ `butuh_kuota` ⇒ masuk panel, bukan jadi baris berangka karangan.

---

## 5. Dual-home, dan kenapa bukan import

`web-internal` **tidak punya dependency `@cdps/*`** (`web-internal/package.json`) — ia
bicara ke `apps/api` lewat HTTP. Jadi `web-internal/src/lib/plan-row-suggest.ts` adalah
**cermin manual** `packages/core/src/planpillar.ts`, pola yang sama persis dengan
`divisions.ts` dan `riset-awal.ts`.

Penjaganya: **tes yang sengaja diduplikasi**. `plan-row-suggest.test.ts` mengulang kasus
yang sama dengan `planpillar.test.ts` (tabel pilar→divisi, parser angka, urutan
kandidat divisi). Kalau satu rumah berubah sendirian, salah satu dari dua suite itu
jatuh.

**Kalau menyentuh aturan pemetaan pilar → baris, ubah KEDUANYA.**

---

## 6. Anti-drift terhadap sesi paralel

Berkas yang B5 sentuh vs berkas yang B1–B4 sentuh menurut rencana Gelombang B §7:

| Gelombang | Berkas utamanya | Bertabrakan dengan B5? |
|---|---|---|
| B1 | `packages/core/src/baseline/payload.ts` | **tidak** |
| B2 | `packages/core/src/baseline/shopee/**`, `domain/riset-awal.ts`, `RisetAwalPanel.tsx` | **tidak** |
| B3 | `domain/strategi.ts`, `lib/wire.ts`, `strategi-baseline-inherit.ts`, `SectionB.tsx` | **tidak** |
| B4 | `packages/core/src/copilot.ts`, route `copilot`, `SectionE.tsx` | **tidak** |

Dua berkas **bersama** yang akan konflik sepele (keduanya bertambah baris, bukan
berubah baris):

1. **`packages/core/src/index.ts`** — B5 menambah `export * as planpillar`. B1/B2/B4
   akan menambah ekspornya sendiri di blok yang sama.
2. **`docs/DECISIONS.md`** — semua gelombang menambah baris di puncak tabel.

Keduanya *append*; selesaikan dengan mempertahankan **kedua** baris, jangan pilih salah
satu.

⚠️ Satu hal yang **B4 wajib tahu**: B4 mengisi Section E lewat AM Co-Pilot. Begitu
Section E terisi, B5 langsung punya bahan — tapi **semai hanya jalan saat Strategi
disetujui** (`generatePlanPeriods` idempoten per kontrak). Strategi yang sudah disetujui
sebelum Section E-nya terisi **tidak** akan tersemai ulang; pilar-pilarnya muncul di
panel §2.3 dan AM membuat barisnya dari sana. Itu perilaku yang benar (Rule 17: periode
yang sudah berjalan tidak diregenerasi), bukan cacat — jangan "perbaiki" dengan
menyemai ulang.

---

## 7. Verifikasi — angka acuan BARU

Perintahnya sama dengan §9 handoff Gelombang B. Angka sesudah B5:

| Suite | Sebelum B5 (akhir Gelombang A) | **Sesudah B5** | Selisih |
|---|---|---|---|
| core | 667 | **701** | +34 (`planpillar.test.ts`) |
| db | 53 | **53** | — |
| apps/api | 447 | **447** | — |
| domain | 1903 (+1 skip) | **1913** (+1 skip) | +10 (semai di `plan.test.ts`) |
| web-internal | 565 | **581** | +16 (cermin + `kekuranganPilar`) |
| web-client-portal | 19 | **19** | — |
| migrasi db-rebuild | 182 | **182** | — (nol migrasi) |

Juga hijau: `npx tsc --noEmit` (domain + web-internal), `npm run build` web-internal,
`eslint` pada berkas yang disentuh.

Jebakan lama masih berlaku semua — terutama: **suite dijalankan dua kali di DB yang sama
tanpa rebuild ⇒ 2 kegagalan PALSU**. Rebuild dulu sebelum mencari bug.

---

## 8. Uji terima B5 (manual, di aplikasi)

1. Buka Strategi kontrak yang Section E-nya terisi, **setujui**.
2. Buka Plan periode 1 → Section P-C sudah memuat baris untuk pilar
   konten/iklan/affiliate/live/operasional, masing-masing dengan divisi PIC-nya, dan
   **tanpa** badge `Di Luar Strategi`.
3. Panel **"Pilar Strategi belum jadi baris kerja"** di atasnya memuat pilar
   `sku`/`harga`/`retensi` dengan dropdown divisi yang menawarkan **AI Optimizer** dan
   **Store Operation** lebih dulu. Pilih → **Buat baris** → baris muncul di P-C, tertaut
   ke pilarnya.
4. Pilar yang targetnya tak berangka muncul di panel dengan "isi kuota + satuan" —
   **bukan** sebagai baris kuota 0.
5. Aktifkan periode → **"Berikan Brief"**: baris yang tersemai ikut mewarisi Brief
   seperti baris manapun. **Brief: nol perubahan kode.**

---

## 9. Yang TIDAK dikerjakan sesi ini (sengaja)

- **Dropdown PC-3 kontrak TIDAK dikembalikan.** Pemilik mencabutnya 2026-09-02 dan
  menyebut sendiri jalan penggantinya: *"mengisi Section E lalu menautkan otomatis"* —
  itulah yang B5 bangun. Panel §2.3 bukan dropdown itu: ia read-only atas pilar yang
  belum punya baris, bukan alat untuk menautkan ulang baris mana pun ke pilar mana pun.
- **Menyemai periode 2..n.** Hanya periode 1. Menyalin baris ke enam periode =
  mengarang komitmen bulan yang belum direncanakan.
- **B6 / Gelombang C / D.** Pemilik memilih "cukup B5 dulu".
- **Pertanyaan terbuka §8 handoff Gelombang B** tetap terbuka semuanya. Yang paling
  menyentuh B5: **no. 3 — pilar `retensi` milik divisi mana?** Sampai diketok, ia tetap
  di panel "pilih divisi PIC".
