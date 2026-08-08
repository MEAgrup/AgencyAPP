# HANDOFF — M6A/M6B/M6C Sesi 9 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI8 → **SESI9 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> **Sesi ini: A-09b — Section E, G, H dan I ditutup di lapisan data.** Sesudah
> ini **sembilan dari sepuluh Section M6A tertutup**; sisanya J, yang tidak
> butuh tiket data. Nol pekerjaan menggantung: ter-commit, ter-push.
>
> 🔴 **Satu temuan lebih besar dari tiketnya:** J-3 (`strategi_version.trigger_revisi`)
> menerima string APA PUN sejak A-03, sementara Rule 13 menuntut *"a trigger from
> the enumerated list"*. Daftar itu **tidak pernah ada** sampai H-2 membawanya
> sesi ini. Lihat §2.
>
> ⚠️ **Migrasi sesi ini TIDAK diterapkan ke live, dan itu disengaja.** PR #107
> belum merge. Lihat §5 sebelum menerapkan apa pun.

## 0. Posisi persis — VERIFIKASI SEBELUM MENYALIN

Empat perintah yang membuat tiga sesi terakhir tidak perlu kehilangan waktu:
`git fetch && git log --oneline -3` · `ls supabase/migrations/*.sql | wc -l` ·
`list_migrations` (live) · `gh`/MCP `pull_request_read`.

