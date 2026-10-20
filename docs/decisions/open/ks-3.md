<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| KS-3 | ✅ **DIJAWAB 2026-08-29 (pemilik) — isi sheet ketiga: rekap PER CAMPAIGN** (nama campaign, total leads, qualified leads, non-qualified leads, total closing, omzet, conversion rate). Ini SUDAH tercakup `salesperf.bySource`/View 3 (dikelompokkan per period+source+campaign, sudah membawa `leads`/`qualified`/`non_qualified`/`closing`/`omzet`) — satu gap: `LeadSourceRow` belum punya field `conversion_rate` eksplisit (hari ini turunannya harus dihitung FE dari `closing/leads`). **Follow-up kecil, non-blocking:** tambah `conversionRatePct` (closing÷leads, house rule #7 div-zero→null) ke `salesperf.bySource` + wire + UI View 3. _Konteks asli:_ sheet `19pfVwm…` tidak bisa diakses saat audit. | Ditutup — Pemilik | Tidak memblokir — View 3 sudah 90% cocok; sisanya satu kolom turunan |
