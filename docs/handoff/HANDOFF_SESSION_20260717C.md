# Handoff — Sesi 2026-07-17 C (GO Wave 1 + merge PR #8 + UAT teknis Wave 2 PASS)

> Lanjutan `HANDOFF_SESSION_20260717B.md`. Dokumen lama masih berlaku:
> `HANDOFF_WAVE2_SESSION3.md` (aturan worktree + setup container), `W2_UAT_RUNBOOK.md`,
> `LANGKAH_MANUSIA_GO_LIVE.md`.

## Status saat handoff

**Branch:** `claude/wave-2-uat-mock-hris-qotk8y` — stack di atas tip PR #9
(`claude/wave-2-uat-mock-hris-ebkdyq`, `d3664c2`). **PR #8 SUDAH MERGED ke `main`**
(merge commit `355eb96`, arahan Yohan). **PR #9 sudah di-retarget ke `main`** — diff
bersih (merge-base = tip PR #8 `b2520e4`), masih draft/open, menunggu review manusia.
Branch sesi ini berisi: entri GO W1-20, runbook + fixture O34, laporan UAT Wave 2 —
kandidat PR berikutnya (stack di atas PR #9) atau digabung saat PR #9 di-review.

## Keputusan manusia sesi ini (Yohan)

**GO — W1-20 langkah 18** (bahan = `W1-20_UAT_REPORT_20260717.md`). Gate exit Wave 1
LULUS. Dicatat di DECISIONS (entri GO 2026-07-17) + tindak lanjut merge/retarget.

## Apa yang selesai sesi ini

1. **PR #8 review (QC diff + CI hijau) → undraft → merge ke `main`** (merge commit,
   preseden #6, supaya retarget PR #9 bersih). **PR #9 retarget ke `main`** — terverifikasi
   diff = 125 file kerja sesi B saja.
2. **Runbook UAT Wave 2** `W2_UAT_RUNBOOK.md` (49 langkah, pola W1-20; executor Opus,
   QC orchestrator: string BI diverifikasi verbatim ke kode, endpoint ke route map).
3. **Open O34 (BARU)**: roster riil tanpa divisi KOL / lead Creative / SPV Ads / staf LS.
   UAT ditutup 5 fixture berlabel (`UATKOL0001/0002`, `UATCRE0001`, `UATADS0001`,
   `UATLSS0001`) + 5 mapping di `role_mappings_uat.csv` (preseden O26/O33). README
   §UAT diperbarui (42 baris, boot order pakai `--role-csv`, sync 42).
4. **UAT teknis Wave 2 PASS 50/50** — `backend/uat/w2_walk.py` (executor Opus menulis +
   menjalankan; rerun QC orchestrator juga 50/50). Laporan:
   **`docs/handoff/W2_UAT_REPORT_20260717.md`** (bukti per bagian, yang tidak dijalankan +
   alasan, temuan). Suite fresh 28 paket hijau 0 skip di container ini sebelum UAT.
5. Koreksi runbook langkah 23: resume block = **lead-only** (kode benar, STATE_MACHINES §7).

## Menunggu manusia

| Apa | Siapa | Blocking apa |
|---|---|---|
| Review & merge **PR #9** (+ PR branch sesi ini) | Yohan/Nerissa | jalur ke `main` |
| **Langkah 49 W2: go/no-go gate exit Wave 2** — bahan = `W2_UAT_REPORT_20260717.md` | Nerissa/Yohan + head dev | **Wave 3 tidak boleh mulai sebelum ini GO** (Build Plan §4) |
| **O34** aktor produksi KOL (seluruh divisi!) / lead Creative / SPV Ads / staf LS | Yohan (+HR) | produksi M7-lead/M8-SPV/M9; UAT jalan dengan fixture |
| O33 aktor Finance produksi | Yohan | produksi M5 |
| **O35** model sub-tim Creative Video/Graphic (3 keputusan: representasi + peta Asset-Type→sub-tim + gate) | Nerissa/Yohan (+HR) | assign-PIC granular M7 §3 (non-blocking gate exit W2) |
| O26 NIK+email Yohan & Nerissa — diberikan TERAKHIR (arahan tetap) | HR/Yohan | produksi saja |
| File import W1-19 ke drop-zone + form pelengkap + `db_jasa.csv` | CRO/Finance/Sales | import riil |
| Spot-check komisi manual (W1-20 AC langkah 5, non-blocking, komisi Rp0 sah O24) | Sales Head | — |

## Pekerjaan sesi berikutnya (urutan saran)

1. ~~Assign-PIC granular sub-tim Creative (M7 §3)~~ → **STOP, jadi Open O35** (executor
   W2-M7-C3 menemukan blocker struktural: model peran tanpa dimensi sub-tim, PRD tanpa
   peta Asset-Type→sub-tim, roster tanpa TL — butuh keputusan Nerissa/Yohan dulu).
   Handler bulk M1 + port test stream A (utang Wave 1) dikerjakan sesi ini — lihat UPDATE.
2. Begitu file W1-19 masuk → import (dry-run dulu; lock `id_sequences`).
3. Setelah go/no-go langkah 49 GO → **Wave 3** (M2, M3, M11, M13, M14, M15 — Client
   Portal terakhir, setelah security spec O5). Pembukaan katalog notifikasi Wave 3:
   daftar tunggu `EvHoursLoggedReminder`.

### Jangan dikerjakan tanpa keputusan
(warisan, masih berlaku) Qualified Form UI; enforcement GMV Max (O31); cap 5 layanan;
katalog notifikasi FROZEN sampai pembukaan Wave 3.

## Pola kerja

Fable = orchestrator/QC/revisi; eksekutor Opus/Sonnet/Haiku (arahan Yohan tetap).
Sesi ini: runbook + walk = executor Opus (2 subagent); merge/retarget/QC/fixture/laporan =
orchestrator. ⚠ Aturan worktree manual executor paralel TETAP berlaku; ⚠ jangan `pkill -f`
pola yang cocok dengan shell sendiri (exit 144 — terkonfirmasi lagi sesi ini, mockhris
ikut mati; kill by PID).

## Environment notes

Setup container = HANDOFF_WAVE2_SESSION3 §Setup. Boot UAT = README import_samples §UAT
login gate (sekarang 42 baris, `--role-csv` wajib). Test WAJIB `-p 1`. DB dev container
ini berisi artefak 2 run `w2_walk.py` + 1 deal W1-20-style — ephemeral.