| | |
|---|---|
| Branch | `claude/sesi6-migration-handoff-1afolk` — **dicabangkan dari head PR #107**, bukan dari `main` |
| `main` | `1316705` — PR #106 ter-merge. **68 migrasi** |
| PR #107 | **TERBUKA**, head `a0bee31`, **10 commit** (bukan 9 — handoff masuk tertinggal satu), 11/11 check hijau, `mergeable_state: clean`. **Nol pekerjaan tersisa di dalamnya; ia menunggu review manusia** |
| Branch ini | `9019189` + handoff. Berisi **seluruh isi #107 + A-09b** ⇒ ia **stacked**, dan PR-nya (kalau dibuka) berbasis #107, bukan `main` |
| Migrasi | **72 berkas** (71 dari #107 + `20260808040000_m6a_section_efghi`) |
| Gate | tabel **76 → 81** · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 · `role_mappings` 12 |
| Test | domain **919 hijau + 1 skipped** (+24) · `apps/api` **324** · `packages/core` **118** · `packages/db` **15** · `web-internal` **116** + build Next bersih · 4 invariant SQL hijau · `db-rebuild` **72 migrasi** dari nol |
| Live `CDPS SG` | **Sinkron dengan #107, TERTINGGAL satu migrasi dari branch ini.** Itu arah yang benar — lihat §5 |
| Menggantung | Kode: **NOL**. Keputusan: **X-14** (enum I-3) · **O60** (detektor ledger O48) · dan yang diwarisi: O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

### 0.1 Skor — dan kenapa angkanya menyesatkan

M6A **11/15 tiket** · M6B **1/12**.

**Jangan baca sebagai persen pekerjaan.** Yang selesai sesi ini menutup
*sembilan Section*, tapi yang tersisa didominasi **A-13** — halaman & form
sepuluh seksi, dan hari ini **nol halaman Strategi ada**. A-13 sendirian lebih
besar dari A-05…A-09b digabung.

Yang benar-benar terjadi: **seluruh lapisan data + domain + route + kontrak FE
M6A sudah ada.** Yang belum: UI-nya, plus A-10 (tier visibilitas), A-11 (tautan
klien), A-12 (UI revisi).

## 1. Yang mendarat: A-09b

`supabase/migrations/20260808040000_m6a_section_efghi.sql`. Lima tabel anak,
gerbang tabel **76 → 81** di KEDUA berkas.

| Field | Bentuk | Kenapa begitu |
|---|---|---|
| **E-2** prioritas channel | 2 kolom di **`strategi_channel`** | §4 menulis ketiga nilainya sendiri (`engine_utama`/`pendukung`/`maintenance`). Ia di baris channel, bukan tabel anak, karena **`saveChannels` DELETE-then-INSERT**: tabel terpisah akan teryatim atau terhapus diam-diam setiap AM menyimpan Section B. Ada test yang menjalankan persis jalur itu |
| **E-12** ketergantungan klien | `strategi_ketergantungan_klien` | Repeatable struct. **Sengaja BUKAN digabung dengan C-7** — lihat §3.1 |
| **G-1** fase kerja | `strategi_fase` (min 2) | §4 menulis "min 2" eksplisit, jadi pesannya sendiri: "satu dari dua" bukan masalah yang sama dengan "nol" |
| **G-2** tanggal besar | `strategi_tanggal_besar` | Dibaca **M6B Rule 7** (distribusi mingguan Plan di-reweight ke minggu yang memuatnya), jadi indeksnya ber-key `(strategi_id, tanggal)` |
| **G-3/G-4** jadwal review | 4 kolom header | Kardinalitas tetap satu. **Teks bebas** — lihat §3.2 |
| **H-2** trigger revisi | `strategi_trigger_revisi` | Multi-enum **+ threshold**. Muatan per-item itulah yang membedakannya dari D-6, dan `<@` hanya bekerja atas array SKALAR |
| **I-2 + I-4** dispatch | `strategi_dispatch` — **satu** tabel | Keduanya ber-key divisi; lihat §3.3 |
| **I-3** metrik laporan | array jsonb | Pola D-6 apa adanya. Set = kosakata D-4 ⇒ **X-14** |

Domain: `saveKetergantungan` · `saveKalender` · `saveTriggerRevisi` ·
`saveHandoff`, plus E-2 di `ChannelInput`/`validateChannel`/`saveChannels`.
Route: `PUT /strategi/{id}/ketergantungan` · `/kalender` · `/trigger-revisi` ·
`/handoff`. Wire + tipe FE + fungsi klien lengkap.

**Kelengkapan submit yang bertambah:** `E-2/{channel}` (per channel, KEDUA
paruh) · `E-12` · `G-1` (min 2) · `G-2` · `G-3` · `G-4` · `H-2` · `I-2` · `I-3`.
Yang **tidak** digerbangi dan itu disengaja: **H-4** dan **I-4** (`O` di §4),
serta **I-1/J-4** yang turunan dan karenanya tidak bisa "hilang".

## 2. 🔴 Temuan: J-3 menerima string apa pun sejak A-03

`strategi_version.trigger_revisi` adalah array jsonb dengan CHECK yang hanya
memeriksa **panjangnya**:

```sql
ck_strver_revisi_lengkap: jsonb_array_length(trigger_revisi) > 0
```

Sementara Rule 13 menuntut *"a trigger from **the enumerated list**"* dan §4 J-3
menulis *"trigger yang terpicu **(dari H-2)**"*.

**Daftar itu tidak pernah ada.** H-2 adalah daftarnya, dan H-2 belum dibangun
sampai sesi ini — jadi selama lima sesi setiap revisi bisa mendeklarasikan
trigger apa pun (`'stok kosong'`, `'target meleset'`, salah ketik apa pun), dan
metrik §9 *"% revisions with a declared trigger"* menghitung **100%** untuk
sesuatu yang tidak bisa dikelompokkan.

Yang dipasang, dua lapis karena satu lapis tidak cukup:

1. **`ck_strver_trigger_set`** — containment `<@` ke set H-2 yang sama persis
   dengan `ck_strtrg_kode`. Satu daftar, bukan dua. Ini lantainya: berlaku untuk
   tulis service-role dan caller mana pun.
2. **`MSG_TRIGGER_NOT_DECLARED` di `openRevision`** — J-3 ⊆ H-2 **Strategi ini**,
   bukan hanya ⊆ set global. Itu perbandingan lintas baris, dan **CHECK tidak
   boleh ber-subquery**, jadi ia tidak bisa hidup di DB.

**Kenapa lapis 2 tidak bisa mengunci siapa pun:** H-2 adalah syarat submit ⇒
setiap versi yang pernah `Aktif` punya ≥1 trigger terdeklarasi, dan
`copyChildren` membawanya ke revisi. Kalau H-2 kelak dibuat opsional, lapis 2
berubah dari gerbang jadi jebakan — **jangan lakukan itu tanpa mencabutnya**.

**Sebelas call site test memakai trigger teks bebas** dan semuanya merah begitu
CHECK-nya dipasang. Itu bukan kerusakan; itu ukuran seberapa lama lubangnya ada.

## 3. Tiga keputusan bentuk yang akan salah kalau ditebak ulang

### 3.1 E-12 BUKAN C-7, dan menggabungkannya menghapus keduanya

`strategi_prasyarat_klien` (C-7) menyimpan `(item, pic_klien, deadline)`. E-12
menyimpan `(item, kapan, konsekuensi)`. Godaannya jelas.

- **C-7** = *"apa yang harus dibereskan klien **SEBELUM** eksekusi jalan"* —
  daftar gerbang, sekali, di depan. Ia tidak punya kolom konsekuensi karena
  konsekuensinya adalah eksekusi tidak dimulai.
- **E-12** = ketergantungan **SELAMA** eksekusi, berulang, dan setiap baris
  membawa konsekuensi keterlambatan. Itulah yang dikutip saat target meleset.

Menggabungkannya memaksa `konsekuensi` jadi nullable dan C-7 kehilangan artinya
sebagai gerbang. PRD menulis keduanya di dua Section dengan struct berbeda.

### 3.2 G-3/G-4 teks bebas — keputusan, bukan kelalaian

§4 menandai G-3 dan G-4 **`Struct`**, bukan `Enum`/`Multi-enum` — berbeda dari
D-6, H-2 dan I-3 yang §4 tandai enum secara eksplisit. PRD tidak pernah menulis
daftar frekuensi di mana pun, dan satu-satunya field frekuensi as-built
(`briefs.recurring_frequency`) juga `varchar` bebas.

Mengarang `mingguan/dua_mingguan/bulanan` lalu menegakkannya CHECK adalah persis
"never invent". Kalau pemilik kelak mau set tertutup, biayanya satu
`ADD CONSTRAINT` atas kolom yang sudah ada; arah sebaliknya (mencabut enum yang
sudah diisi produksi) tidak murah. **Jangan "perbaiki" ini jadi enum tanpa
keputusan pemilik.**

### 3.3 I-4 adalah kolom di baris I-2

I-4 (*"catatan khusus untuk tiap divisi eksekusi"*) ber-key `divisi`, key yang
sama dengan I-2. Tabel terpisah mengizinkan catatan untuk divisi yang **bukan**
penerima Brief — baris yang tidak punya arti dan tidak punya pembaca.

Sekalian, karena ia akan ditanyakan: **`Live Stream` IKUT** di set I-2 walau
Rule 18 bilang MEA tidak menaruh host internal. As-built
`briefs.assigned_division` memang memuat Live Stream (brief-nya melewati mesin
task dan berujung ke vendor tracker), jadi Brief Live Stream ADA dan urutan
dispatch harus bisa menyebutnya. Ada test yang mengikat set I-2 ke
`ALLOWED_DIVISIONS`.

## 4. Ledger O48 menangkap lima tabel — dan itu false-negative, terverifikasi

`rls_checks.sql` §42 menolak kelima tabel baru:

```
O48 ledger GREW: {strategi_dispatch_select, strategi_fase_select, …}
has no lead/division arm.
```

Premisnya **diperiksa, bukan dipercaya**:

```sql
select pg_get_functiondef(oid) from pg_proc
 where proname='jwt_can_read_strategi' and pronamespace='private'::regnamespace;
-- ... OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
```

Arm-nya **ADA** — ia cermin persis `strategi_select`, hanya satu tingkat di
balik SECURITY DEFINER, yang tidak bisa dilihat detektor sintaktik. Itu persis
false-negative yang komentar §42 sendiri sudah antisipasi; A-09b yang
membuktikannya nyata, untuk **sepuluh** policy `strategi_*`, bukan lima.

Yang dilakukan: ledger diperluas **dengan entri DECISIONS**, sesuai aturan yang
pesan errornya sendiri tetapkan.

Yang **sengaja tidak** dilakukan: memperbaiki detektornya supaya menembus satu
tingkat indireksi. Itu benar, dan akan menyusutkan ledger sepuluh baris
sekaligus — tapi **mengubah semantik invariant bersama di dalam tiket fitur,
supaya tiket itu sendiri hijau, adalah cara paling mudah kehilangan gerbang.**
Dibuka sebagai **O60**.

## 5. ⚠️ Live TIDAK disentuh sesi ini — baca sebelum menerapkan apa pun

Live `CDPS SG` sinkron dengan **#107** (72 baris riwayat: 71 migrasi repo + satu
baris yatim `20260808024726` yang efek skemanya sudah dibongkar O59).

