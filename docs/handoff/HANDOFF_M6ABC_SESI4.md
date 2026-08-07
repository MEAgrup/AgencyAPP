# HANDOFF — M6A/M6B/M6C Sesi 4 (titik mulai sesi berikutnya)

> **Konteks:** lanjutan `HANDOFF_M6ABC_SESI3.md`. Sesi ini mengerjakan **A-07**
> (Section C — Diagnosa & Akar Masalah, 4 tabel baru, Rule 6, 12 test case).
>
> Berkas SESI1, SESI2, SESI3 **tetap berlaku** dan tidak digantikan.
> Yang di bawah hanya menambah di atas SESI3.

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/ci-gates-db-migrations-101jt4` |
| **Commit terakhir** | `a9b7a47` — "M6A A-07 §4 — Section C (Diagnosa & Akar Masalah)" |
| **PR aktif** | **#101** masih TERBUKA. Sesi ini menumpuk DI ATASNYA. Jangan buat PR baru kecuali diminta |
| **Migrasi** | **60 berkas** lokal. **8 BARU belum diterapkan ke live `CDPS SG`** (7 dari sesi sebelumnya + 1 Section C) |
| **Tabel** | **73** (dari 69). +`strategi_diagnosa` · `strategi_quick_win` · `strategi_risiko_struktural` · `strategi_prasyarat_klien` |
| **`sm_machines`** | **16 — TIDAK disentuh** |
| **`notif_events`** | **17 — TIDAK disentuh.** O55 masih menunggu tanda tangan Hans |
| **Test** | 9 pass · 82 skip (non-DB) · shape-parity 11 pass · route-parity 5 pass |
| **TypeScript** | `tsc --noEmit` EXIT 0 (domain + api + web-internal semua bersih) |

**Perintah untuk melanjutkan:**

```bash
git fetch origin claude/ci-gates-db-migrations-101jt4
git checkout claude/ci-gates-db-migrations-101jt4
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal      # TERPISAH — bukan anggota workspaces
```

---

## 1. Yang SELESAI sesi ini — A-07 (Section C)

### Ringkasan deliverables

| Berkas | Perubahan |
|--------|-----------|
| `supabase/migrations/20260807000000_m6a_section_c.sql` | **BARU** — 4 tabel + RLS |
| `packages/domain/src/strategi.ts` | BOTTLENECK_KINDS, VALID_BASELINE_FIELD_IDS, 6 pesan BI, 4 interface, `saveDiagnosa`, perluasan `checkCompleteness` + `copyChildren` + `loadDetail` |
| `apps/api/src/app/api/v1/strategi/[id]/diagnosa/route.ts` | **BARU** — `PUT` handler |
| `apps/api/src/lib/wire.ts` | 4 wire interface, `StrategiDetailWire` diperluas, `strategiDiagnosaFromWire()` |
| `apps/api/src/lib/shape-parity.test.ts` | 4 entri WIRE_TO_FE baru |
| `web-internal/src/lib/strategi.ts` | 4 tipe FE, body shapes, `saveStrategiDiagnosa()` |
| `packages/domain/src/strategi.test.ts` | Fixture `DIAGNOSA_PAYLOAD`, `seedSubmittable` diperluas, 12 test case Section C |
| `scripts/db-rebuild.sh` | gate 69 → **73** |
| `.github/workflows/ci.yml` | gate 69 → **73**, komentar diperbarui |

### Tiga hal penting Section C

1. **Rule 6 divalidasi di `saveDiagnosa`, BUKAN di submit.**  
   `VALID_BASELINE_FIELD_IDS` adalah closed set A-1..A-16 + B-0.1..B-9.3. DB CHECK
   tidak bisa memvalidasi ini (subquery dilarang di Postgres CHECK). Karena
   validasi ada di save, baris yang masuk ke DB sudah pasti field_ids-nya valid —
   sehingga `checkCompleteness` tidak perlu memvalidasinya ulang.

2. **Replace-set, bukan UPSERT row-by-row.**  
   `saveDiagnosa` DELETE semua 4 sub-seksi, INSERT baru. Sama seperti `saveAkses`
   dan `saveKonteks`. Ini membuatnya idempotent dan mudah diuji.

3. **C-5 min 3, C-6 min 1, C-7 min 1.**  
   Nilai minimum PRD eksplisit untuk C-5. C-6 dan C-7 minimum 1 berdasarkan "W"
   (required) di §5 — structural risk selalu ada di tahap strategi, begitu juga
   prasyarat klien.

---

## 2. Yang BELUM dikerjakan — urutan berikutnya

### A-08 — Section D (Asumsi & Target lanjutan) — **BERIKUTNYA**

**Apa saja:**
- Endpoint baru: `PATCH /api/v1/strategi/{id}/assumptions/{kode}/status` — flip
  satu asumsi ke `Gugur` atau `Terverifikasi`. Ini berbeda dari `PUT /assumptions`
  yang replace-set seluruh seksi.
- Domain baru: `flipAssumptionStatus(sql, actor, id, kode, newStatus)`.
  - Flip ke `Gugur` → **tidak** langsung trigger `strategi_revisi_disarankan`
    (transisi state machine itu), karena O55 masih pending. Cukup update kolom
    `status` di `strategi_assumption` dan catat di `audit_log`. Sesi berikutnya
    sambungkan ke transisi setelah O55 selesai.
  - Hanya `Aktif` → `Gugur` atau `Aktif` → `Terverifikasi` yang sah. `Gugur`
    tidak bisa balik ke `Berlaku` tanpa revisi baru.
- **D-7 Sanggahan Target** adalah kolom opsional (`O`) di tabel `strategi` — field
  `sanggahan_target text` di migrasi baru. Endpoint: `PUT /api/v1/strategi/{id}/sanggahan`
  atau boleh juga ditambah ke `PUT /konteks` jika ukurannya kecil. Tapi karena
  D-7 hard-internal (§4.1), ia TIDAK boleh masuk ke client-facing output.

**Yang sudah ada (tidak perlu diulangi):**
- `saveAssumptions` (replace-set D-8/D-9) → sudah ada di domain + route.
- `checkCompleteness` sudah memeriksa `D-8` (min 3 asumsi + setiap GMV target wajib
  punya asumsi terkait).

**Batasan A-08:**
- Jangan tambah baris ke `notif_events` — O55 belum.
- Flip `Gugur` catat di `audit_log` sebagai `asumsi_gugur`, aktor, sebelum/sesudah.
- `strategi_revisi_disarankan` transition boleh dikerjakan jika O55 sudah
  ditandatangani. Jika belum, cukup comment "// O55: transisi ini menunggu katalog
  notif v2" di kode.

### A-09 — Section E/F/G/H/I/J

**Section E** (Pilar Strategi) dan **Section F** (Sumber Daya) sudah ada tabelnya
(`strategi_pillar`, `strategi_resource`) dan domain-nya (`savePillars`,
`saveResources`). Yang belum: **Section H** (Risk Register) — `strategi_risk` sudah
ada (`saveRisks`). Jadi yang betul-betul belum:

- **Section G** — Thesis & Prioritas Channel: kolom teks di `strategi`. Endpoint
  `PUT /konteks` atau endpoint baru; field `thesis`, `channel_prioritas`, dsb.
- **Section I** — Jadwal Implementasi: tabel baru `strategi_jadwal` (per channel,
  per milestone bulan). Perlu migrasi + gate naik.
- **Section J** — Persetujuan & Histori: tabel `strategi_version` sudah ada.
  Section J fields yang belum: `catatan_reviewer` (sudah ada kolom), `trigger_revisi`
  (sudah ada di revision flow), `asumsi_gugur` (sudah ada). Periksa PRD §5 J-1..J-4
  apakah ada field yang belum diisi.

### A-10 — Overlay Visibilitas (Rule 16)

Dua tier:
- **Hard-internal**: A-10 riwayat agensi, D-7 sanggahan, F-5 beban tim, F-7 batas
  toleransi, H-4 kondisi stop, J-2 catatan reviewer, J-3 alasan revisi. **Tidak bisa**
  di-toggle siapa pun.
- **Default internal, AM bisa toggle ke shareable**: A-3 ruang margin, A-13 SLA klien,
  C-6 risiko struktural, E-4 floor price, F-1 sumber dana, H-1 risk register.
  Toggle ini harus di-audit-log.

Sekarang filter ini belum ada — kolom `visibilitas` ada di `COMMENT` saja. A-10
harus mendarat **sebelum** A-11 (client link) boleh dibuka.

### A-11 — Client Read-Only Link `/s/{token}`

Blokir: A-10 harus selesai dulu (filter visibilitas harus ditegakkan sebelum
link dibuka ke klien).

### A-12 — Revision + Versioning UI + J-4 Diff

Tabel dan logic sudah ada. Yang belum: endpoint diff antara versi (J-4
"perubahan dari versi sebelumnya").

### A-13 — Halaman & Form Section A→J

**Tidak ada satu pun halaman Strategi di `web-internal`** — semua yang dibangun
A-03..A-09 adalah API + domain saja. A-13 adalah FE murni.

Catatan penting dari SESI3: koneksi approval STRG ke gerbang Brief belum ada
(masih pakai entitas M6 §4 lama `STR-`). Ini disambungkan di A-13.

### M6B (B-01..B-11) — Plan Period Entity

**Belum dimulai.** O57 harus dijawab dulu (Yohan/Yulianti: CONTRACT entity
decision sebelum M6B B-01 bisa dibuat).

---

## 3. Pertanyaan terbuka (O) yang masih pending

| Kode | Menunggu | Masalah | Memblokir |
|------|----------|---------|-----------|
| **O54** | Yohan/Yulianti | Tier untuk 33 entri katalog — mana yang plan-gated, mana yang tidak | A-10 (daftar `Bagikan ke Klien` yang ambiguu) |
| **O55** | Hans + Yohan | Katalog notif v2 amendment — 13 event M6A/6B/6C menunggu tanda tangan | `strategi_revisi_disarankan` transition setelah flip Gugur; semua ping notif M6 |
| **O57** | Yohan/Yulianti | CONTRACT entity — apakah M6B `plan_period` perlu entitas kontrak baru atau menumpang di service? | M6B B-01 — blokir keras |
| **O58** | Yohan/Yulianti | "tidak ada" vs "belum dijawab" untuk 6 field `W` berbentuk daftar (A-11, A-14, B-5.3, B-8.1, B-8.2). Bacaan saat ini: gerbangi angka pendamping, bukan daftar | Klaim "seluruh field wajib Section A/B ditegakkan" |

> **O56 dinyatakan tertutup** (SESI3): pensiun Go dikonfirmasi ulang oleh user —
> semua build di Supabase + Vercel, Go tidak dipakai.

---

## 4. Migrasi yang belum di-`db push`

Delapan berkas di `supabase/migrations/` belum diterapkan ke live `CDPS SG`:

1. `20260805060000_rls_account_lead_service_scope.sql` — RLS lead/service
2. `20260806050000_prospect_activity_and_komisi_service.sql`
3. `20260806060000_entity_prefix_registry.sql`
4. `20260806061000_m6c_plan_gate.sql`
5. `20260806062000_m6c_retier_catalog.sql`
6. `20260806063000_m6a_vendor.sql`
7. `20260806064000_m6a_strategi.sql`
8. `20260806065000_m6a_section_a.sql`
9. `20260806066000_m6a_section_b.sql`
10. `20260807000000_m6a_section_c.sql`

Terblokir PR #98 (ketergantungan yang harus merge duluan). Jangan `psql -f`.
Gunakan `apply_migration` MCP Supabase atau tunggu PR #98 merge.

---

## 5. Jebakan yang sudah dikenali (ringkasan dari SESI1-SESI3)

1. **Gate jumlah tabel hidup di DUA TEMPAT.** Setiap kali menambah tabel: naikkan
   di `scripts/db-rebuild.sh` DAN `.github/workflows/ci.yml` dalam SATU commit.
   Saat ini: **73**. Komentar di kedua berkas saling menyebut.

2. **Gate `sm_machines` hidup di DUA TEMPAT** juga, sama polanya.
   Saat ini: **16**.

3. **Response snake_case HANYA dari `wire.ts`.** Route yang mengirim objek domain
   mentah adalah bug O43: halaman blank walau 200. Kunci HILANG lebih bahaya
   dari null — kirim `null` eksplisit.

4. **`INSERT … SELECT` di `openRevision` (copyChildren).** Kalau menambah kolom
   ke `strategi`, tambahkan juga ke `copyChildren`. Kalau menambah tabel anak,
   tambahkan INSERT … SELECT untuk tabel baru itu. Section C sudah ditambahkan.

5. **`KNOWN_GAPS` di `route-parity.test.ts` harus tetap KOSONG.**
   Setiap `PUT /strategi/{id}/X` yang dipanggil FE wajib ada route handler-nya.

6. **Jangan sentuh `notif_events`** sampai O55 selesai.

7. **`month_index` 1 = bulan TERTUA** (paling lama), n = terbaru (bukan sebaliknya).

8. **DB CHECK tidak boleh berisi subquery.** Validasi yang butuh subquery harus
   ada di domain TS (contoh: Rule 6 validasi field-ID di `saveDiagnosa`).

---

## 6. Arsitektur Section C — catatan singkat untuk A-08

`saveDiagnosa` adalah template yang A-08 bisa ikuti untuk flip asumsi:

```
A-07 pattern:
  saveDiagnosa(sql, actor, id, payload) → withTransaction → requireDraftAndWriter
    → validate → DELETE+INSERT 4 tabel → loadDetail

