# Wave 3 — Laporan UAT teknis (2026-07-18)

**Hasil: PASS 38/38 assertion langkah teknis terjangkau-API, FAIL 0, SKIP 4 terdokumentasi**
(runbook `W3_UAT_RUNBOOK.md` langkah 2–41, dieksekusi via API dengan aktor riil + fixture;
skrip repeatable `backend/uat/w3_walk.py`, jalankan setelah boot order README
import_samples §UAT — data unik per run, exit 0 bila 0 FAIL). Eksekusi TIGA kali:
executor Opus 2× + rerun QC orchestrator — ketiganya 38/38 PASS, 0 FAIL.

## Lingkungan
Stack dev container: MariaDB lokal, `cmd/mockhris` + `cmd/cdps` dengan `employees_uat.csv`
**43 baris** (42 Wave 2 = 33 riil + fixture O26/O33/O34, + **1 fixture Wave 3
`UATMKT0001` Marketing lead**), `rolemapseed --role-csv role_mappings_uat.csv` (**31
mapping** + 3 layered, idempoten), `mslseed` 32 layanan; sync `43/43` bersih. Branch
`claude/wave3-uat-runbook-6epydu` (stacked di atas tip PR #11 `75883c3`). Suite penuh
fresh `go test -count=1 -p 1 ./...` di container yang sama SEBELUM walk: **34 paket
hijau, 0 FAIL, 0 skip** (durasi paket DB diverifikasi >1s — prosedur anti-silent-skip
MariaDB dijalankan, insiden tidak terulang). Precondition langkah 3 = `w2_walk.py`
dijalankan penuh **PASS 50/50** (rantai W2 sehat di stack yang sama).

## Aktor
| Peran runbook | Akun | Riil/fixture |
|---|---|---|
| Marketing Staff (owner / target reassign) | INSAN (`2411250460`) / TRI (`2411250461`) | riil |
| Marketing Lead (SPV) | `UATMKT0001` | ⚠ **fixture — preseden O34** (roster HR tanpa lead Marketing/BD) |
| Sales Staff | SAFFIRA (`2404160367`) | riil |
| AM (Account staff, owning) / Account Lead | SYIFA (`2412090425`) / YULIANTI (`2305100275`) | riil |
| Creative Staff / Creative Lead | ARIF (`2111040039`) / `UATCRE0001` | riil / **fixture O34** |
| Ads Staff (scored M14) / Ads Lead | KENNY (`2206060100`) / `UATADS0001` | riil / **fixture O34** |
| KOL / LS / Finance | `UATKOL0001-2` / `UATLSS0001` / `UATFIN0001-2` | **fixture O34/O33** (precondition W2) |
| OD (layered) / Director | OKFA (`2409230432`) riil / `UATDIR0001` | riil / **fixture O26** |

## Bukti kunci per bagian (status/pesan BI persis)
- **[A 2]** Login lintas peran Wave 3 (incl. INSAN/TRI/`UATMKT0001`); role resolution
  benar; password salah → `[email atau password salah]`; email luar roster ditolak.
- **[B 4–8]** Create tanpa field wajib → `[data tidak lengkap, silahkan lengkapi semua
  pertanyaan wajib!]` **tanpa mint `CMP-`** (house #1); create valid lahir **`Draft`**;
  lifecycle penuh via engine Draft→Active↔Paused→Closed (**`end_date` ter-set +
  audit `set_end_date`**)→Archived; edge ilegal → `[transisi status tidak diizinkan]`;
  reassign M3-OA-6 oleh Marketing-lead⚠/Director (audit `owner_reassigned`), staff
  ditolak, target non-staff-Marketing → `[data tidak ditemukan]`; visibilitas staf
  own-only / lead⚠-OD-Director all / divisi lain 403.
- **[C 9–13]** **O13 dua sisi**: campaign `Draft`/`Paused` + intake ber-campaign →
  **auto-activate via engine + audit `campaign_auto_activated`** dan import jalan;
  `Closed`/`Archived` → **DIBLOKIR** `[campaign belum/tidak aktif, lead tidak bisa
  diimport]`. Source auto: Channel `TikTok Ads` → `Leads - Iklan`, unmapped as-is;
  Origin=Last-Touch saat lahir (origin immutable); Client mewarisi `origin_campaign_id`
  saat closing; rollup derived (leads/real/won/`Rp. 6.250.000,00`).
- **[D 14–17]** Record 1:1: budget kosong/≤0/NaN ditolak; duplikat →
  `[performance record untuk campaign ini sudah ada]` (409, string baru Wave 3);
  **gate M2 §5 Rule 3 teruji dengan level peran benar**: Marketing-lead⚠ NON-owner
  tulis → 403 (monitor-not-edit), owner/Director boleh, OD ditolak; Auto-Metrics
  derived (ROAS `0.25`, quality `100%`, div-zero `—`); dashboard staf own / lead-OD-Dir all.
- **[E 18]** Sweep `EvHoursLoggedReminder` (event ke-15, satu-satunya pembukaan katalog
  W3): Asset aktif tanpa Hours dapat reminder `m7.hours_logged.reminder`, Asset
  ber-Hours TIDAK (fire-once per hari WIB); AM → `[anda tidak memiliki akses untuk
  menjalankan pemindaian pengingat Hours Logged]`.
- **[F 19–23]** `DEP-` lahir pasca-validasi; 8 uji negatif create (field/tipe/entity/
  self/not-found/cross-client/duplikat/**siklus BFS**) semua pesan persis; otoritas non-AM →
  `[hanya Account Manager pemilik klien atau SPV/Lead Account yang dapat membuat
  Dependency]`; **gate blocking**: approve Target diblokir dengan pesan template §12
  `Brief ini belum bisa lanjut ke [Approved] karena menunggu BRF-… selesai Approved.`;
  Source mencapai `[Approved]` ⇒ Dependency **Satisfied** + emisi
  `m11.dependency.satisfied` ke PIC Target (fire-once), Target lalu lolos; My Tasks +
  Client Board scoped.
- **[G 24–27]** Sweep M13 (period `202606` = bulan tutup terakhir): `CHR-202606-…` lahir,
  UNIQUE (client, period); OD scan → `[anda tidak memiliki akses untuk menjalankan
  pemindaian skor kesehatan klien]`; `components_json` 7 komponen lengkap
  (raw/capped/bobot base-effective/included-excluded + alasan, contoh grace Rule 8);
  toggle ROAS set/get/clear ter-audit; preview derived-on-read (period berjalan
  `2026-07`, TIDAK disimpan); trend = deret snapshot.
- **[H 30–34]** Config weights Director-only (Σ≠100 → `[total bobot KPI harus berjumlah
  100]`; non-Director → `[anda tidak memiliki akses untuk mengubah konfigurasi KPI
  performa]`); seed targets semua `is_placeholder=1` + snapshot ekspos
  `targets_placeholder` (O9 terbuka by design); sweep Director-only lintas divisi
  (`PERF-202606-…` KENNY role Ads, AM role AM; Marketing staf → 404 tanpa profil;
  non-Director → `[anda tidak memiliki akses untuk menjalankan pemindaian skor performa
  tim]`); breakdown penuh + team rollup derived; emisi `m14.performance.published`
  per staf in-tx.
- **[I 35–38]** `/portal/me` (open_tasks SLA-risk + running_score bulan berjalan
  computed-on-read + trend); `/portal/team` (rollup M14 + client shortcuts + block-queue
  delegasi M12); **edge 404 by design** lead divisi non-scored (Marketing-lead⚠ →
  404, sama utk `/performance/teams/Marketing`); `/portal/management` **Director/OD
  SAJA** (band/trend/dragging/AM + filter + sort; staf & lead divisi →
  `[anda tidak memiliki akses ke data ini]`).
- **[J 40–41]** Rantai audit immutable Wave 3 (CMP/LEAD/DEP + `campaign_auto_activated`/
  `owner_reassigned`/`budget_edited`/`last_touch_updated`); **UPDATE SQL langsung ke
  `client_health_snapshots` & `performance_snapshots` GAGAL oleh trigger DB** (CHR-/PERF-
  immutable by construction); OD semua write Wave 3 → 403; recompute derived = nilai
  tampil (rollup M3, Auto-Metrics M2, Health M13, Performance M14, status Dependency).

## Tidak dijalankan (dengan alasan)
- **[1]** boot order = manusia/dev (dilakukan manual saat setup container ini).
- **[42]** **go/no-go gate exit Wave 3 = keputusan manusia (Nerissa/Yohan + head dev)** —
  laporan ini bahannya.
- **[2d]** Negatif HRIS-down — perlu mematikan mockhris; sudah teruji di gate login UAT
  (Decided 2026-07-17), W1-20, dan W2.
- **[28]** `EvClientBandDrop` (band turun antar 2 periode) — **tak terjangkau API
  real-time**: sweep hanya menskor bulan-kalender-tutup-terakhir (`time.Now()` tak
  injectable via handler) sehingga dua snapshot periode berurutan mustahil dibuat via
  API tanpa menulis DB langsung (dilarang dalam UAT). Tercakup unit test
  `module13_health/snapshot_db_test.go` (assert emisi tepat 1).
- **[29 + angka 34]** Worked example Alpha Digital ≈74,56→Watch & Kenny 86.4/+2/88.4 —
  vektor terkunci unit test (`health_test.go`, `profile_test.go`/`snapshot_db_test.go`);
  data walk real-time (klien baru, period Juni) beda by design. Recompute=display
  (house #4) tetap ter-cover langkah 25/33/41; emisi + eksistensi snapshot + breakdown
  diverifikasi real-time.
- **[39]** M15-C2 Client Portal — **DITUNDA** (Decided 2026-07-18); tidak ada
  kode/endpoint; sengaja di luar cakupan UAT Wave 3.

## Temuan
1. **Perluasan gap O34 ke divisi Marketing (blocking produksi M3/M2 sisi lead):** roster
   HR riil punya 2 staf Marketing (BUSINESS DEVELOPMENT) tetapi **tanpa lead** — UAT
   memakai fixture berlabel `UATMKT0001` (preseden O26/O33/O34). Dua cabang izin
   khas-lead (M3 §5 lead read-all; M2 §5 Rule 3 lead non-owner read-only) hanya
   terjangkau dengan level peran ini. Aktor Marketing-lead produksi = keputusan
   Yohan/HR (masuk daftar Open O34).
2. **O9 tetap terbuka non-blocking:** semua target periode M14 masih seed
   `is_placeholder=1` dan respons snapshot mengekspos `targets_placeholder` — target
   riil (SPV Ads + OD) tinggal masuk via endpoint config tanpa kode.
3. SKIP [28] bersifat arsitektural (sweep fire-once bulan-tutup-terakhir), bukan bug —
   dicatat agar reviewer tidak menganggap jalur band-drop teruji via API; cakupan ada
   di unit test DB.
4. Tiga bug ditemukan selama iterasi = bug SKRIP walk (normalisasi telepon tabrakan,
   set kepemilikan usang) — bukan bug produk; diperbaiki di `w3_walk.py`. Artefak UAT
   di DB dev ephemeral (3 run walk = 3 rantai "UAT W3"); tidak mengganggu.
