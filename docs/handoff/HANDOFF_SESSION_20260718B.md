# Handoff — Sesi 2026-07-18B (UAT teknis Wave 3 SELESAI — bahan go/no-go gate exit W3)

> Lanjutan `HANDOFF_SESSION_20260718.md`. Dokumen lama tetap berlaku:
> `HANDOFF_WAVE2_SESSION3.md` (setup container), `WAVE3_PLAN.md` (peta klaster).

## Status saat handoff

**Branch:** `claude/wave3-uat-runbook-6epydu` — **stacked di atas tip PR #11**
(`75883c3`, branch `claude/wave2-uat-gate-exit-asstfa`); PR #11 → main masih OPEN
menunggu review manusia. Working tree bersih, ter-push penuh; **PR draft baru dibuka
untuk branch ini** (base = branch PR #11, bukan main — supaya diff hanya berisi kerja
UAT; retarget ke main otomatis/manual setelah PR #11 merged). Migrasi terakhir: **0036**
(tidak berubah). Katalog notifikasi: FROZEN 15 event (nol penambahan sesi ini).
Suite penuh fresh di container sesi ini: **34 paket hijau, 0 FAIL, 0 skip** (`-p 1`,
durasi paket DB terverifikasi — insiden silent-skip TIDAK terulang).

## Selesai sesi ini (pola Fable orchestrator/QC + executor Opus ×2)

1. **`docs/handoff/W3_UAT_RUNBOOK.md`** — runbook UAT teknis Wave 3, 42 langkah
   (bagian A–K, pola W1-20/W2): M3-C1 core, M3-C2 linkage/O13, M2-C1, CAT-1, M11,
   M13, M14, M15-C1; M15-C2 ditandai DITUNDA (tidak di-UAT). Semua status/pesan BI
   verbatim dari kode + rujukan `file:baris`; QC orchestrator memverifikasi string,
   rujukan, dan 41 rute Wave 3.
2. **Fixture `UATMKT0001` (Marketing lead)** di `employees_uat.csv` (43 baris) +
   `role_mappings_uat.csv` (31 mapping) + README sinkron — **perluasan O34**: roster
   HR tanpa lead Marketing/BD; dibutuhkan utk cabang izin khas-lead M3 §5 (read-all)
   dan M2 §5 Rule 3 (lead non-owner read-only).
3. **`backend/uat/w3_walk.py`** — walk repeatable (data unik per run, exit 0 bila
   0 FAIL) mengeksekusi langkah 2–41. **Hasil: PASS 38/38, FAIL 0, SKIP 4
   terdokumentasi**; dieksekusi 3× (executor 2× + rerun QC orchestrator) identik.
   Precondition = `w2_walk.py` PASS 50/50 di stack sama.
4. **`docs/handoff/W3_UAT_REPORT_20260718.md`** — laporan lengkap (lingkungan, aktor,
   bukti per bagian, SKIP + alasan + cakupan unit test, temuan) = **bahan langkah 42**.
5. **DECISIONS**: entri "UAT teknis Wave 3 PASS 38/38" + perluasan O34 butir (e)
   lead Marketing.

## Pekerjaan berikutnya

1. **Langkah 42 runbook W3 = go/no-go gate exit Wave 3 — KEPUTUSAN MANUSIA**
   (Nerissa/Yohan + head dev), bahan = `W3_UAT_REPORT_20260718.md`. Catat hasil di
   DECISIONS (pola GO W1/W2). Catatan wajib: fixture ⚠ Marketing-lead (O34-e),
   O9 placeholder (non-blocking), M15-C2 ditunda (O4/O5 prasyarat bila dihidupkan).
2. **Review & merge PR #11** (seluruh kode Wave 3) lalu PR UAT ini (retarget ke main
   bila tidak otomatis). Merge PR #11 dulu — PR UAT stacked di atasnya.
3. Setelah kedua PR merged: Wave 3 tuntas (kode + UAT); lanjut sesuai Build Plan
   (frontend Wave 1–3 belum dibangun; import riil W1-19 menunggu file manusia).
4. Deferral non-blocking lama tetap tercatat (lihat HANDOFF_SESSION_20260718 §3).

## Menunggu manusia (delta dari sesi sebelumnya)

| Apa | Siapa | Blocking |
|---|---|---|
| **Go/no-go gate exit Wave 3 (langkah 42)** — bahan sudah lengkap | Nerissa/Yohan + head dev | Wave berikutnya |
| Review & merge **PR #11** lalu **PR UAT W3** (stacked) | Nerissa/Yohan | ya (merge ke main) |
| O34 + **perluasan (e) lead Marketing/BD** — aktor produksi | Yohan (+HR) | produksi M3/M2 sisi lead (UAT jalan dgn fixture) |
| O9 target periode M14 (configurable + placeholder ditandai) | SPV Ads + OD | tidak |
| Item lama (O33 Finance, O35 sub-tim Creative, O26 NIK Yohan/Nerissa, file W1-19) | lihat HANDOFF_SESSION_20260718 | (tetap) |

## Pola kerja & environment

Fable orchestrator/QC/revisi; executor Opus ×2 (runbook + walk — dua-duanya klaster
besar). Test WAJIB `-p 1`; satu suite per DB; DSN WAJIB
`?parseTime=true&multiStatements=true`. Setup container baru = HANDOFF_WAVE2_SESSION3
§Setup (catatan: DB `cdps` perlu `migrate up` 0001–0036; boot UAT = README
import_samples §UAT — kini **43 baris / sync 43/43 / 31 mapping**).

**⚠ Prosedur anti-silent-skip MariaDB tetap WAJIB** (insiden 2× sesi sebelumnya, tidak
terulang sesi ini): (1) `service mariadb status` sebelum & sesudah run; (2) durasi paket
DB normal >1s — mayoritas 0.00Xs = silent skip, ulangi. JANGAN `pkill -f` (kill by PID).
Executor mati kena session limit → relaunch prompt sama (tidak terjadi sesi ini).
