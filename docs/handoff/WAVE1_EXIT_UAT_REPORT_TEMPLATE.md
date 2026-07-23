# Laporan Hasil UAT — Gate Exit Wave 1

> Isi saat menjalankan `WAVE1_EXIT_UAT_RUNBOOK.md`. Satu baris per langkah.
> Status: ✅ lolos · ❌ gagal (blocking) · ⚠️ catatan (non-blocking) · ⏭️ dilewati (opsional/tak relevan).

- **Tanggal UAT:** ____
- **Deal riil (klien):** ____ · **LEAD-/CLI-/TRX-:** ____
- **Pilot:** Sales ____ · Finance ____ · Dampingan: Dev ____ · OD ____
- **Build main @ commit:** ____ (harus mengandung Merge PR #37/#38/#39)

## Hasil per langkah

| Langkah | Status | Bukti (ID / status DB / string BI / screenshot) | Catatan |
|---|---|---|---|
| A1 migrasi 53 tabel |  |  |  |
| A2 login peran + OD read-only |  |  |  |
| A3 seed fixture (opsional) |  |  |  |
| B1 register lead |  |  |  |
| B2 claim pool |  |  |  |
| B3 New Lead→Contacted |  |  |  |
| B4 Qualified + estimasi otomatis |  |  |  |
| B5 spot-check komisi vs MSL |  |  |  |
| B6 negosiasi + approval SPV |  |  |  |
| B7 closing atomik + Σ=100% |  |  |  |
| C1 visibility pra-verifikasi |  |  |  |
| C2 lock matrix edit |  |  |  |
| C3 platform add/deactivate |  |  |  |
| C4 changeScheme pra-verifikasi |  |  |  |
| C5 verifikasi #1 + routing gate |  |  |  |
| C6 verifikasi #2 (rilis sekali) |  |  |  |
| C7 over-verifikasi diblokir |  |  |  |
| C8 kontrak gate + Lunas |  |  |  |
| C9 reminder/scan + Jatuh Tempo |  |  |  |
| C10 Bermasalah (opsional) |  |  |  |
| D1 commission cross-check |  |  |  |
| D2 void service + efek komisi (opsional) |  |  |  |
| D3 audit immutable |  |  |  |
| D4 recompute dari log |  |  |  |

## Temuan

| # | Langkah | Severity | Deskripsi | Tindak lanjut |
|---|---|---|---|---|
|  |  |  |  |  |

## Keputusan go/no-go Wave 2

- **Keputusan:** ⬜ GO · ⬜ NO-GO
- **Alasan:** ____
- **Disetujui oleh:** ____ (pemilik) + ____ (head dev)
- **Dicatat di `docs/DECISIONS.md`:** ⬜ ya (tanggal ____)
