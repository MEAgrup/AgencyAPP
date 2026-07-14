# HANDOFF — Wave 2 Sesi 3: wiring httpapi Wave 2 SELESAI + O27-b reopen + M7 §7 Daily Output

_Sesi: 2026-07-14. Model kerja (arahan Nerissa, terbukti 3 sesi): Fable = orchestrator/QC/revisi; executor = Opus (klaster besar) & Haiku (mekanis/kecil). Pertahankan._

## ⚠ STATUS PUSH: BERSIH
Branch kerja sesi ini `claude/fable-orchestrator-opus-haiku-vi68gu` ter-push penuh (tip `228e7b8`), working tree bersih. Branch di-fast-forward dari `claude/fervent-sagan-ld7ljl` (`d0705f4`, handoff sesi 2) — seluruh histori Wave 2 terbawa; TIDAK perlu kembali ke branch lama.

## Commit sesi ini (semua lolos QC orchestrator: suite fresh 26 paket `-count=1 -p 1` hijau, gofmt/vet bersih, scope aditif)
| Commit | Isi |
|---|---|
| `c594531` | docs: **O27 RESOLVED pilihan (b)** — interview Nerissa 2026-07-14; STATE_MACHINES §10 dulu |
| `119cef6` | **W2-API-1** (Opus): wiring httpapi M12+M7 — 28 endpoint, pola `routes_account.go`, nol string BI baru |
| `72c2260` | **W2-M10-C2** (Haiku): `ReopenBrief` off-machine ter-audit `ls_brief_reopened`; 2 string BI baru (di DECISIONS) |
| `dcf75bd` | **W2-API-2** (Opus): wiring M8+M9+M10 — 44 endpoint (total 72+); guard Launch M8 dua sisi; endpoint reopen; helper aditif read-only `module8_ads/read.go`; **wiring httpapi Wave 2 SELESAI** |
| `45b96c8` | **W2-API-3** (Haiku): guard submit brief Ads aktif via `SubmitGuard` injection + test dua sisi (melunasi utang W2-API-2) |
| `228e7b8` | **W2-M7-C2** (Opus): Daily Output auto-log + EOD lock (M7 §7) = **pure derived read-model** dari audit log, bucketing WIB, tanpa migrasi; 1 string BI baru |

Migrasi terpakai tetap **0020–0028** (W2-M7-C2 sengaja tanpa tabel baru — lihat entri DECISIONS).

## Keputusan sesi ini (sudah di DECISIONS.md, semua FINAL)
- **O27 = (b)**: brief LS `[Approved]` dapat dibuka kembali (`ls_brief_reopened`, gate owner AM/Director); rollup existing re-close otomatis. Endpoint: `POST /api/v1/briefs/{id}/reopen`.
- **W2-M7-C2 interpretasi** (atribusi ke Assigned PIC; Output Unit = Asset Type; lock = boolean turunan WIB; read gate internal Creative tanpa Account/AM).
- Mapping `ErrBudgetApprovalRequired` → 403 (gate otoritas).
- Item manusia Wave 1: per interview 2026-07-14 **belum ada yang siap** (nik_email.csv, sales_map.csv+MSL, form pelengkap 239 klien, NIK OD/Director, endpoint HRIS).

## Open BARU untuk interview awal sesi berikut (tidak memblokir)
1. **O28 — koreksi Daily Output pasca-lock** (M7 §7 Rule 3): model derived tidak punya surface koreksi. (a) koreksi = re-transisi biasa hari berikutnya [posisi sekarang, nol kode] vs (b) entitas override ber-approval lead [butuh spec field]. 
2. **O29 — Hours Logged reminder (M7-OA-2)**: katalog notifikasi FROZEN tidak punya event-nya. Tambah event di pembukaan katalog berikutnya, atau cukup visual dashboard?
3. Ulangi status **item manusia Wave 1** (memblokir UAT go-live W1-20).
Nomor Open terakhir = **O29**.

## Pekerjaan berikutnya (urutan)
1. **Sisa klaster deferred Wave 2** (cek entri DECISIONS per modul): wiring endpoint Daily Output M7 §7 (domain sudah ada, tinggal route+handler+permission test — kecil, cocok Haiku); M6-OA-1 override flag per-engagement; Attributed GMV write-back KOL via affiliate link (M9-OA-4, kolom siap); assign-PIC granular sub-tim Creative (M7 §3); handler bulk M1 & port test stream A (utang Wave 1, non-blocking). KPI rollup (M7 §8, M8 GMV Impact, Monthly KOL Report M9 §9) → sebagian besar M14 (Wave 3).
2. **UAT Wave 2** = gate exit Wave 2 (runbook menyusul, pola W1-20). UAT W1-20 go-live tetap menunggu item manusia.
3. **Wave 3** (build order): M2, M3, M11, M13, M14, M15 — Client Portal (M15) terakhir setelah security spec (O5).

## Cara kerja terbukti (ringkas — detail di HANDOFF_WAVE2_SESSION2.md, masih akurat)
- Orchestrator TIDAK menulis fitur (kecuali revisi kecil pasca-QC); prompt executor: bacaan wajib penuh, scope eksplisit, larangan (commit/push, katalog FROZEN, string BI baru → daftar persetujuan, ambiguitas → STOP), env test `-p 1`, format laporan.
- QC per klaster: `git status` scope; grep raw-UPDATE status/emisi notifikasi handler/string BI liar; verifikasi klaim ke PRD/kode; suite fresh sendiri + gofmt + vet; entri DECISIONS SEBELUM commit; push per klaster.
- Paralel aman: executor A worktree (`CDPS_TEST_DSN` → `cdps_test2`) + executor B main tree (cdps_test). JANGAN dua suite serentak di DB yang sama. Hasil worktree di-port via `cp` + `git apply` patch, worktree dihapus setelahnya.
- **Session limit**: kedua executor pernah mati seketika saat limit (reset 5am UTC) — relaunch prompt sama setelah reset berhasil mulus; worktree gagal terhapus otomatis.

## Setup container baru (ephemeral)
`apt-get update && apt-get install -y iproute2 rsync mariadb-server`; `service mariadb start`; buat DB `cdps`/`cdps_test`/`cdps_test2` + user `cdps`@localhost & @127.0.0.1 password `cdps_dev` (GRANT ALL ketiganya); `SET GLOBAL log_bin_trust_function_creators=1`. DSN test default `cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps_test`. ⚠ MariaDB bisa mati saat cleanup background task — cek `service mariadb status` bila test SKIP "connection refused", dan **pastikan tidak ada SKIP massal** sebelum percaya suite hijau.