Migrasi A-09b **tidak** diterapkan, dan alasannya bukan kehati-hatian umum:
**PR #107 belum merge.** Menerapkan migrasi keempat ke live sementara `main`
masih tertinggal tiga menghasilkan keadaan "live lebih maju dari `main`" — dan
itu **persis bentuk O38, O59, dan tiga ronde drift sebelumnya**.

Arah yang aman adalah kebalikannya: **live boleh tertinggal dari repo** (bisa
dideteksi, bisa disusul dengan `db push`); live yang **mendahului** repo adalah
drift yang hanya ketahuan kalau ada yang membandingkan DDL satu per satu.

**Urutan yang benar:** merge #107 → merge PR A-09b → baru `db push` ke live,
lalu sidik jari struktural (SESI6 §2). Jangan dibalik.

## 6. Apa yang tersisa — dan urutannya

### 6.1 Lebih dulu daripada fitur apa pun

1. **Review + merge PR #107.** 11/11 hijau, `clean`, nol pekerjaan di dalamnya.
   Ia menunggu **manusia**. Merge-nya membuka O47b **dan** membuat branch ini
   berhenti stacked.
2. **PR untuk A-09b** (branch ini). Ia berbasis #107, jadi urutannya terikat.

### 6.2 Butuh izin/orang, bukan kode

