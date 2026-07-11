# CDPS — Rencana Kerja Paralel Wave 2 (2 Jalur × Fable-Planner Multi-Agent)

> Penerus `WAVE1_PARALLEL_PLAN.md`. Dua sesi Claude Code (Akun A & B) membangun Wave 2 bersamaan. **Yang baru di Wave 2:** di tiap jalur, model **Fable** berperan sebagai *planner + QC* — SEMUA draft kode ditulis agent lain (Opus 4.8 / Sonnet 5 / Haiku 4.5) yang dibagi berdasar kesulitan tiket; Fable turun tangan hanya untuk QC dan revisi kecil. Tiket + rating + model per tiket: `docs/backlog/WAVE2 BACKLOG.md`.

## 0. Keputusan terkunci (interview 11 Jul 2026, Nerissa)
1. **Cakupan:** penutupan Wave 1 (Fase 0) + Wave 2 penuh.
2. **Split:** Jalur A = M12+M7+M8 · Jalur B = M6+M9+M10.
3. **Revisi QC:** hybrid — temuan kecil diperbaiki Fable langsung; struktural dikirim balik sebagai tiket revisi ke agent.
4. **Git:** merge Wave 1 ke `main` dulu; kedua jalur Wave 2 fork dari `main`.
5. **Tier model:** HARD→opus, STANDARD→sonnet, MECH→haiku. Fable tidak koding di draft awal.
6. **Full-stack per jalur** (BE + `web-internal`); UI dikerjakan setelah kontrak API tiketnya stabil.
7. **Ritme QC:** per fase (bukan per tiket, bukan di akhir jalur).
8. **Eksekusi:** Agent tool per tiket (bukan workflow terskrip), maks **2–3 agent paralel** per jalur.
9. **Fondasi Wave 2 (Fase F):** dikerjakan sesi orchestrator ini, sekali jalan, sebelum fork.

## 1. Fase 0 — Gate penutupan Wave 1 (BLOCKING)
Sesuai Build Plan R5, tidak ada tiket Wave 2 dimulai sebelum ini lulus:
1. Jalur A Wave 1 menuntaskan W1-06 → W1-07/08 → **W1-09 Closing** (branch `claude/cdps-sprint-0-handoff-c48u62`).
2. Orchestrator merge kedua branch Wave 1 ke `main` (basis: `claude/jalur-b-completion-72zpda` yang paling lengkap; rebase/merge branch Jalur A di atasnya; resolve DECISIONS.md secara union).
3. **W1-20 UAT** satu deal end-to-end lintas hasil kedua jalur; komisi spot-check Sales Head vs MSL.
4. Go/no-go dicatat di `DECISIONS.md`.

Langkah manusia paralel (tidak memblokir dev): validasi MSL oleh Sales Head; data sample W1-19 dari Yohan (lihat `LANGKAH_MANUSIA_GO_LIVE.md`).

## 2. Konsep Fable-Planner di tiap jalur

```
Fable (planner)                    Agent pool                       Fable (QC)
──────────────                     ──────────                       ──────────
baca PRD modul fase ini      →     opus  : tiket HARD          →    jalankan make test
pecah/urutkan tiket fase           sonnet: tiket STANDARD           audit vs checklist DoD
tulis prompt per tiket             haiku : tiket MECH               temuan kecil: fix sendiri
spawn 2–3 paralel                  (semua test-first utk            temuan struktural: tiket
                                    money & state machine)           revisi → agent semula
```

**Aturan peran:**
- Fable WAJIB membaca penuh PRD modul + entri STATE_MACHINES/DATA_MODEL sebelum menulis prompt tiket (CLAUDE.md working style) — agent pelaksana juga diberi § PRD yang relevan di prompt-nya.
- Draft awal 100% oleh agent (permintaan Nerissa: "diawal biarkan semua progress dikerjakan agent lain").
- Prompt tiket harus memuat: § PRD verbatim yang relevan, string BI persis, daftar file yang BOLEH disentuh (peta §4), perintah test-first untuk state machine/metrik, dan larangan menyentuh file FROZEN.
- Tiket HARD boleh diberi `effort: high`; MECH pakai `effort: low`.
- Satu commit per tiket, pesan merujuk § PRD (mis. `feat(m12): turnaround + blocked pause (W2-A02, M12 §2 R4-8)`).

