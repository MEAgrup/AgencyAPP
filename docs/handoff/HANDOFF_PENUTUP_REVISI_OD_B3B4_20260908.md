# Handoff — Penutup Revisi OD: B3 selesai, B4 diinvestigasi lebih jauh (tetap ⬜), B5 masih menunggu pemilik

> **Ditulis 2026-09-08**, melanjutkan
> `HANDOFF_PENUTUP_REVISI_OD_LANJUT_20260908.md`. PR #324 (isi handoff itu)
> sudah **merge** ke `main` sebelum sesi ini mulai — sesi ini dimulai dari
> branch baru (`claude/handoff-penutup-revisi-od-jzkeno`) di atas tip `main`
> terbaru, bukan menumpuk di branch lama, per aturan "PR sudah merge = mulai
> ulang dari main".

---

## 0. Posisi

| Apa | Nilai |
|---|---|
| Jalur A | ✅ selesai (sesi sebelumnya) |
| B1 (Makefile) | ✅ selesai (sesi sebelumnya) |
| B2 (harness peramban) | ✅ selesai (sesi sebelumnya) |
| **B3 (gerbang drift repo↔live)** | ✅ **SELESAI sesi ini** — bentuk: skrip manual, BUKAN CI terjadwal (ketokan pemilik) |
| **B4 (`withClaims` round-trip)** | 🟡 **diinvestigasi lebih jauh, TETAP `⬜`** — akses Vercel sungguhan dicoba, p95 tetap tidak terukur (alasan baru, lebih presisi — §2) |
| B5 (X-12) | ⬜ **masih menunggu pemilik** — tidak disentuh, sesuai batasan |
| Migrasi di repo | **209** (tidak berubah — B3/B4 tidak menyentuh migrasi) |
| Gate lokal | 149 tabel · 41 entity_prefix · 33 sm_machines · 73 notif_events (db-rebuild.sh --yes, diverifikasi ulang sesi ini) |
| Live (`CDPS SG`) | 211 migrasi, tidak disentuh sesi ini (tidak ada apply baru) |

**Nol perubahan kode aplikasi** sesi ini — hanya `scripts/`, `Makefile`, dan
dokumen (`docs/DECISIONS.md`, `docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`,
handoff ini). Jadi suite test `core`/`db`/`domain`/`api`/`web-internal` TIDAK
dijalankan ulang sesi ini — tidak ada yang bisa mereka regresi-kan. Yang
diverifikasi ulang: `db-rebuild.sh --yes` (bersih, angka di atas).

---

## 1. B3 — gerbang drift repo↔live (SELESAI)

