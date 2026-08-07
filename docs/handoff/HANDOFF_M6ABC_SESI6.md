# HANDOFF — M6A/M6B/M6C Sesi 6 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI5 → **SESI6 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> Sesi ini **mengeksekusi O57 / tiket B-00** (entitas `CONTRACT`) dan
> **membuktikan** live ≡ repo dengan sidik jari struktural.
>
> **Pemilik: baca §7.** Di sana daftar lengkap yang menunggu Anda — 19 pertanyaan
> `DECISIONS.md` yang belum selesai, disaring ke mana yang benar-benar butuh
> jawaban Anda dan mana yang tidak. **§7.1 dijawab lebih dulu**: ia menentukan
> pekerjaan ronde berikutnya.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| Branch | `claude/handoff-m6abc-sesi5-2eq31i` |
| Commit | `c8cb34c` (di atas `e8de6fa`) |
| PR aktif | **#104** (`B-00 / O57`) — CI **hijau 5/5**, **menunggu merge pemilik** |
| Base | `main` = `d384d95` (terkini, tidak tertinggal) |
| Migrasi | **64 berkas**, live `CDPS SG` **sinkron penuh & terverifikasi** |
| Gate | tabel **75** · prefix **30** · mesin **16** · event **31** |
| Skor | M6A **57%** (8/14) · M6B **8%** (1/12) — papan skor di backlog §0a |

**Tidak ada pekerjaan yang belum ter-push.** Working tree bersih; lokal ≡ remote.

✅ **Ronde berikutnya SUDAH pasti: CACAT 🔴, bukan fitur M6.** Pemilik
mengonfirmasi O56 pada 2026-08-07 — kerjakan **O52 → O51 → O42/O44-asal** lebih
dulu; A-08/A-09/A-13 dan B-01 **ditunda**. Keputusannya kini tercatat di
`DECISIONS.md` §Decided; sebelumnya klaim itu hanya ada di backlog tanpa entri
padanan, dan celah itu ditutup. O56 ditandai RESOLVED di §Open.

Konsekuensi yang diterima pemilik: M6A membeku di **57%** dan M6B di **8%**
selama ronde cacat berjalan.

## 1. Yang mendarat sesi ini — B-00 / O57

"Kontrak" di CDPS = **kumpulan Service satu klien dalam satu kesepakatan**. Klien
yang membeli Store Management + GMV Max + Nano KOL dalam satu kesepakatan 12
bulan mendapat **SATU** Strategi, bukan tiga. Dengan itu M6A terbaca apa adanya:
Rule 2 ("exactly one active Strategi per Contract"), D-1 ("Auto from Contract"),
§7 ("n baris PLAN = contract months").

Migrasi `20260807120000_o57_contract_entity.sql`:

- tabel `contracts` (74 → **75**), prefix `CTR` (29 → **30**)
- `strategi.contract_id` NOT NULL menggantikan `service_id`; ketiga indeks unik
  Rule 2 jadi **per-kontrak**
- `services.contract_id` nullable — Service tanpa kesepakatan payung tetap sah
- RLS `private.jwt_is_am_of_contract` di **dua tempat**; lima tabel anak mewarisi
  lewat `EXISTS` dan tidak disentuh

Konsistensi klien dijaga **FK KOMPOSIT** `(contract_id, client_id)` →
`contracts (id, client_id)`, bukan trigger: "Strategi klien A menggantung di
kontrak klien B" jadi mustahil **disimpan**, termasuk lewat service role.