A-08 pattern (flip asumsi):
  flipAssumptionStatus(sql, actor, id, kode, newStatus) → withTransaction
    → requireDraftOrActiveAndWriter  ← perhatian: Aktif juga boleh flip Gugur
    → read current status → validate transition
    → UPDATE strategi_assumption SET status = newStatus
    → append audit_log
    → (O55: jika Gugur → try sm_transition strategi_revisi_disarankan jika tersedia)
    → return loadDetail(tx, row)
```

Catatan penting: flip asumsi terjadi **pada record Aktif** (bukan hanya Draft).
`requireDraftAndWriter` tidak cukup — flip Gugur harus bisa terjadi saat strategi
sedang berjalan.

---

## 7. Prompt untuk sesi berikutnya — salin utuh

```
Lanjutkan M6A/M6B/M6C dari HANDOFF_M6ABC_SESI4.md.

BACA DULU (urutan):
1. docs/handoff/HANDOFF_M6ABC_SESI4.md   ← dokumen ini (posisi sekarang)
2. docs/handoff/HANDOFF_M6ABC_SESI3.md   ← masih berlaku, jangan dilewati
3. docs/handoff/HANDOFF_M6ABC_SESI1.md   ← §4 (PR #98 blocker), §5 (walk HTTP)
4. docs/prd/CDPS_Module6A_Strategi.md    ← PRD M6A
5. docs/backlog/M6ABC_BACKLOG.md         ← A-07…A-13 (M6A) & B-01…B-11 (M6B)
6. docs/DECISIONS.md, cari O54/O55/O57/O58

KEADAAN SEKARANG:
- A-07 Section C SELESAI: 4 tabel baru (strategi_diagnosa, strategi_quick_win,
  strategi_risiko_struktural, strategi_prasyarat_klien), Rule 6 divalidasi di save
  time, saveDiagnosa, checkCompleteness C-1..C-7, copyChildren diperluas, 12 test.
- Tabel: 73 (gate sudah diperbarui di db-rebuild.sh DAN ci.yml).
- TypeScript bersih (domain + api + web-internal).
- shape-parity: 11 hijau. route-parity: 5 hijau. KNOWN_GAPS = kosong.
- BELUM: A-08 (flip asumsi Gugur + D-7 Sanggahan Target), A-09 (Section G/I), 
  A-10 (overlay visibilitas), A-11 (client link), A-12 (diff versioning), 
  A-13 (halaman & form — TIDAK ADA halaman Strategi di web-internal), dan M6B.

TUGAS: A-08 — Section D lanjutan:
  1. `flipAssumptionStatus(sql, actor, id, kode, newStatus)` — domain function.
     Flip ke Gugur/Terverifikasi. Catat di audit_log. Jangan trigger notif
     (O55 pending). Jangan restricT ke Draft saja — flip terjadi pada Aktif juga.
  2. `PATCH /api/v1/strategi/{id}/assumptions/{kode}/status` — route handler.
  3. D-7 Sanggahan Target: kolom `sanggahan_target text` di tabel `strategi`
     (migrasi baru). Endpoint PATCH atau extend PUT /konteks. Hard-internal (§4.1)
     — JANGAN masuk ke client-facing output.
  4. Test: flip valid, flip invalid transition, flip pada Aktif, write-lock pada
     Diajukan, checkCompleteness tidak terpengaruh flip.
Lalu lanjut A-09 jika masih ada waktu.

BATASAN YANG TIDAK BOLEH DILANGGAR:
- Jangan tambah baris ke notif_events (O55 masih pending).
- Format ID PREFIX-YYYYMM-NNNN (CLAUDE.md #1).
- Riwayat immutable — audit_log + strategi_version append-only.
- Transisi status HANYA lewat sm_transition.
- Migrasi HANYA lewat supabase/migrations/** + db push / apply_migration.
  JANGAN psql -f. Jangan edit migrasi yang sudah diterapkan.
- Kalau menambah tabel/mesin: naikkan gate di scripts/db-rebuild.sh DAN
  .github/workflows/ci.yml, di commit yang SAMA.
- 8 migrasi belum diterapkan ke live; db push terblokir PR #98.
- KNOWN_GAPS di apps/api/src/lib/route-parity.test.ts harus tetap KOSONG.
- Setiap wire interface baru wajib punya tipe FE di WIRE_TO_FE (shape-parity).
- Response snake_case, diterjemahkan HANYA di apps/api/src/lib/wire.ts.
- Kalau menambah kolom ke strategi: tambahkan ke copyChildren di openRevision.

VERIFIKASI YANG DIHARAPKAN:
- npm run db:rebuild -- --yes
- DATABASE_URL=... npm test --workspaces --if-present
- npx vitest run --root web-internal      ← TERPISAH
- walk HTTP lewat route nyata (pola SESI1 §5; ingat 201 untuk create)
- npm run build --prefix web-internal

Branch: claude/ci-gates-db-migrations-101jt4. Commit, push. Jangan buka PR
kecuali diminta.
```