| # | Isi | Kenapa bukan saya |
|---|---|---|
| **O47b — REWRITE** | `git filter-repo` buang `backend/testdata/import_samples/` → force-push `main` → semua kontributor re-clone → tiket GitHub Support | Premis §0 runbook sudah dikoreksi (SESI8 §8): **`main` MEMUAT PII**, menghapus 25 ref memberi **nol** efek. Biayanya jatuh ke orang lain ⇒ butuh jendela pemilik. Runbook: **§5**, bukan §0 (§0 DIBATALKAN) |
| **X-14** 🟡 BARU | Apakah laporan klien bulanan (I-3) memuat metrik yang BUKAN metrik target D-4 | Yohan. Tidak memblokir — A-09b mendarat dengan set D-4, dan membalikkannya satu `ALTER` selama belum ada Strategi live |
| **O42-b** | Eksekusi seed `role_mappings` ke bentuk HRIS UPPERCASE | Menggeser gerbang `role_mappings = 12` + bentuk 10 karyawan seed |
| **O59-b** | Gerbang atas **nama** event, bukan jumlahnya | Usul sejak SESI8; masih belum diotorisasi |
| **O60** 🟡 BARU | Detektor ledger O48 menembus satu tingkat indireksi | Keputusan teknis; siapa pun yang meninjau §42 |
| **O24** · **O45** · **X-06** · **X-12** | tidak berubah dari SESI8 §6.2 | — |

### 6.3 Fitur M6 — jalur yang sekarang terbuka

1. **A-13 — halaman & form Section A→J.** Sekarang **tidak ada lagi alasan
   menundanya**: seluruh kontrak FE ada dan dijaga `shape-parity`, jadi form
   bisa dibangun tanpa menebak bentuk respons. Baca `web-internal/AGENTS.md`
   lebih dulu — versi Next di repo ini bukan yang ada di data latih.
   ⚠️ Halaman `account/strategies/[id]` yang ADA adalah entitas **lama** M6 §4
   (`strategy_plan`/`STR`) — **jangan** pakai sebagai titik mulai.
