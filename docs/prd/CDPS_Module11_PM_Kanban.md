# CDPS — Module 11: Project Management / Kanban

**Status:** Draft untuk konfirmasi Yohan sebelum developer ticketing
**Worked example:** Alpha Digital (Client), AM Sinta, Editor Rian (Creative), Advertiser Kenny (Ads), KOL Coordinator Putri
**Bergantung pada:** Module 6 (Brief — universal sub-entity per divisi), Module 7–10 (status native per divisi)

---

## 1. Background

Sampai Module 10, setiap divisi (Creative/Ads/KOL/Live Stream) punya Kanban dan status machine sendiri-sendiri di level Brief. Masalahnya: AM dan SPV gak punya satu pandangan tunggal buat satu Client — mereka harus buka 4 modul beda buat tau progress 1 Client secara penuh, dan gak ada cara formal buat nyatat "Brief A harus selesai dulu sebelum Brief B bisa jalan" (misalnya Ads gak bisa launch sebelum Creative selesai).

Module 11 menjawab dua hal:
1. **Unified Board** — satu papan per Client yang menggabungkan semua Brief lintas divisi, pakai kolom status yang sama (Universal Column), dihitung otomatis dari status native masing-masing modul.
2. **Dependency** — mekanisme formal buat nyatat ketergantungan antar Brief (blocking atau cuma informasional), supaya AM/SPV bisa lihat dan sistem bisa cegah kerjaan yang launching duluan padahal prasyaratnya belum kelar.

Hasil yang diharapkan: AM/SPV bisa buka satu board per Client, langsung tau divisi mana yang nge-blok progress, tanpa loncat-loncat modul.

---

## 2. Rules

1. Unified Board menampilkan **semua Brief milik satu Client**, lintas divisi (Creative/Ads/KOL/Live Stream), dikelompokkan per **Universal Column** — hasil mapping otomatis dari status native, bukan field yang diisi manual.
2. Mapping status native → Universal Column **fixed per divisi** (lihat tabel §5), tidak bisa di-override per kasus oleh user.
3. Brief dengan sub-entity campuran (Asset/Booking) pakai aturan **worst-case**: Universal Column = tahap paling belum selesai, sampai SEMUA sub-entity capai tahap akhir (Approved/QC Passed/Reconciled).
4. Dependency hanya bisa dibuat antar Brief **dalam Client yang sama** (lintas-Service dalam satu Client boleh; lintas-Client dilarang dan ditolak sistem).
5. Dependency punya 2 tipe:
   - **Blocking** — mengunci transisi spesifik Target Brief sampai Source Brief capai `[Approved]` (atau setara di divisi lain).
   - **Informational** — sekadar penanda relasi di board, tidak mengunci transisi apapun.
6. Sistem menolak **circular dependency** saat create (validasi graph traversal, server-side).
7. Brief dengan Blocking Dependency yang belum Satisfied ditandai badge **"Menunggu Dependency"** di board; PIC tetap boleh lanjut kerja di Brief itu — yang ditolak sistem cuma transisi ke gate yang terkunci (mis. ADC Launch), bukan seluruh aktivitas Brief.
8. Begitu Source Brief capai status akhir, Dependency otomatis berubah jadi **Satisfied** dan badge hilang — tidak perlu trigger manual dari siapapun.
9. Guardrail Module 8 (Linked Creative Asset wajib `[Approved]` sebelum Ad Campaign Launch) **tetap berlaku independen** sebagai Blocking Dependency implisit bawaan sistem — AM tidak perlu declare manual untuk kasus ini.
10. **My Tasks** (view personal) menampilkan Brief/Asset/Booking/Session milik staff sendiri lintas semua Client. **Client Board** (AM/SPV/OD/Director) menampilkan semua Brief satu Client — konsisten Role Matrix Phase 0 (Staff lihat punya sendiri, Lead/SPV lihat semua).

---

## 3. Flow

1. Service di-breakdown jadi Brief lintas divisi (sudah berjalan dari Module 6) →
2. AM/SPV — **opsional** — declare Dependency antar Brief kalau memang ada ketergantungan kerja nyata →
3. Sistem hitung Universal Column tiap Brief otomatis, dari status native + rollup sub-entity + status Dependency yang masih Blocking →
4. Client Board menampilkan semua Brief Client tersebut, terbagi per Universal Column, dengan badge divisi & badge Dependency (kalau ada) →
5. PIC tetap kerja seperti biasa di level native masing-masing modul (Module 7–10), tidak ada interface baru buat eksekusi harian →
6. Kalau ada percobaan transisi yang kena Blocking Dependency belum Satisfied → sistem **reject server-side** dengan pesan, contoh: *"Brief ini belum bisa lanjut ke [In Execution] karena menunggu BRF-202606-0007 selesai Approved."* →
7. Begitu Source Approved → Dependency auto-Satisfied, badge hilang, Target lanjut normal →
8. AM/SPV pantau Client Board harian, filter per divisi/status/PIC/overdue buat nentuin prioritas follow-up.

