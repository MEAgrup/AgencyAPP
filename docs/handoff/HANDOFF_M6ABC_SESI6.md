# HANDOFF — M6A/M6B/M6C Sesi 6 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI5 → **SESI6 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> Sesi ini **mengeksekusi O57 / tiket B-00** (entitas `CONTRACT`) dan
> **membuktikan** live ≡ repo dengan sidik jari struktural. Tidak ada keputusan
> pemilik baru yang diminta.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| Branch | `claude/handoff-m6abc-sesi5-2eq31i` |
| Commit | `e8de6fa` + commit dokumen sesi ini |
| PR aktif | **#104** (`B-00 / O57`), base `main` = `d384d95`, CI hijau |
| Migrasi | **64 berkas**, live `CDPS SG` **sinkron penuh & terverifikasi** |
| Gate | tabel **75** · prefix **30** · mesin **16** · event **31** |
| Skor | M6A **57%** (8/14) · M6B **8%** (1/12) — papan skor di backlog §0a |

**Ronde berikutnya BUKAN M6A/M6B.** Pemilik menjawab O56 pada 2026-08-07:
kerjakan **CACAT 🔴 (O52 / O51 / O42)** lebih dulu, bukan A-13 maupun B-01.
B-01 sudah tidak terblokir secara teknis — tapi ia bukan yang diminta berikutnya.

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

## 5. Pertanyaan terbuka yang masih hidup

Tidak ada yang baru sesi ini. Yang masih menunggu manusia: **X-03, X-04, X-05,
X-06, X-07, X-08, X-10** — daftar lengkap di backlog §4. Dua yang paling dekat
menggigit ronde berikutnya:

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
