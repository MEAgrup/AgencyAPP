# Handoff — M19 Creative Daily Ops (2026-09-09)

## Posisi

Separuh **jadwal harian** M19 selesai dan bisa dipakai. Separuh
**`SMO & Content Strategist`** ditahan menunggu satu ketokan.

| Apa | Nilai |
|---|---|
| Commit | `1947262` (skema+kosakata) · `9140ec6` (domain) · `65c67d4` (rute+layar) · commit ini (dokumen) |
| Branch | `claude/eloquent-clarke-qmk87m` |
| Migrasi di repo | **216** (`20260927010000_m19_creative_daily_ops.sql`) |
| Gate | **153 tabel · 42 entity_prefix · 33 sm_machines · 73 notif_events** |
| Live `CDPS SG` | **BELUM** — migrasi M19 belum diterapkan (lihat §4) |

Angka gate diambil dari keluaran `scripts/db-rebuild.sh` yang benar-benar
dijalankan dari nol, bukan dari aritmetika.

## Tes — jumlah yang JALAN, bukan "0 failed"

```
core        985 lulus · 27 berkas
db           81 lulus ·  8 berkas   (+17 dailyops.registry)
domain     2300 lulus (+1 skip) · 82 berkas   (+67 dailyops)
apps/api    496 lulus · 33 berkas
web-internal 729 lulus · 54 berkas
db-rebuild  153 · 42 · 33 · 73 + ident/immutability/rls/auth_claims
typecheck   bersih di 6 target (4 workspace + 2 app frontend)
lint        3 error + 61 warning — IDENTIK dengan baseline (diverifikasi
            lewat `git stash`); ketiganya pre-existing di
            `admin/employees` + `performance/page.tsx`. Nol tambahan M19.
```

⚠️ Kalau `db` melaporkan **0** tes, `DATABASE_URL` tidak sampai dan SELURUH tes
DB/RLS di-skip diam-diam sementara `make test` tetap lapor hijau.

## 1. Yang dibangun

Tiga tabel, satu prefix, **nol mesin status, nol event notifikasi**:
`studios` (registry, seed di migrasi) · `prod_slots` (`SLOT-`) ·
`pic_unavailability`. Delapan rute di `/api/v1/creative/`, tiga layar di
`/creative/schedule`, `/creative/schedule/rekap`, `/creative/ketersediaan`.

Menutup Gap A (kalender harian), D (ketidaktersediaan PIC), E (booking studio),
F (penyelesaian hari-sama).

## 2. Enam hal yang paling mudah dirusak sesi berikutnya

1. **Warn-not-block adalah perilaku, bukan validasi yang belum selesai.** Konflik
   studio dan PIC tidak tersedia menjawab **201/200 dengan `peringatan`**, bukan
   4xx (D3/D4). Sebuah tes yang meng-assert 4xx di dua tempat itu menguji
   perilaku yang SALAH dan akan **hijau** kalau seseorang "memperbaiki" modulnya
   jadi memblokir. Tiap tes warn karena itu meng-assert pesannya **DAN**
   keberadaan barisnya di DB.
2. **Nol `EXCLUDE USING gist`, dan itu bukan kelalaian.** Jawaban Postgres yang
   "benar" untuk tumpang-tindih memblokir — persis yang dilarang D3.
3. **Tumpang-tindih SETENGAH TERBUKA, rentang cuti INKLUSIF.** 09.00–12.00 lalu
   12.00–14.00 bukan konflik; cuti "10–12" mencakup tanggal 12. Dua bentuk
   berbeda, dua fungsi berbeda di `core/dailyops.ts`, masing-masing ada tesnya.
4. **`actual_qty` NULL ≠ 0.** NULL = slot belum ditutup. Men-default-kannya ke 0
   membuat slot yang belum ditutup terbaca sebagai gagal total, dan merusak
   `slot_fill_pct` yang membaca null/not-null.
5. **D5: angka penyelesaian hari-sama TIDAK boleh masuk Modul 14.** Dijaga tes
   yang memindai `performance.ts`, bukan cuma komentar.