---

## 4. Example — Alpha Digital

**Service "TikTok Shop Full Management"** (Plan-gated) breakdown jadi 2 Brief:
- `BRF-202606-0012` (Creative, Rian) — 12 Product Videos
- `BRF-202606-0013` (Ads, Kenny) — setup `ADC-202606-0003`

Sinta declare **Blocking Dependency**: Source `BRF-0012` → Target `BRF-0013`, catatan "ADC gak bisa Launch sampai semua Asset Approved". (Enforcement teknisnya sebenarnya sudah otomatis dari guardrail Module 8/Rule 9 — Sinta declare ini cuma supaya badge-nya muncul di board buat visibilitas tim.)

**Hari ke-3:**
- `BRF-0012` → Universal Column **Awaiting Review** (8/12 Asset Submitted, nunggu 4 lagi)
- `BRF-0013` → tetap nampilin status native `[In Progress]` (Kenny udah riset audiens), tapi dapat badge **"Menunggu Dependency"** karena belum bisa Launch.

**Service "Single KOL Booking"** → `BRF-0014` (KOL, Putri), 1 Booking creator. Booking `[QC Passed]` → `BRF-0014` Universal Column = **Done**.

**Service "Live Stream upsell"** (ditambah belakangan) → `BRF-0015` (Live Stream). Sinta declare **Informational Dependency**: Source `BRF-0014` → Target `BRF-0015`, catatan "creator yang live = creator yang sama dari Booking BKG-202606-0014" — tidak mengunci apapun, cuma bantu SPV ngerti relasinya pas lihat board.

**Snapshot akhir bulan — Client Board Alpha Digital:**

| Brief | Divisi | Universal Column | Dependency |
|---|---|---|---|
| BRF-0012 | Creative | Done | — |
| BRF-0013 | Ads | Awaiting Review | Satisfied |
| BRF-0014 | KOL | Done | — |
| BRF-0015 | Live Stream | In Progress | Informational (link ke BRF-0014) |

Sinta langsung tau: tinggal follow up Ads biar cepat di-Approve, sisanya jalan normal — tanpa buka 4 modul terpisah.

---

## 5. System Requirements

### 5.1 Entity baru: Dependency (`DEP-YYYYMM-NNNN`)

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| Source Brief ID | ref BRF | ✅ | Brief yang jadi prasyarat |
| Target Brief ID | ref BRF | ✅ | Brief yang bergantung; harus Client sama dengan Source (validasi tolak kalau beda) |
| Type | enum: Blocking / Informational | ✅ | Menentukan apakah mengunci transisi atau cuma penanda |
| Note | teks bebas | opsional | Terutama dipakai untuk Informational |
| Status | enum: Pending / Blocking / Satisfied | read-only, auto | Pending = Source belum mulai; Blocking = Source belum capai status akhir & Type=Blocking; Satisfied = Source sudah capai status akhir |
| Created By | ref User (AM/SPV) | auto-log | Konsisten house convention: actor dicatat |
| Created At | timestamp | auto | — |

**Constraint:** satu pasang Source–Target cuma boleh 1 Dependency aktif (tolak duplikat). Circular dependency ditolak via graph traversal saat create.

### 5.2 Universal Column (computed, tidak disimpan permanen)

Dihitung on-the-fly setiap board di-render, dari: status native Brief + rollup sub-entity (Asset/Booking/Session) + status Dependency Blocking yang masih aktif.

**Tabel mapping status native → Universal Column:**

| Divisi | Status native | Universal Column |
|---|---|---|
| Creative | `[To Do]` | To Do |
| Creative | `[In Progress]` | In Progress |
| Creative | `[Submitted]` / `[In Review]` (rollup Asset) | Awaiting Review |
| Creative | `[Revision Requested]` (ada Asset revisi) | Blocked/Revision |
| Creative | `[Approved]` (semua Asset Approved) | Done |
| Ads | `[To Do]` / `[In Progress]` / `[Submitted]` / `[In Review]` / `[Revision Requested]` / `[Approved]` | sama pola dengan Creative (Brief closes setelah Approved; optimization lanjutan Module 8 tidak masuk board ini) |
| KOL | rollup Booking: ada `[Escalated]` | Blocked/Revision |
| KOL | rollup Booking: campuran Sourcing/Booked/Content In Progress | In Progress |
| KOL | rollup Booking: campuran Submitted/QC Review | Awaiting Review |
| KOL | rollup Booking: semua `[QC Passed]` | Done |
| Live Stream | `[Requested]` | To Do |
| Live Stream | `[Confirmed by Vendor]` | In Progress |
| Live Stream | `[Completed]` | Awaiting Review |
| Live Stream | `[Reconciled]` | Done |
| Live Stream | `[Discrepancy Flagged]` | Blocked/Revision (non-blocking flag, tetap tampil) |