**Checklist QC Fable per fase (gate ke fase berikutnya):**
1. `make test` hijau penuh (MariaDB lokal, `-p 1`).
2. String BI `[...]` verbatim vs PRD (grep-diff terhadap daftar di backlog).
3. Test permission per role ada untuk tiap endpoint baru (termasuk OD/Director berlapis).
4. Immutability: tidak ada jalur UPDATE/DELETE pada history/log.
5. Field turunan tercakup test recompute-from-log (khusus fase M12: turnaround/speed/revision WAJIB punya property test multi-siklus block + revisi).
6. Fixture Alpha Digital tetap lulus end-to-end.
7. Event notifikasi terdaftar sesuai katalog W2-F4.
8. Setiap deviasi PRD tercatat di DECISIONS.md; ambiguitas = STOP & flag, bukan tafsir diam-diam.

## 3. Pembagian jalur & urutan fase

| | **Akun A** | **Akun B** |
|---|---|---|
| Modul | **M12 Task Engine + M7 Creative + M8 Ads** | **M6 Account/Service + M9 KOL + M10 Live** |
| Fase | A1: W2-A01..06 (M12) → A2: W2-A07..13 (M7) → A3: W2-A14..21 (M8) | B1: W2-B01..08 (M6) → B2: W2-B09..17 (M9) → B3: W2-B18..22 (M10) |
| Branch | `claude/cdps-wave2-jalur-a-task-creative-ads` | `claude/cdps-wave2-jalur-b-account-kol-live` |
| Rentang migrasi | `0021`–`0029` | `0030`–`0039` |
| Alasan urutan | M12 duluan (Build Plan: "M12 early") karena M7/M8 menancap ke mesinnya; M8 terakhir karena butuh Asset M7 utk guardrail & atribusi | M6 duluan karena pintu Brief semua divisi; M9 kedua (konsumen Brief + M12-interface); M10 terakhir (paling ringan, exempt Kanban) |

**Sinkronisasi kunci:** saat Jalur B masuk Fase B2 (M9), Fase A1 (M12) idealnya sudah merge — kalau belum, W2-B16 koding melawan interface beku W2-F3 dan integrasi riil ditunda ke W2-X1.

## 4. Peta kepemilikan file (disjoint)

### Akun A
- `backend/internal/module12_tasks/**` (baru — mesin kanonik, compute, block queue)
- `backend/internal/module7_creative/**` (baru)
- `backend/internal/module8_ads/**` (baru)
- `backend/internal/httpapi/routes_delivery_a.go` + handler baru milik A (`tasks_handlers.go`, `creative_handlers.go`, `ads_handlers.go`)
- `web-internal/src/app/(shell)/creative/**`, `.../ads/**`, komponen kartu-Task bersama di `.../tasks/**`

### Akun B
- `backend/internal/module6_account/**` (baru)
- `backend/internal/module9_kol/**` (baru)
- `backend/internal/module10_live/**` (baru)
- `backend/internal/module5_finance/` — HANYA file baru `creator_payment.go` (intake CPR; jangan ubah file Wave 1)
- `backend/internal/httpapi/routes_delivery_b.go` + handler baru milik B (`account_handlers.go`, `kol_handlers.go`, `live_handlers.go`)
- `web-internal/src/app/(shell)/account/**`, `.../kol/**`, `.../live/**`

## 5. Kontrak antar jalur (titik temu — dibekukan di Fase F)
1. **Skema migrasi `0020_wave2_delivery`** — semua tabel Wave 2. Perubahan hanya via orchestrator + DECISIONS.
2. **Interface `module12_tasks`** (W2-F3) — signature compute yang dipakai M7/M8 (Jalur A internal) dan mapping M9 (Jalur B, W2-B16).
3. **Tabel `briefs` + mesin Task kanonik** — B produsen baris Brief (M6), A konsumen (Asset fan-out M7, ADC M8). A boleh INSERT fixture Brief sesuai skema untuk test tanpa menunggu B (pola Wave 1 §4).
4. **CPR → M5** — Jalur B sendiri (pemilik M5 sejak Wave 1); bukan titik konflik.
5. **Pengecualian LSS** — Brief M10 tidak masuk mesin Task; sudah dikodifikasi di W2-F2, kedua jalur tinggal patuh.

