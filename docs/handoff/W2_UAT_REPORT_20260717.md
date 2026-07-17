# Wave 2 — Laporan UAT teknis (2026-07-17)

**Hasil: PASS 50/50 assertion langkah teknis** (runbook `W2_UAT_RUNBOOK.md` langkah 2–48,
dieksekusi via API dengan aktor riil + fixture; skrip repeatable `backend/uat/w2_walk.py`,
jalankan setelah boot order README import_samples §UAT — nomor telepon/nama unik per run).
Eksekusi ganda: executor Opus (run pertama) + rerun QC orchestrator — keduanya 50/50.

## Lingkungan
Stack dev container: MariaDB lokal, `cmd/mockhris` + `cmd/cdps` dengan `employees_uat.csv`
**42 baris** (33 riil + 2 fixture Director O26 + 2 fixture Finance O33 + **5 fixture Wave 2
O34**), `rolemapseed --role-csv role_mappings_uat.csv` (30 mapping + 3 layered), `mslseed`
32 layanan. Branch `claude/wave-2-uat-mock-hris-qotk8y` (tip PR #9 + runbook/fixture O34).
Suite fresh `go test -count=1 -p 1 ./...` di container yang sama: 28 paket hijau, 0 skip.

## Aktor
| Peran runbook | Akun | Riil/fixture |
|---|---|---|
| Sales Staff / Sales Head | SAFFIRA (`2404160367`) / CUCU NURHAYATI (`2101180004`) | riil |
| AM (Account staff) | SYIFA NUR ALYA PUTRI (`2412090425`) + AM kedua utk uji negatif | riil |
| Account Lead | YULIANTI HANDAYANI (`2305100275`) | riil |
| Creative Staff | MOCHAMAD ARIF (`2111040039`) | riil |
| Creative Lead | `UATCRE0001` | **fixture — Open O34** |
| Ads Staff (Advertiser) | KENNY (`2206060100`) | riil |
| Ads Lead (SPV Ads) | `UATADS0001` | **fixture — Open O34** |
| KOL Staff/Coordinator + Lead | `UATKOL0001` / `UATKOL0002` | **fixture — Open O34** |
| Live Stream Staff (queue-viewer) | `UATLSS0001` | **fixture — Open O34** |
| Finance Staff / Head | `UATFIN0001` / `UATFIN0002` | **fixture — Open O33** |
| OD (layered) / Director | OKFA (`2409230432`) riil / `UATDIR0001` | riil / **fixture O26** |

## Bukti kunci per bagian (status/pesan BI persis)
- **[A 2–3]** Login 17 akun lintas peran; role resolution benar; password salah →
  `[email atau password salah]`; precondition dicetak via API: deal 2 layanan flat →
  closing atomik → verifikasi + kontrak → klien released + **2 SVC `[Awaiting Onboarding]`**.
- **[B 4–7]** Intake queue Account-lead-only; assign AM ke staff aktif (audit `am_assigned`);
  reassign wajib alasan (audit `am_reassigned`); visibilitas assigned-AM (AM lain 404).
- **[C 8–13]** Direct tanpa STR (`[layanan ini tidak memerlukan Strategy & Plan]`);
  override M6-OA-1 flip flag via COALESCE + audit; STR `[Strategy Drafting]` →
  `[Strategy Submitted for Approval]` → revisi (notes wajib, Revision Count derived) →
  approve oleh Account Lead ⇒ **transaksi tunggal STR + Service `[Strategy Approved]`**.
- **[D 14–18]** GuardBriefCreation plan-gated (`[layanan ini wajib memiliki Strategy & Plan
  yang disetujui sebelum dibuatkan Brief]`); Direct edge → `[Briefed]`; brief LS lahir
  off-machine `[Dispatched to Vendor]`; brief-queue per divisi (staf divisi lain ditolak).
- **[E 19–24]** Klaim M12 (pra-PIC staf divisi boleh start; pasca-PIC non-PIC ditolak);
  hook `OnBriefLeavesToDo` ⇒ Service `[In Execution]` se-transaksi; block-request queue
  (approve lead, `[Blocked]`, resume **lead-only** per STATE_MACHINES §7); metrics Speed.
- **[F 25–29]** Asset per-sequence; roll-up forward-only Asset→Brief→Service; submit tanpa
  link → `[link output wajib diisi sebelum submit]`; review per-Asset oleh owning AM;
  Hours Logged overwrite-and-audit; **Daily Output derived + lock WIB hari lampau**.
- **[G 30–36]** ADC lahir `[Paused]` (O32); link asset wajib `[Approved]`; submit-guard
  M8 (`[campaign belum lengkap…]`); **Launch gate sisi (a) teruji** (brief belum approved
  ditolak); metrics append-only, ROAS derived; optimisasi budget >50% oleh Advertiser polos
  → 403, oleh SPV Ads fixture / owning AM diizinkan (M8-OA-3).
- **[H 37–41]** BKG lifecycle native §8 sampai `[QC Passed]`; cap revisi 1 → FailQC kedua
  diblok `[batas revisi kreator tercapai…]`; drop reason wajib (`[Dropped]` excluded);
  Attributed GMV hanya `[QC Passed]` (M9-OA-4, AM ditolak); CPR amount = Agreed Rate,
  sisi Finance `[Received by Finance]`→`[Paid]`/`[Rejected]` (reason wajib).
- **[I 42–46]** LSS `[Requested]`→`[Confirmed by Vendor]`→`[Completed]` (vendor report link
  wajib)→`[Reconciled]`; discrepancy non-blocking + `EvSessionDiscrepancyFlagged`; roll-up
  brief LS `[Approved]`; **reopen O27-b** (AM/Director; AM lain/Account lead/OD ditolak);
  void ⇒ brief `[Cancelled — Service Voided]`, session dibekukan.
- **[J 47–48]** Audit chain immutable 7 entitas (CLI/STR/BRF/AST/ADC/BKG/LSS); OD semua
  write 403; recompute derived (Speed, ROAS, Daily Output, Attributed GMV) = nilai tampil.

## Tidak dijalankan (dengan alasan)
- **[1]** boot order = manusia/dev (dilakukan manual saat setup container ini).
- **[49]** **go/no-go gate exit Wave 2 = keputusan manusia (Nerissa/Yohan + head dev)** —
  laporan ini bahannya.
- Negatif HRIS-down — perlu mematikan mockhris; sudah teruji di gate login UAT (Decided
  2026-07-17) & W1-20.
- Negatif `[aset kreatif bukan milik klien layanan ini]` — butuh klien kedua; path linkage
  lain teruji.
- **Launch gate sisi (b)** (`[…aset kreatif tertaut harus disetujui]`, `ads.go:141`) —
  **defensif tak terjangkau via API**: LinkAsset mewajibkan aset `[Approved]` dan
  `[Approved]` terminal, jadi aset tertaut tidak bisa regresi. Tercakup unit test M8.
- Worked example Alpha Digital 54÷48=112.5% — tidak reproducible pada walk real-time
  (turnaround riil ~detik); formula + recompute konsisten (langkah 24/48), vektor persis
  tercakup unit test M12.

## Temuan
1. **O34 (BARU, blocking produksi M7-lead/M8-SPV/M9): roster HR riil tanpa aktor untuk
   peran eksekusi Wave 2** — divisi KOL kosong total; tidak ada lead Creative; tidak ada
   SPV Ads; tidak ada staf Live Stream. UAT memakai 5 fixture berlabel (preseden O26/O33).
   Butuh keputusan Yohan: aktor produksi peran-peran ini.
2. Kalimat runbook langkah 23 semula "PIC/lead resume" → dikoreksi **lead-only**
   (STATE_MACHINES §7 pause/resume = SPV/Lead-only; kode `block.go` sudah benar).
3. Launch gate sisi (b) bersifat defensif murni (lihat atas) — bukan bug; dicatat agar
   reviewer tidak menganggap jalur itu teruji via API.
4. Artefak UAT di DB dev ephemeral (2 run walk = 2 deal "UAT W2"); tidak mengganggu.
