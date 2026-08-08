# HANDOFF — M6A/M6B/M6C Sesi 9 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI8 → **SESI9 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> **Sesi ini: A-09b (Section E/G/H/I di lapisan data) + A-13a (halaman Strategi
> pertama) + PR #107 di-merge + X-14 dijawab pemilik.** Sesudah A-09b,
> **sembilan dari sepuluh Section M6A tertutup** di data; sisanya J, yang tidak
> butuh tiket data. Nol pekerjaan menggantung: ter-commit, ter-push.
>
> 🔴 **DUA temuan lebih besar dari tiketnya masing-masing:**
> 1. **J-3 menerima string APA PUN sejak A-03** — Rule 13 menuntut *"a trigger
>    from the enumerated list"* dan daftar itu tidak pernah ada sampai H-2
>    membawanya. Lihat §2.
> 2. **Seluruh lapisan klien `lib/strategi.ts` belum pernah punya SATU pemanggil
>    di halaman mana pun** sejak A-03 — dan `route-parity` hijau sepanjang waktu
>    itu, karena ia memeriksa apakah path yang dipanggil FE dilayani, bukan
>    apakah ada manusia yang bisa sampai ke sana. Lihat §8.
>
> ✅ **Live `CDPS SG` ≡ repo, diverifikasi lewat ISI.** #107 dan #108 keduanya
> merge sesi ini, migrasi A-09b disusulkan sesudahnya, dan sidik jari struktural
> **`d8daaa2506691ce206c15b5641464aac` atas 148 fakta identik** di live dan
> lokal. Lihat §5.

## 0. Posisi persis — VERIFIKASI SEBELUM MENYALIN

Empat perintah yang membuat tiga sesi terakhir tidak perlu kehilangan waktu:
`git fetch && git log --oneline -3` · `ls supabase/migrations/*.sql | wc -l` ·
`list_migrations` (live) · `gh`/MCP `pull_request_read`.