## 6. Aturan main (rules of engagement)
- **FROZEN:** `backend/internal/core/**`, semua migrasi < 0021, `core/statemachine/config.go` (edge baru → orchestrator), katalog notifikasi (tambah event → orchestrator), `httpapi/api.go` (route di file milik jalur masing-masing).
- **DECISIONS.md:** append-only di bawah, satu commit `docs(decision): ...` terpisah; konflik rebase = union keduanya.
- **Draft PR terpisah per jalur** ke `main`; rebase rutin. Merge order: A1 dulu bila siap (B2 membutuhkannya), sisanya bebas.
- **Test:** wajib test-first untuk state machine & semua metrik/money (DoD CLAUDE.md); `make test -p 1`.
- **Konvensi rumah Phase 0** berlaku penuh (ID pasca-validasi, transisi hanya via engine, history immutable, field turunan read-only, IDR `Rp. X.XXX.XXX,00`, div-nol ⇒ `—`).

## 7. Prompt siap-tempel

### Akun A (Jalur A — M12+M7+M8)
```
Baca docs/handoff/WAVE2_PARALLEL_PLAN.md dan docs/backlog/WAVE2 BACKLOG.md sampai penuh, lalu jalankan Jalur A.

Peranmu (Fable): PLANNER + QC — kamu TIDAK menulis kode draft awal.
1. git checkout -b claude/cdps-wave2-jalur-a-task-creative-ads dari main (pastikan Fase 0 + Fase F sudah merge; kalau belum, STOP dan lapor).
2. Fase A1 (W2-A01..A06): baca penuh PRD M12 + entri STATE_MACHINES/DATA_MODEL-nya. Tulis prompt per tiket (sertakan § PRD, string BI verbatim, peta file §4 plan, perintah test-first). Spawn agent per tiket via Agent tool dengan model sesuai kolom Model backlog (opus=HARD, sonnet=STANDARD, haiku=MECH), maksimal 3 paralel, hormati dependensi antar tiket.
3. Setelah semua tiket fase selesai: QC per checklist §2 plan. Temuan kecil perbaiki sendiri; struktural kirim balik sebagai tiket revisi ke agent tier yang sama. Fase lulus → commit + lanjut A2 (M7), lalu A3 (M8), pola sama.
4. File FROZEN §6 jangan disentuh; kebutuhan perubahan kontrak → catat DECISIONS + minta orchestrator.
5. Selesai A3: buka draft PR ke main, laporkan ringkasan QC per fase.
```

### Akun B (Jalur B — M6+M9+M10)
```
Baca docs/handoff/WAVE2_PARALLEL_PLAN.md dan docs/backlog/WAVE2 BACKLOG.md sampai penuh, lalu jalankan Jalur B.

Peranmu (Fable): PLANNER + QC — kamu TIDAK menulis kode draft awal.
1. git checkout -b claude/cdps-wave2-jalur-b-account-kol-live dari main (pastikan Fase 0 + Fase F sudah merge; kalau belum, STOP dan lapor).
2. Fase B1 (W2-B01..B08): baca penuh PRD M6 + entri STATE_MACHINES/DATA_MODEL-nya. Tulis prompt per tiket (sertakan § PRD, string BI verbatim, peta file §4 plan, perintah test-first). Spawn agent per tiket via Agent tool dengan model sesuai kolom Model backlog (opus=HARD, sonnet=STANDARD, haiku=MECH), maksimal 3 paralel, hormati dependensi antar tiket.
3. Setelah semua tiket fase selesai: QC per checklist §2 plan. Temuan kecil perbaiki sendiri; struktural kirim balik sebagai tiket revisi ke agent tier yang sama. Fase lulus → commit + lanjut B2 (M9), lalu B3 (M10), pola sama.
4. Catatan B2: W2-B16 (mapping Booking→M12) koding melawan interface module12_tasks yang dibekukan W2-F3; integrasi riil menunggu Fase A1 Jalur A merge (W2-X1).
5. File FROZEN §6 jangan disentuh; modul5_finance hanya boleh file baru creator_payment.go.
6. Selesai B3: buka draft PR ke main, laporkan ringkasan QC per fase.
```

## 8. Exit criteria Wave 2 (Build Plan §4)
Klien ala Alpha Digital menjalani siklus delivery penuh: Service → Brief ke ≥2 divisi → Task dengan Speed Score live → satu loop revisi → satu interval `[Blocked]` ter-exclude dari turnaround → sesi live stream ter-rekonsiliasi. UAT = W2-X2; go/no-go Wave 3 di DECISIONS.md.