**Bentuk yang dipilih pemilik saat ditanya** (opsi diajukan eksplisit,
bukan ditebak — sesuai instruksi handoff sebelumnya "putuskan salah satu...
JANGAN ditebak"): **skrip manual saja**, bukan job CI terjadwal. Job CI
butuh secret repo baru (`SUPABASE_ACCESS_TOKEN` atau connection string live)
yang belum disetujui — ditunda, bukan ditolak; lihat §4 untuk cara
melanjutkannya kalau pemilik berubah pikiran.

### Berkas baru

| Berkas | Fungsi |
|---|---|
| `scripts/check-live-drift.sh` | Bandingkan `supabase/migrations/**` vs `supabase_migrations.schema_migrations` live, **per-slug** (lucuti satu prefix numerik dari kedua sisi — O65, BUKAN per-nomor). Dua jalur koneksi: `LIVE_DATABASE_URL` (psql) atau `SUPABASE_ACCESS_TOKEN`+`SUPABASE_PROJECT_REF` (Management API via curl+jq). `MISSING ON LIVE` selalu bikin gerbang gagal (exit 1) — itu kelas cacat A-req-3. `EXTRA ON LIVE` dicocokkan ke allowlist; hanya slug BARU yang bikin gagal, dan hanya dengan `--strict`. |
| `scripts/known-live-drift.txt` | Allowlist EXTRA ON LIVE yang SUDAH tercatat di `DECISIONS.md` — `m6a_section_d` (baris ledger duplikat lama, jinak, dan sebenarnya tidak pernah ditandai gerbang ini karena per-slug-unik) + `d3_tutup_buku_pulihkan_komentar_jaga_transisi` (baris `A2-DRIFT` §Open, masih terbuka). |
| `Makefile` target `check-live-drift` | Alias `bash scripts/check-live-drift.sh`. |

### Diuji dengan data live SUNGGUHAN, bukan data sintetis

**Penting untuk sesi berikutnya:** dari sandbox Claude Code ini, `curl` ke
`api.supabase.com:443` DITOLAK proxy organisasi (403 pada CONNECT,
dikonfirmasi) dan TCP langsung ke `*.supabase.co:5432`/`:6543` timeout (di
luar allowlist proxy, dikonfirmasi). Jadi skrip **tidak bisa dites langsung
terhadap live dari sini** — itu bukan bug skripnya, itu kebijakan jaringan
sandbox. Cara pengujian yang dipakai:

1. Ambil ledger live sungguhan (211 baris) lewat `mcp__Supabase__list_migrations`.
2. Muat ke tabel sisipan `supabase_migrations.schema_migrations` di DB lokal
   (`db-rebuild.sh --yes` dulu — tabel itu tidak otomatis ada, konstruksi
   platform Supabase, bukan bagian dari migrasi repo).
3. Jalankan `LIVE_DATABASE_URL=postgresql:///cdps scripts/check-live-drift.sh`
   (via `su postgres`) — hasil: **0 MISSING, 2 EXTRA (keduanya ter-allowlist),
   exit 0**, cocok persis dengan yang ditemukan manual di A2.
4. Uji negatif: hapus satu baris live (`MISSING` terdeteksi, exit 1);
   sisipkan satu baris live palsu (`EXTRA` baru terdeteksi dengan tanda
   `⚠️ BARU`, exit 0 tanpa `--strict` / exit 1 dengan `--strict`).
5. `db-rebuild.sh --yes` sekali lagi untuk membuang tabel sisipan (bukan
   ditulis skrip cleanup — DB lokal disposable, per jebakan #6 handoff
   sebelumnya).

Jadi **logikanya teruji terhadap kondisi live real**, tapi **jalur
koneksinya sendiri (psql/Management API) belum pernah benar-benar
menghubungi Supabase** — itu tugas operator/CI runner dengan akses jaringan
nyata. Kalau sesi berikutnya (di sandbox yang sama) perlu menjalankan
pengecekan drift SUNGGUHAN, jalurnya tetap `mcp__Supabase__list_migrations`
+ diff manual (persis §3 handoff sebelumnya) — `check-live-drift.sh` adalah
alat untuk di luar sandbox ini.

### Cara pakai (di luar sandbox ini)

```bash
LIVE_DATABASE_URL="postgres://postgres:***@db.egddxfcnrtecheiykhlf.supabase.co:5432/postgres" \
  scripts/check-live-drift.sh
# atau
SUPABASE_ACCESS_TOKEN=*** SUPABASE_PROJECT_REF=egddxfcnrtecheiykhlf \
  scripts/check-live-drift.sh --strict
```

---

## 2. B4 — round-trip `withClaims` (masih ⬜, tapi diinvestigasi lebih jauh)

**Dibaca penuh dulu** `docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`
§"Bagian 4" sebelum menyentuh apa pun, sesuai instruksi wajib handoff
sebelumnya.

**Temuan baru sesi ini:** sesi ini, TIDAK SEPERTI sesi-sesi sebelumnya,
punya `mcp__Vercel__*` yang benar-benar terhubung ke tim `meagency` dan
proyek `agency-app-api` (produksi CDPS) — dikonfirmasi `list_teams`/
`list_projects`/`get_project`, deploy produksi terbaru cocok tip `main`.
Region `sin1` (P1) sudah live.

**Tapi p95 TETAP tidak terukur** — dicoba nyata, bukan diasumsikan:
- `get_runtime_logs` (production, 24 jam): baris log cuma
  `method path status [level/source]` + `dep`/`branch`/`cache` — **nol
  field durasi**.
- `get_web_analytics`: pageview/visitor sisi klien, bukan latensi server.
- `get_runtime_errors`: kluster error, bukan durasi.
- Tidak ada tool durasi-fungsi atau Speed Insights di permukaan yang
  di-grant.

**Kesimpulan tidak berubah** dari 2026-09-04 (langkah 5/P2.5 tetap `⬜`,
rekomendasi "PR terpisah setelah p95 diverifikasi" tetap berlaku) —
**tapi alasannya sekarang presisi**, dicatat di `DECISIONS.md` dan di
rencana §"Bagian 4" itu sendiri, supaya sesi berikutnya tidak mengulang
usaha yang sama: p95 sungguhan hanya ada di Vercel Dashboard
(Observability → Functions) atau Speed Insights (add-on terpisah, perlu
`buy_addon` + persetujuan eksplisit pemilik) — keduanya di luar permukaan
MCP yang tersedia.

**Kalau sesi berikutnya ingin melanjutkan B4:** dua opsi konkret, bukan
"tunggu selamanya":
1. Minta pemilik membuka Vercel Dashboard langsung dan menempelkan angka
   p95 (Observability → Functions → `agency-app-api` → production).
2. Ajukan ke pemilik: nyalakan Speed Insights (`mcp__Vercel__buy_addon`
   `siem` bukan yang ini — cek produk yang benar-benar mengukur durasi;
   TIDAK dieksekusi sesi ini karena itu keputusan biaya, butuh persetujuan
   eksplisit lewat `AskUserQuestion`/percakapan langsung, bukan diasumsikan).

Jangan mengerjakan langkah 5 (`onconnect`+`RESET`) tanpa salah satu di
atas — risikonya nyata (kebocoran klaim/role lintas request bila `RESET
ROLE`/`RESET ALL` gagal di satu jalur error), dan rencananya sendiri
eksplisit menahan langkah itu sampai dampaknya terbukti.

---

## 3. B5 — tidak disentuh

Sesuai batasan tetap: menunggu pemilik membangun "rumah" KPI X-12
(`docs/backlog/M6ABC_BACKLOG.md`). Tidak ditanyakan ulang sesi ini.

---

## 4. Kalau pemilik mengetok CI terjadwal untuk B3

`scripts/check-live-drift.sh` sudah siap dipanggil dari job CI — tinggal:
1. Tambahkan secret repo (`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`,
   atau connection string live sebagai `LIVE_DATABASE_URL`) di
   GitHub Settings → Secrets (pemilik yang mengisi nilainya, sesi manapun
   sebaiknya TIDAK menyimpan token di percakapan).
2. Tambahkan job terjadwal (`schedule:` cron, BUKAN `on: push` — live
   berubah independen dari push) yang menjalankan
   `bash scripts/check-live-drift.sh --strict` dan gagal/memposting kalau
   exit-nya bukan 0.
3. Skrip sudah menangani sisi perbandingan; job CI-nya sendiri belum ditulis
   (sengaja, sampai pemilik mengetok bentuknya).

---

## 5. Angka acuan (diverifikasi ulang sesi ini)

```
db-rebuild.sh --yes: 209 migrasi
  gate: 149 tabel · 41 entity_prefix · 33 sm_machines · 73 notif_events
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks
  (dijalankan 2x sesi ini — sekali untuk smoke-test B3, sekali untuk
  membersihkan tabel sisipan sesudahnya — keduanya bersih)

live CDPS SG: 211 migrasi, TIDAK disentuh sesi ini (nol apply baru)

core/db/domain/api/web-internal: TIDAK dijalankan ulang — nol kode aplikasi
  berubah sesi ini (hanya scripts/Makefile/docs). Angka handoff sebelumnya
  (985/64/2188+1 skip/494/695) masih jadi acuan terakhir yang terverifikasi.
```

---

## 6. Mulai dari mana untuk sesi berikutnya

1. **B3 selesai** — tidak perlu dikerjakan ulang. Kalau live bergerak lagi
   (sesi paralel lain menambah migrasi), jalankan diff manual
   `mcp__Supabase__list_migrations` dulu (§3 handoff sebelumnya) sebelum
   apply apa pun — `check-live-drift.sh` baru berguna dari luar sandbox ini.
2. **B4 tetap `⬜` secara sah** — bukan kegagalan, laporkan apa adanya kalau
   ditanya. Jangan coba mengukur p95 dari sandbox lagi tanpa salah satu dari
   dua opsi §2 — sudah dicoba dan hasilnya sama.
3. **B5 tetap tidak disentuh** sampai pemilik membawanya.
4. Program "Penutup Revisi OD" (Jalur A + B1-B5) secara efektif **selesai
   sejauh yang bisa dikerjakan tanpa ketokan/akses tambahan pemilik** — B3
   tertutup penuh, B4 diinvestigasi sampai batas yang tooling izinkan, B5
   menunggu. Sesi berikutnya kemungkinan besar mulai dari backlog lain
   (`docs/backlog/CUTOVER_BACKLOG.md` atau prioritas baru pemilik), bukan
   melanjutkan seri handoff ini — cek dengan pemilik apa prioritas
   berikutnya sebelum menebak.
