# HANDOFF — Wave 2 Sesi 1: M6 selesai, M12/M7/M8 klaster 1 selesai

_Sesi: interview keputusan manusia + eksekusi Wave 2 (2026-07-12 s/d 2026-07-13)._
_Model kerja sesi ini (arahan Nerissa): Fable = orchestrator/QC/revisi; executor = Opus (klaster besar) & Haiku (tugas mekanis). Pola berhasil — pertahankan._

## ⚠ PERTAMA KALI DIBACA: status push
- **Kemungkinan ada commit lokal yang BELUM ter-push** ke `origin/claude/wave1-handoff-wave2-decisions-utajej`. Proxy git container 403 sejak 2026-07-12 ~18:05 UTC (jalur MCP GitHub tetap hidup — jadi gangguan token proxy git, bukan kebijakan repo). Commit antre saat handoff ditulis: `1914a91` (M12-C1), `7c12afd` (M7-C1), `21f8066` (M8-C1), + commit handoff ini.
- Cek `git log origin/claude/wave1-handoff-wave2-decisions-utajej..HEAD --oneline`; kalau masih ada antrean, `git push -u origin claude/wave1-handoff-wave2-decisions-utajej` (retry backoff). Rantai `send_later` retry mungkin masih aktif dari sesi lama — kalau push sudah beres, biarkan firing berikutnya melapor lalu mati sendiri.
- Identitas committer semua commit antre sudah benar (`noreply@anthropic.com`); warning "Unverified" dari stop-hook = tidak ada signature lokal, wajar, selesai saat push.

## Status branch `claude/wave1-handoff-wave2-decisions-utajej` (di atas main `2a75125`)
Semua yang di bawah SUDAH lolos QC orchestrator + full suite hijau (**24 paket** terakhir), gofmt bersih, migrasi up→down→up, seed Alpha Digital lolos.

| Tiket | Isi | Commit |
|---|---|---|
| Interview 14 keputusan | R5 waived (Opsi A), O18/O20/O21, role mapping HRIS final (semua [KONFIRMASI]), O24 | `b9d2eef`, `6dcf222` |
| W2-TZ (O20) | Bucketing kalender → Asia/Jakarta (`core/tz`); storage tetap UTC | `28b190e` + QC `f83569c` |
| W2-O24 | State awal Service = `[Awaiting Onboarding]` (STATE_MACHINES dulu → config → fixtures) | `d53ea58` + QC `44d2a94` |
| M6 C1 | Intake & AM assignment (migrasi 0020, pelunasan W1-10: Account staff = assigned clients) | `78cd0c5` |
| M6 C2 | Strategy & Plan STR- (0021; flag `requires_strategy_plan` di VERSI MSL, di-pin ke services) | `e1cf00b` (+docs `1902d22`) |
| M6 C3 | Brief penuh (0022, promosi stub W1-12), dispatch queue divisi, O25 resolved, LS `[Dispatched to Vendor]`, void×LS fix | `27d5d3c` |
| M6 C4 | Revision routing §7 + Complaint CPL- (0023); `EvComplaintLogged` & `EvRevisionCountFlag` diemit (M6 = emitter kanonik flag) | `6c7f877` |
| M12 C1 | `module12_task` engine (Start/Submit/Rework/Block via engine; speed_score=turnaround/SLA uncapped; 0024 `sla_target_hours`+block requests) | `1914a91` |
| M7 C1 | `module7_creative` AST- (0025) + generalisasi M12 ke task-source parametrik + roll-up Brief↔Asset forward-only | `7c12afd` |
| M8 C1 | `module8_ads` ADC- (0026) + mesin `ad_campaign` (§14) + ROAS/attribution/optimization | `21f8066` |

Migrasi terpakai: **0020–0026** (rentang Wave 2 M6/M12; 0002/0006/0010–0013 beku). Package baru: `module6_account`, `module12_task`, `module7_creative`, `module8_ads`, `core/tz`.

