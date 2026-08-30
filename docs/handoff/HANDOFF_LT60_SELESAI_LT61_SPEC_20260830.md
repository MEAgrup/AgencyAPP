# HANDOFF — LT-60 SUDAH SELESAI, LT-61 masih terblokir (butuh spec keamanan)

> Ditulis 2026-08-30 karena `docs/handoff/RENCANA_INDUK_M16_M17.md` (§6) masih
> menandai LT-60 "Terbuka" — itu KETINGGALAN, sudah diverifikasi langsung ke
> kode bahwa LT-60 selesai. Baca dokumen ini SEBELUM menyentuh Live Stream/M16
> Fase 5 lagi supaya tidak mengerjakan ulang sesuatu yang sudah ada.

## 0. TL;DR

- **LT-60 (input tahapan Live oleh tim internal atas nama vendor) — ✅ SUDAH
  SELESAI, sudah di `main`.** Commit `ce61307` ("M16 LT-60: Live Stream
  tahapan produksi bisa digerakkan lewat FE"), didokumentasikan penuh di
  `docs/DECISIONS.md` (cari "LT-60 SELESAI"). **Jangan mengerjakan ulang.**
  Detail & bukti verifikasi: §1 di bawah.
- **LT-61 (login vendor sendiri, realm auth eksternal) — 🔴 MASIH
  TERBLOKIR, nol kode ada.** Blocker-nya BUKAN sekadar "belum sempat" —
  seluruh dokumen (rencana induk, 3 file handoff, `DECISIONS.md`) sepakat:
  **jangan mulai implementasi sampai ada spec keamanan**, persis blocker
  M15 Client Portal (`O5`, `DECISIONS.md`, terbuka sejak 2026-07-18, belum
  pernah ditulis). Struktural blocker-nya SAMA PERSIS dengan M15 — bukan
  cuma analog. Detail: §2.
- **Rekomendasi kerja sesi berikutnya**: tugas nyata yang BISA dimulai
  sekarang bukan "implementasi LT-61", melainkan **menulis spec keamanan
  realm eksternal untuk vendor Live Stream** (setara `O5`/§11 Phase 0 v2,
  diadaptasi untuk vendor bukan client contact). Begitu spec itu ada DAN
  disetujui pemilik, baru LT-61 boleh diimplementasikan. Draf kerangka
  pertanyaan yang perlu dijawab spec itu ada di §4.

---

## 1. LT-60 — bukti selesai (jangan kerjakan ulang)

**Verifikasi yang sudah dilakukan** (2026-08-30, sesi ini):
```
git log --oneline --all -- web-internal/src/lib/livestream.ts
ce61307 M16 LT-60: Live Stream tahapan produksi bisa digerakkan lewat FE
```
Commit ini **ada di riwayat `origin/main`** (dicek via
`git show origin/main:web-internal/src/lib/livestream.ts | grep isLiveStreamDivision`
— ketemu, baris 288/293).

**Yang dibangun** (ringkas dari `docs/DECISIONS.md` "🟢 LT-60 SELESAI",
kutip poin-poin kunci — baca entri lengkapnya di `DECISIONS.md` untuk detail
penuh + rasional):

1. **Gate yang dipakai**: `stage.canExecuteStage` yang SUDAH ADA (staff/lead
   divisi Live Stream, atau Director) — **BUKAN** `canManageLiveStream`
   (gate M10 Session/GMV: AM pemilik klien atau Director). Ini
   **dua populasi aktor yang berbeda dan tetap dipisah**:
   - `isLiveStreamDivision(role)` / `canAdvanceLiveStage(role)` — tim
     internal (staff/lead divisi "Live Stream") yang melapor progres
     produksi vendor ke CDPS atas nama vendor (LT-60, `stage_live`
     machine).
   - `canManageLiveStream(role)` — AM pemilik klien / Director, gate untuk
     `LSS-` Session request/result/reconcile (M10, TIDAK disentuh LT-60).
   Keduanya ada berdampingan di `web-internal/src/lib/livestream.ts`.
2. **Endpoint baru**: `getStageOverview` (`stage.ts`) sekarang menyertakan
   `nextStages` — edge maju yang valid dari `production_stage` saat ini,
   dipakai tombol "Lanjutkan" di `StageTimelinePanel` pada halaman detail
   Brief Live Stream (`web-internal/src/app/(shell)/livestream/briefs/[id]/page.tsx`).
   Ini juga menutup gap LT-28 untuk SEMUA pipeline, bukan cuma Live Stream.
3. **Sumber datanya WAJIB** `packages/domain/src/engine.ts` `allowedTransitions`
   (RPC `private.sm_allowed_transitions`, SECURITY DEFINER) — **BUKAN**
   `select … from sm_edges` langsung (tabel itu RLS-locked tanpa policy,
   query langsung akan 42501, persis insiden lama yang melahirkan RPC ini).
4. **`STAGE_RETURNED` ('Brief Dikembalikan ke AM') selalu dikecualikan**
   dari `nextStages` — edge itu milik `reviewBrief`, bukan `advanceStage`.
5. Nol migrasi baru, nol perubahan gate backend — murni kode baca + FE.
6. Test: `stage.test.ts` "getStageOverview.nextStages (LT-60)" (3 kasus).
   Full suite (core 290, db 53, domain 1548+1, api 383, web-internal 374)
   + `db-rebuild.sh --yes` (142 migrasi saat itu) hijau.

**Kalau ada keraguan lain soal LT-60** (mis. mau audit UX-nya lagi), itu
task TERPISAH ("QA ulang LT-60") — bukan "mengerjakan LT-60", karena
kodenya sudah ada dan sudah diverifikasi. Jangan menulis ulang
`isLiveStreamDivision`/`canAdvanceLiveStage`/`getStageOverview.nextStages`
dari nol.

---

## 2. LT-61 — kenapa benar-benar terblokir (bukan sekadar belum dikerjakan)

### 2.1 Apa yang diminta

"Login vendor sendiri" — vendor (perusahaan sister-company yang menjalankan
live stream, lihat §3) bisa masuk ke semacam portal dan menginput sendiri
progres/hasil sesi live stream-nya, alih-alih tim internal yang menginput
atas nama mereka (LT-60, sudah selesai).

### 2.2 Kenapa ini BUKAN "tambah role baru"

`packages/core/src/permission.ts` — seluruh model `Actor`/`Role` CDPS
dibangun di atas **satu asumsi tertutup**: aktor adalah **karyawan CDPS
yang tersinkron dari HRIS**.

```ts
export interface Role {
  division: string; level: string; od: boolean; director: boolean;
}
export interface Actor {
  employeeId: string; nama?: string; email?: string;
  divisi?: string; jabatan?: string; role: Role;
}
```

`actorFromClaims` **melempar error kalau `employee_id` kosong** — tidak
ada konsep "aktor tanpa employee_id" di seluruh sistem tipe saat ini.
Klaim JWT (`app_metadata.employee_id/division/level/od/director`) disuntik
`custom_access_token_hook` yang membaca `public.employees` + `role_mappings`
— **satu-satunya jalur mendapatkan token yang sah adalah punya baris
`employees` hasil sync HRIS**. Vendor Live Stream bukan karyawan MEA dan
TIDAK PERNAH akan ada di HRIS.

Menambah "role Vendor" ke `division_registry` (pola yang dipakai
menambahkan "AI Optimizer"/"Store Operation") **tidak menyelesaikan ini**
— itu cuma memperluas populasi *karyawan internal*, bukan memberi akses ke
orang di LUAR HRIS. LT-61 butuh **realm otentikasi kedua yang sepenuhnya
terpisah**, bukan baris baru di tabel yang sudah ada.

### 2.3 Precedent: ini PERSIS blocker M15 Client Portal, bukan analog

`CLAUDE.md` (baris 23, house rule, non-negotiable):
> **Frontend:** React/Next. Two apps: `web-internal` (workspaces/boards/dashboards)
> and `web-client-portal` (external, **separate auth realm**, strict
> allow-list data layer — never a permission-trimmed internal view).

Direktori `web-client-portal/` **sudah ada tapi kosong** — cuma satu
`README.md` (nol `src/`, nol `package.json`). Isinya (kutip penuh, ini
kontrak desain yang harus diikuti kalau LT-61 dibangun dengan pola serupa):

> `# web-client-portal (empty shell — Wave 3)`
> `External-facing Client Portal for MEA Agency clients. **Not built in Sprint 0.**`
> `## Status`
> `Empty shell placeholder per Sprint 0 ticket **S0-01**. Implemented in
> **Wave 3** (Module 15), only after the Client Portal security spec is
> written (Phase 0 v2 §11).`
> `## Separate auth realm (non-negotiable)`
> `This app is a **separate authentication realm** from the internal system:`
> `- Client contacts authenticate through their **own** realm — they are
> **never** part of the HRIS employee sync used by web-internal / the CDPS
> backend (docs/HRIS_API_CONTRACT.md, Phase 0 v2 §8).`
> `- Data access is a **strict per-Client allow-list** enforced at the
> query layer (Module 15 §6.1) — **never** a permission-trimmed view of
> internal data.`
> `- Additional minimums before build: per-Client data isolation, rate
> limiting on login + complaint form, session expiry, per-contact action
> audit (Phase 0 v2 §11).`
> `Do not wire this app to the internal auth/session tables.`

`docs/DECISIONS.md` (2026-07-18, keputusan yang menunda M15-C2 — kutip
verbatim karena ini blocker yang sama diwarisi LT-61):

> Client Portal (M15-C2) DITUNDA — untuk sementara TIDAK dibuat. Keputusan
> manusia via sesi 2026-07-18: klaster W3-M15-C2 (realm auth terpisah,
> allow-list data layer, embed `mea-client-reporting`, complaint form
> portal, health band client-facing) tidak dikerjakan sampai ada keputusan
> baru. ... (2) **O4** (cek embeddability) dan **O5** (security spec)
> TIDAK lagi ditunggu aktif — keduanya tetap tercatat Open sebagai
> PRASYARAT WAJIB bila portal dihidupkan kembali (JANGAN mulai M15-C2
> tanpa keduanya, aturan lama tetap) ...

Baris Open `O5` (`DECISIONS.md`, masih terbuka sampai sekarang, 2026-08-30):
> Spec keamanan detail Client Portal (minimum sudah di Phase 0 v2 §11).
> M15-C2 DITUNDA (Decided 2026-07-18) — tulis hanya bila portal dihidupkan
> kembali; tetap prasyarat wajib.

**Minimum spec yang diwajibkan** (`docs/prd/CDPS_Phase0_Foundation_v2.md`
§11, kutip penuh — poin-poin ini yang perlu diadaptasi untuk vendor):
> Module 15's Client Portal is the only external-facing surface. Before it
> is built (Wave 3), a short security spec must cover, at minimum: a
> separate auth realm for client contacts (never mixed into the HRIS
> employee sync), per-Client data isolation enforced at the query layer
> (strict allow-list per Module 15 §6.1 — not permission-trimmed internal
> views), rate limiting on login and the complaint form, session expiry,
> and per-contact action audit. Internal Team Portal reuses the standard
> HRIS-backed auth (§8).

### 2.4 Konsensus semua dokumen: JANGAN MULAI

- `RENCANA_INDUK_M16_M17.md` §0: *"LT-61 (login vendor sendiri)
  **terblokir** — butuh realm auth eksternal yang belum ada di CDPS.
  **JANGAN mulai** sampai ada spec keamanan client-portal-style untuk
  vendor."*
- `HANDOFF_M16_SESI_LANJUTAN.md` §3: *"🔴 **Terblokir** — butuh spec
  keamanan client-portal-style yang belum ditulis | **Jangan mulai**
  sampai spec itu ada"*
- Tidak ada SATU PUN dokumen yang mengusulkan desain LT-61. Semua eksplisit
  menahan diri.

**Kesimpulan: jangan menulis kode LT-61 di sesi berikutnya tanpa spec yang
disetujui pemilik lebih dulu.** Ini bukan preferensi tim, ini garis yang
sudah ditarik berulang kali di dokumentasi proyek.

---

## 3. Konteks Live Stream vendor (untuk memahami apa yang dibutuhkan spec)

`packages/domain/src/livestream.ts` (M10) — kerangka mental yang harus
dipahami sebelum menulis spec:

- Live Stream **sengaja BUKAN divisi eksekusi biasa**: MEA tidak menjalankan
  live stream-nya sendiri — **vendor sister-company TANPA akses CDPS**
  yang menjalankan. Kutip header modul: *"the confirmed exception to every
  execution-division pattern... This module is a tracker, not an execution
  system... what MEA (via the AM) requested from the vendor, and what the
  vendor actually delivered."*
- PRD M10 §6.1 (Roles table), baris Vendor, verbatim:
  > `| Vendor (sister company) | No system access — represented entirely
  > through AM-entered request/result data. |`
- **Vendor SEBAGAI ENTITAS DATA** (`vendors`, prefix `VND-`, M6A) itu
  **beda dan tidak berhubungan** — itu master data Strategy-pillar (klien
  mana pakai vendor mana untuk pillar "live"), FK-referenced dari strategi,
  BUKAN identitas login. Tidak ada `vendor_users`/`vendor_contacts` atau
  tabel identitas vendor apa pun di schema saat ini.
- Mesin `live_stream_session` (`LSS-`, M10) — `[Requested]` →
  `[Confirmed by Vendor]` → `[Completed]` → `{[Reconciled]|[Discrepancy
  Flagged]→[Reconciled]}` — **semua transisi ini dijalankan AM/Director**,
  vendor tidak pernah menulis apa pun langsung ke mesin ini. Field
  `dataConfidenceTier` selalu `'Vendor-Reported'` (vendor tidak pernah
  memverifikasi datanya sendiri secara langsung di sistem — datanya masuk
  lewat laporan eksternal yang AM ketik ulang/link-kan).
- Mesin `stage_live` (`brief_stage`, M16, LT-60) — **paralel, tidak
  menyentuh `LSS-` sama sekali** — `Terima Brief AM` (`label`, `stage_code`
  literal `Cek Brief AM`) → `Terima Sampel` → `Briefing Klien Live` →
  `Live Start`. Ini yang LT-60 hubungkan ke FE untuk tim internal.

**Implikasi untuk spec LT-61**: kalau vendor dapat login sendiri, perlu
diputuskan APA yang boleh mereka tulis — apakah menggantikan tim internal
di mesin `stage_live` (LT-60), atau mengisi field `LSS-` (M10) langsung
(saat ini AM yang mengisi berdasarkan laporan vendor), atau keduanya, atau
sekadar portal BACA (lihat brief mereka, upload Vendor Report Link sendiri
tanpa AM mengetik ulang). Ini keputusan produk yang belum pernah diajukan
ke pemilik — bagian dari yang perlu ditanyakan saat menulis spec (§4).

---

## 4. Kerangka pertanyaan untuk spec keamanan LT-61 (draf awal, BELUM dijawab)

Ini BUKAN spec — ini daftar yang perlu diisi/diputuskan sebelum spec bisa
ditulis dan diajukan ke pemilik. Pola strukturnya meniru §11 Phase 0 v2
(minimum M15) + README `web-client-portal`, diadaptasi untuk populasi
vendor (bukan client contact):

1. **Realm otentikasi**: vendor login lewat apa? Opsi yang perlu
   dipertimbangkan — akun terpisah di Supabase Auth (project yang sama
   atau realm/project terpisah?), magic link per sesi (tanpa akun
   permanen), atau token per-Brief/per-Session yang dikirim manual (mirip
   pola `strategi_share_token`/`/s/{token}` yang SUDAH ADA di codebase
   untuk share link login-less — lihat `DECISIONS.md` 2026-08-09, ini
   preseden paling dekat yang sudah pernah dibangun & sengaja TIDAK pakai
   `web-client-portal`). **Vendor jumlahnya kemungkinan sangat sedikit**
   (satu sister-company?) — pertimbangkan apakah kompleksitas realm penuh
   sepadan, atau token-per-akses seperti share-link sudah cukup.
2. **Data isolation**: kalau vendor bisa login, apa yang mereka boleh
   lihat/tulis — HANYA Brief/Session milik mereka sendiri? Bagaimana
   "milik mereka" ditentukan (field `vendor_id` di `briefs`/`live_stream_sessions`
   yang BELUM ADA hari ini — perlu migrasi baru kalau opsi ini diambil)?
3. **Scope tulis**: lihat §3 di atas — apakah vendor menulis ke `stage_live`
   (menggantikan LT-60), ke `LSS-` (menggantikan sebagian alur AM di M10),
   keduanya, atau read-only + upload link saja?
4. **Rate limiting** — login vendor & (kalau ada) form input harus dibatasi
   laju permintaannya (pola sama diminta §11 M15 untuk login + complaint
   form).
5. **Session expiry** — berapa lama sesi vendor valid; apakah sama dengan
   kebijakan sesi karyawan internal atau lebih pendek (rekomendasi: lebih
   pendek, karena realm eksternal).
6. **Audit per-aksi** — setiap aksi vendor (submit hasil, konfirmasi, dst)
   harus tercatat `audit_log` dengan aktor yang jelas BUKAN karyawan CDPS —
   `audit_log.actor_employee_id` (kalau kolomnya bertipe FK ke `employees`)
   mungkin perlu pola baru untuk merepresentasikan aktor eksternal. Cek
   skema `audit_log` sebelum menjawab ini.
7. **Hubungan dengan blocker M15**: apakah LT-61 HARUS menunggu spec M15
   (`O5`) selesai lebih dulu (satu spec besar untuk realm eksternal,
   dipakai client portal maupun vendor), atau LT-61 boleh punya spec
   sendiri yang lebih sempit (vendor ≠ client, kebutuhan datanya jauh lebih
   sempit — hanya live stream, bukan seluruh Client Board)? **Ini
   pertanyaan pertama yang sebaiknya diajukan ke pemilik** sebelum menulis
   detail spec — jawabannya menentukan apakah LT-61 bisa jalan independen
   dari M15 atau harus menunggunya.

**Rekomendasi urutan kerja sesi berikutnya:**
1. Ajukan pertanyaan #7 di atas ke pemilik dulu (lewat `AskUserQuestion`
   kalau di sesi Claude Code, atau langsung ke Nerissa/Yohan) — ini
   menentukan apakah LT-61 independen atau terikat M15.
