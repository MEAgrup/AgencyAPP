# Handoff — Sesi 2026-07-17 B (Integrasi Wave 2 + gate login UAT mock HRIS data riil)

> Lanjutan dari `HANDOFF_SESSION_20260717.md` (sesi A hari yang sama). Dokumen lama yang
> masih berlaku: `HANDOFF_WAVE2_SESSION3.md` (aturan worktree manual + setup container),
> `W1-20_UAT_RUNBOOK.md`, `LANGKAH_MANUSIA_GO_LIVE.md`.

## Status saat handoff

**Branch:** `claude/wave-2-uat-mock-hris-ebkdyq` — stack di atas tip PR #8 (`b2520e4`,
`claude/build-process-continuation-rcuch7`). PR #8 masih draft/open — merge = keputusan manusia.

**Arahan Yohan sesi ini:** (a) mock-HRIS-berisi-data-riil = gate login UAT; (b) NIK+email
Yohan & Nerissa (O26) diberikan TERAKHIR — jangan menunggu; (c) mulai Wave 2.

## Apa yang selesai sesi ini

1. **Integrasi Wave 2 → jalur Wave 1 terbaru** (commit `Wave 2 Integration`). Temuan kunci:
   Wave 2 TIDAK dimulai dari nol — M6, M12, M7–M10 + 72 endpoint httpapi + migrasi
   0020–0029 sudah dibangun sesi 2026-07-12..14 di `claude/fable-orchestrator-opus-haiku-vi68gu`
   (tip `0ea6a83`, base `2a75125`), belum memuat MSL kalkulator (PR #7) & PR #8. Merge
   pola integrator PR #6: `core/tz` kanonik = versi O20 Wave 1 (pemanggil W2 diadaptasi);
   `admin/master_service` + handler = UNION field kalkulator 0014 + `requires_strategy_plan`
   0021; `ident`/`qualified`/`reminder` versi Wave 1 menang. **Tabrakan nomor Open paralel**:
   W2-"O24"→O30, W2-"O25"→O31, W2-"O26"→O32 (peta renumber = entri Decided integrasi).
   QC: `go build`+`go vet` bersih; **`go test -count=1 -p 1 ./...` HIJAU 28 paket, 0 skip**;
   migrasi up→down→up bersih (0001–0029 + 0014).
2. **Gate login UAT terbukti end-to-end** (entri Decided "Gate login UAT"): mockhris +
   `employees_uat.csv` (33 riil + 2 fixture Director `UATDIR0001/0002`) + `layered_roles_uat.csv`;
   sync 35/35; rolemapseed idempoten; mslseed 32 layanan (aktor Head of Sales riil);
   login riil OK (role mapping benar), password salah/di-luar-roster ditolak dengan BI verbatim,
   **case email teruji dua arah** (vektor SAFFIRAMARWAH lolos), layered OD `od:true`,
   fixture Director tembus surface Director-only & staff ditolak, HRIS mati = fail-closed.
   Kredensial UAT: password bersama `rahasia123`; per-user bisa via kolom ke-7 CSV tanpa kode.
   **Boot order lengkap: `backend/testdata/import_samples/README.md` §UAT login gate.**

## Menunggu manusia (tidak berubah kecuali O26)

| Apa | Siapa | Blocking apa |
|---|---|---|
| Review & merge **PR #8**, lalu PR sesi ini | Yohan/Nerissa | jalur ke `main` |
| **O26** NIK+email Yohan & Nerissa — **diberikan terakhir (arahan 2026-07-17)**; saat masuk: ganti 2 baris fixture di `employees_uat.csv`/`employees_cdps.csv` + baris `director` di `layered_roles_riil.csv`, rerun `rolemapseed --apply` | HR/Yohan | produksi saja |
| File import W1-19 ke drop-zone + form pelengkap + `db_jasa.csv` | CRO/Finance/Sales | import riil (§A HANDOFF_JALUR_B_SESSION2) |
| O25 anomali kalkulator; endpoint HRIS staging; witness demo S0-12 | Sales Head/COO; tim HRIS; manusia | tidak blocking / go-live |

## Pekerjaan sesi berikutnya (urutan saran)

1. **UAT W1-20 end-to-end riil** — semua blocker teknis bersih: jalankan boot order README
   §UAT, lalu runbook `W1-20_UAT_RUNBOOK.md` (satu deal lintas stream). Komisi Rp0 = SAH (O24).
2. **UAT Wave 2** (gate exit Wave 2, pola W1-20 — runbook belum ditulis): alur
   klien → Service `[Awaiting Onboarding]` → Strategy & Plan / Direct → Brief → task M12 →
   M7 asset / M8 campaign+Launch / M9 booking / M10 LSS → Daily Output WIB.
3. **Sisa klaster deferred Wave 2** (dari HANDOFF_WAVE2_SESSION3): assign-PIC granular
   sub-tim Creative (M7 §3); handler bulk M1 + port test stream A (utang Wave 1).
4. Begitu file W1-19 masuk → import (dry-run dulu; lock `id_sequences`).
5. Setelah exit criteria Wave 2 → **Wave 3** (M2, M3, M11, M13, M14, M15 — portal terakhir).

### Jangan dikerjakan tanpa keputusan
(warisan, masih berlaku) Qualified Form UI; enforcement GMV Max (O25); cap 5 layanan;
katalog notifikasi FROZEN sampai pembukaan Wave 3 (daftar tunggu: `EvHoursLoggedReminder`).

## Pola kerja

Fable = orchestrator/QC/revisi; eksekutor opus/sonnet/haiku (arahan Yohan tetap).
Sesi ini merge integrasi + verifikasi UAT dikerjakan orchestrator langsung
(preseden integrator PR #6 — konflik 9 file, lebih murah daripada porter subagent).
⚠ Aturan worktree manual untuk executor paralel TETAP berlaku (HANDOFF_WAVE2_SESSION3),
plus baru: **jangan `pkill -f <pola>` yang cocok dengan command line shell sendiri** (exit 144).

## Environment notes

Setup container = HANDOFF_WAVE2_SESSION3 §Setup (apt mariadb-server; DB `cdps`/`cdps_test`/
`cdps_test2`; user `cdps`/`cdps_dev`; `log_bin_trust_function_creators=1`). Test WAJIB `-p 1`.
DB dev container ini berisi hasil smoke UAT (35 employees, 23+3 role/layered, 32 MSL) — ephemeral.

---

## UPDATE sesi yang sama (lanjutan): UAT teknis W1-20 SELESAI — PASS 32/32

Runbook `W1-20_UAT_RUNBOOK.md` langkah 1–17 dieksekusi via API dengan aktor riil +
fixture. **Laporan: `docs/handoff/W1-20_UAT_REPORT_20260717.md`** (bukti per langkah,
aktor, temuan). Skrip repeatable: `backend/uat/w120_walk.py`.

Temuan penting → **Open O33 (BARU)**: roster HR riil TIDAK punya divisi Finance —
flow M5 tanpa aktor riil di produksi; UAT pakai fixture `UATFIN0001/0002` +
`role_mappings_uat.csv`. Butuh keputusan Yohan sebelum go-live M5.

Yang tersisa dari W1-20 = manusia: langkah 18 go/no-go (Nerissa/Yohan + head dev,
bahan = laporan UAT) + spot-check komisi manual Sales Head. Setelah go →
lanjut **UAT Wave 2** (runbook belum ditulis; pola sama, modul M6/M12/M7–M10).