2. **B-01** — `PLAN` + 6 tabel anak. Tidak terblokir sejak B-00. Sekarang
   sumbernya lengkap: G-1 fase, **G-2 tanggal besar (Rule 7 reweight)**, D-2
   target, E-4 floor price, F kuota, D-8 asumsi — keenamnya ada.
   **B-06/B-07/B-09 wajib dibaca ulang dengan deviasi X-07.**
3. **A-10** — dua tier visibilitas. Pelanggan konkretnya bertambah: **D-7** dan
   **H-4** hard-internal masih belum ditegakkan. Ketiga pembacanya internal ⇒
   nol kebocoran ke luar, tapi **jangan** dibaca sebagai "tier sudah ditegakkan".
4. **A-11 / A-12** — tautan klien dan UI revisi. A-11 menunggu X-06.

### 6.4 Yang JANGAN dikerjakan

- **Jangan** menerapkan migrasi A-09b ke live sebelum #107 dan PR-nya merge (§5).
- **Jangan** menjadikan G-3/G-4 enum tanpa keputusan pemilik (§3.2).
- **Jangan** menggabungkan E-12 dengan C-7 (§3.1) atau memecah I-4 jadi tabel
  sendiri (§3.3).
- **Jangan** membuat H-2 opsional tanpa mencabut gerbang subset J-3 (§2).
- **Jangan** memperbaiki detektor ledger O48 di dalam tiket fitur (§4 / O60).
- **Jangan** menambah kolom penyimpan untuk D-3, I-1, atau J-4 — ketiganya
  turunan, dan nilainya justru pada tidak adanya kolom itu.
- **Jangan** menyentuh `backend/**` kecuali menjaga job-nya hijau (CLAUDE.md).
- **Jangan** menambah baris ke `KNOWN_GAPS` di `route-parity.test.ts`.
- **Jangan** melaporkan PII bersih sebelum O47b rewrite + tiket Support selesai.
- **Jangan** menyalin baris posisi handoff tanpa memverifikasinya (§0).

## 7. Jebakan lingkungan — yang terbukti lagi sesi ini

Semua yang SESI7 §5.1 dan SESI8 §7 catat masih berlaku. Yang kambuh:

0. **`vitest` tanpa `DATABASE_URL` LULUS DENGAN MELEWATI.** Tetap pabrik
   laporan-hijau-palsu nomor satu. Angka yang benar pada commit ini:
   `domain` **919 + 1 skipped** · `apps/api` **324** · `core` **118** ·
   `db` **15** · `web-internal` **116**. Kalau `domain` melaporkan ratusan
   `skipped`, Anda belum menguji apa pun yang penting.
1. **Container start tanpa postgres, dan clusternya PG16.**
   `service postgresql start` + `alter user postgres with password 'postgres'`.
   Langkah kedua tidak opsional (socket vs TCP).
2. **`node_modules` kosong di container baru** — `npm install` dari **root**
   repo, jangan dari `packages/*`. `web-internal` punya `node_modules` sendiri
   dan `npm test`/`npm run build`-nya dijalankan dari dalam `web-internal`.
3. **`npx tsc` me-resolve TypeScript global 6.x** sementara repo pin `^5`.
   Pakai `./node_modules/.bin/tsc` — sesi ini memakai
   `../../node_modules/.bin/tsc --noEmit -p tsconfig.json` per workspace.

### 7.1 Kebiasaan yang terbukti berharga dua sesi berturut-turut

**Verifikasi gerbang secara NEGATIF.** Sesi ini: satu route dihapus ⇒
`route-parity` merah dan **menyebut path-nya**; satu kunci `kriteria_lulus`
dihapus dari `wire.ts` ⇒ `shape-parity` merah dan **menyebut kuncinya**. Tanpa
itu, "gerbangnya menjaga A-09b" hanyalah asumsi — dan O43 adalah kelas cacat di
mana route menjawab 200 sementara halamannya blank.
