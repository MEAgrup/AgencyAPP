# CDPS — Module 6A: Kolom **Strategi** (Full Store Management)

> **Scope of this document.** Field-level specification of the **Strategi** form that an Account Manager (AM) fills in when a client buys a *Full Store Management* service (MEA Agency operates the client's store end-to-end across channels). This is the content of the Plan-gated path introduced in CDPS Module 6 — the gate that must clear before any Brief is dispatched to Creative / Ads / KOL / Live.
>
> **Body text: English. Field labels, statuses, and UI copy: Bahasa Indonesia** (consistent with CDPS convention).

## Contents
1. Background
2. Locked decisions (from intake)
3. Rules
4. Form structure — Section A → J (the questions the AM answers)
5. Flow
6. Example — Alpha Digital
7. System Requirements
8. Open Assumptions
9. Success Metrics

---

## 1. Background

**Problem.** Today the "strategy" for a full-management client lives in each AM's head, a Google Doc, or a WhatsApp thread. Consequences: (a) Briefs go down to execution divisions without a shared thesis, so Ads optimises for ROAS while Creative optimises for views; (b) when a client asks "why did we do this?", nobody can reconstruct the reasoning; (c) when GMV misses target, there is no recorded assumption to test, so the post-mortem becomes opinion; (d) when an AM resigns or is reassigned, the client's context resets to zero.

**Why now.** CDPS Module 6 already enforces a Plan-gate per Service. The gate exists but is empty — it needs a canonical form with enough structure that a reviewer (SPV / Head of Account) can approve or reject on evidence, not vibes.

**Expected outcome.** One approved Strategi record per contract that (i) forces the AM to look at real store numbers before proposing anything, (ii) states an explicit growth thesis with falsifiable assumptions, and (iii) mechanically produces the skeleton of the monthly/weekly **Plan** and the Briefs beneath it.

---

## 2. Locked decisions (from intake)

| # | Decision | Value |
|---|---|---|
| D1 | Channel scope | Multi-channel: Shopee, TikTok Shop, Tokopedia, Lazada, Website (+ others) |
| D2 | Validity period | One Strategi per contract (3 / 6 / 12 months), revisable |
| D3 | Strategi vs Plan | **Strategi** = baseline analysis + direction + targets. **Plan** = monthly/weekly execution breakdown derived from it |
| D4 | Multi-channel structure | One parent Strategi + **mandatory sub-block per active channel** |
| D5 | Baseline data | **⟳ RAB-19 (DECISIONS 2026-08-18):** numbers may be **sourced from the Riset Awal analysis engine** (proposed), but every figure is **mandatory per-figure AM confirmation** (usulan→konfirmasi) — not free-text, and never left blank. Superseded original: "mandatory manual numeric entry per channel". |
| D6 | Approval | Internal only — SPV / Head of Account. No client sign-off required |
| D7 | Resource commitment | Mandatory to fill, but **soft reference** — Briefs may exceed it with a recorded reason (warning, not block) |
| D8 | Targets | Contract target = **floor**; AM sets a **stretch target** above it |
| D9 | Revision | Allowed anytime, but **requires a reason + a declared trigger** (target miss / client pivot / etc.) |
| D10 | Entity prefix | `STRG-` (Strategi) & `PLAN-` (Plan) — collision-proofed by a registry table + CI check (§7) |
| D11 | Baseline window | **AM-declared per contract**, not globally fixed — every contract differs |
| D12 | Notification events | Catalog formally amended to **v2 = 19 events** via migration. Not reusing generic `approval_*` |
| D13 | Plan period | **Anniversary-month cycle**, start date set by AM once at activation |
| D14 | Sanggahan Target | **Advisory only** — never changes the contract floor |
| D15 | Live Stream | **Vendor mode** (results tracker), same as MSDPS — no internal host assignment |
| D16 | Over-commitment tolerance | 20% default before SPV escalation |
| D17 | Visibility | Strategi **is shared with the client**, but selected fields are `Internal Saja` and stripped from the client export |
| D18 | Baseline source | **⟳ RAB-19 (DECISIONS 2026-08-18):** the legitimate source set grows — **seller-centre exports the AM pulls themselves** (parsed by the Riset Awal engine) are now a sanctioned baseline source, alongside manual entry. Still **no auto-pull from report-engine APIs**. Superseded original: "Manual entry. No auto-pull from report engines". |
| D19 | Vendor entity | Does not exist in CDPS yet — **`VND-` entity to be created** as a prerequisite for E-8 |
| D20 | Client-facing delivery | **Read-only web link**, not PDF — token-based, version-pinned, revocable |
| D21 | Client acknowledgement of assumptions | Not recorded. D-8 stays a one-way presentation (keeps D6 intact) |

---

## 3. Rules

1. A Strategi record is **required** before the first Brief can be dispatched for any Service flagged `butuh_plan = true` in the Service Catalog (Module 4). Full Store Management is always `butuh_plan = true`.
2. Exactly **one active Strategi per Contract**. Multiple contracts for the same client = multiple Strategi records.
3. **Channel sub-blocks are driven by the contract**, not by AM choice: every channel listed in the contract scope generates a mandatory sub-block. The AM cannot submit while any contracted channel's sub-block is incomplete.
4. A channel may be marked `Belum Aktif` (not yet live) — this **skips the historical baseline fields** but still requires the launch-plan fields (Section B, group B-0).
5. **Baseline is numeric and sourced.** Every baseline group requires: the figure, the period it covers, and a source (attached export/screenshot + capture date). Strategi cannot be submitted with baseline fields left blank; `0` is a valid answer, blank is not. **⟳ RAB-19 (DECISIONS 2026-08-18): this rule is NOT loosened by D5/D18/OA-9 — it is finally *satisfied*.** The Riset Awal engine proposes the figure + period + provenance from the AM-pulled export; the AM confirms each. "Sourced" now has a real pipeline (`riset_awal_analisa` + `riset_awal_sumber_berkas`, `sha256` + capture date) instead of an unfilled requirement.
5a. **The baseline window is declared by the AM per contract, per channel** (field B-0.7) — there is no globally fixed 3-month rule, because contracts differ (new store, seasonal category, post-freeze store). Allowed range 1–6 months, default 3. A window shorter than 3 months requires a written reason. Once the Strategi is approved the window is locked; changing it is a revision (Rule 13), so later performance is always compared against the same yardstick.
6. **⟳ 2026-08-24 (DECISIONS): Diagnosis must state its reasoning in free text (C-2).** An empty C-2 fails validation. Superseded original: "Diagnosis must cite baseline. Each root-cause entry in Section C must reference at least one baseline field ID. A diagnosis with no numeric reference fails validation." — the field-ID citation requirement is dropped because AMs had no lookup UI for the 50+ valid field IDs, making the requirement a lookup burden rather than useful evidence.
7. **Target floor is read-only.** The contract target is pulled from the Contract record (Module 4) and cannot be edited in Strategi. The stretch target must be `>=` floor; if the AM believes the floor is unachievable, they raise `Sanggahan Target` (Section D-7) which routes to SPV — it does not lower the floor.
8. **Every target should carry an assumption, but this is advisory, not a submit gate.** Each monthly stretch figure is meant to be tied to at least one assumption in Section D-8 — assumptions are the objects that later justify a revision (Rule 13) — but neither the D-8 minimum nor this per-target coverage check blocks `Diajukan`/`Disetujui` (**⟳ 2026-08-26 DECISIONS, STRG-202608-0001**: an AM starting a new engagement, or a store they have not yet run, usually cannot honestly name a falsifiable assumption before work starts — real ones surface during execution, and a hard floor here just produced boilerplate rows written to pass validation, same failure mode as C-5's old "min 3"). D-8 stays fully functional and the AM is expected to keep it current as understanding grows; Rule 13(c) still requires citing a broken assumption on revision, but only if this Strategi has any recorded at all.
9. **Out-of-scope must be explicit.** Section E-9 (`Tidak Dikerjakan`) requires at least one entry. Empty = validation error. This is the anti-scope-creep record used when the client later asks for extras.
10. **Resource commitment is soft.** Brief creation compares against Section F. Exceeding it raises a `Lewat Komitmen` warning on the Brief requiring a reason, visible on the SPV dashboard. It never blocks.
11. **Floor price is a guardrail, not a suggestion.** Section E-3 records a minimum price per hero SKU. Any Brief or promo instruction below it is flagged `Di Bawah Floor` and requires SPV acknowledgement.
12. **Approval is internal and two-outcome.** SPV / Head of Account either `Disetujui` or `Dikembalikan` with a written note. A returned Strategi goes back to `Draft` and keeps its version number.
13. **Revision requires reason + trigger.** Editing an approved Strategi creates version `n+1` in `Draft Revisi`, and requires: (a) a trigger from the enumerated list, (b) a free-text reason, (c) which assumption(s) from D-8 broke — **waived only if this Strategi has zero D-8 rows recorded** (⟳ 2026-08-26 DECISIONS: since Rule 8 no longer forces D-8 to be filled, there can be nothing to cite; (a) and (b) are still always required). Version `n` becomes `Diarsipkan` (immutable, still readable) only when `n+1` is approved. The active version never disappears mid-revision.
14. **Contract end closes the Strategi.** On contract end date the record moves to `Kedaluwarsa`. Renewal creates a new Strategi that may be initialised by copying the last approved version (fields carried over, baseline fields cleared and re-required).
15. **Immutable audit log.** Every field change, submit, approval, return, and revision writes to the CDPS audit log with actor, timestamp (WIB), before/after value.
16. **Two visibility tiers.** Every field carries `visibilitas` ∈ `Bagikan ke Klien` / `Internal Saja`. The client-facing export renders only shareable fields. Three sub-rules: (a) fields marked **hard-internal** (§4.1) can never be toggled shareable by an AM; (b) fields with a *default* of `Internal Saja` may be toggled to shareable by the AM, and the toggle is audit-logged; (c) the client view is served from the **approved active version only** — never from a Draft. Delivery is a read-only web link (D20), not a file, so a revoked link cannot keep circulating the way a downloaded PDF would.
17. **Plan cycle follows the contract anniversary, not the calendar.** At activation the AM sets `tanggal_mulai_siklus` once (field G-0). Period 1 runs from that date to the day before the same day-of-month next month, and so on for the contract length. Day-of-month > 28 clamps to the last day of shorter months. The start date cannot be edited after the first Plan period closes.
18. **Live Stream is vendor-mode.** MEA does not assign an internal host. Section E-8 and F-4 record the vendor, the booked slots, and the target — and the resulting work item is a **vendor tracker record**, not an internal execution Brief. No live-stream capacity is drawn from internal division load (F-5).
19. **Sanggahan Target is advisory.** It notifies SPV and Head of Sales and is stored on the record for the post-mortem, but the contract floor (D-1) stays untouched and the stretch target must still be `>=` floor. It is evidence, not an escape hatch.

---

## 4. Form structure — the questions the AM answers

Legend: **W** = wajib (required) · **O** = opsional · **A** = auto-filled/read-only · **↻** = repeated per active channel

### 4.1 Visibility map (Rule 16)
The Strategi is a client-facing document by default — it is what the AM presents at kickoff. These are the exceptions.

| Tier | Fields | Toggle allowed? |
|---|---|---|
| **Hard-internal** (never shareable) | A-10 riwayat agensi sebelumnya · D-7 sanggahan target · F-5 divisi & beban tim · F-7 batas toleransi · H-4 kondisi stop/ubah scope · J-2 catatan reviewer · J-3 alasan revisi | No |
| **Default internal, AM may share** | A-3 ruang margin · A-13 SLA klien · C-6 risiko struktural · E-4 floor price · F-1 sumber dana iklan · H-1 risk register | Yes, audit-logged |
| **Default shareable** | everything else — A-1/2/4/5/6/7/8/9/11/12/14, all of B, C-1→C-5, C-7, D-1→D-6, D-8, D-9, E-1→E-3, E-5→E-13, F-2/3/4/6, all of G, H-2, H-3, I-2, I-3 | Yes, audit-logged |

Design note: **D-8 (asumsi target) is deliberately shareable.** The assumptions are mostly things the client must deliver — budget on time, stock, approval speed. Showing them at kickoff is the point: it converts "kenapa target gak kejar" from an argument into a checklist both sides already signed off on.

### SECTION A — Konteks Klien & Bisnis
*Purpose: everything that makes a target realistic or a strategy impossible. Filled once, not per channel.*

| ID | Label (UI) | Question the AM answers | Type | Req |
|---|---|---|---|---|
| A-1 | Brand & Kategori | Nama brand, kategori utama, sub-kategori yang digarap | Text + enum kategori | W |
| A-2 | Model Bisnis | Klien ini produsen, brand owner, distributor, atau reseller? | Enum | W |
| A-3 | Ruang Margin | Berapa % margin kotor rata-rata yang klien punya untuk hero SKU? | Number (%) | W |
| A-4 | Posisi Harga | Posisi harga vs kompetitor: premium / mid / budget / price-fighter | Enum | W |
| A-5 | USP Produk | 3 alasan utama orang beli produk ini, bukan kompetitor | Repeatable text (min 3) | W |
| A-6 | Kapasitas Stok | Ready stock atau produksi per order? Lead time restock berapa hari? | Enum + number (hari) | W |
| A-7 | Plafon Kapasitas | Maksimum unit yang klien bisa kirim per bulan | Number | W |
| A-8 | Titik Kirim | Gudang/origin pengiriman (kota) — dasar hitung ongkir & subsidi platform | Text + enum kota | W |
| A-9 | Ekspektasi Klien | Definisi sukses **menurut klien**, dicatat verbatim dari kickoff | Long text | W |
| A-10 | Riwayat Agensi | Pernah pakai agensi/tim lain? Apa yang gagal & kenapa? | Long text | W |
| A-11 | Pantangan Klien | Larangan eksplisit: harga tak boleh turun, KOL tertentu dilarang, klaim yang tak boleh dipakai, brand guideline | Repeatable text | W |
| A-12 | Decision Maker | Nama + jabatan PIC klien, siapa yang berhak approve, jalur eskalasi | Repeatable struct | W |
| A-13 | SLA Klien | Berapa lama klien biasanya balas approval? Hari/jam kerja klien? | Number (jam) + text | W |
| A-14 | Aset dari Klien | Yang klien sediakan: foto produk, video, sampel, katalog, budget iklan, host live | Multi-checkbox + notes | W |
| A-15 | Akses & Hak | Checklist akses per channel: Seller Center, Ads Manager, Affiliate Center, akun chat, akses gudang/stok — status: sudah / pending / ditolak. **⟳ 2026-08-24 (DECISIONS): tambah status ke-4 `tidak butuh akses`** (akses yang memang tidak diperlukan untuk channel ini, supaya tidak dipaksa dicatat `pending`). | Matrix (channel × akses × status) | W |
| A-16 | Blocker Akses | Akses yang belum ada dan memblokir eksekusi + target tanggal beres. **⟳ 2026-08-24 (DECISIONS): hanya status `ditolak` yang boleh ditandai blocker** — `sudah`/`pending`/`tidak butuh akses` tidak pernah menghentikan AM maju ke langkah berikutnya (supersedes contoh §6 di bawah, yang menandai akses `pending` sebagai blocker). | Repeatable struct | O |

### SECTION B — Baseline per Channel ↻ (angka manual, wajib)
*Purpose: no strategy without numbers. One block per contracted channel. Blank is not allowed; `0` is.*

**B-0 · Identitas Channel**
| ID | Question | Type | Req |
|---|---|---|---|
| B-0.1 | Channel apa? (Shopee / TikTok Shop / Tokopedia / Lazada / Website / lainnya) | Enum | W |
| B-0.2 | Status: Eksisting (ada histori) atau Belum Aktif (akan dibuka) | Enum | W |
| B-0.3 | Nama toko + URL toko | Text + URL | W |
| B-0.4 | Umur toko (bulan) & level/badge (Star Seller, Mall, dll) | Number + enum | W |
| B-0.5 | *Jika Belum Aktif:* target tanggal live + prasyarat pembukaan (dokumen, katalog, akun) | Date + repeatable text | W (kondisional) |
| B-0.6 | Sumber data baseline + tanggal ambil data + lampiran export/screenshot. **⟳ 2026-08-24 (DECISIONS): lampiran autofill dari Link Toko klien (`client_platforms.store_link` → `clients.link_toko`) saat kosong; tetap bisa diganti.** | File + date | W |
| B-0.7 | **Periode baseline** yang dipakai untuk channel ini: berapa bulan ke belakang (1–6, default 3) + tanggal mulai & akhir periode | Number + date range | W |
| B-0.8 | *Jika periode < 3 bulan:* alasannya (toko baru, kategori musiman, toko baru lepas pembekuan, data tak tersedia) | Enum + text | W (kondisional) |

**B-1 · Penjualan** — per bulan sepanjang periode baseline yang dideklarasi di B-0.7 (kolom digenerate dinamis: M-1 … M-n)
| ID | Question | Type | Req |
|---|---|---|---|
| B-1.1 | GMV per bulan | Currency × n | W |
| B-1.2 | Jumlah pesanan per bulan | Number × n | W |
| B-1.3 | AOV per bulan | Auto (GMV/order) | A |
| B-1.4 | Pesanan dibatalkan / dikembalikan (%) | % × n | W |
| B-1.5 | Tren: naik / stabil / turun + besaran % | Auto + note | A |

**B-2 · Trafik & Konversi**
| ID | Question | Type | Req |
|---|---|---|---|
| B-2.1 | Total pengunjung toko/bulan | Number | W |
| B-2.2 | Conversion rate toko (%) | % | W |
| B-2.3 | Komposisi sumber GMV/trafik: organik / iklan (overlay) / affiliate / live / video / kartu produk (%) — **GMV-share platform, boleh tumpang-tindih, TIDAK wajib 100%** (revisi 2026-08-22, lihat DECISIONS) | Struct % | W |
| B-2.4 | Halaman/entry point terbesar (search, feed, live, keranjang, chat) | Enum + note | O |

**B-3 · Portofolio SKU**
| ID | Question | Type | Req |
|---|---|---|---|
| B-3.1 | Total SKU listed / SKU aktif berjualan | Number × 2 | W |
| B-3.2 | Berapa SKU yang menyumbang 80% GMV? (Pareto) | Number | W |
| B-3.3 | Top 5 SKU: nama, GMV, unit terjual, harga jual, margin % | Repeatable struct (5) | W |
| B-3.4 | Jumlah SKU slow-moving / nol penjualan 60 hari | Number | W |
| B-3.5 | SKU dengan stok kritis / sering habis | Repeatable text | O |
| B-3.6 | Kualitas listing (%) — **⟳ revisi 2026-08-24 (DECISIONS): kini TURUNAN read-only = `SKU aktif ÷ SKU terdaftar × 100`, dihitung server, bukan lagi observasi manual "SKU dengan foto & deskripsi layak". Bagi-nol → `—`.** | Auto | A |

**B-4 · Kesehatan Toko & Layanan**
| ID | Question | Type | Req |
|---|---|---|---|
| B-4.1 | Rating toko + jumlah ulasan | Number × 2 | W |
| B-4.2 | Chat response rate & response time | % + minutes | W |
| B-4.3 | % pesanan terlambat kirim | % | W |
| B-4.4 | Poin penalti / status pelanggaran platform | Number + note | W |
| B-4.5 | Masalah ulasan negatif berulang (tema keluhan) | Repeatable text | O |

**B-5 · Iklan (per channel)**
| ID | Question | Type | Req |
|---|---|---|---|
| B-5.1 | Ad spend per bulan sepanjang periode baseline | Currency × n | W |
| B-5.2 | ROAS & ACOS aktual per bulan | Number × n | W |
| B-5.3 | Tipe kampanye yang jalan (GMV Max, manual keyword, auto, live ads, dll) + jumlah aktif | Multi-enum + number | W |
| B-5.4 | Top 5 keyword/audience penyumbang order | Repeatable struct | O |
| B-5.5 | Kampanye boncos yang masih jalan (spend tanpa order) | Repeatable struct | O |

**B-6 · Affiliate / KOL**
| ID | Question | Type | Req |
|---|---|---|---|
| B-6.1 | Jumlah affiliate/kreator aktif 30 hari terakhir | Number | W |
| B-6.2 | GMV dari affiliate (Rp & % dari total) | Currency + % | W | <!-- % = GMV-share tumpang-tindih lintas-export (affGmv ÷ totGMV); boleh >100% karena over-attribution, tidak dipangkas — sejajar B-2.3, DECISIONS 2026-08-23 -->
| B-6.3 | Komisi rate saat ini (open plan & target plan) | % × 2 | W |
| B-6.4 | Top 5 kreator penyumbang GMV | Repeatable struct | O |
| B-6.5 | Program sampel/seeding yang jalan? Biaya ditanggung siapa? | Enum + note | W |

**B-7 · Konten & Live**
| ID | Question | Type | Req |
|---|---|---|---|
| B-7.1 | Jumlah video/bulan + total views + GMV dari video | Number × 3 | W |
| B-7.2 | Jam live/bulan + GMV live + GMV per jam live | Number × 3 | W |
| B-7.3 | Host live: internal klien / vendor / tim MEA / belum ada | Enum | W |
| B-7.4 | Studio & perangkat live tersedia? | Enum + note | W |

**B-8 · Promo & Program Platform**
| ID | Question | Type | Req |
|---|---|---|---|
| B-8.1 | Voucher & promo yang aktif (tipe, nilai, syarat) | Repeatable struct | W |
| B-8.2 | Program platform yang diikuti (gratis ongkir xtra, cashback, campaign seasonal) | Multi-checkbox | W |
| B-8.3 | Beban promo terhadap margin (%) | % | W |

**B-9 · Kompetitor di Channel Ini**
| ID | Question | Type | Req |
|---|---|---|---|
| B-9.1 | Top 3 toko kompetitor: nama, URL, harga produk sebanding, estimasi penjualan/bulan | Repeatable struct (3) | W |
| B-9.2 | Apa yang kompetitor lakukan lebih baik? (harga / konten / ulasan / iklan / live / bundling) | Multi-enum + note | W |
| B-9.3 | Celah yang belum diisi kompetitor | Long text | W |

### SECTION C — Diagnosa & Akar Masalah
*Purpose: force the AM to name the bottleneck and explain why, in their own words (Rule 6). **⟳ 2026-08-24 (DECISIONS):** previously required a baseline field-ID citation; dropped — see C-2, Rule 6.*

| ID | Question | Type | Req |
|---|---|---|---|
| C-1 | Bottleneck utama per channel: trafik / konversi / AOV / repeat order / margin / operasional / konten / harga / listing | Enum ↻ per channel | W |
| C-2 | **⟳ 2026-08-24 (DECISIONS):** Alasan/bukti bottleneck ini dipilih — uraian bebas, bukan rujukan field-ID (field-ID baseline sulit dicari AM tanpa daftar kode di tangan, menyulitkan pengisian tanpa memberi nilai sebanding). Superseded original: "Bukti angka: field baseline mana yang mendasari diagnosa ini?" — type was "Field-ID reference (min 1)". | Long text | W |
| C-3 | Akar masalah (bukan gejala) — kenapa bottleneck itu terjadi | Long text ↻ | W |
| C-4 | Gap vs kompetitor yang paling menentukan | Long text | W |
| C-5 | **⟳ 2026-08-26 (DECISIONS):** Quick win 14 hari pertama (perbaikan yang tak butuh budget baru). Superseded original: min 3 baris. | Repeatable struct: aksi, channel, PIC divisi, dampak diharapkan | W (min 1) |
| C-6 | Risiko struktural yang tak bisa dihilangkan (margin tipis, kapasitas stok, kategori jenuh, klien lambat approve) | Repeatable text | W |
| C-7 | Apa yang harus dibereskan klien sebelum eksekusi jalan (prasyarat) | Repeatable struct: item, PIC klien, deadline | W |

### SECTION D — Target & KPI
*Purpose: contract floor is read-only; AM commits to a stretch and states what makes it true.*

| ID | Question | Type | Req |
|---|---|---|---|
| D-1 | Target minimum kontrak (Rp, per bulan & total periode) | Auto from Contract | A |
| D-2 | Stretch target GMV per bulan per channel (tabel M1…Mn) | Currency matrix (bulan × channel) | W |
| D-3 | Target komposisi kontribusi channel (% dari total GMV) | % struct, total 100 | W |
| D-4 | Target metrik pendukung per channel: pengunjung, CR, AOV, ROAS min / ACOS maks, jumlah SKU winner baru, jumlah affiliate aktif, jam live, jumlah video | Struct matrix ↻ | W |
| D-5 | Definisi berhasil di 30 / 60 / 90 hari | Struct × 3 | W |
| D-6 | Leading indicator yang dipantau mingguan (maks 5) | Multi-enum (≤5) | W |
| D-7 | Sanggahan Target (**advisory, internal saja**) — jika target kontrak dinilai tak realistis: alasan, angka pembanding, target yang menurut AM realistis. **Tidak mengubah floor kontrak** | Long text + number | O (notif SPV + Head of Sales) |
| D-8 | **Asumsi di balik target** — hal yang harus benar agar target tercapai (mis. budget iklan cair tiap tgl 1, stok hero SKU aman 2.000 pcs/bln, klien approve konten ≤48 jam) | Repeatable struct: asumsi, pemilik, cara verifikasi | O — dianjurkan diisi begitu diketahui, tidak menggerbang submit (⟳ 2026-08-26 DECISIONS, semula "W (min 3)") |
| D-9 | Konsekuensi jika asumsi gugur — target mana yang otomatis ditinjau | Mapping asumsi → target | W |

### SECTION E — Strategi Inti (arah eksekusi)
*Purpose: the thesis and the per-pillar direction that Briefs will inherit.*

| ID | Question | Type | Req |
|---|---|---|---|
| E-1 | **Growth thesis** — 1 paragraf: "Toko ini tumbuh dengan cara X, karena Y, dan yang paling menentukan adalah Z" | Long text | W |
| E-2 | Prioritas channel: mana engine utama, mana pendukung, mana maintenance + alasan | Ranking + note | W |
| E-3 | **Produk & SKU** — hero SKU yang didorong, SKU pendamping, bundling, SKU baru yang diusulkan, SKU yang dimatikan, strategi varian | Struct per SKU: peran, aksi, target | W |
| E-4 | **Harga & Promo** — struktur harga, tangga diskon, **floor price per hero SKU** (guardrail margin), voucher, keikutsertaan program platform | Struct: SKU, harga normal, harga promo, floor price | W |
| E-5 | **Iklan** — tipe kampanye per fase, alokasi budget per channel & tipe, target ACOS per fase (learning / scale / efisiensi), aturan matikan kampanye | Struct per channel | W |
| E-6 | **Konten & Kreatif** — pilar konten, format, volume/bulan, angle utama, siapa talent | Struct per channel | W |
| E-7 | **Affiliate / KOL** — tier kreator sasaran, jumlah target, komisi rate, rencana sampel/seeding, kanal rekrutmen | Struct | W |
| E-8 | **Live Streaming (vendor)** — vendor yang dipakai, frekuensi & slot jam yang dibooking, angle/brief untuk vendor, target GMV per jam, siapa yang sediakan produk & studio, cara verifikasi hasil | Struct | W |
| E-9 | **Retensi & CRM** — follow-up chat, WhatsApp broadcast (Sebari), program pembeli ulang, bundling repeat | Struct | O |
| E-10 | **Operasional & Layanan** — SLA balas chat, standar packing, penanganan ulasan negatif, siapa pegang chat | Struct | W |
| E-11 | **Yang TIDAK dikerjakan** (out of scope eksplisit) | Repeatable text (min 1) | W |
| E-12 | Ketergantungan pada klien: apa yang klien harus sediakan, kapan, konsekuensi jika terlambat | Repeatable struct | W |
| E-13 | Urutan eksekusi: kenapa pilar A didahulukan dari pilar B | Long text | W |

### SECTION F — Komitmen Resource (soft reference — Rule 10)
| ID | Question | Type | Req |
|---|---|---|---|
| F-1 | Budget iklan per bulan per channel (Rp) + sumber dana (klien / paket MEA) | Currency matrix + enum | W |
| F-2 | Kuota konten per bulan: video, foto, desain grafis | Number × 3 | W |
| F-3 | Kuota KOL: jumlah kreator, jumlah video/kreator, nilai sampel | Number × 3 | W |
| F-4 | Jam live per bulan yang dibooking ke vendor + nama vendor + tarif/skema biaya. **Tidak menarik kapasitas divisi internal (F-5)** | Number + text + enum | W |
| F-5 | Divisi & role yang dialokasikan + estimasi beban (jam/bulan atau slot) | Struct per divisi | W |
| F-6 | Tools yang dipakai (report engine, SKU screener, Sebari, Linkreator, dll) | Multi-checkbox | O |
| F-7 | Batas toleransi over-komitmen sebelum eskalasi ke SPV (%) | % | O (default 20%) |

### SECTION G — Kalender & Fase
| ID | Question | Type | Req |
|---|---|---|---|
| G-0 | **Tanggal mulai siklus Plan** — dasar periode anniversary-month (mis. mulai 12 Agu → periode 1 = 12 Agu–11 Sep). Diset sekali, tak bisa diubah setelah periode 1 tutup | Date | W |
| G-1 | Fase kerja: nama fase, rentang tanggal, tujuan fase, kriteria lulus fase | Repeatable struct (min 2) | W |
| G-2 | Tanggal besar dalam periode kontrak (double date, payday, Ramadan/Lebaran, Harbolnas, campaign platform) + peran tiap tanggal | Repeatable struct | W |
| G-3 | Jadwal review dengan klien (frekuensi, format laporan, PIC) | Struct | W |
| G-4 | Jadwal review internal SPV (frekuensi) | Struct | W |

### SECTION H — Risiko & Trigger Revisi
| ID | Question | Type | Req |
|---|---|---|---|
| H-1 | Risk register: risiko, dampak (rendah/sedang/tinggi), kemungkinan, mitigasi, PIC | Repeatable struct (min 1, **⟳ 2026-08-26 (DECISIONS)**: semula min 3) | W (min 1) |
| H-2 | Trigger revisi yang dipilih untuk klien ini (enum, multi): pencapaian <X% target 2 bulan berturut / klien ubah lini produk / stok kosong >X hari / budget iklan dipotong / perubahan kebijakan platform / ganti PIC klien / lainnya | Multi-enum + threshold | W |
| H-3 | Skenario mundur (fallback) jika strategi utama gagal di fase 1 | Long text | W |
| H-4 | Kondisi yang membuat MEA menyarankan stop/ubah scope | Long text | O |

### SECTION I — Turunan ke Plan & Brief (handoff)
| ID | Question | Type | Req |
|---|---|---|---|
| I-1 | Ringkasan turunan otomatis: channel × pilar × kuota → kerangka Plan bulanan | Auto-generated from E & F | A |
| I-2 | Divisi penerima Brief + urutan dispatch | Multi-enum + order | W |
| I-3 | Metrik yang akan ditarik ke laporan klien bulanan | Multi-enum | W |
| I-4 | Catatan khusus untuk tiap divisi eksekusi (hal yang mudah salah dipahami) | Struct per divisi | O |

### SECTION J — Approval & Versi
| ID | Question | Type | Req |
|---|---|---|---|
| J-1 | Versi, status, tanggal submit, AM pengisi | Auto | A |
| J-2 | Reviewer (SPV / Head of Account) + keputusan `Disetujui` / `Dikembalikan` + catatan | Struct | W (reviewer) |
| J-3 | *Jika revisi:* trigger yang terpicu (dari H-2), alasan revisi, asumsi D-8 mana yang gugur | Struct | W (kondisional — trigger & alasan selalu; asumsi gugur hanya jika D-8 punya isi, Rule 13(c), ⟳ 2026-08-26 DECISIONS) |
| J-4 | Ringkasan perubahan vs versi sebelumnya | Auto diff | A |

---

## 5. Flow

1. Finance verifies first payment → client released to Account (Module 6 §5).
2. SPV assigns AM. System detects Service with `butuh_plan = true` → creates Strategi record `Draft`, pre-seeded with contract data (channel scope, contract target floor, period).
3. AM completes **Section A**, then requests/records access (A-15). Access blockers are visible on the SPV dashboard from this point — they are the most common cause of a stalled Strategi.
4. AM completes **Section B** per channel with attached exports. *Error path:* channel marked `Eksisting` but no export attached → submit blocked with the specific field IDs listed.
5. AM completes **C → D → E → F → G → H**. Validation runs continuously; the submit button shows a live count of unmet required fields.
6. AM submits → status `Diajukan`. Notification to SPV / Head of Account.
7. SPV reviews. `Dikembalikan` → back to `Draft` with notes, same version. `Disetujui` → status `Aktif`, and **Module 6 unlocks Brief dispatch** for that Service.
8. On approval the system generates the **Plan** skeleton (Section I-1): one Plan period per month of the contract, pre-filled with channel × pillar × quota rows from E and F. Weekly rows are generated inside each monthly Plan.
9. Briefs are created from Plan rows. Each Brief inherits: hero SKU list (E-3), floor price (E-4), campaign type & ACOS target (E-5), content pillar (E-6), quota (F). Exceeding F → `Lewat Komitmen` warning + reason. Below floor price → `Di Bawah Floor` flag + SPV acknowledgement.
10. Weekly/monthly actuals flow back from execution modules. If a declared H-2 trigger fires, the system raises `Revisi Disarankan` on the Strategi and notifies AM + SPV. The AM must either revise or record why not (recorded either way).
11. Revision → version `n+1` in `Draft Revisi` → same approval path. Version `n` stays `Aktif` until `n+1` is approved, then becomes `Diarsipkan`.
12. Contract end → `Kedaluwarsa`. Renewal offers "copy from last approved version" with baseline fields cleared.

---

## 6. Example — Alpha Digital (Full Store Management, 6-month contract)

**Contract:** Full Store Management, Shopee + TikTok Shop + Tokopedia, 6 months, contract GMV floor Rp 400jt/month by M6.

**Section A (excerpt).** Brand owner, home living category, average gross margin 38%, mid-price positioning. Ready stock, restock lead time 21 days, ceiling 8.000 unit/month, shipping from Bandung. Client's own definition of success (verbatim): *"pokoknya omzet naik 2x dan gak rugi di iklan."* Previous agency ran ads only, failed because listings were never fixed. Explicit prohibition: no price below Rp 79.000 for the hero rack SKU. Decision maker: owner, approves personally, typical reply time 36 hours. Access: Shopee Seller Center + Ads granted; TikTok Affiliate Center ditolak (blocker, target cleared in 5 days); Tokopedia not yet opened. **⟳ 2026-08-24 (DECISIONS): was "pending (blocker …)" — under the A-16 rule above only `ditolak` may carry the blocker flag, so this example now reads as a rejected request, not a pending one.**

**Section B (excerpt, Shopee).** GMV M-1 Rp 180jt / M-2 Rp 165jt / M-3 Rp 172jt → flat. Orders 2.050 → AOV Rp 87.800. Visitors 96.000, CR 2,1%. Traffic mix: organik 41%, iklan 44%, affiliate 9%, live 0%, luar 6%. 214 SKU listed, 178 active, **7 SKU carry 80% of GMV**. Slow-moving 96 SKU. Rating 4,8 / 3.104 reviews; late shipment 4,2%; chat response 88% / 34 min. Ad spend Rp 41jt/month, ROAS 4,1, ACOS 24%. Affiliate: 22 active creators, Rp 15jt GMV, commission 6%. Live: 0 hours. Competitors: three stores at Rp 69.000–75.000 with 3× the video volume. Source: Shopee export, captured 2 Aug 2026.

**Section C.** Bottleneck Shopee = **konversi** (evidence: B-2.2 CR 2,1% against category norm, B-3.6 only 54% of SKUs have adequate photos). Bottleneck TikTok Shop = **trafik** (no video volume, no live). Root cause: listing quality and zero content engine, not ad budget — the previous agency's failure pattern. Quick wins (14 days): rewrite listings for 7 Pareto SKUs, kill 3 zero-order campaigns burning Rp 6jt/month, raise commission to 12% on the hero SKU to pull creators. Structural risk: 21-day restock lead time caps aggressive scaling; owner's 36-hour approval time slows creative.

**Section D.** Floor (read-only): Rp 400jt/month by M6. Stretch: Rp 460jt by M6 — Shopee Rp 250jt, TikTok Shop Rp 180jt, Tokopedia Rp 30jt. Assumptions: ads budget disbursed by the 1st of each month; hero SKU stock ≥ 3.000 pcs/month; owner approves creative within 48 hours; TikTok Affiliate Center access granted within 5 days. Mapping: if the stock assumption breaks, the Shopee ads-scale target is reviewed first.

**Section E.** Thesis: *this store grows by converting existing traffic first, then adding content-driven traffic on TikTok — because ad spend is already respectable while CR and listing quality lag, so pouring more budget in repeats the previous agency's mistake.* Channel priority: Shopee = engine (fix conversion), TikTok Shop = growth engine from M2, Tokopedia = maintenance from M4. Hero SKU: rack A (floor price Rp 79.000). Ads: M1 efficiency phase, target ACOS ≤18%; M2–M4 scale with ACOS ≤25%. Content: 40 videos/month from M2. Affiliate: 12% commission, 60 target creators, 100 seeding samples. Live: 3×/week from M3, host from MEA. **Not doing:** no photo reshoot in M1 (client provides existing assets), no Lazada, no marketplace price war below floor.

**Section F.** Ads Rp 45jt Shopee + Rp 25jt TikTok/month (client-funded), 40 videos + 60 photos/month, 60 creators, 36 live hours/month from M3.

**Downstream.** On approval the system generates 6 monthly Plans. Plan M1 pre-fills: "Listing rewrite — 7 SKU — Creative", "Kill 3 campaigns + restructure — Ads", "Commission raise + creator recruitment 60 — KOL". Creative's Brief inherits the floor price and the "existing assets only in M1" constraint automatically — the AM does not re-type it.

---

## 7. System Requirements

**Entity.** `STRG-YYYY-NNNNN` (Strategi), `PLAN-YYYY-NNNNN` (Plan period). Child tables: `STRG_CHANNEL` (Section B blocks), `STRG_TARGET`, `STRG_ASSUMPTION`, `STRG_PILLAR`, `STRG_RESOURCE`, `STRG_RISK`, `STRG_VERSION`.

**Prefix collision-proofing (D10).** Four-letter `STRG` is chosen over three-letter `STR` precisely because three-letter space is where collisions live (`SVC`, `CPL`, `BRF`, `CLT`…). Two mechanisms enforce it rather than trusting the choice:
1. A registry table `entity_prefix` (`prefix` PK, `entity_name`, `module`, `added_at`) — every entity in CDPS registers its prefix, PK makes a duplicate impossible.
2. A CI test that scans the codebase for ID-generating call sites and fails the build if any prefix is absent from `entity_prefix` or if two entities resolve to the same prefix.

Dev action before coding: backfill `entity_prefix` from the existing 29 migrations, **then** insert `STRG` and `PLAN`. If either is already taken, fall back to `STGY` / `PPRD` — the registry decides, not this document.

**Relations.** `STRG` 1:1 active per `CONTRACT`; 1:N `STRG_CHANNEL`; `STRG` 1:N `PLAN` (anniversary-month periods) → 1:N `PLAN_WEEK` → 1:N `BRIEF`. Every Brief carries `strategi_id` + `strategi_version` so a Brief can always be traced to the version of the strategy that authorised it.

**Plan period generation (D13, Rule 17).** On approval, generate `n` PLAN rows where `n` = contract months. Period `i` = [`tanggal_mulai_siklus` + (i-1) months, `tanggal_mulai_siklus` + i months − 1 day]. Day-of-month clamping: store the *intended* day-of-month separately from the computed date so a 31st start does not drift to the 28th permanently after passing February. Weekly rows inside each period are 7-day blocks from the period start; the final block absorbs the remainder (may be 8–10 days) rather than creating a stub week.

**State machine.** `Draft` → `Diajukan` → (`Disetujui` → `Aktif` | `Dikembalikan` → `Draft`); `Aktif` → `Draft Revisi` → `Diajukan` → …; `Aktif` → `Kedaluwarsa`; superseded version → `Diarsipkan`. Transitions only via `sm_transition` (CDPS frozen invariant). This is machine #15 in the state-machine registry.

**Notification catalog → v2 (D12).** *Superseded by Module 6C §10: the amendment is a single migration covering all three modules — 15 base + 4 Strategi + 6 Plan + 3 Gate = 28 events. Do not ship separate catalog migrations.*

**The 4 Strategi events (D12).** The catalog is a frozen invariant, so it is amended explicitly and versioned, not appended silently. Rationale for not reusing generic `approval_*`: the four Strategi events have different recipients and different urgency (`strategi_revisi_disarankan` is system-triggered and goes to AM + SPV; a generic approval event has no concept of a broken assumption), and collapsing them would make the "% revisions with a declared trigger" metric unmeasurable.

| Event | Fires when | Recipients |
|---|---|---|
| `strategi_diajukan` | AM submits (v1 or revision) | SPV / Head of Account |
| `strategi_disetujui` | Reviewer approves | AM, execution division leads, Finance (budget in F-1) |
| `strategi_dikembalikan` | Reviewer returns with notes | AM |
| `strategi_revisi_disarankan` | An H-2 trigger fires or a D-8 assumption flips to `Gugur` | AM + SPV |

Migration: new `notification_catalog_version` row = 2, four Strategi events + six Plan events inserted in the same migration, old 15 untouched. The invariant test asserting "catalog length == 15" is updated to assert against the registered version, not a literal.

**Field-level notes.**
- All currency: integer minor units, IDR, BI-formatted strings byte-exact per the frozen invariant.
- All timestamps WIB, `WIB_OFFSET_HOURS=7` single source.
- Baseline numeric fields: `NOT NULL` with explicit `0` allowed; a separate `tidak_tersedia` boolean per group is **not** provided by design (Rule 5) — if data genuinely cannot be pulled, the channel is marked `Belum Aktif`.
- `STR_TARGET`: composite key (strategi_id, channel, month_index, metric). Stretch `>=` floor enforced at DB check level for the GMV metric.
- `STR_ASSUMPTION.status` ∈ `Berlaku` / `Gugur` / `Terverifikasi`; flipping to `Gugur` fires `strategi_revisi_disarankan`.
- Floor price stored per SKU in `STR_PILLAR` (type `harga`); Brief validation reads it.
- Attachments: export/screenshot per channel baseline group, max 10MB/file, stored with capture date; retained for the contract period + 24 months.
- Percentage composition fields: **D-3** (kontribusi channel, DERIVED) sums to 100 by construction. **B-2.3** traffic/GMV-share is **NOT** required to sum to 100 (revisi 2026-08-22): the platform reports overlapping GMV-share (an affiliate video counts in both Affiliate and Video; Ads is an overlay that can exceed 100%), so the DB check that enforced Σ=100 was dropped — each bucket is only validated `>= 0`. Recorded as-is so the overlap is visible in the report. See DECISIONS 2026-08-22.
- **⟳ 2026-08-24 (DECISIONS):** C-2 stored as free text (`alasan`, `NOT NULL`, non-empty). Superseded original: "Field-ID references (C-2): stored as an array of baseline field IDs, validated to exist within the same Strategi."
- `STRG_CHANNEL.periode_baseline_bulan` (int 1–6) + `periode_mulai` / `periode_akhir` dates. The monthly baseline columns (B-1, B-5) are stored as rows in a child table keyed by `(channel_id, month_index)` — **not** as fixed `m1/m2/m3` columns, since the window is variable (D11). A shorter window than 3 requires `alasan_periode_pendek` to be non-null (DB check).
- `visibilitas` per field: stored as a `STRG_FIELD_VISIBILITY` overlay table (`strategi_id`, `field_id`, `visibilitas`, `diubah_oleh`, `diubah_pada`) seeded from the §4.1 defaults. Hard-internal field IDs live in a constant list in `packages/core` and are rejected at both the TS predicate and the DB check — the two must not diverge (frozen invariant).
- **Client view — read-only web link (D20).** Not a file. Server-rendered page at `/s/{token}`, shareable fields only.
  - `token`: 32-byte random, unguessable, stored hashed. One active token per Strategi; regenerating invalidates the old one immediately.
  - **No client login** — the token *is* the credential. Consequence to accept knowingly: whoever holds the link can view it, so the token is treated as a secret (never in a subject line, never in URL query params — it is a path segment, per privacy rules).
  - **Version-pinned by default:** the link always renders the current *approved active* version, so a client who bookmarks it sees the strategy as it stands, not a stale copy. Version number + approval date shown in the header, so a client in a meeting can state which version they are looking at.
  - **Revocable & expirable:** AM or SPV can revoke instantly; optional expiry date (default: contract end + 30 days). Revoked or expired → neutral "tautan tidak aktif" page, no data, no hint about what was there.
  - `Draft` / `Draft Revisi` versions are never reachable through the token, even mid-revision.
  - Access log: every view writes `(strategi_id, version, token_id, ip, user_agent, viewed_at)`. This answers "did the client actually open it, and which version" during a dispute — the reason a link beats a PDF here.
  - Rendering is server-side with the visibility filter applied **before** serialisation. No internal field may be present in the HTML payload, hidden or otherwise.
  - Print-to-PDF from the browser is fine and expected; MEA does not generate the PDF, so there is no MEA-branded artefact circulating with stale numbers.

**New prerequisite entity — `VND-` Vendor (D19).** CDPS has no vendor entity today; E-8 cannot store `vendor_id` until it exists. Minimum viable shape, to be confirmed against how MSDPS tracks its live-stream vendor:

| Field | Type | Notes |
|---|---|---|
| `id` | `VND-YYYY-NNNNN` | register prefix `VND` in `entity_prefix` |
| `nama_vendor` | text | required |
| `jenis_layanan` | enum | `live_stream`, `produksi_video`, `talent`, `lainnya` — extensible |
| `status` | enum | `Aktif` / `Nonaktif` / `Blacklist` |
| `pic_nama`, `pic_kontak` | text | required |
| `skema_biaya` | enum + struct | `per_jam` / `per_sesi` / `bagi_hasil` / `retainer` + rate |
| `catatan_kinerja` | long text | internal only |
| `dokumen` | file[] | contract / agreement with the vendor |

Relation: `STRG_PILLAR` (type `live`) → `VND` (FK, nullable until vendor selected). A vendor tracker record references both. **Sequencing note:** this entity is a blocker — E-8 and F-4 cannot be implemented before it lands, so it belongs in the same migration batch as `STRG`, not after.
- Live Stream (D15): `STRG_PILLAR` type `live` carries `vendor_id`, `slot_jam`, `tarif`, `target_gmv_per_jam`. Downstream it creates a **vendor tracker record**, not a `BRIEF`. Excluded from internal division load calculations (F-5).

**Permissions (TS predicate + RLS must not diverge — frozen invariant).**
| Role | Read | Write | Approve |
|---|---|---|---|
| AM (assigned) | own clients | Sections A–I on `Draft`/`Draft Revisi` | no |
| AM (other) | no | no | no |
| SPV / Head of Account | all | Section J + override | yes |
| Execution divisions (Creative/Ads/KOL/Live) | read-only: E, F, G, I-4 for their own pillar | no | no |
| Finance | read-only: F-1 (budget) | no | no |
| Direksi | all | no | no |

**Non-functional.** Autosave every 20s on Draft (the form is long — losing an hour of entry is the primary abandonment risk). Full form load < 2s with 5 channel blocks. Print/PDF export of the approved version for client meetings (internal approval only, but AMs will present it). Mobile: read-only view acceptable; entry is desktop-first.

---

## 8. Assumptions — resolved & residual

### 8.1 Resolved (this session)
| ID | Question | Decision |
|---|---|---|
| OA-1 | Entity prefix collision | `STRG-` / `PLAN-`, enforced by `entity_prefix` registry table + CI check; fallback `STGY-` / `PPRD-` if taken (§7) |
| OA-2 | Baseline period length | AM declares it per contract per channel, 1–6 months, default 3, reason required below 3 (B-0.7, Rule 5a) |
| OA-3 | Notification catalog | Formal amendment to v2 = 19 events with versioned migration (§7) |
| OA-4 | Plan period boundaries | Anniversary-month cycle from an AM-set start date (G-0, Rule 17) |
| OA-5 | Sanggahan Target effect | Advisory only, internal-only field; contract floor untouched (Rule 19) |
| OA-6 | Live Stream mode | Vendor tracker, same as MSDPS; excluded from internal capacity (Rule 18) |
| OA-7 | Over-commitment tolerance | 20% default (F-7) |
| OA-8 | Client visibility | Strategi is shared with the client; two visibility tiers with a hard-internal list (§4.1, Rule 16) |
| OA-9 | Baseline auto-population | **⟳ RAB-19 (DECISIONS 2026-08-18):** now **in scope** via the usulan→konfirmasi model — the Riset Awal engine proposes figures from AM-pulled exports, the AM confirms each per Rule 5. Superseded original: "auto-population explicitly out of scope for this version". |

### 8.2 Residual — resolved (round 2)
| ID | Question | Decision |
|---|---|---|
| RA-2 | Vendor entity exists? | No — `VND-` entity to be created, in the same migration batch as `STRG` (§7). Blocker for E-8/F-4 |
| RA-3 | Client delivery format | Read-only web link, token-based, version-pinned, revocable, access-logged (§7) |
| RA-6 | Record client acknowledgement of D-8? | No. Stays a one-way presentation — D6 (internal-only approval) remains intact |

### 8.3 Still open
| ID | Item | Owner | Why it matters |
|---|---|---|---|
| RA-1 | The catalog invariant test asserts a literal `== 15`. Changing it to assert against a registered version modifies a **frozen invariant** — needs explicit sign-off, not just a PR | Hans | Blocks the notification migration (D12) |

### 8.4 Assumptions taken by default (flagged, not blocking)
These are set so the build can proceed. Each is cheap to reverse before coding, expensive after.

| ID | Default taken | Reverse by |
|---|---|---|
| RA-4 | Uneven baseline windows across channels inside one Strategi (e.g. Shopee 6 months vs TikTok 1 month) raise a **warning, not a block**, when the gap exceeds 2 months — because cross-channel contribution targets (D-3) then rest on uneven ground and the reviewer should see it | Yohan, before D-3 validation is coded |
| RA-5 | `tanggal_mulai_siklus` (G-0) **defaults to the contract start date**; the AM overrides it only when the client wants reporting aligned to something else | Yulianti, before Plan generation is coded |
| RA-7 | The client link shows the **current active version only** — no version history, no diff, even though revisions happen. If a client asks "what changed", the AM explains it in the meeting rather than the system exposing it | Yohan, before the client view is built |

## 9. Success Metrics

**Activation event.** First Strategi approved and its Plan skeleton generated — not "Strategi created".

**North star.** % of active full-management contracts with an `Aktif`, non-expired Strategi whose assumptions have been verified in the last 30 days. Target ≥ 90%. A Strategi with zero D-8 rows (allowed since ⟳ 2026-08-26 DECISIONS — D-8 is no longer a submit gate) counts against this metric the same as one whose assumptions are stale: the metric is meant to push the AM toward keeping D-8 current, not to be satisfied by never filling it in.

**Leading indicators.**
| Metric | Why | Target |
|---|---|---|
| Median time from client release → Strategi `Disetujui` | The gate blocks execution; a slow gate means idle divisions | ≤ 5 working days |
| Return rate (`Dikembalikan` / submitted) | High = AMs guessing; measured per AM to target coaching | < 30% after month 2 |
| % Briefs traceable to a Strategi version | Detects execution bypassing the gate | 100% |
| % Briefs flagged `Lewat Komitmen` | Soft limits should be roughly right, not routinely blown | < 15% |
| % revisions with a declared trigger + broken assumption | Tests whether D-8 is real or filled to pass validation. Since ⟳ 2026-08-26 (DECISIONS), a revision opened on a Strategi with zero D-8 rows ever recorded has nothing to cite (Rule 13(c) waiver) — exclude those from this metric's denominator rather than counting them as a miss | 100% (of revisions where D-8 has ≥1 row) |
| % contracts hitting stretch vs floor | Reveals systematic sandbagging or fantasy targets | tracked, not targeted |

**Anti-vanity guard.** Do not measure "number of Strategi created" or "form completion %". A fully-filled Strategi that never predicts anything is a worse outcome than a returned one — the return rate metric exists specifically to catch that.
