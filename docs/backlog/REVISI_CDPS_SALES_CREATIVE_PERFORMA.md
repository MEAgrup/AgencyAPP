# CDPS — Revisi Sales, Creative & Performa (backlog)

> Sumber: dokumen rencana yang dibawa Nerissa (COO) 2026-09-04, digabungkan di
> sini dengan format backlog yang sama dengan `docs/backlog/*_BACKLOG.md` lain.
> Branch kerja: `claude/handoff-navigasi-mea-ai-tools-t0iw6o`.

## Titik gabung dengan `main`

Posisi `main` per handoff terbaru (`docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md`,
PR #283/#284/#285 sudah merge): gate `db-rebuild.sh` = tabel **145** /
`entity_prefix` **40** / `sm_machines` **31** / `notif_events` **67** — nol
migrasi menggantung, live `CDPS SG` cocok persis repo. Rencana ini dimulai dari
gate itu; migrasi baru bernomor `20260911*`, di atas migrasi terakhir yang ada
(`20260910010000_gelombang4_adsscanner.sql`).

`scripts/db-rebuild.sh:146` dan `.github/workflows/ci.yml` gate `notif_events`
naik **67 → 69** lewat tiket L2 (2 event baru). Tabel/prefix/mesin **TETAP**
(145/40/31) — tidak ada tabel/prefix/mesin baru di rencana ini.

Sisa terbuka yang **tidak** disentuh rencana ini: SCR-UI-1, O65, O72 (lihat
`docs/DECISIONS.md` §Open) — rencana ini tidak menambah beban ke sana selain
kewajiban urutan apply migrasi (migrasi live berikutnya harus tetap urut:
tidak ada gap sebelum `20260911*`).

Empat rumpun tiket (**P** performa, **C** creative, **L** lead aging, **E**
export) **tidak saling bergantung** satu sama lain — masing-masing bisa jadi
PR sendiri. Ketergantungan keras hanya di **dalam** rumpun (lihat tabel Urutan
Pengerjaan).

---

## Context — tiga revisi dari user CDPS

1. **Sales** — lead yang didaftarkan tapi tidak digerakkan ke `Qualified`
   mangkrak tanpa jaring pengaman. Auto `[Unrespon]` setelah 3 hari diam, auto
   `Not Qualified` setelah 14 hari di `[Unrespon]`, plus export CSV seluruh
   Leads Database.
2. **Creative** — mengisi link asset hari ini `window.prompt` satu-per-satu;
   brief 30 video = 30 halaman + 30 prompt. Diminta: satu layar buka semua
   kolom sekaligus.
3. **Performa** — setiap membuka modul (creative/sales/leads/klien) terasa
   lambat.

### Keputusan pemilik yang sudah diambil

- Jam 3 hari dihitung dari **perubahan status terakhir** (audit log), bukan
  tanggal daftar.
- Export CSV dibuka untuk **semua Director** (Yohan, Nerissa, Hans) — bukan
  kunci per-email.
- Creative: **grid 30 kolom dulu**, mode "1 link folder" ditunda (lihat REV-4).
- Performa: **dikerjakan tuntas** — Tahap 1 (P1) + Tahap 2 (P2).

### Dua mesin status lead (bukan satu)

**A. Prospect Attempt** (`prospect_attempts.status`, dipegang sales, punya
`Qualified`): `Pending Validation` → `New Lead` → `Contacted` →
{`Qualified`|`Not Qualified`} → `Negotiation - Pending Approval` →
{`Negotiation - Approved`|`Negotiation - Revision Required`|`Negotiation -
Rejected`} → `Closed-Success`/`Closed-Lost`, plus `Negotiation - Auto
Approved`, `Blocked`, `[Closed - Kalah Kompetisi]` (otomatis).

**B. Lead Record** (`leads.record_status`, registry pusat): `[Pool]`,
`active`, `[Rejected]`, `[Not Qualified]`, `[Deleted]`.

`[Unrespon]` masuk **mesin A** (jam per-sales; `leads.record_status`
**tidak disentuh**).

---

## Bagian 1 — Sales: `[Unrespon]` + job harian (L1–L5)

### L1 · Migrasi state `[Unrespon]` + edge

`supabase/migrations/20260911010000_m1_unrespon_state.sql` — 5 edge baru pada
mesin `prospect_attempt`:

| from | to | `require_lead` | alasan |
|---|---|---|---|
| `New Lead` | `[Unrespon]` | true | penuaan digerakkan sistem/Head |
| `Contacted` | `[Unrespon]` | true | idem |
| `[Unrespon]` | `Contacted` | false | jalan pulang — sales hidupkan lagi |
| `[Unrespon]` | `Not Qualified` | false | kaki 14 hari / tutup manual |
| `[Unrespon]` | `[Closed - Kalah Kompetisi]` | false | wajib — lihat ranjau di bawah |

Nol baris di `sm_terminal_states` untuk `[Unrespon]`. Tidak ada edge langsung
`[Unrespon]` → `Qualified` (M0 §4: `Qualified` hanya lewat submit Qualified
Form dari `Contacted`).

**Ranjau wajib ditutup di migrasi yang sama:** `leads.resolveWin` menutup semua
attempt saudara non-terminal ke `[Closed - Kalah Kompetisi]` dan **melempar**
kalau ada transisi gagal, di dalam transaksi Closing M0. Tanpa edge kelima:
lead Pool diperebutkan, satu attempt menua ke `[Unrespon]`, attempt lain
closing → `resolveWin` gagal → **seluruh closing rollback**. Wajib test
integrasi: closing sukses pada lead yang punya saudara `[Unrespon]`.
`[Unrespon]` **tidak** masuk `TERMINAL_ATTEMPT_STATUSES` — tetap terhitung di
`open_attempt_count` dan tetap ditutup `resolveWin`.

**AC:** kelima edge legal + `require_lead` ditegakkan oleh SQL (bukan cuma
TS); edge di luar tabel diblokir; `allowedTransitions('prospect_attempt',
'[Unrespon]')` tepat `['Contacted','Not Qualified','[Closed - Kalah
Kompetisi]']`; closing deal pada lead ber-saudara `[Unrespon]` berhasil.

### L2 · Notif katalog v14 (blocker: L1)

Berkas migrasi terpisah `20260911015000_m1_unrespon_notif.sql` (supaya
"tanpa notifikasi" = penghapusan file, bukan bedah):

| event | penerima |
|---|---|
| `m1.attempt.unrespon` | pemilik attempt |
| `m1.attempt.auto_not_qualified` | pemilik attempt |

Registrasi 5 tempat, satu commit (pola O55): `notif_catalog_versions` (v14,
`event_count=2`) + `notif_events` (2 baris) + `packages/core/src/notification.ts`
(`EVENTS`+`CATALOG_VERSIONS`) + `scripts/db-rebuild.sh:146` (67→69) +
`.github/workflows/ci.yml` gate (angka sama). `notif_catalog.reals.test.ts`
membandingkan DB↔TS per-nama.

### L3 · `leads_unrespon_tick` job (blocker: L1, L2)

Pola **pg_cron di dalam migrasi** (bukan Vercel Cron — job siklus-hidup, bukan
rollup periodik):

- `20260911020000_m1_unrespon_tick.sql` — `public.leads_unrespon_tick(p_now
  timestamptz default now()) returns jsonb`, SECURITY DEFINER, `REVOKE EXECUTE
  FROM public`, pg_cron dibungkus `IF EXISTS (... pg_available_extensions ...)`.
  Jadwal `'30 22 * * *'` = 05:30 WIB.
- Wrapper TS `sales.runUnresponTick(sql, now?)` di `packages/domain/src/sales.ts`.
- Route manual/backfill `apps/api/src/app/api/v1/internal/leads/tick/route.ts`
  — `tickSecretOk(request)` baris pertama POST dan GET, fail-closed (401 tanpa
  secret **dan** saat kedua env tidak diset).

**Jangkar jam** (keputusan pemilik: dari perubahan status terakhir), turunan
murni audit log:

```sql
coalesce(
  (select max(a.created_at) from audit_log a
    where a.entity_type = 'prospect_attempt' and a.entity_id = pa.id
      and a.action like 'transition:%'),
  pa.created_at)
```

Tanpa kolom `unrespon_at` baru — reset otomatis saat lead dihidupkan lagi.
**Hari kalender** (bukan hari kerja) via `wib_date()` — sales wajib respon di
hari libur, dan `hari_libur` masih kosong. **Idempoten gratis**: kandidat
dipilih dari status (`in ('New Lead','Contacted')` / `= '[Unrespon]'`),
`sm_transition` mengunci + membaca ulang di dalam lock — nol kolom penanda.

**Jebakan `require_lead`:** kedua edge penuaan `require_lead=true`, panggil
`sm_transition(..., 'SISTEM', true, false)` — bukan `false` seperti preseden
`wrr_monday_job` (`require_lead=false` di sana). Guard hasil + `raise
exception` kalau `not ok`.

**Baris alasan Not Qualified** — kaki 14 hari menulis, dalam transaksi yang
sama, sebelum transisi:

```sql
insert into prospect_attempt_nq_reasons (attempt_id, reason, created_by)
values (r.id, '[Tidak ada respon]', 'SISTEM')
on conflict do nothing;
```

`[Tidak ada respon]` sudah ada di taksonomi tertutup M1-OA-8 — nol perluasan
taksonomi. `created_by='SISTEM'` membedakannya dari NQ manual (job SQL pakai
`'SISTEM'`, TS domain pakai `'SYSTEM'` — inkonsistensi lama, tidak diperbaiki
di tiket ini, lihat REV-lama di bawah).

**AC:** batas 3 hari (hari 2 diam, hari 3 flip) dari `New Lead` maupun
`Contacted`; batas 14 hari + baris `[Tidak ada respon]`; idempoten (run kedua
`{0,0}`); jam reset saat dihidupkan lagi; batas WIB dibuktikan (bukan UTC);
route tick 401 tanpa/salah secret dan saat kedua env tidak diset.

### L4 · Cermin frontend (blocker: L1)

- `packages/domain/src/sales.ts` — `export const STATUS_UNRESPON = '[Unrespon]'`.
- `web-internal/src/lib/sales.ts` `ATTEMPT_STATUSES` — tambah.
- `web-internal/src/lib/status.ts` `EXACT_MAP` — wajib, `'[unrespon]'` tidak
  cocok heuristik substring; merah/amber.
- `web-internal/src/lib/lead-progress.ts` `ATTEMPT_NEXT_STEP` — tambah
  `'[Unrespon]': 'Hubungi ulang & tandai Contacted'`.
- `web-internal/src/app/(shell)/sales/[id]/page.tsx` — tombol "Tandai
  Contacted" untuk `status === '[Unrespon]'`.
- `docs/STATE_MACHINES.md` §1 — blok `[Unrespon]` bergaya blok `[Deleted]` §2.

### L5 · `junkBreakdown` + `bucketOf` (blocker: L3)

`marketing.junkBreakdown` mengecualikan baris `created_by='SISTEM'` (lead
tak-tersentuh sales ≠ junk campaign) — ambil pilihan ini, bukan tampilkan
sebagai baris terpisah (dicatat di DECISIONS.md sebagai REV-3). CPL/ROAS/
`leadQualityRate` **tidak** terpengaruh (dihitung dari `leads`+audit log, bukan
tabel alasan) — diperiksa, nol perubahan di sana.

`salesperf.bucketOf` mengembalikan `null` untuk status tak dikenal — tambahkan
`[Unrespon]` ke bucket yang tepat di tiket yang sama.

---

## Bagian 2 — Sales: export CSV Leads Database (E1–E2)

### E1 · `GET /leads/export`

Gerbang: `if (!actor.role.director) throw ForbiddenError` — nol tabel/migrasi/
klaim JWT baru. Route baru (bukan `?format=csv` di `GET /leads` — jalur baca
panas dipanggil tiap render, jangan digerbangi/dijadikan kondisional):
`apps/api/src/app/api/v1/leads/export/route.ts`.

Membaca lewat `leads.leadsDatabase` yang sama di dalam `readAsActor`, filter
sama (`status`/`q`/`source`/`mine`) — RLS identik, file selalu sama dengan
tabel di atasnya. **Buffered**, bukan streaming (`readAsActor` commit saat `fn`
return). **Cap baris:** usul 50.000, 400 + pesan BI kalau terlampaui (angka
perlu dikonfirmasi Nerissa — lihat "Perlu dikonfirmasi" di bawah).

**Format:** kolom = `LeadsDbRow` snake_case sama persis `leadRowToWire` (buang
`registered_by_me`/`claimed_by_me`); `created_at` sebagai waktu sipil WIB
(`core/tz`); **BOM UTF-8** + delimiter **`;`** + CRLF (Excel locale
Indonesia), tanpa baris `sep=;`; `Content-Disposition: attachment;
filename="leads-database-<YYYY-MM-DD>.csv"` (tanggal WIB), `Cache-Control:
no-store`. Helper `apps/api/src/lib/csv.ts` — regex escape diperluas ke `/[",\n;]/`
kalau ada regex sejenis dipakai bersama; jangan impor dari `web-internal`.

**Test wajib:** matriks izin staff/lead/**OD**→403 (OD read-only ≠ boleh
export), Director→200 `text/csv`; export tidak melebarkan RLS (lead yang tak
bisa dibaca grantee absen dari body); route-parity `KNOWN_GAPS` tetap kosong +
asertion positif `expect(routes).toContain('GET /leads/export')`.

### E2 · Tombol export + parity (blocker: E1)

`web-internal/src/lib/api.ts` `request()` selalu `JSON.parse` — **tidak
dipakai** untuk CSV. Fungsi terpisah di `web-internal/src/lib/leads.ts`:
`fetch()` mentah `credentials:'include'` → cek `res.ok` (gagal → `res.json()`
→ `ApiError` string `[...]`) → `res.blob()` → `URL.createObjectURL` → `<a
download>` → `revokeObjectURL`.

Tombol "Export CSV" di baris filter `DatabaseTab`, meneruskan
`appliedQ`/`appliedStatus`/`appliedSource`, state "mengekspor…".

`CALL_RE` di `parity-scan.ts` tidak mengenali `fetch()` mentah — tutup dengan
asertion positif di `route-parity.test.ts` (bukan `KNOWN_GAPS`).

---

## Bagian 3 — Creative: submit output massal (C1–C4)

**Temuan pembentuk desain:** mode "1 link folder" dan "30 kolom" adalah
**endpoint yang sama**; nol migrasi, nol edge mesin baru, nol string BI baru.
Semua edge dipakai sudah ter-seed dan `require_lead=false`: `[To
Do]→[In Progress]→[Submitted]→[In Review]→[Approved]`.

### C1 · Refactor `execEdgeTx` (nol perubahan perilaku)

`driveExecEdge` (`task.ts`) membuka transaksinya sendiri → 30× `submitAsset` =
30 transaksi tanpa atomisitas. Pecah: `execEdgeTx(tx, actor, src, id,
requireFrom, to, submitLink, opts?: {propagate?: boolean})` (badan lama minus
`withTransaction`, `propagate` default true); `driveExecEdge =
withTransaction(sql, (tx) => execEdgeTx(tx, ...))`. Semua pemanggil lama
identik setelahnya — `task.test.ts` hijau = bukti.

### C2 · `submitAssetBatch` + `startAssetBatch` (blocker: C1)

`packages/domain/src/task.ts`, bentuk meniru `creative.createAssetBatch`:

```ts
export interface AssetExecLine { assetId: string; outputLink?: string }
export interface AssetExecRowResult {
  rowNumber: number; assetId: string; sequenceNo: number;
  applied: boolean; fromStatus: string; toStatus: string; reason: string;
}
export interface AssetExecBatchReport {
  applied: number; rejected: number; briefId: string; briefStatus: string;
  rows: AssetExecRowResult[]; rejections: AssetExecRowResult[];
}
export function submitAssetBatch(sql, actor, briefId, lines): Promise<AssetExecBatchReport>
export function startAssetBatch(sql, actor, briefId, assetIds): Promise<AssetExecBatchReport>
```

**Penguncian:** satu transaksi, Brief `for update` dulu (sama dengan
`lockAssetableBrief`), lalu Asset `order by sequence_no asc`.

**Kebijakan kegagalan: all-or-nothing dengan laporan per-baris** — beda dari
import leads (commit per baris) karena setiap alasan tolak di sini adalah
pembacaan murni. Fase 1: vonis semua baris di bawah lock. Fase 2: ada yang
ditolak → kembalikan laporan tanpa menulis apa pun. Fase 3: bersih → loop
`execEdgeTx(..., {propagate:false})` lalu `recomputeBriefRollup` sekali di
akhir. Nol string BI baru — pakai konstanta ada (`creative.MSG_ASSET_NOT_FOUND`,
`task.MSG_EXEC_FORBIDDEN`, `bi.TRANSITION_NOT_ALLOWED`,
`task.MSG_OUTPUT_LINK_REQUIRED`, `bi.INCOMPLETE_DATA`).

Route (2): `POST /briefs/{id}/assets/submit-batch`, `.../start-batch` — brief-
scoped, bukan global. `wire.ts`: `AssetExecLineWire`+`toAssetExecLines`,
`AssetExecRowResultWire`, `AssetExecBatchReportWire`+
`assetExecBatchReportToWire` — **semua kunci selalu ada, nilai eksplisit**
(`reason:''`, `to_status:''`, tanpa spread kondisional).

**Tiga penjaga (bagian tiket, bukan follow-up):** `shape-parity.test.ts`
(`WIRE_TO_FE`), `body-parity.test.ts` (kunci `rows` literal di route),
`route-parity.test.ts` (`KNOWN_GAPS` kosong).

**AC:** atomisitas (5 asset, 4 siap 1 `[To Do]` → `applied 0, rejected 1`, baca
ulang: nol status pindah/`output_link`/transition row Brief); satu case per
konstanta BI (assert ke konstanta, bukan literal); matriks peran; batch N →
tepat N audit row asset (bukan satu), `dailyOutput` naik N; turnaround
per-asset tetap berbeda meski satu batch; roll-up Brief tanpa duplikat;
`task.test.ts` lama hijau.

### C3 · Kartu "Submit Output Massal" (blocker: C2)

`web-internal/src/app/(shell)/creative/briefs/[id]/page.tsx`, di bawah tabel
Asset, di atas "Assign Team":

1. Textarea tempel-massal + "Sebar ke baris" — `distributeLinks(pasted:
   string, rowCount: number)` murni di `web-internal/src/lib/creative.ts`
   (split `/\r?\n/`, trim, buang kosong, ambil `rowCount` pertama, laporkan
   sisa). Penghitung hidup.
2. Satu baris per Asset submittable (`[In Progress]`), urut `sequence_no`.
   Baris `[To Do]` terpisah dengan "Mulai Kerjakan (n Asset)".
3. `isHttpUrl` sebagai petunjuk saja, tidak pernah blokir submit.

Sekalian: ganti `window.prompt` di `creative/assets/[id]/page.tsx:225` dengan
field inline (sebut eksplisit di PR, jangan diselundupkan).

### C4 · `reviewAssetBatch`/`approveAssetBatch` + kartu AM (blocker: C2)

`packages/domain/src/creative.ts` (bukan `task.ts` — file itu memiliki edge
review AM):

```ts
export function reviewAssetBatch(sql, actor, briefId, assetIds): Promise<task.AssetExecBatchReport>
export function approveAssetBatch(sql, actor, briefId, assetIds): Promise<task.AssetExecBatchReport>
```

Bentuk tiga-fase sama, gerbang `lockAssetOwner`. **Dua langkah, bukan satu** —
`[Submitted]→[In Review]→[Approved]` dua edge terpisah (LT-30 menurunkan
`waktuAmBelumBukaHours`/`waktuAmReviewHours` dari dua timestamp itu; LT-1
`kecepatan_review_am` masih terbuka). Route (2): `.../review-batch`,
`.../approve-batch`. **Tidak ada bulk request-revision** — M7 §6 Rule 1:
feedback wajib teks per-Asset, tetap lewat `/assets/{id}/request-revision`.

UI: kartu kedua "AM: Review & Approve Massal" — checkbox, pilih semua,
penghitung hidup, kolom link.

### Yang TIDAK dilakukan (C1–C4)

Submit massal **tidak pernah membuat Asset baru** — `createAssetBatch` tetap
satu-satunya pintu pembuatan/alokasi Sequence #/plafon `quantity_target`.
Tulis sebagai komentar di fungsi domain.

---

## Bagian 4 — Performa (P1, P2)

### Diagnosis (lihat rencana penuh untuk detail)

1. **Geografi** — DB live `CDPS SG` di `ap-southeast-1`; `apps/api/vercel.json`
   tanpa `regions` → fungsi jalan di default Vercel (`iad1`).
2. **4 round-trip per baca** — `withClaims` (`BEGIN`→SET→query→`COMMIT`) +
   `idle_timeout:20s`.
3. **Nol pagination** — hanya satu `LIMIT` di seluruh `packages/domain/src`
   (`audit.ts:71`).
4. **Indeks hilang** tepat di kolom `ORDER BY`.
5. **Cold start** — `http.ts` mengimpor seluruh barrel `@cdps/domain` (29
   modul) untuk rantai `instanceof` di `mapError`.
6. **N+1 nyata** — `salesperf.ts` `commissionAchievement`/`computeMetricActual`
   per baris, lewat pool `max:5`.

### P1 · Tahap 1 — murah, risiko ~nol

1. Konfirmasi region produksi (header `x-vercel-id` / dashboard) → pin
   `"regions":["sin1"]` di `apps/api/vercel.json`.
2. Indeks tambahan aditif (pola `20260724132631_fk_covering_indexes.sql`):
   `leads(created_at desc, id desc)`, `leads(created_by)`,
   `clients(created_at desc, id desc)`, `prospect_attempts(created_at desc, id
   desc)`, `prospect_attempts(lead_id, status)`,
   `prospect_attempts(owner_employee_id, lead_id)`, `services(client_id,
   status)`, `complaints(client_id, status)`.
3. `http.ts` — petakan error lewat `name`/`code`, bukan `instanceof` lintas
   barrel.
4. Ukur before/after (`bench/README.md` + Vercel Analytics + Supabase
   `query_logs`) — syarat handoff, jangan lewat.

### P2 · Tahap 2 — sesudah angka P1 keluar (blocker: P1)

5. Pangkas round-trip `withClaims` (pipeline flush / `onconnect`+`RESET`, naik
   `idle_timeout`).
6. Pagination `LIMIT`+keyset (`created_at desc, id desc`) di enam pembacaan
   daftar — menyentuh kontrak wire, butuh update FE + shape-parity.
7. Hapus dua N+1 `salesperf` — batch dengan `= any($ids)`.
8. Dorong `health.portfolio` `canView` ke SQL.

**Risiko:** langkah 5–6 menyentuh jalur baca setiap modul — PR terpisah dari
Tahap 1, satu langkah per PR, suite penuh hijau di antara keduanya.

---

## Urutan Pengerjaan

| # | Tiket | Ketergantungan | Status |
|---|---|---|---|
| P1 | Performa Tahap 1 (region + indeks + `http.ts`) + ukur | — | ⬜ |
| C1 | Refactor `execEdgeTx` (nol perubahan perilaku) | — | ⬜ |
| C2 | `submitAssetBatch` + `startAssetBatch` + route + wire + test | C1 | ⬜ |
| C3 | Kartu "Submit Output Massal" + `distributeLinks` | C2 | ⬜ |
| C4 | `reviewAssetBatch`/`approveAssetBatch` + kartu AM | C2 | ⬜ |
| L1 | Migrasi state `[Unrespon]` + edge (termasuk edge Kalah Kompetisi) | — | ⬜ |
| L2 | Notif katalog v14 (berkas terpisah) | L1 | ⬜ |
| L3 | `leads_unrespon_tick` + wrapper TS + route internal + pg_cron | L1, L2 | ⬜ |
| L4 | Cermin FE (`status.ts`, `sales.ts`, `lead-progress.ts`, tombol) | L1 | ⬜ |
| L5 | `junkBreakdown` kecualikan `SISTEM` + `bucketOf` kenal `[Unrespon]` | L3 | ⬜ |
| E1 | `GET /leads/export` + gerbang Director + helper CSV | — | ⬜ |
| E2 | Tombol export di `DatabaseTab` + asertion route-parity | E1 | ⬜ |
| P2 | Performa Tahap 2 (round-trip, pagination, N+1, health) | P1 | ⬜ |

---

## Verifikasi (semua tiket)

```bash
service postgresql start   # atau pg_ctlcluster 16 main start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci && (cd web-internal && npm ci)
bash scripts/db-rebuild.sh --yes     # gerbang: tabel 145 / prefix 40 / mesin 31 / notif 69 (setelah L2)
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
( cd apps/api && npx vitest run --no-file-parallelism )
npx vitest run --root packages/domain
npx vitest run --root web-internal
npm run typecheck --workspaces --if-present
```

Definition of Done (CLAUDE.md) berlaku penuh per tiket: validasi server-side +
pesan BI persis, tes izin per peran, tes immutability, tes recompute-from-log,
fixture Alpha Digital tetap lolos, event notif terdaftar sesuai katalog.

## Perlu dikonfirmasi Nerissa sebelum/saat implementasi

1. **Cap baris export** (usul 50.000).
2. **Delimiter `;` + BOM** — ada yang mengolah file ini di luar Excel?
3. **Isi export** — hanya record lead, atau lead + attempt (pemilik, status,
   alasan NQ)?
4. **Notifikasi** — 2 event (masuk Unrespon + auto-NQ), atau cukup 1 terminal?
5. **Junk breakdown Marketing** — auto-NQ dikeluarkan dari hitungan junk
   campaign (default rencana ini) atau tetap dihitung?
6. **Export perlu diaudit?**
7. Saat attempt terakhir sebuah lead auto-NQ, apakah `leads.record_status`
   ikut `[Not Qualified]`? Rencana ini **tidak** melakukannya.

## Deviasi PRD — lihat `docs/DECISIONS.md` §Open REV-1..REV-4

## Temuan lama disenggol, sengaja TIDAK diperbaiki di rencana ini

- `account.approveBrief` mengizinkan AM menggiring Brief `[In Review]→[Approved]`
  tanpa memeriksa status Asset anaknya (M7 §2). Scope M6, tiket sendiri.
- `assetToWire` menghilangkan `output_link` saat kosong (anti-pola O43). Wire
  baru di rencana ini ditulis benar; yang lama menunggu PR sendiri.
- Inkonsistensi aktor sistem: TS `'SYSTEM'`, job SQL `'SISTEM'`. Job baru (L3)
  memakai `'SISTEM'` dengan alasan di komentar migrasi; call site lain tidak
  disentuh.