| | |
|---|---|
| Branch | `claude/sesi6-migration-handoff-1afolk` — sudah ter-merge ke `main` |
| `main` | `c2dc953` — #107 lalu #108 ter-merge sesi ini. **72 migrasi** |
| PR | **NOL terbuka.** #107 (`bc7aa4e`) dan #108 (`c2dc953`) keduanya ter-merge sesi ini |
| Migrasi | **72 berkas** (71 dari #107 + `20260808040000_m6a_section_efghi`) |
| Gate | tabel **76 → 81** · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 · `role_mappings` 12 |
| Test | domain **919 hijau + 1 skipped** · `apps/api` **324** · `packages/core` **118** · `packages/db` **15** · `web-internal` **128** (+12) · 4 invariant SQL · `db-rebuild` **72 migrasi** dari nol · lint + typecheck + build Next bersih |
| Live `CDPS SG` | ✅ **≡ repo**, 73 baris riwayat. Sidik jari `d8daaa25…` \| 148 fakta **identik** dengan lokal — dibandingkan isinya (definisi constraint, indexdef, predikat policy, tipe kolom), bukan jumlahnya. Itu pelajaran O59 dipakai, bukan diulang |
| Menggantung | Kode: **NOL**. Keputusan: **O60** (detektor ledger O48) · dan yang diwarisi: O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12. **X-14 ✅ dijawab pemilik** |

### 0.1 Skor — dan kenapa angkanya menyesatkan

M6A **12/16 tiket** (A-13 dipotong jadi A-13a ✅ / A-13b) · M6B **1/12**.

**Jangan baca sebagai persen pekerjaan.** Halaman Strategi sekarang ADA, tapi
ia melayani **empat dari sepuluh seksi** (D, G, H, I). Yang tersisa di A-13b —
Section A, B, C, E, F — lebih besar daripada A-13a, dan **Section B sendirian**
adalah ±45 field dikali jumlah channel.

Yang benar-benar terjadi: **seluruh lapisan data + domain + route + kontrak FE
M6A sudah ada, dan sekarang ada pintu masuk manusia ke sebagiannya.** Yang
belum: A-13b, A-10 (tier visibilitas), A-11 (tautan klien), A-12 (UI revisi).

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

Live `CDPS SG` sinkron dengan **`main`** (72 baris riwayat: 71 migrasi repo +
satu baris yatim `20260808024726` yang efek skemanya sudah dibongkar O59).
#107 sudah merge sesi ini, jadi `main` ≡ live.

> ✅ **Sudah dijalankan sesi ini, sesudah #108 merge.** Yang di bawah adalah
> alasan urutannya, dan ia tetap berlaku untuk migrasi berikutnya.

Migrasi A-09b tidak diterapkan **sebelum PR-nya merge**, dan alasannya bukan
kehati-hatian umum. Menerapkan migrasi keempat ke live sementara `main`
masih tertinggal tiga menghasilkan keadaan "live lebih maju dari `main`" — dan
itu **persis bentuk O38, O59, dan tiga ronde drift sebelumnya**.

Arah yang aman adalah kebalikannya: **live boleh tertinggal dari repo** (bisa
dideteksi, bisa disusul dengan `db push`); live yang **mendahului** repo adalah
drift yang hanya ketahuan kalau ada yang membandingkan DDL satu per satu.

**Urutan yang dijalankan:** merge #107 ✅ → merge #108 ✅ → `apply_migration` ✅ →
sidik jari struktural ✅. Jangan dibalik untuk migrasi berikutnya.

**Guard-nya dibuktikan lebih dulu, bukan diasumsikan:** live diperiksa `strategi`
**0 baris** dan `strategi_version` **0 baris** SEBELUM `ck_strver_trigger_set`
dipasang — CHECK baru atas tabel append-only yang sudah berisi baris melanggar
akan menggagalkan seluruh migrasi di tengah jalan.

⚠️ **Satu catatan kejujuran:** SQL yang tersimpan di riwayat migrasi live adalah
versi yang **komentar penjelasnya dipangkas** (payload `apply_migration` punya
batas praktis). **Seluruh DDL dan seluruh `COMMENT ON` identik** — dan itu
dibuktikan sidik jari 148 fakta di atas, yang membandingkan definisi constraint,
`indexdef`, predikat policy, dan tipe kolom. Yang berbeda hanya komentar `--`
di dalam teks migrasi yang tersimpan, bukan skemanya.

## 6. Apa yang tersisa — dan urutannya

### 6.1 Lebih dulu daripada fitur apa pun

~~Keduanya~~ ✅ **SELESAI sesi ini.** #107 (`bc7aa4e`) dan #108 (`c2dc953`)
ter-merge, migrasi disusulkan ke live, sidik jari cocok.

**Konsekuensi yang perlu dibaca:** O47b tidak lagi menunggu PR mana pun. Nol PR
terbuka, jadi rewrite histori sekarang hanya menunggu **jendela waktu pemilik**
— itu satu-satunya yang tersisa di depannya.

### 6.2 Butuh izin/orang, bukan kode

| # | Isi | Kenapa bukan saya |
|---|---|---|
| **O47b — REWRITE** | `git filter-repo` buang `backend/testdata/import_samples/` → force-push `main` → semua kontributor re-clone → tiket GitHub Support | Premis §0 runbook sudah dikoreksi (SESI8 §8): **`main` MEMUAT PII**, menghapus 25 ref memberi **nol** efek. Biayanya jatuh ke orang lain ⇒ butuh jendela pemilik. Runbook: **§5**, bukan §0 (§0 DIBATALKAN) |
| ~~X-14~~ | ✅ **DIJAWAB pemilik 2026-08-08:** laporan klien bulanan dibuat dari **HTML generator**, mayoritas metriknya belum masuk CDPS, dan itu dikerjakan **setelah Strategi dan Plan**. I-3 tetap set D-4, dan **sengaja melebar nanti** — saat itu D-4/D-6 TIDAK ikut. Test yang mengunci ketiganya sudah menuliskan jalan keluarnya sendiri | — |
| **O42-b** | Eksekusi seed `role_mappings` ke bentuk HRIS UPPERCASE | Menggeser gerbang `role_mappings = 12` + bentuk 10 karyawan seed |
| **O59-b** | Gerbang atas **nama** event, bukan jumlahnya | Usul sejak SESI8; masih belum diotorisasi |
| **O60** 🟡 BARU | Detektor ledger O48 menembus satu tingkat indireksi | Keputusan teknis; siapa pun yang meninjau §42 |
| **O24** · **O45** · **X-06** · **X-12** | tidak berubah dari SESI8 §6.2 | — |

### 6.3 Fitur M6 — jalur yang sekarang terbuka

1. **A-13b — Section A, B, C, E, F + UI revisi.** A-13a sudah memberi shell,
   navigasi, panel kekurangan, autosave, dan Section D/G/H/I, jadi yang tersisa
   adalah mengisi lima seksi ke dalam pola yang sudah ada. Baca
   `web-internal/AGENTS.md` lebih dulu — Next di repo ini **16.2.10** dan React
   **19.2.4**, bukan yang ada di data latih.
   ⚠️ Halaman `account/strategies/[id]` yang ADA adalah entitas **lama** M6 §4
   (`strategy_plan`/`STR`) — **jangan** pakai sebagai titik mulai; yang baru
   `account/strategi/[id]`, beda satu huruf.
   ⚠️ **`saveStrategiNarasi` mengganti KEEMPAT field E-1/E-13/H-3/H-4.** Section
   E wajib mengirim ulang H-3/H-4 apa adanya, persis seperti Section H hari ini
   mengirim ulang E-1/E-13. Kalau tidak, menyimpan Section E mengosongkan H.
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

## 8. 🔴 Lapisan klien M6A tidak bisa dijangkau siapa pun — dan gerbangnya hijau

`web-internal/src/lib/strategi.ts` dibangun bertahap sejak A-03 dan tumbuh jadi
sekitar tiga puluh fungsi klien: `getStrategi`, `saveStrategiKonteks`,
`saveStrategiKpi`, `saveStrategiNarasi`, … Sampai sesi ini, **nol** di antaranya
dipanggil dari sebuah halaman.

```
grep -rn "from '@/lib/strategi'" web-internal/src/app   # -> tidak ada satu pun
```

**Dan `route-parity` hijau sepanjang waktu itu — dengan benar.** Ia menjawab
*"apakah setiap path yang dipanggil `web-internal` dilayani `apps/api`"*. Sebuah
fungsi klien yang tidak pernah dipanggil dari halaman **tetap** sebuah call site
untuk pemindainya, jadi paritasnya terpenuhi. Yang tidak ditanyakan gerbang mana
pun: *apakah ada manusia yang bisa sampai ke sana*.

**Kenapa ini berbahaya dan bukan sekadar rapi:** empat sesi berturut-turut
melaporkan "kontrak FE lengkap dan dijaga `shape-parity`" — dan itu benar. Tapi
kalimat itu mudah dibaca sebagai "fitur ini bisa dipakai", padahal jaraknya ke
sana adalah seluruh A-13. Ukuran yang jujur adalah **apakah ada tautan menuju
ke sana**, dan itu tidak diukur siapa pun.

Diperbaiki di A-13a: Service hub sekarang menampilkan kartu **Strategi M6A**
dengan tautan ke `/account/strategi/{id}`.

**⚠️ Beda satu huruf, dan itu disengaja.** `/account/strategies/{id}` adalah
entitas **LAMA** M6 §4 (`strategy_plan` / `STR-`), record berbeda dengan siklus
hidup berbeda. Keduanya ditampilkan sebagai **dua kartu terpisah** di Service
hub: menggabungkannya menyiratkan salah satu menggantikan yang lain, dan tidak
ada modul yang menyatakan itu.

**Usul yang TIDAK dikerjakan sesi ini** (sekelas O59-b/O60, biar diputus di
luar tiket fitur): gerbang yang meng-assert setiap halaman `app/**` bisa
dijangkau dari nav atau dari halaman lain. Ia akan menangkap kelas ini sekali
untuk semua — tapi ia juga akan menandai halaman yang memang hanya dituju dari
notifikasi, jadi ia butuh daftar pengecualian, dan daftar pengecualian yang
lahir di tengah tiket fitur adalah cara daftar itu jadi tempat sampah.

## 9. A-13a — apa yang ada, dan apa yang belum

**Ada:** `/account/strategi/{id}` — navigasi sepuluh seksi dengan hitungan
kekurangan per seksi, panel kekurangan hidup (§5 langkah 5), autosave 20 detik
(§7), aksi Ajukan / Setujui / Kembalikan, dan form penuh **Section D, G, H, I**.

**Tiga bentuk yang datang dari PRD, bukan dari selera — jangan "sederhanakan":**

1. **Hitungan kekurangan selalu dari server**, di-fetch ulang tiap save. Salinan
   kedua aturan kelengkapan di FE akan menyimpang dari `checkCompleteness` yang
   berjalan di transaksi submit, dan AM akan melihat "siap diajukan" lalu
   ditolak `[data tidak lengkap …]`.
2. **Tiap seksi menyimpan ke endpoint-nya sendiri.** Mengirim semua seksi tiap
   tick membuat satu baris tidak valid di seksi mana pun memblokir penyimpanan
   seksi yang sedang dikerjakan — dan menimpa seksi yang AM tidak pernah buka.
3. **Tombol Ajukan TIDAK di-disable saat masih ada kekurangan.** Hitungannya
   snapshot; gerbangnya dijalankan ulang di transaksi submit. Memblokir di FE
   menyembunyikan pesan server, yaitu satu-satunya hal yang memberi tahu AM apa
   yang harus diperbaiki.

**Belum, dan itu A-13b:** Section A, B, C, E, F. Baris navigasinya **tetap ada
dan tetap menampilkan hitungan kekurangannya** — seksi yang belum bisa dibuka
tetap harus terhitung, kalau tidak total di tombol Ajukan tidak menjumlah dan AM
tidak punya cara menjelaskan selisihnya.

### 9.1 Dua bug React yang ditemukan lint, bukan test

`npx eslint src` menolak dua hal yang keduanya cacat nyata, bukan gaya:
`useAutosave` menulis ref saat render, dan `RepeatList` memanggil `setState`
saat render. Keduanya sudah diperbaiki (ref pindah ke effect; rekonsiliasi key
pindah ke effect dengan key `pending-` sementara untuk satu render).

**Pelajarannya:** `npm test` di `web-internal` bebas-framework (konvensi repo),
jadi ia **secara struktural tidak bisa** menangkap kelas ini. `eslint` bisa, dan
ia tidak dijalankan CI hari ini — CI hanya `npm run build` + `npm test`.
Jalankan `npx eslint src` sebelum menganggap kerja FE selesai.

### 9.2 Apa yang TIDAK diverifikasi, dan tidak diklaim

Halaman diverifikasi terhadap `next dev` yang benar-benar berjalan:
`/account/strategi/{id}`, `/account/services/{id}` dan `/account` ketiganya
**200 tanpa penanda error runtime**. Itu menutup kelas "halaman crash saat
di-render".

Yang **tidak** ditutup: jalur interaktif dengan data nyata. DB lokal punya
**nol** `services`, `contracts`, dan `strategi`, jadi tidak ada record untuk
dibuka, dan repo ini tidak punya harness test DOM (konvensinya: pisahkan logika
yang bisa diuji ke modul bebas framework — itulah `lib/strategi-sections.ts`,
12 test). **Jangan laporkan A-13a sebagai "teruji dengan data produksi".**
