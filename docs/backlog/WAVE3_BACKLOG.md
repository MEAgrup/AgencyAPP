# CDPS — Wave 3 Backlog (M11, M13, M14, M15)

> Prasyarat: Wave 2 exit criteria lulus (W2-30). M2+M3 sudah dimajukan ke Wave 2 stream D (DECISIONS 2026-07-12), sehingga Wave 3 kini rantai dependensi murni: **M11 → M13 → M14 → M15** — tiap modul membaca hasil modul sebelumnya, tidak ada yang saling menunggu selain urutan ini. M11 boleh mulai hari pertama pasca gate (semua status native sumbernya beku sejak Wave 2). Client Portal tetap PALING AKHIR, setelah spec keamanan (O5) dan cek embeddability (O4).

## Epic M11 — Unified Board & Dependency

- **W3-01 · Dependency entity** (M11 §5.1): `DEP-` Blocking/Informational; hanya AM/SPV yang create; validasi server-side: satu Client sama, tolak duplikat pasangan aktif, tolak siklus (graph traversal); status auto Pending/Blocking/Satisfied — tanpa transisi manual; blocking gate menolak transisi final Target dengan pesan BI M11 Flow 6; guardrail M8 (Asset Approved sebelum ADC launch) tetap implisit terpisah (M11 R9 — sudah dibangun W2-17). AC: circular fixture ditolak; auto-Satisfied saat Source terminal + notif PIC Target (katalog existing).
- **W3-02 · Universal Column + Client Board + My Tasks** (M11 §5.2–5.4): mapping fixed per divisi (tabel §5.2), worst-case rollup sub-entity — dibaca dari kolom rollup W2-07, near-real-time event-driven (§5.5); Client Board (filter divisi/kolom/PIC/overdue) untuk AM/SPV/OD/Director, Staff hanya klien di mana ia PIC; My Tasks lintas klien. AC: board p95 sesuai budget W2-29 pada klien ber-10+ Brief aktif; badge "Menunggu Dependency" muncul/hilang otomatis.

## Epic M13 — Client Health

- **W3-03 · Snapshot bulanan `CHR-`** (M13 §2–5): 7 komponen, bobot terkonfirmasi, redistribusi komponen missing/toggled (bobot terpakai disimpan per snapshot); sub-score capped + raw uncapped keduanya disimpan; grace 1 bulan klien baru; band 80/60; ROAS toggle per klien (default = ada Ads service aktif); snapshot immutable; band-drop flag SPV (katalog existing); Satisfaction selalu N/A sampai M15 — tidak pernah proxy. Batch chunked+idempotent+resumable (NFR W2-29). AC: fixture Alpha Digital §4 (74,6 → Watch) angka-per-angka; recompute-from-log.
- **W3-04 · Live preview + trend** (M13 §5.3): preview bulan berjalan read-only, tidak disimpan, tidak masuk trend; trend chart multi-periode dari snapshot saja. AC: preview ≠ snapshot dibuktikan test.

## Epic M14 — Team Performance

- **W3-05 · KPI Profile engine + admin UI** (M14 §2, §5.2): profil per role (bobot terkonfirmasi §2 R2) dikonfigurasi via admin UI tanpa redeploy; normalisasi `Actual ÷ Period Target × 100` capped (target periode dari entry O9/OA-5 — dijadwalkan selama Wave 2, risiko R6); transform Speed (OA-1); redistribusi komponen missing. AC: fixture Kenny §4 (86,4 + modifier +2 = 88,4).
- **W3-06 · Snapshot `PERF-` + Client-Outcome Modifier** (M14 §3, §5.3–5.4): modifier `clamp((avg−80)÷2, ±10)` dari sub-komponen CHR per mapping role (Creative→Revision Burden, Ads→ROAS Attainment, KOL→Task Completion); scoped ke klien yang disentuh bulan itu; snapshot bulanan immutable; breakdown penuh selalu tampil (§5.5); notif skor terbit (katalog existing); team rollup = simple average. AC: permission Staff-own/TL-team/OD-Director-all.

## Epic M15 — Portals (paling akhir)

- **W3-07 · Gate pra-portal:** (a) spec keamanan Client Portal detail (O5) di atas minimum Phase 0 v2 §11 — realm auth terpisah, isolasi per-Client di query layer (allow-list, BUKAN view internal yang dipangkas), rate limiting login+complaint, session expiry, audit per-contact; (b) cek embeddability `mea-client-reporting` (O4, 1 hari — fallback link-out R2 bila gagal, deviasi dicatat karena M15-OA-3 konfirmasi embed). AC: spec di-review head dev + Nerissa sebelum W3-09 mulai.
- **W3-08 · Team Portal** (M15 §3): landing My Tasks sorted SLA-risk + skor berjalan + quick actions; varian TL/SPV dengan team rollup + **block-approval queue** actionable (backend sudah dari W2-06; reject tanpa alasan — OA-6); **Management Dashboard** Director/OD: seluruh basis klien per band, sortable, drill-through, read-only. AC: quick action mendelegasi ke mekanik native (tidak ada jalur transisi kedua).
- **W3-09 · Client Portal** (M15 §2, §6.1): app/realm terpisah, multi-contact per klien (aksi per-contact ter-audit); relabel Universal Column client-facing (tabel §2); Health band-only ("On Track"/"Needs Attention"/"Action Needed") — tanpa angka; laporan embedded; complaint form → `CPL-` source=Client Portal + auto-ack; submit-only (tanpa riwayat); exclusion list §2 R7 ditegakkan di data layer. AC: test isolasi lintas-klien (contact klien A tidak bisa menyentuh data klien B pada SEMUA endpoint portal); rate-limit test.

## Penutup wave

- **W3-10 · Wave 3 UAT + exit review** (Build Plan §4): management membuka satu dashboard melihat band semua klien; satu staf melihat skor bulanan dengan breakdown penuh; satu klien pilot login Portal. Go-live checklist `docs/handoff/LANGKAH_MANUSIA_GO_LIVE.md` diperbarui.
