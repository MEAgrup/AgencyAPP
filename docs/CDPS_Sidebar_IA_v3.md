# CDPS Sidebar Information Architecture v3

Date: 3 Sep 2026 · Owner: Yohan · Supersedes v2 · Scope: navigation grouping & display labels only

> ## ✅ Status implementasi — 2026-09-04
>
> Dokumen ini **sudah diimplementasikan** di `web-internal/src/lib/nav.ts` +
> `Sidebar.tsx` (`docs/DECISIONS.md` 2026-09-04). Terpasang: 9 grup §2, pembubaran
> grup "Portal", semua rename label, accordion §5.1, kotak cari ⌘K §5.3, sub-grup
> `Papan Divisi` kedalaman-2 dengan localStorage §5.2, auto-scope §5.6, rail 270px
> sticky §5.7, dan a11y §5.8.
>
> **Empat penyimpangan, semuanya disengaja:**
> 1. **§5.4 badge angka DITUNDA** — tiap badge butuh endpoint hitungan tersendiri di
>    `apps/api` berikut tes izin per peran (pekerjaan backend, bukan navigasi).
> 2. **§4 dijawab pemilik: ketiga pasang halaman DIPERTAHANKAN** (33 item, bukan 30).
>    Pembacaan kode: ketiganya beda kemampuan, bukan cuma beda scope — `Tugas Saya`
>    punya filter divisi + "Lihat Tugas Staff Lain"; `Team Performance` universal +
>    halaman Konfigurasi bobot; `Client Health` punya aksi Pemindaian Skor.
> 3. **Grup `ALAT BANTU AM` bernama `MEA AI Tools`** (permintaan pemilik), dan label
>    kedua alatnya TIDAK diubah — `AM - baseline riset` & `AM Co-Pilot` tetap, bukan
>    `Baseline Riset Toko`/`Co-Pilot AM` seperti usulan §2, karena pemilik hanya
>    meminta nama grupnya yang berganti.
> 4. **Delivery memuat 2 item tambahan**, `Screening SKU` dan `Ads Scanner` — keduanya
>    mendarat sesudah dokumen ini ditulis (3 Sep), jadi §2 tak memuatnya; menghapusnya
>    berarti dua halaman tanpa pintu.

Revision driven by three corrections:
1. Account & Service and AI Optimizer are **delivery divisions that manage clients**, not client data / tools.
2. The group name "Portal Klien" is wrong for what those pages actually are.
3. Several "Portal" pages are performance-check screens — labels may be renamed for clarity.

---

## 1. What the Portal pages actually are

Read from the live screens:

| Menu | Real content (from the page itself) | Therefore |
|---|---|---|
| Portal Saya | M15-C1 Rule 9 — personal landing: my open tasks sorted by SLA risk + my current-month performance score. Scope: self. | Personal inbox → **Beranda › Kinerja Saya** |
| Portal Tim | M15-C1 Rule 10 — SPV/Lead landing: division score rollup, division client list, block-request queue. | Team management → **Tim › Kinerja Divisi** |
| Manajemen | M15-C1 Rule 11 — all clients × latest Client Health: band, trend, drag component, AM. Read-only, default sort At Risk first. | Client-wide monitoring → **Klien › Pantauan Risiko Klien** |
| Kontak Klien (Portal) | M15-C2 — manage client contact logins for the Client Portal. | The only true client-portal page → **Admin › Akses Portal Klien** |

Conclusion: the group "Portal" does not exist as a job. It is dissolved; three of its four items are performance/monitoring screens that belong to Beranda, Tim, and Klien.

## 2. Target structure (9 groups, 33 items)

```
BERANDA
  Dashboard
  Kinerja Saya                (was Portal Saya)
  Tugas Saya                  ← merge candidate, see §4
  Persetujuan                 (badge)

AKUISISI
  Leads                       (badge)
  Sales Workspace
  Campaign Marketing
  Kinerja Sales
  Performa Marketing

KATALOG & PENAWARAN
  Master Service List
  Kalkulator Penawaran

KLIEN
  Direktori Klien
  Pantauan Risiko Klien       (was Manajemen)
  Client Health               ← merge candidate, see §4

DELIVERY
  Task Execution              (badge)
  Rekap Mingguan
  Papan Divisi ▾
      Account & Service
      AI Optimizer
      Ads
      Creative
      KOL
      Live Stream
      Store Operation

ALAT BANTU AM
  Co-Pilot AM
  Baseline Riset Toko

KEUANGAN
  Finance
  Reminder Pembayaran         (badge)

TIM
  Penugasan Internal
  Kinerja Divisi              (was Portal Tim)
  Team Performance            ← merge candidate, see §4

ADMIN
  Karyawan
  Role Mapping
  Hari Libur
  Akun Vendor
  Akses Portal Klien          (was Kontak Klien (Portal))
```