## Keputusan yang MASIH menunggu jawaban Nerissa (provisional/open — tanya di awal sesi berikut)
1. **Model klaim eksekusi task M12 (PROVISIONAL, sudah jalan):** pra-PIC semua staf divisi target boleh klaim; pasca-PIC terkunci PIC+lead+Director; AM tak pernah ikut edge eksekusi. Tercatat di entry W2-M12-C1 butir 4. Konfirmasi/ubah.
2. **O26 — birth-status ADC (PROVISIONAL, sudah jalan):** lahir `[Paused]` + Launch eksplisit ber-gate (brief Approved + aset approved). Alternatif born-`[Active]`/auto-flip. Lihat Open O26.
3. Item manusia Wave 1 (masih ditunggu, TIDAK memblokir Wave 2): `nik_email.csv` (HR — status "hampir siap" per 2026-07-12), `sales_map.csv` + validasi MSL (Sales Head), form pelengkap 239 klien (CRO+Finance), daftar NIK kandidat OD/Director, endpoint HRIS.

## Pekerjaan berikutnya (urutan build: M6 ✅ → M12 ✅C1 → M7 ✅C1 → M8 ✅C1 → **M9 → M10**)
1. **M9 (KOL):** entitas BKG- (Booking, parent BRF) — daftarkan sebagai task source baru di `module12_task/source.go` (pola `sourceAsset`); baca PRD M9 + DATA_MODEL (BKG, LSS). Mesin §7 berlaku; §8-9 STATE_MACHINES cek dulu.
2. **M10 (Live Stream):** vendor session LSS-; brief LS sudah lahir `[Dispatched to Vendor]` (off-machine) — M10 yang memberi lifecycle vendor + menyelesaikan catatan void×LS (lihat entry W2-M6-C3 butir 3-4).
3. **Klaster lanjutan yang dideferred** (cek entri DECISIONS per modul): wiring httpapi M12/M7/M8; Daily Output auto-log + end-of-day lock (M7 §7); KPI rollup (M7 §8, M8 GMV Impact) → sebagian M14; assign-PIC granular sub-tim Creative; M6-OA-1 override flag per-engagement; handler bulk M1 & port test stream A (utang Wave 1, non-blocking).
4. **Wave 2 exit** butuh M9+M10 selesai + wiring + UAT Wave 2; UAT W1-20 (gate go-live) tetap menunggu item manusia di atas.

## Cara kerja yang terbukti di sesi ini (pertahankan)
- Orchestrator TIDAK menulis fitur; menulis prompt executor yang sangat spesifik: daftar bacaan wajib (PRD penuh + DATA_MODEL + STATE_MACHINES + entri DECISIONS Wave 2), scope klaster eksplisit, larangan (commit/push, katalog notifikasi FROZEN, string BI → daftar untuk persetujuan, ambiguitas → STOP & lapor), env test, format laporan akhir.
- QC orchestrator per klaster: jalankan sendiri full suite + gofmt + vet; verifikasi klaim penting executor langsung ke PRD/kode (string "verbatim", anti-double-emit, katalog tidak disentuh); revisi kecil langsung oleh orchestrator (preseden yang sudah dipakai: Director bypass ownership W1-13; AM=staff-only; Account lead dapat queue divisi; void×LS off-machine cancel).
- Tulis entry DECISIONS.md per klaster (string BI baru, interpretasi, deferral) SEBELUM commit; commit per klaster dengan referensi PRD §.
- **Session limit Opus**: executor mati beberapa kali (reset ~tiap beberapa jam) — pekerjaan di working tree TIDAK hilang; relaunch dengan prompt "lanjutkan dari tree state" + daftar file yang tertinggal. Selalu cek `git status` sebelum relaunch.
- Nomor Open question: cek nomor terakhir di DECISIONS.md sebelum menomori (pernah tabrakan O25 → di-renumber O26).

## Setup container baru (ephemeral — MariaDB tidak ter-install)
Ikuti `docs/handoff/HANDOFF_WAVE1_MERGE_CHECK.md` §setup (apt-get update → iproute2 rsync → mariadb-server; init; buat DB `cdps`/`cdps_test` + user `cdps`/`cdps_dev`; `SET GLOBAL log_bin_trust_function_creators=1`). Worktree agent paralel pakai DB test TERPISAH (`cdps_test2`) agar tidak tabrakan.