### 5.3 View: Client Board

- Filter wajib: Client. Filter opsional: Division, Universal Column, PIC, Overdue (vs Brief SLA Module 6).
- Role akses: AM/SPV/OD/Director lihat semua Client (sesuai Role Matrix Phase 0); Staff hanya lihat Client di mana dirinya jadi PIC salah satu Brief.
- Tiap card Brief menampilkan: Brief ID, divisi (badge warna), PIC, Universal Column, progress sub-entity ringkas (mis. "8/12 Asset Approved"), badge Dependency kalau ada ("Menunggu Dependency" / link informasional).

### 5.4 View: My Tasks

- Personal, default filter PIC = diri sendiri, lintas semua Client yang staff itu jadi PIC.
- Sama struktur card dengan Client Board, tanpa filter Client wajib.

### 5.5 Non-functional

- Universal Column harus re-compute **near-real-time** setiap status native/sub-entity berubah (event-driven, bukan batch/cron) — konsisten house convention auto-calculated read-only field.
- Validasi Dependency (circular check, Client-match check) jalan **server-side** saat create, pesan reject dalam Bahasa Indonesia.
- Board harus tetap responsif untuk Client dengan banyak Service & Brief aktif sekaligus (Alpha Digital di contoh ini kecil; Client besar bisa punya 10+ Brief aktif paralel).

---

## 6. Resolved Decisions (Module 11)

*These 6 items were drafted with proposed defaults but never explicitly revisited before the conversation moved to Module 12. Closing them now, adopting each proposed default (none were contradicted by anything decided later) and applying the global escalation rule confirmed during the Module 1–10 cleanup pass: all escalation/authority decisions require minimum SPV/Head approval, logged for Director review.*

1. **Who can create Dependency? — ✅ Adopted.** AM or SPV/Account Lead — not staff at the division level. Consistent with the global escalation rule.
2. **Approval gate for Dependency itself? — ✅ Adopted.** No separate approval gate — takes effect immediately once AM/SPV declares it (visibility-only control, same pattern as Module 8's no-approval-gate-by-default for routine optimizations).
3. **Blocking gate — fixed or custom? — ✅ Adopted.** Fixed gate for v1 ("Target can't pass its final transition until Source reaches its terminal status") — no custom per-case gate text yet.
4. **Relation to Module 8's guardrail? — ✅ Adopted.** Stays separate — the Creative→Ads launch guardrail remains a built-in implicit Blocking Dependency (Module 8 §4 Rule 2), never something AM has to declare manually. This Module 11 Dependency table is for every other cross-division relationship that doesn't already have a hardcoded system guardrail.
5. **Overdue/SLA on the board? — ✅ Adopted.** Uses Brief SLA from Module 6 as-is — no extra grace period for Dependency-caused delay in v1.
6. **Live Stream rollup mapping? — ✅ Adopted.** The 1:1 status→Universal Column mapping in §5.2 is sufficient — no separate "Menunggu Vendor" column needed, since Live Stream's own native states (Module 10) already distinguish vendor-side waiting clearly enough at the Brief level.

---

## 7. Success Metrics

- **Activation event:** AM/SPV pertama kali pakai Client Board buat planning/monitoring harian (bukan cuma buka Kanban per-divisi terpisah seperti sebelumnya).
- **North-star:** % Service yang punya cross-division dependency riil ter-declare **sebelum** Brief downstream mulai dikerjakan (mencegah kerjaan sia-sia karena ketergantungan baru ketahuan belakangan).
- **Leading indicators:**
  - Jumlah Blocking Dependency yang resolve tepat waktu vs yang stuck lama (indikasi bottleneck antar divisi).
  - Jumlah kasus Brief "kerja duluan, gagal launch" karena dependency belum Approved — target turun mendekati 0 setelah board dipakai rutin.
- **Engagement proxy:** frekuensi AM/SPV membuka Client Board per minggu per Client aktif.

---

**Selanjutnya:** Module 12 — Task Execution (universal task lifecycle, time-tracking, duration feeds KPI).