Kontrak **sengaja tanpa mesin status** — tidak ada PRD yang memberi kontrak
siklus hidup, dan mendaftarkan mesin kosong berarti mengarang nama state
(aturan rumah #2).

### Dua penajaman terhadap rancangan SESI5 §6 — di dalam keputusan (a)

Keduanya tercatat di `docs/DECISIONS.md` ("O57 DIEKSEKUSI"), bukan deviasi.

1. **Jendela kontrak PINDAH, tidak disalin.** Membiarkan tiga kolom jendela di
   `strategi` **dan** di `contracts` berarti dua jawaban untuk satu pertanyaan
   yang B-02 harus tanyakan — "berapa bulan?" — dan generator periode yang
   menemukan keduanya berselisih harus memilih diam-diam. Ketiganya dihapus dari
   `strategi`, dibaca kembali sebagai field **turunan** lewat join (aturan rumah #4).
2. **`sumber_floor` berhenti bisa diketik.** Dihapus dari `TargetInput`; ditulis
   `input_am` oleh `saveTargets`, dibalik ke `disetujui_head` **hanya** oleh
   `approveStrategi`. Rule 7 "read-only" ditegakkan **trigger DB**, bukan cabang
   TS — panggilan service role melewati TS. Nilai lama `kontrak` dipetakan ke
   `input_am`, bukan `disetujui_head`: menaikkannya jadi "sudah disetujui" akan
   mengarang persetujuan yang tidak pernah ada.

## 2. Bukti live ≡ repo — metodenya, bukan cuma hasilnya

SESI5 menutup drift O38 ronde 3 dengan menerapkan 11 migrasi tertunda. Yang
**belum** pernah dilakukan siapa pun: membuktikan hasilnya identik dengan repo.
"Migrasi jalan tanpa error" bukan bukti — itulah persis bagaimana drift O38 lolos
tiga ronde.

Sidik jari struktural **133 fakta** atas `contracts`/`strategi`/`services`/
`strategi_target` — kolom+tipe+nullability, constraint, indeks, RLS policy,
definisi fungsi (di-hash), trigger:

| | Hash |
|---|---|
| Lokal (`db-rebuild.sh`, 64 migrasi dari nol) | `4e2580fd4a47bec0f05777dd2c19569e` \| 133 |
| Live `CDPS SG` | `4e2580fd4a47bec0f05777dd2c19569e` \| 133 |

Kueri sidik jarinya ada di riwayat sesi ini; **jalankan ulang setiap kali habis
`db push`.** Ia menangkap kelas kesalahan yang `list_migrations` tidak bisa:
migrasi tercatat sebagai "applied" padahal isinya sebagian gagal.

## 3. Jebakan sesi ini — tambahan atas SESI1 §5, SESI2 §6, SESI4, SESI5 §9

Keduanya sudah tercatat di SESI5 §9 dan **keduanya kambuh**. Anggap ini bukan
anomali melainkan sifat lingkungan sandbox.

### 3.1 (§9 #8) Checkout lokal mundur sendiri — JANGAN membuat ulang kerja

Di tengah sesi, working tree tiba-tiba kembali ke `18ae571` dan berkas migrasi
`20260807120000` **hilang dari disk**. `git log` lokal ikut mundur, jadi
tampilannya persis seperti "kerja saya lenyap".

**Yang benar:** `git fetch origin` dulu, lalu baca remote. Commit `e8de6fa` utuh
di sana. Pulihkan dengan `git checkout -B <branch> origin/<branch>`.

**Yang salah dan mahal:** menulis ulang migrasinya di atas checkout basi. Itu
melahirkan **dua migrasi berbeda dengan isi yang sama** — kelas kesalahan yang
melahirkan drift O38, dibuat ulang dengan tangan sendiri.

### 3.2 (§9 #6) Postgres di-SIGKILL, dan cara membaca korbannya

Postgres mati **dua kali**; sekali membawa serta seluruh basis `cdps`. Yang kedua
terjadi di tengah `npm test --workspaces` dan menghasilkan:

```
Test Files  35 failed | 1 skipped (36)
     Tests  818 failed | 25 passed | 1 skipped (844)
```

**818 kegagalan itu palsu.** Semuanya `Test timed out in 5000ms`, log postgres
berhenti mendadak tanpa baris shutdown (SIGKILL supervisi container, bukan OOM —
15 GB bebas). Test yang sama lolos **116/116 dalam 7,7 detik** sesudah
`db:rebuild`.

**Cara membedakan artefak dari regresi**, sebelum mulai "memperbaiki" kode yang
tidak rusak:

1. `pg_isready` — kalau merah, hasil test tidak berarti apa-apa.
2. Kegagalan **seragam** `timed out in 5000ms` di seluruh berkas ⇒ infrastruktur,
   bukan logika. Regresi nyata gagal dengan asersi yang berbeda-beda.
3. Bandingkan dengan CI di SHA yang sama — CI punya PG17 sendiri yang tidak mati.

**Konsekuensi praktis:** suite penuh (~844 test, ~30 menit) **tidak andal
dijalankan lokal di container ini** — postgres tidak bertahan selama itu.
Jalankan berkas yang relevan saja (`npx vitest run src/contract.test.ts …`) dan
serahkan suite penuh ke CI.

## 4. Yang BELUM — dan itu bukan kelalaian

- **UI Strategi (A-13) = 0%.** Belum ada satu pun halaman entitas `STRG`.
  ⚠️ `web-internal/src/app/(shell)/account/strategies/[id]/page.tsx` **ada**, tapi
  itu entitas **lama** M6 §4 (`strategy_plan`/`STR`, dari PR #37). Namanya mirip,
  entitasnya beda. Jangan pakai itu sebagai titik mulai A-13.
- **UI kontrak** — menyusul bersama form Strategi.
  `web-internal/src/lib/contract.ts` sudah ada karena `shape-parity` tidak bisa
  memeriksa converter yang tipe FE-nya belum dideklarasi.
- **Section D…J (A-08/A-09)** — 7 dari 10 seksi belum punya field.
- **M6B: nol tabel `PLAN`.** `plan_gate_config` milik M6C. Mesin #16 belum ada.
- **`emit()` katalog v2 belum dipasang** — katalognya ada (O55/X-01), pemanggilnya
  belum. Ini menunggu tiket yang memicunya, bukan pekerjaan tergantung.

## 4b. Audit PR seluruh sesi (2026-08-07) — dua terbuka, nol menggantung diam-diam

Repo punya **70+ branch lama** tanpa PR; semuanya sisa sesi yang kerjanya sudah
masuk main lewat PR lain. Yang benar-benar terbuka hanya dua:

| PR | Isi | Status | Tindakan |
|---|---|---|---|
| **#104** | B-00 / O57 entitas CONTRACT | CI hijau 5/5, base terkini | **Menunggu merge pemilik.** Preseden #102/#103 di-merge sendiri oleh `yohanagustian-del`, jadi sesi ini tidak merge sepihak |
| **#91** | M5-OA-7 Finance — ubah transaksi wajib ACC Direktur | 🔴 **draft, `mergeable: false`, konflik nyata** | Sengaja **dibiarkan** — lihat di bawah |

### Kenapa #91 tidak bisa "dibereskan" sebagai pekerjaan akhir sesi

Kerjanya **nyata dan belum ada di main** (`20260805030200_transaction_change_request.sql`
tidak ada di `origin/main`), jadi menutupnya berarti membuang fitur, bukan
membuang sampah. Tapi merapikannya bukan pekerjaan lima menit:

1. **9 penanda konflik** terhadap main.
2. **Gate-nya basi dua generasi** — branch itu berharap **14 mesin / 19 event**;
   main sudah **16 / 31**. Angka harus dinaikkan di `ci.yml` **dan**
   `scripts/db-rebuild.sh` (dua berkas, satu commit).
3. **Migrasinya out-of-order.** Timestamp `20260805030200` kini jatuh **sebelum**
   `20260806*`/`20260807*` yang **sudah ter-apply ke live**. Menerapkannya apa
   adanya melahirkan **drift O38 ronde keempat**. Ia harus digeser ke ujung
   mengikuti pola §A.7b, persis seperti yang sudah dilakukan branch itu dua kali.

**Perlakukan #91 sebagai tiket tersendiri**, bukan tempelan. Pemilik memutuskan
2026-08-07: biarkan terbuka, catat sebagai utang.

## 5. Pertanyaan terbuka yang masih hidup

Tidak ada yang baru sesi ini. Daftar lengkap ada di §7 (untuk pemilik) dan
backlog §4 (X-03…X-10, khusus M6). Dua yang paling dekat menggigit:

| # | Item | Menunggu | Menggigit saat |
|---|---|---|---|
| X-05 | RA-5 (`tanggal_mulai_siklus` default = tanggal mulai kontrak) | Yulianti | B-02 generasi periode |
| X-10 | O58 — enam field daftar bertanda WAJIB | Yohan / Yulianti | A-08/A-09 |

## 6. Aturan migrasi — tidak berubah, diulang karena mahal

1. Migrasi **hanya** lewat `supabase/migrations/**` + `db push` / `apply_migration`.
   **Jangan pernah** `psql -f` ke live — itu yang melahirkan drift O38.
2. DB lokal dibangun ulang **hanya** lewat `scripts/db-rebuild.sh`.
3. Angka gate hidup di **DUA** berkas (`scripts/db-rebuild.sh` +
   `.github/workflows/ci.yml`). Menaikkan satu saja = CI merah dengan seluruh
   test suite hijau.
4. Sesudah `db push`, **jalankan sidik jari §2**. Jangan percaya "tidak error".

## 7. SEMUA yang menunggu keputusan pemilik — daftar lengkap

Diambil dari `docs/DECISIONS.md` §Open (**19 item belum selesai** dari 61 baris)
disaring ke yang benar-benar butuh Anda. Sisanya pekerjaan developer atau
menunggu data live, dan **tidak** perlu Anda jawab.

### 7.1 Jawab lebih dulu — menentukan pekerjaan ronde berikutnya

| # | Pertanyaan | Kenapa mendesak |
|---|---|---|
| ~~1~~ | ✅ **TERJAWAB 2026-08-07 — ya, cacat dulu.** Entri `DECISIONS.md` sudah ditulis; O56 RESOLVED | — |
| ~~2~~ | ✅ **TERJAWAB — di-merge 2026-08-07** | — |
| ~~3~~ | ✅ **TERJAWAB — dikerjakan 2026-08-07**, sesi yang sama | — |

### 7.2 Cacat 🔴 yang menunggu pilihan Anda (a) atau (b)

| # | Isi | Blokir |
|---|---|---|
| **O52** | Halaman detail Task/Asset/Booking **404 untuk divisi eksekusinya sendiri** | Tidak memblokir penugasan AM/PIC |
| **O51** | `GET /portal/me` menabrak `role_mappings` — cacat sekelas `sm_edges` di satu jalur baca | Tidak memblokir halaman sales |
| **O48** | Kelas cacat O46 ternyata **36 policy lebar**, bukan 3 arm (survei, bukan sampel) | Tidak memblokir cutover |
| **O44-asal / O42** | `route-parity.test.ts` buta terhadap panggilan API dari komponen halaman ⇒ **6 route admin mati**, 2 halaman admin mati total. Bagian (c): arah auth ganti-password | **Memblokir C-04** |
| **O45** | Invariant lokal tidak bisa melihat grant yang bocor di live | Tidak memblokir cutover |

### 7.3 Kebijakan & data — butuh Anda atau HR

| # | Isi | Menunggu |
|---|---|---|
| **O47b** | 🟠 **PII masih ada di HISTORI git**, cakupan scrub **89 branch** bukan `main` saja. Butuh persetujuan hapus ~85 branch basi + tiket GitHub Support | Kebijakan retensi (pemilik) |
| **O26** | Layered role Director — **kirim NIK + email Yohan & Nerissa** | HR / Yohan |
| **O34** | Roster HR riil tanpa aktor untuk beberapa peran Wave 2 (divisi KOL kosong dll) | Yohan + HR |
| **O35** | Granularitas sub-tim Creative (Video/Graphic) M7 §3 | Nerissa / Yohan + HR |
| **O25** | Anomali sheet kalkulator MSL (Nano KOL batas minimal dll) | Sales Head / COO |
| **O6** | Sample data spreadsheet leads/klien existing untuk parser migrasi | Yohan (akses/export sheet) |
| **O9** | Target periode nyata M14 (GMV Impact, Optimization Activity, Creator Count) | SPV Ads + OD |

### 7.4 M6-spesifik (backlog §4) — menunggu Anda / Yulianti

| # | Isi | Menggigit saat |
|---|---|---|
| **X-05** | RA-5 — `tanggal_mulai_siklus` default = tanggal mulai kontrak | B-02 |
| **X-10** | O58 — enam field daftar bertanda WAJIB | A-08 / A-09 |
| **X-03** | Ambang pemicu (20 item · Rp 15jt · 1 bulan) belum diuji ke data riil | GA-1 |
| **X-04** | RA-4 — jendela baseline tak rata antar channel | validasi D-3 |
| **X-06** | RA-7 — tautan klien hanya versi aktif, tanpa riwayat/diff | A-11 |
| **X-07** | PA-2/PA-5 — jendela GMV manual 5 hari · force-close +7 hari | B-06 / B-09 |
| **X-08** | PA-3 — metrik auto PE-3 belum tentu tersedia semua | B-06 |

### 7.5 TIDAK perlu Anda jawab

`O2` `O4` `O5` `O7` `O8` — timeline/head-dev/Phase-2/menunggu data live pasca
Wave 2. Dicatat supaya tidak terus muncul sebagai "terbuka" yang mencemaskan.
