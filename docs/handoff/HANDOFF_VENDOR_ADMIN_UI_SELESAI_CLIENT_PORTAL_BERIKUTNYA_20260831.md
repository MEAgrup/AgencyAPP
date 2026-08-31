# HANDOFF — Vendor admin-provisioning UI SELESAI (PR #260); task berikutnya: Client Portal (M15-C2)

> Ditulis 2026-08-31. Sesi ini menuntaskan follow-up LT-61 (admin UI provisioning
> akun vendor), menemukan+menambal satu bug laten sebelum sempat lahir, meng-
> merge `main` terbaru, dan membuka **PR #260**. **Baca §0 dulu.**

## 0. Sebelum mulai kerja: cek keadaan repo dulu

1. `git fetch origin main && git log --oneline -5` — cek posisi `main` sesuai
   catatan di sini. Kalau PR #260 sudah di-merge, `main` akan memuat commit
   "LT-61 follow-up: admin UI for vendor account provisioning" + merge commit
   dari `origin/main` ke dalamnya (lihat §1).
2. `mcp__github__pull_request_read(method: "get", pullNumber: 260)` — cek
   status PR-nya (kalau sesi ini belum sempat menyelesaikan merge, lihat §1
   untuk instruksi lanjut).
3. `mcp__github__list_pull_requests(state: "open")` — cek PR lain yang mungkin
   berjalan paralel sebelum mulai kerja baru (pola insiden dua-sesi-paralel
   pernah terjadi di repo ini — `DECISIONS.md` 2026-08-30 "Kinerja Sales #7").

## 1. Status PR #260

