# HANDOFF — Cutover Sesi 16A (PAKET A · paritas wire jalur delivery)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI14.md` (hidup di PR #76) §5 T1, dan
> `docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` (hidup di PR #78) PAKET A.
> Aturan rumah `CLAUDE.md` §Phase 0 berlaku bit-for-bit. Yang masih berlaku dari
> sesi sebelumnya tidak diulang.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/wire-parity-delivery-a-nbhiqg` |
| **Basis** | `origin/claude/cdps-sg-cutover-sesi13-2kmgy4` = **HEAD #76 (`966a1b3`)** — #76 **belum ter-merge**, jadi PR ini **BERTUMPUK di atas #76** (merge #76 dulu) |
| **PR** | draft ke `main` (stacked di atas #76) |
| **Paket paralel** | Paket B (`claude/wire-parity-commerce-*`) memakai basis yang **SAMA** (#76 HEAD); urutan merge dipatok **A dulu, B rebase** |
| **Live `CDPS SG`** | **tidak disentuh** — nol `apply_migration`, nol DDL, nol INSERT. Paket ini nol perubahan skema. |

**Angka test (Postgres 16 lokal, DB dibangun ulang dari nol 40 migrasi):**
`@cdps/domain` **566** (+1 skip) · `apps/api` **246 → 290** (+44, berkas baru
`wire.delivery.test.ts`) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · `route-parity` **5/5, `KNOWN_GAPS` KOSONG** · 7 gate seed
**PASS** · 4 invariant SQL **PASS** · typecheck bersih semua workspace ·
eslint `apps/api` **0 error / 1 warning** (pre-existing, di luar ruang lingkup A).

**Setup sandbox (tidak persisten antar sesi):**
```bash
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npm run typecheck --workspaces --if-present
```

---

## 1. A1 — paritas field-by-field 25 converter delivery 🔴 (yang utama)

**Hasil: ke-25 converter diaudit lawan oracle Go; NOL cacat pengeblank-halaman.**
Dikunci di berkas BARU `apps/api/src/lib/wire.delivery.test.ts` (+44 test): tiap
converter punya `toEqual` objek penuh + assertion rekursif "nol kunci camelCase di
seluruh pohon", plus assertion yang mengunci perilaku omitempty/null di tiap edge.

Metode per converter (SESI14 §5 T1): diff **tiga** sumber — tipe FE
(`web-internal/src/lib/*.ts`), struct Go + json tag (`backend/internal/module*/`),
converter (`apps/api/src/lib/wire.ts`). Yang dicari: field FE tak pernah diisi ·
snake_case beda dari json tag Go · `Date` lupa `.toISOString()` · kunci nullable
HILANG alih-alih dikirim `null`.

### Tabel audit — 25 converter, "diaudit, nol temuan"

| Modul | Converter | Oracle Go | Verdikt |
|---|---|---|---|
| M11 board | `cardToWire` | `module11_board/views.go` Card | ✅ benar (4 omitempty = FE `x?`; `overdue` selalu hadir) |
| M11 board | `dependencyToWire` | `board.go` Dependency | ✅ benar (`note` omitempty) |
| M6 account | `briefToWire` | `module6_account/brief.go` | ✅ benar (7 omitempty = FE `x?`; `recurring` selalu hadir) |
| M6 account | `complaintToWire` | `complaint.go` | ✅ benar (3 omitempty) |
| M12 task | `metricsToWire` | `module12_task/metrics.go` | ✅ benar (semua pointer = FE `\| null`, hadir) |
| M12 task | `blockRequestToWire` | `block.go` | ✅ benar (`resolved_by`/`resolved_at` null eksplisit) |
| M12 task | `pendingBlockRequestToWire` | `block.go` | ✅ benar |
| M7 creative | `assetToWire` | `module7_creative/asset.go` | ✅ benar (`*float64,omitempty`: null=omit, 0=kirim) |
| M7 creative | `dailyOutputToWire` | `daily_output.go` | ✅ benar (nested entries ber-ISO) |
| M7 creative | `scanHoursReminderResultToWire` | `reminder.go` | ✅ benar |
| M8 ads | `campaignToWire` | `module8_ads/read.go` | ✅ benar (`roas` null saat spend 0) |
| M8 ads | `metricEntryToWire` | `metrics.go` | ✅ benar (ctr/cvr input-only, tak dikirim balik) |
| M8 ads | `optimizationToWire` | `optimization.go` | ✅ benar |
| M9 kol | `bookingToWire` | `module9_kol/booking.go` | ✅ benar (`payment_status` selalu hadir) |
| M9 kol | `paymentRequestToWire` | `payment.go` | ✅ benar (`rejection_reason`/`paid_by` omitempty) |
| M9 kol | `bookingMetricsToWire` | `metrics.go` | ✅ benar (pointer = null eksplisit) |
| M9 kol | `creatorListToWire` | `creator_list.go` | ✅ benar — **1 deviasi disengaja**, lihat §1.1 |
| M10 livestream | `sessionToWire` | `module10_livestream/session.go` | ✅ benar (11 result-field omitempty; `gmv` number, `gmv_display` string) |
| M13 health | `healthSnapshotToWire` | `module13_health/snapshot.go` | ✅ benar (`computed_*` omitempty; `final_health_score` null) |
| M13 health | `roasToggleToWire` | `roas.go` | ✅ benar (`override` tri-state null) |
| M13 health | `healthScanResultToWire` | `snapshot.go` | ✅ benar |
| M14 performance | `perfSnapshotToWire` | `module14_performance/snapshot.go` | ✅ benar (lihat §1.2 soal `id`) |
| M14 performance | `perfTeamRollupToWire` | `snapshot.go` | ✅ benar |
| M14 performance | `perfWeightToWire` | `config.go` | ✅ benar |
| M14 performance | `perfTargetToWire` | `config.go` | ✅ benar |

**Konsekuensi: NOL edit ke `wire.ts` converter.** Semua sudah benar. Nilai kerja
ini = **bukti** (44 test yang mengunci paritas), bukan perbaikan. Ini penting: route
delivery menjawab 200 dan tak ada test yang gagal saat kolom kosong, jadi "bersih"
harus dibuktikan, bukan diasumsikan. Preseden kelas-2 yang terbukti nyata
(`clientDetailToWire` O41, `InstallmentRow.proofOfPayment`, `skippedApprovedBriefs`)
semuanya di jalur **commerce/finance** (Paket B / sudah ditutup #76) — jadi jalur
delivery memang bisa bersih, dan sekarang terbukti begitu.

### 1.1 Satu deviasi dari Go yang DISENGAJA (dikonfirmasi, bukan diperkenalkan)

`creatorListToWire.last_compiled` dikirim **`null` eksplisit** padahal Go menandai
`last_compiled,omitempty` (dan tipe FE `last_compiled?`). Ini sejalan stance O43:
kunci HILANG mengeblank halaman, `null` tidak. Halaman `kol/briefs/[id]` membacanya
lewat `formatDateTime` yang null-guard (`if (!value) return '—'`), jadi `null`
aman & render "—". Dicatat di `docs/DECISIONS.md` (baris teratas, 2026-07-30).
Deviasi serupa omitempty→null pada `perf`/`health` (`computed_at`/`computed_by`)
dan `perf.Component` (`diagnostic`/`excluded_reason`) sudah tercakup stance O43 lama
dan cocok tipe FE (`\| null` / wajib).

### 1.2 Observasi non-cacat: `perfSnapshotToWire` mengirim `id`

Go `Snapshot` punya `id` (snapshot.go:23) dan converter mengirimnya, tapi tipe FE
`web-internal/src/lib/performance.ts` `Snapshot` **tidak** mendeklarasikan `id`.
Ini kunci EKSTRA (bukan hilang) — tak mengeblank apa pun, FE cuma mengabaikannya.
Bukan cacat wire; kalau suatu halaman perlu id snapshot, tipe FE tinggal
menambahkannya (data sudah dikirim). Dicatat sebagai observasi, tidak diubah.

---

## 2. A2 — eslint config `apps/api` (T2)

Sebelum ini `npm run lint -w @cdps/api` **selalu** gagal: `ESLint couldn't find an
eslint.config.js` ⇒ **210 berkas TS tidak pernah di-lint** (semua route handler +
`wire.ts`). Ditambahkan `apps/api/eslint.config.mjs` (mirror flat-config
`web-internal`: `eslint-config-next` core-web-vitals + typescript, opt-out
`react-hooks/set-state-in-effect`). Dep sudah ada (`eslint ^9`,
`eslint-config-next`), jadi nol perubahan `package.json`.

**Hasil `npm run lint -w @cdps/api`: 0 error, 1 warning.**
- `scripts/mslseed.ts:36` — `'msl' is defined but never used`
  (`@typescript-eslint/no-unused-vars`). **Di luar blok converter Paket A** ⇒
  sesuai batas ruang lingkup, **tidak diperbaiki** — jadi tiket lanjutan **T2b**.

**Rekomendasi CI:** job `@cdps/api` (`.github/workflows/ci.yml` step "typecheck +
lib tests") **belum** memanggil lint. Aman ditambahkan sekarang — `eslint` keluar
**exit 0** pada warning, jadi menambah `npm run lint -w @cdps/api` tidak akan
memerahkan CI. Kalau ingin `--max-warnings 0`, bereskan 1 warning mslseed.ts (T2b)
dulu. **Tidak menyentuh `ci.yml` di PR ini** (A2 hanya "pasang + laporkan +
rekomendasi").

---

## 3. A3 — rapikan rujukan path pasca-Fase 0

Data organisasi riil (`role_mappings_riil.csv`, `layered_roles_riil.csv`,
`hris_department_jabatan_pairs.csv`, `msl_kalkulator.csv`) sudah **disalin** ke
`supabase/seed/` (byte-identik, duplikat di `backend/seed/` sampai Fase 5 — lihat
`supabase/seed/README.md`, yang **benar & tidak diubah**). Diperbarui rujukan
**kanonik/operasional** ke lokasi durabel:

- `docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md` §"CSV kanonik" → `supabase/seed/role_mappings_riil.csv` + `supabase/seed/layered_roles_riil.csv`.
- `docs/handoff/RUNBOOK_O42_MARKETING_ACTOR.md` — perbandingan sumber kebenaran → `supabase/seed/role_mappings_riil.csv`.

**`LANGKAH_MANUSIA_GO_LIVE.md` sengaja TIDAK diubah — dan ini bukan kelalaian.**
Satu-satunya rujukan `backend/`-nya (L138) adalah catatan **bertanggal** ("✅ STATUS:
Diterima 2026-07-17") yang menunjuk `backend/testdata/import_samples/nik_email.csv`.
Berkas roster PII itu **tidak dipindahkan** (masih di `backend/testdata/import_samples/`,
menunggu keputusan retensi PII pemilik — PENSIUN §5 butir 5), jadi menuliskannya
`supabase/seed/…` akan **salah fakta**. A3 sendiri melarang menulis ulang catatan
bertanggal. Rujukan `backend/testdata/import_samples/` lain (HRIS_ROLE_MAPPING_DRAFT
L3/L16/L31/L107) juga dibiarkan — sebagian catatan historis, sebagian menunjuk PII
yang belum pindah. Rujukan `backend/cmd/*` / `backend/internal/*` = jalur KODE Go
(oracle read-only), bukan data, jadi tetap.

---

## 4. Temuan untuk PAKET B (jangan diperbaiki di sini)

Nol. Selama audit jalur delivery tidak ada converter milik Paket B yang tersentuh
atau terlihat cacat. (Kalau Paket B menemukan sesuatu di converter delivery, itu
regresi pasca-PR ini, bukan sisa.)

---

## 5. Yang TIDAK dikerjakan & kenapa

- **Nol edit `wire.ts` converter** — ke-25 sudah benar (§1). Menyentuhnya hanya
  menambah risiko konflik dengan Paket B tanpa manfaat.
- **1 warning eslint mslseed.ts** — di luar blok Paket A (§2), → T2b.
- **`ci.yml`** — A2 hanya minta rekomendasi (§2).
- **Butir Fase 4/5** — nol yang bisa ditutup Claude; C-05 justru menghapus oracle
  yang A1 pakai.

---

## 6. Lanjut dari sini

1. **Merge #76** (prasyarat), lalu review + merge PR ini (A dulu), lalu Paket B rebase.
2. **T2b** — bereskan gelombang lint `apps/api` (mulai: 1 warning mslseed.ts), lalu
   pertimbangkan menambah `npm run lint -w @cdps/api` ke job CI `api`.
3. Sisa pensiun Go = tujuh butir pemilik (PENSIUN §5) — nol bisa ditutup Claude.