2. Kalau independen: tulis draf spec sempit (poin 1–6 di atas, khusus
   vendor Live Stream) sebagai entri baru `docs/DECISIONS.md` atau file
   PRD addendum baru, ajukan ke pemilik untuk disetujui.
3. **Jangan menulis kode implementasi (migrasi, `packages/domain`, FE)
   sebelum spec itu disetujui pemilik** — ikuti pola persis yang menahan
   M15 sejak 2026-07-18.

---

## 5. Berkas rujukan

| Berkas | Untuk apa |
|---|---|
| `packages/domain/src/livestream.ts` | Modul M10 lengkap — mesin `LSS-`, gate `canManageLiveStream`, framing "vendor tanpa akses CDPS" |
| `web-internal/src/lib/livestream.ts` | Gate FE `isLiveStreamDivision`/`canAdvanceLiveStage` (LT-60) vs `canManageLiveStream` (M10) — baca komentar inline, sudah menjelaskan pemisahan populasi |
| `docs/STATE_MACHINES.md` §10 | Mesin `LSS-` |
| `docs/STATE_MACHINES.md` §18 | Mesin `stage_live` / `brief_stage` (LT-60 jalan di sini) |
| `docs/prd/CDPS_Module10_Live_Stream.md` §6.1 | Roles table, baris Vendor verbatim |
| `docs/prd/CDPS_Module15_Client_Team_Portal.md` §6.1 | Spec allow-list Client Portal (pola yang perlu diadaptasi) |
| `docs/prd/CDPS_Phase0_Foundation_v2.md` §11 | Minimum spec keamanan realm eksternal (dikutip penuh di §2.3 atas) |
| `web-client-portal/README.md` | Kontrak desain realm terpisah yang SUDAH disepakati untuk client portal (dikutip penuh di §2.3) |
| `docs/DECISIONS.md` — cari "LT-60 SELESAI" | Bukti + rasional lengkap LT-60 |
| `docs/DECISIONS.md` §Open — cari `O4`, `O5` | Blocker M15 yang diwarisi LT-61 |
| `docs/DECISIONS.md` (2026-08-09) | Preseden share-link login-less (`strategi_share_token`, `/s/{token}`) — pola paling dekat dengan "akses eksternal tanpa realm penuh" yang SUDAH pernah dibangun |
| `docs/handoff/RENCANA_INDUK_M16_M17.md` §0/§6 | Rencana induk (SUDAH KETINGGALAN untuk baris LT-60 — dokumen ini yang jadi koreksinya) |
| `docs/backlog/LEADTIME_BACKLOG.md` | Status tiket otoritatif — perbarui baris LT-60/LT-61 di sana juga kalau statusnya berubah lagi |