`https://github.com/MEAgrup/AgencyAPP/pull/260` — branch
`claude/vendor-feature-build-9itvjk` → `main`. Isi: admin UI provisioning
akun vendor (lihat handoff sebelumnya untuk detail lengkap fitur ini — dicari
lewat `DECISIONS.md` 2026-08-30 "LT-61 follow-up — admin UI for vendor
account provisioning").

**Yang terjadi sesi ini, urut:**
1. `main` sudah bergerak jauh sejak branch dibuat (049ba58 → 9f6e33d): fitur
   "Perlu Persetujuan Saya" (Sales+Renewal approval inbox), perbaikan
   `BadCommissionRuleError` 500→400, dan — **penting** — perbaikan bug
   produksi `import_employee_credentials()` yang melahirkan
   `auth.users.email_change = NULL` (bikin GoTrue 500 di login untuk SETIAP
   akun baru; lihat `DECISIONS.md` 2026-08-31).
2. **Ditemukan sebelum sempat jadi masalah nyata:** `provision_vendor_account`
   (fungsi baru sesi sebelumnya) menyalin bentuk INSERT `auth.users` yang
   PERSIS SAMA — jadi kena bug laten yang identik. Karena migrasinya belum
   pernah di-apply ke lingkungan mana pun, filenya diedit langsung (bukan
   ditambal lewat migrasi susulan) untuk memasukkan `email_change = ''`.
   Dicatat di `DECISIONS.md` 2026-08-31.
3. `git merge origin/main` ke branch — satu konflik di `docs/DECISIONS.md`
   (kedua sisi menambah baris di atas tabel yang sama), diselesaikan dengan
   menyusun ulang urut tanggal (terbaru di atas). File lain auto-merge bersih.
4. Full rebuild + suite penuh pasca-merge: `db-rebuild.sh --yes` (158 migrasi,
   gate 134/37/30/67 semua lolos), `core` 293, `db` 53, `domain` 1636+1 skip,
   `api` 385, `web-internal` 390 — semua hijau. `tsc --noEmit` + `next build`
   bersih untuk `apps/api` dan `web-internal`.
5. Push + **PR #260 dibuka** ke `main`.

**Kalau CI PR #260 sudah hijau dan belum di-merge saat sesi ini berakhir**
(mungkin karena sesi terputus sebelum sempat menyelesaikan) — cek statusnya
dulu (`pull_request_read` method `get_status`/`get_check_runs`), lalu merge
kalau memang hijau (`mcp__github__merge_pull_request`). Kalau CI merah, itu
task pertama sesi berikutnya — diagnosis dulu sebelum menyentuh apa pun yang
lain (lihat aturan "drive to green" di system prompt).

## 2. Task berikutnya (diminta pemilik langsung): Client Portal (M15-C2)

Pemilik secara eksplisit meminta ini sebagai task chat berikutnya. **Jangan
langsung menulis kode** — ini modul yang sengaja DITUNDA sejak 2026-07-18
(`DECISIONS.md`, entri tanggal itu) menunggu dua prasyarat wajib, **O4** dan
**O5**, dan keduanya BELUM diputuskan.

### 2.1 Bahan yang SUDAH ada — jangan menulis ulang dari nol

**`docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`** — draft spec keamanan
lengkap (23KB, ditulis 2026-07-20), mencakup model ancaman, prinsip desain,
autentikasi, otorisasi/isolasi data, audit, rate limiting, dan opsi embed.
**Status header dokumen ini sendiri: "DRAFT — bahan keputusan, BUKAN izin
mulai koding."** Baca ini SEBELUM menulis apa pun.

**⚠️ Draft ini ditulis SEBELUM migrasi Go→TS/Supabase** (tertanggal
2026-07-20; migrasi "Pensiun Go" diputuskan 2026-07-29 — lihat CLAUDE.md
banner di atas). §3 draftnya berulang kali merujuk `backend/internal/auth/
local.go` (Go, SUDAH DIPENSIUNKAN, `backend/**` sekarang cuma oracle paritas)
sebagai pola yang ditiru. Itu sudah usang. **Pola yang harus ditiru sekarang
adalah realm auth vendor LT-61** (`supabase/migrations/20260903010000_
lt61_vendor_auth.sql` + `packages/core/src/permission.ts` `isVendorActor`/
`actorFromVendorClaims` + `custom_access_token_hook` cabang kedua) — itu
preseden CDPS pertama untuk realm non-HRIS yang SUNGGUHAN dibangun di stack
TS/Supabase saat ini, bukan draft. Client Portal akan jadi realm non-HRIS
KEDUA; pola strukturnya (Supabase Auth user terpisah → tabel link →
`jwt_*_id()` RLS helper → cabang hook baru) kemungkinan besar sama, hanya
skalanya lebih besar (multi-contact per Client, bukan satu vendor per akun).
**Merevisi §3 draft ke pola LT-61 adalah kemungkinan besar langkah pertama
yang nyata**, bukan menulis dari nol.

### 2.2 10 Open Questions di draft (§7-nya) — belum satu pun terjawab

Draft itu sendiri mendaftar `OQ-1` sampai `OQ-10` yang wajib dijawab manusia
sebelum koding boleh mulai (bukan boleh ditebak Claude — aturan CLAUDE.md
"PRD ambigu → STOP, catat sebagai Open"). Ringkasan (baca §7 draft untuk teks
lengkap + alasan tiap satu tidak bisa diasumsikan):

| # | Inti pertanyaan |
|---|---|
| OQ-1 | Satu kontak klien bisa terhubung ke banyak Client, atau selalu satu? |
| OQ-2 | Reset password: self-service email, atau admin/AM-only (pola karyawan)? |
| OQ-3 | Angka pasti session TTL Portal (draft usul 2–4 jam, belum final) |
| OQ-4 | Siapa berwenang provisioning kontak klien baru (AM saja? +Account Lead? admin non-AM?) |
| OQ-5 | Angka rate limiting per-IP (ambang, jendela, mekanisme block) |
| OQ-6 | Apakah Portal benar menampilkan status invoice/pembayaran klien — PRD M15 §2 Rule 7 MENYIRATKAN ini tapi TIDAK PERNAH merancang surface-nya di §2–§6 manapun. **Ambiguitas PRD nyata, bukan sekadar detail teknis** |
| OQ-7 | = **O4** — embeddability teknis `mea-client-reporting` (cek header `X-Frame-Options`/CSP `frame-ancestors`, ±1 hari kerja, TIDAK butuh keputusan produk — ini task teknis yang bisa dikerjakan duluan/paralel) |
| OQ-8 | Mekanisme handoff sesi ke `mea-client-reporting` kalau Opsi A (embed native) dipilih |
| OQ-9 | Apakah draft ini sendiri sudah dianggap "O5 selesai" begitu direvisi, atau masih butuh satu putaran review eksplisit head dev sebelum dicatat closed di `DECISIONS.md`? |
| OQ-10 | Ambang lockout & panjang password Portal: sama persis realm karyawan, atau diperketat khusus permukaan publik? |

### 2.3 Cara mengerjakannya — pola yang sudah terbukti jalan (LT-61)

LT-61 (vendor realm) menyelesaikan pertanyaan sejenis ini lewat **dua putaran
`AskUserQuestion`** langsung ke pemilik — bukan menebak, bukan menulis semua
opsi lalu menunggu review dokumen panjang:
1. **Putaran 1 — kerangka besar** (analog OQ-1, OQ-6, OQ-7/O4, arah opsi
   embed §6 draft: native vs link-out).
2. **Putaran 2 — mekanik detail** setelah kerangka besar terjawab (analog
   OQ-2, OQ-3, OQ-4, OQ-5, OQ-10).

Rekomendasi konkret untuk sesi berikutnya:
1. Baca `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` penuh + `docs/prd/
   CDPS_Module15_Client_Team_Portal.md` §2/§6.1 (rules Client Portal) +
   `supabase/migrations/20260903010000_lt61_vendor_auth.sql` (pola realm
   yang mau ditiru).
2. Kerjakan **O4 duluan** (cek embeddability `mea-client-reporting`) — ini
   task teknis murni, tidak menunggu siapa pun, dan menentukan apakah §6
   draft Opsi A (embed native) atau Opsi B (link-out) yang jadi dasar spec
   final.
3. Ajukan `AskUserQuestion` untuk OQ-1/OQ-6 dulu (dua-duanya menentukan
   BENTUK data model — client_contacts junction table atau tidak, dan apakah
   surface invoice/payment ada sama sekali) — jangan mulai desain skema
   sebelum ini terjawab.
4. Revisi `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` §3 (autentikasi) ke
   pola LT-61 (Supabase Auth realm kedua, bukan `local.go` Go yang sudah
   pensiun) sebagai bagian dari menjawab OQ-9 — draft yang direvisi itulah
   yang diajukan sebagai "O5 selesai" untuk sign-off pemilik.
5. Putaran `AskUserQuestion` kedua untuk OQ-2/3/4/5/10 (mekanik) setelah
   kerangka besar clear.
6. Begitu O4+O5 resmi closed di `DECISIONS.md` (butuh keputusan manusia
   eksplisit — closing OQ-9 TIDAK otomatis, per catatan penutup draft),
   BARU mulai kode: Rules → Flow → Example → System Requirements → PR kecil
   per klaster, pola yang sama seperti M15-C1 (Team Portal, sudah selesai).

**Jangan mulai menulis migrasi/kode `web-client-portal` sebelum langkah 6.**
`web-client-portal/README.md` saat ini masih shell kosong dengan alasan yang
sama — itu bukan bug, itu status yang benar sampai O4+O5 closed.

## 3. Task kecil yang TIDAK diminta tapi dicatat pemilik untuk nanti

Pemilik bertanya apakah menu sidebar Store Operation/AI Optimizer bisa
dibangun sekarang (sebelum detail pipeline LT-2/LT-8 datang dari tim).
**Jawaban yang diberikan sesi ini: ya, aman dibangun sekarang** —
`listDivisionQueue` sudah data-driven dari `division_registry` (kedua divisi
sudah ada di `BRIEF_ASSIGNABLE_DIVISIONS`) dan `StageTimelinePanel`/`stage.ts`
sudah eksplisit menangani kasus "divisi tanpa pipeline" (Rule 12) tanpa
error — begitu pipeline di-seed nanti (satu migrasi, `DECISIONS.md` LT-2),
panel itu otomatis mulai menampilkannya, nol perubahan kode FE. Saat ini
staff Store Operation/AI Optimizer **sama sekali tidak punya menu** untuk
melihat Brief mereka sendiri — kelas defect yang sama dengan O42/O43.

**Tidak dikerjakan sesi ini** (pemilik memilih fokus ke PR+handoff dulu).
Kalau pemilik minta lagi: halaman queue generik (mirip pola `/livestream`,
bukan custom seperti `/ads`/`/kol`) + dua entri nav baru, gated
`divisionQueue('Store Operation')`/`divisionQueue('AI Optimizer')` (helper
yang sudah ada di `nav.ts`). Task kecil, terpisah penuh dari LT-2/LT-8 dan
dari Client Portal — bisa dikerjakan kapan saja tanpa menunggu apa pun.

## 4. Backlog owner-gated lain yang TETAP terbuka (tidak berubah)

Tidak disentuh sesi ini, statusnya sama seperti handoff sebelumnya:
- **LT-2/LT-8** (Store Operation: daftar & urutan kerja + alasan pengembalian
  brief) — pemilik memilih Client Portal duluan sesi ini; LT-2/LT-8 masih
  "menunggu pemilik" (`docs/backlog/LEADTIME_BACKLOG.md` §0/Fase 6).
- **C-05 cutover gate** (pencabutan `backend/`) — menunggu keputusan go/no-go
  produksi pemilik, tidak disentuh (`docs/backlog/PENSIUN_GO_STATUS_DAN_
  TASK_PARALEL.md` + `docs/handoff/HANDOFF_CUTOVER_SESI26.md`).

## 5. Berkas rujukan

| Berkas | Untuk apa |
|---|---|
| PR #260 (`https://github.com/MEAgrup/AgencyAPP/pull/260`) | Diff admin UI provisioning vendor + merge `main` + fix `email_change` |
| `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` | **Mulai di sini untuk Client Portal.** Draft O5, perlu revisi pola auth (§2.1 di atas) + 10 OQ dijawab |
| `docs/prd/CDPS_Module15_Client_Team_Portal.md` §2/§4/§6.1 | Rules/Flow/System Requirements Client Portal (C2). §3/§6.2/§6.3 (Team Portal) sudah SELESAI, jangan disentuh ulang |
| `supabase/migrations/20260903010000_lt61_vendor_auth.sql` | Pola realm auth non-HRIS yang TERBUKTI jalan — tiru strukturnya untuk Client Portal |
| `docs/DECISIONS.md` — cari "O4"/"O5"/"2026-07-18" | Riwayat penundaan M15-C2 + entri Open O4/O5 |
| `docs/prd/CDPS_Build_Plan.md` §R2 | Fallback kalau O4 embeddability gagal: Opsi B link-out (degradasi anggun, sudah di PRD) |
| `web-client-portal/README.md` | Shell kosong — jangan diisi sebelum O4+O5 closed |
| `docs/backlog/WAVE3_GAP_AUDIT.md` | Konfirmasi Wave 3 non-portal SELESAI penuh; Client Portal satu-satunya sisa |
