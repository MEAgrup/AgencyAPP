# Handoff — Sesi M1 v2 Dedup Kolaboratif (2026-07-16, sesi lanjutan)

> Baca ini lebih dulu. `HANDOFF_MSL_KALKULATOR.md` (MSL/kalkulator) dan
> `HANDOFF_JALUR_B_SESSION2.md` (urutan import data manusia) masih berlaku
> untuk bagiannya masing-masing.

## Status saat handoff

**Branch:** `claude/fable-orchestrator-setup-19x7sa` — 3 commit (1 docs keputusan,
1 feat backend, 1 docs handoff), full suite hijau (`go test -p 1 ./...`, 20 paket,
MariaDB). Belum ada PR (tidak diminta); branch siap di-PR-kan kapan saja.

**PR #7 (MSL kalkulator) sudah MERGED ke main** — item 1 handoff sebelumnya selesai.

**Pola kerja:** Fable = orchestrator/QC/revisi; eksekutor subagent = opus (backend),
sonnet (data/CLI), haiku (docs). Terbukti dua sesi berturut-turut.

## Apa yang selesai sesi ini (item 4 handoff sebelumnya)

**M1 v2 — dedup kolaboratif** (eksekusi DECISIONS 2026-07-10 "M1 DEDUP DIREDESAIN"):

1. `module1_leads.Decide(channel, match, actor)` — jalur single-reg Sales kini
   KOLABORATIF: attempt terbuka milik sales lain ⇒ `OutcomeJoin` (PRSP- baru pada
   LEAD- yang sama, audit `dedup_join`, notifikasi ke pemilik attempt lain, pesan
   inline `[lead juga sedang dikerjakan sales lain]`); duplikat milik sendiri ⇒
   blokir `[lead sudah ada di daftar prospek Anda]`; `[Closed-Success]` tetap
   blokir; terminal tetap reopen; `[Pool]` tanpa attempt ⇒ join senyap (setara
   claim). Jalur import Marketing TIDAK berubah (M1-OA-6 / M1 §3 rule 5).
2. **Event katalog ke-14:** `m1.lead.collaborative_attempt` (resolver explicit —
   hanya pemilik attempt lain; pendaftar dapat info via respons API `collab`).
3. **O19 RESOLVED:** `MatchByPhone` + `IsTerminalAttempt` diekspor; mirror query
   di importer DIHAPUS; `JOIN employees` → `LEFT JOIN` (drop attempt karyawan
   belum sinkron HRIS diputuskan defect; nama fallback = employee_id).
   Konsekuensi importer yang disengaja: baris lead yang match lead ber-attempt
   milik karyawan belum sinkron kini BLOCK (dulu keliru reopen).
4. Dokumen: 3 baris Decided 2026-07-16 + **Open O26 baru** (konfirmasi Nerissa:
   wording 2 string BI baru, pendaftar tanpa notifikasi in-app, import tetap
   blokir) di `DECISIONS.md`; `STATE_MACHINES.md` §2 diperbarui.

**Test:** tabel keputusan v2 (pure), join E2E + target notifikasi + audit,
blokir duplikat sendiri, regresi LEFT JOIN owner belum sinkron, ekspektasi
importer disesuaikan. Fixtures Alpha Digital tetap lolos.

## Yang menunggu manusia (TIDAK berubah dari handoff sebelumnya)

- **Drop-zone `backend/testdata/import_samples/` masih kosong** — file data
  manusia (daily_leads, form pelengkap, db_jasa, NIK→email) belum masuk.
- **O21** NIK→email (blokir login riil), **O20** UTC vs WIB (putuskan sebelum
  UAT W1-20), **O24** commission_rule 32 layanan (blokir UAT komisi),
  **O25** anomali sheet kalkulator, **O26** (baru — konfirmasi detail M1 v2,
  non-blocking).
- Daftar lengkap + instruksi: `LANGKAH_MANUSIA_GO_LIVE.md`.

## Pekerjaan sesi berikutnya (urutan saran)

1. **Buka PR** untuk branch ini bila diminta / review manual, lalu merge.
2. Begitu data manusia masuk → **import W1-19** (`HANDOFF_JALUR_B_SESSION2.md` §A)
   + **sync HRIS** (§B) + **seed MSL final** (O24 terisi → `mslseed --apply`).
3. **W1-20 UAT** end-to-end (`W1-20_UAT_RUNBOOK.md`) — perhatikan O20 harus
   diputus dulu.
4. Setelah exit criteria Wave 1 lolos → **Wave 2** (M6, **M12 early**, M7, M8,
   M9, M10) sesuai Build Plan §4.
5. Ide backlog yang MASIH butuh keputusan (jangan dikerjakan tanpa keputusan):
   lihat "Ide lanjutan MSL" di `HANDOFF_MSL_KALKULATOR.md`; tambahan sesi ini —
   UI M1 (pool/claim/registrasi) belum ada di web-internal; saat dibangun,
   render `collab.message` + `collab.other_sales` dari respons registrasi.

## Peta file kunci (sesi ini)

- `backend/internal/module1_leads/dedup.go` — tabel keputusan v2 (decideImport /
  decideSingleReg), string BI baru
- `backend/internal/module1_leads/leads.go` — `MatchByPhone` (LEFT JOIN),
  `IsTerminalAttempt`, `Register` 4-return (`*JoinInfo`), emit notifikasi in-tx
- `backend/internal/core/notification/notification.go` — event ke-14
- `backend/internal/httpapi/leads_handlers.go` — field respons `collab`
- `backend/internal/importer/leads.go` — mirror dihapus, pakai helper resmi

## Environment notes (container baru)

Sama dengan `HANDOFF_MSL_KALKULATOR.md`: MariaDB harus di-install manual
(`apt-get update` dulu), DB `cdps`+`cdps_test` user `cdps`/`cdps_dev`,
test wajib `go test -p 1 ./...`. gofmt punya 4 file komplain PRA-EKSISTING
(importer.go, module4_client/{client,lock,intent_test}.go) — bukan dari sesi
ini, rapikan terpisah bila mau.