Avatar menu (top right): `Notifikasi` · `Ganti Password` · `Keluar`

## 3. Changes vs v2

| v2 | v3 | Reason |
|---|---|---|
| Account & Service → Klien | Delivery › Papan Divisi | It is a delivery division managing clients, not a client record page |
| AI Optimizer → Alat AI | Delivery › Papan Divisi | Same — a division board, not an assist tool |
| Sub-group "Eksekusi Kanal" | Sub-group "Papan Divisi" | Contents are divisions; Account & Service and AI Optimizer are not channels |
| Group "Alat AI" (3 items) | Group "Alat Bantu AM" (2 items) | Only the two AM assist tools remain |
| Group "Portal Klien" | dissolved | Its pages are performance/monitoring screens, not a client portal |
| Portal Saya | Beranda › Kinerja Saya | |
| Portal Tim | Tim › Kinerja Divisi | |
| Manajemen | Klien › Pantauan Risiko Klien | |
| Kontak Klien | Admin › Akses Portal Klien | |

Groups: 10 → 9.

## 4. Overlaps to resolve before implementation

Renaming exposed three pairs that likely render the same data. Navigation cannot fix duplication — decide the product question first.

1. **Kinerja Saya vs Tugas Saya** — Portal Saya already lists the user's open tasks (SLA-sorted). If the standalone Tugas Saya menu shows the same query, drop it and keep the card inside Kinerja Saya. Beranda then holds 3 items.
2. **Kinerja Divisi vs Team Performance** — both show per-staff scores by division. If both survive, differentiate by scope: "Kinerja Divisi Saya" (SPV, own division) vs "Kinerja Semua Divisi" (Head/Direktur, cross-division).
3. **Pantauan Risiko Klien vs Client Health** — the Management Dashboard is the all-client view of the same Client Health snapshot. If Client Health is only the per-client detail, make it a drill-down from a row, not a top-level menu.

Collapsing all three: 33 → 30 items.

## 5. Behaviour spec (unchanged from v2 unless noted)

1. Accordion, single group open; the group containing the active route opens on load.
2. Max depth 2. `Papan Divisi` remembers its own open state per user (localStorage).
3. Search filter at the top of the rail, `⌘K` / `Ctrl+K` to focus; matching groups expand, non-matching hide.
4. Badges on Persetujuan, Leads, Task Execution, Reminder Pembayaran — scoped to the current user, hidden at 0, `99+` above 99.
5. Role-based visibility hides items rather than blocking them, derived from the same permission predicate as RLS (frozen invariant: TS + RLS predicates must not diverge).
6. **New in v3 — Papan Divisi auto-scope.** A channel executor sees only their own division board and lands on it by default; AM, Head, and Direktur see all seven. Division membership comes from Role Mapping, not a hardcoded list.
7. Desktop-first: rail fixed at 270px, always expanded, sticky full height, own scroll area.
8. A11y: group header is `<button aria-expanded>`, active item `aria-current="page"`, visible focus ring, `prefers-reduced-motion` respected.

## 6. Role → visible groups

| Role | Groups |
|---|---|
| Direktur | all 9 |
| Head / SPV Account | Beranda, Akuisisi, Katalog, Klien, Delivery, Alat Bantu AM, Keuangan (Reminder), Tim, Admin (Akun Vendor, Akses Portal Klien) |
| Account Manager | Beranda, Katalog, Klien, Delivery, Alat Bantu AM, Tim (Penugasan), Admin (Akses Portal Klien) |
| Sales | Beranda, Akuisisi, Katalog, Klien (Direktori), Alat Bantu AM (Baseline Riset) |
| Finance | Beranda, Klien (Direktori), Keuangan |
| Creative / Ads / KOL / Live / Store Ops | Beranda, Delivery (Task Execution + own division board), Tim (Penugasan) |
| Admin & HR | Beranda, Admin |

Starting proposal only; Role Mapping in CDPS remains the source of truth.

## 7. Implementation notes

- v3 changes display labels and grouping only. Keep route paths, entity prefixes, module numbers (M15-C1/C2), state machines, and the 38-event notification catalog untouched.
- Page subtitles currently expose internal references ("M15-C1 Rule 9", "sumber: GET /portal/me"). Useful during build, but they should move behind a dev-only toggle before the tool is opened to non-technical staff — the sidebar rename is pointless if the page header still speaks in module numbers.
- Master Service List: read for all roles, write for Direktur/Head — enforce in RLS, not only in the UI.