6. **Nol mesin status pada `PROD-SLOT`.** Kalau `status` muncul di `prod_slots`
   atau `SLOT_STATES` muncul di `core/dailyops.ts`, D1 sedang dibatalkan tanpa
   entri `DECISIONS.md`. Dua tes memaku ketiadaan itu.

## 3. Menunggu ketokan pemilik — `M19-SCS-ENGINE`

Satu pertanyaan, sudah dipersempit sampai murah dijawab:

> Baris `SMO & Content Strategist` memakai mesin **`brief_task`** yang sudah ada
> sebagai Task M12 keempat, atau mesin **sendiri (#34)** pola `internal_tasks`?

- **Task M12 keempat** ⇒ `sm_machines` **tetap 33** (Asset pun tidak punya mesin
  sendiri — `task.ts:8`), tapi butuh amandemen PRD M12 §2 Rule 1 **dan**
  `client_id` harus WAJIB, yang menghapus kasus "all client" dari sheet.
- **Mesin sendiri #34** ⇒ M12 tidak disentuh, `client_id` boleh nullable, dan
  `task.computeMetrics()` (exported, pure) tetap dipakai ulang sehingga tidak ada
  definisi kedua Speed Score. **Rekomendasi.**

Rinciannya di `DECISIONS.md` §Open dan PRD §12. Prefix `SCS` **sengaja belum
didaftarkan**. Yang **tidak** menunggu apa pun: keempat Gap di atas, yang justru
bagian yang hari ini dikerjakan dengan tangan setiap hari.

Dua item lain ditunda dengan sengaja: jurnal koordinasi Content Creator
(Gap H-1, ikut D1) dan KPI Profile M14 untuk peran gabungan (PRD §5.5).

## 4. Langkah berikutnya — urutannya WAJIB

Migrasi M19 **belum** ada di live `CDPS SG`. Urutan yang benar (O65, preseden
2026-09-09): **terapkan migrasi ke live LEBIH DULU, baru merge PR** — bukan
sebaliknya. Satu berkas per panggilan `apply_migration`, dalam urutan nama.
**Jangan pernah** `supabase db push`, **jangan pernah** `psql -f`.

Sesudah itu: `scripts/check-live-drift.sh` harus melaporkan nol MISSING (ia tidak
berfungsi dari sandbox Claude Code — egress Supabase diblok kebijakan org;
jalankan dari operator atau CI runner).

## 5. Jebakan lingkungan yang kena sesi ini

- **Cluster Postgres 16 `main` mati sendiri** di tengah sesi (jebakan yang sudah
  tercatat di handoff penutup). `pg_ctlcluster 16 main start` lalu `pg_isready`
  sebelum menyimpulkan apa pun.
- **`node_modules` kosong** di tiga workspace pada awal sesi (`make install`).
- **`DATABASE_URL` tidak di-set** — dan itu yang berbahaya, karena diamnya
  membuat suite hijau tanpa membuktikan apa pun.

## 6. Dua bug yang ditemukan dengan MENJALANKAN, bukan dengan mengklaim hijau

Ditulis di sini karena keduanya lolos typecheck dan hanya muncul saat suite-nya
benar-benar dijalankan:

1. `clients` tidak punya kolom `name` — yang benar `c.toko as client_name` (idiom
   `creative.ts:905`).
2. Tabel sekuens ID bernama `id_sequences (prefix, period, next_n)`
   (`20260722060601_ident_next.sql:39`), bukan `ident_sequences.seq`. Yang
   menyebut nama salah itu di seluruh repo hanya berkas tes yang baru ditulis
   sendiri — ketemu lewat `grep`, sebelum dijalankan.

## 7. Sumber

`docs/prd/CDPS_Module19_Creative_Daily_Ops.md` · `docs/backlog/M19_BACKLOG.md` ·
`docs/DECISIONS.md` (baris `Decided` 2026-09-09 + `Open` `M19-SCS-ENGINE`) ·
`CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md`
