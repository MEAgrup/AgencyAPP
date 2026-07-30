# HANDOFF — Cutover Sesi 18 (blind spot nested-inline ditutup · T2b · lint di CI)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI17.md` (penggabungan Paket A+B, hidup di PR #78).
> Yang masih berlaku tidak diulang — terutama SESI9 §6 (aturan rumah yang menggigit),
> SESI12 §2.4 (`npm run db:rebuild`, satu-satunya jalur benar untuk DB lokal), dan
> SESI17 §3.3 (daftar "jangan dikerjakan", masih berlaku bit-for-bit).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **`main`** | **`e5755ff`** = Merge PR #79. Berisi #75 → #77 → #76 → #79. **Belum bergerak sejak SESI17.** |
| **Branch aktif** | `claude/go-retirement-progress-08ly3d` — **BERTUMPUK di atas PR #78** (bukan di atas `main`) |
| **Basis** | `origin/claude/go-retirement-progress-6r14e0` = **HEAD #78 (`25a383b`)**, yang sudah memuat `main@e5755ff` |
| **PR** | draft ke `main`, stacked di atas #78 ⇒ **merge #78 DULU** |
| **Kenapa bertumpuk** | kerja sesi ini mengubah `shape-parity.test.ts`, dan berkas itu **hanya ada di #78**. Branch dari `main` berarti menulis ulang gate-nya dari nol. |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** — tidak disentuh. Nol `apply_migration`, nol DDL, nol INSERT, nol perubahan skema. |

**Angka test (Postgres 16 lokal, DB dibangun ulang dari nol, 40/40 migrasi bersih):**
`apps/api` **301** (299 dari #78 + 2 test gate) · `@cdps/domain` **566** (+1 skip) ·
`@cdps/core` **113** · `@cdps/db` **9** · `web-internal` **26** ·
`route-parity` **5/5, `KNOWN_GAPS` KOSONG** · typecheck bersih semua workspace ·
`npm run lint -w @cdps/api -- --max-warnings 0` **0 error 0 warning** ·
`web-internal`: `tsc --noEmit` bersih + `npm run lint` bersih.

```bash
git fetch origin main claude/go-retirement-progress-08ly3d
git checkout claude/go-retirement-progress-08ly3d
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

> ⚠️ **Cek `list_pull_requests` sebelum apa pun, bukan hanya `git log`** (SESI17 sudah kena tiga
> kali). Catatan konkret untuk sesi ini: `HANDOFF_CUTOVER_SESI17.md` **tidak ada di `main`** — ia
> hidup di PR #78. Handoff yang "hilang" biasanya berarti PR-nya belum di-merge, bukan berarti
> handoff-nya tidak pernah ditulis.

---

## 1. Yang dikerjakan: tiga sisa engineering non-terkunci SESI17 §3.2 (butir 1–3)

Setelah PR ini, **nol butir sisa pensiun Go bisa dimajukan Claude** tanpa keputusan atau akses
pemilik. Sisanya T3 (terkunci O47) dan Fase 5 (terkunci gate GO + O47).

### 1.1 🔴 Yang paling penting: "3 interface nested inline" ternyata 6, dan salah satunya lubang nyata

Gate `shape-parity.test.ts` (#78) membandingkan kunci **level-atas** saja dan menyatakan blind
spot-nya sebagai **tiga** interface. Angka itu terlalu optimistis **dua arah**:

| Arah yang luput | Contoh | Kenapa tak terhitung |
|---|---|---|
| Objek inline **satu baris** | `PerfTeamRollupWire.members`, `MarketingMetricsWire.junk_breakdown` | deteksinya regex kunci ber-indentasi **4 spasi**; objek satu baris tak punya baris seperti itu |
| Sisi **FE** | `AttemptDetail`, `DemoTaskDetail` | gate hanya memeriksa `wire.ts`; blind spot FE bahkan tak pernah **dinyatakan** |

**Dan salah satunya cacat, bukan cuma cakupan.** `DemoTaskDetail.task` membaca `description`,
sementara tipe daftar `DemoTask` tidak mendeklarasikannya. Jadi `description` duduk di
`ALLOWED_EXTRA` sebagai "kunci ekstra yang sah" — dan **menghapusnya dari wire akan mengeblank
halaman detail sementara CI tetap hijau**. Persis kelas O43/O41.

Bukti, bukan klaim: mutasi "hapus `description` dari `DemoTaskWire`" disuntik ke `wire.ts` versi
**lama** (`25a383b`) → gate lama **9/9 HIJAU**. Pada gate baru → **MERAH**.

### 1.2 Apa yang diubah

**Enam blok inline jadi interface bernama** — ekstraksi tipe murni, **nol perubahan nilai** yang
dikirim converter mana pun (`git diff` badan fungsi: nol):

| Sisi | Baru |
|---|---|
| `apps/api/src/lib/wire.ts` | `LeadAttemptWire` · `ProposalLineWire` · `AttemptDetailAttemptWire` · `AttemptDetailLeadWire` · `PerfTeamMemberWire` · `JunkReasonWire` |
| `web-internal/src/lib` | `AttemptDetailAttempt` · `AttemptDetailLead` (sales.ts) · `DemoTaskDetailTask` (types.ts) |

**Gate turun rekursif.** Dari tiap pasangan registry, tiap kunci yang tipenya menamai interface
diikuti ke bawah. Tiga hal yang membuatnya tidak bisa berhenti diam-diam:

1. **Referensi diikuti hanya bila KEDUA sisi tipe bernama.** Kasus satu-sisi (named vs objek
   inline, atau nama ambigu) dikumpulkan sebagai `unfollowed` dan **di-assert kosong**. Ini yang
   menemukan keenam blok — bukan mata manusia.
2. **Resolusi lintas-berkas dibaca dari `import type`, bukan ditebak.** `portal.ts` me-reuse
   `Card` (board.ts), `Snapshot` (performance.ts), `PendingBlockRequest` (tasks.ts) — dan ketiga
   nama itu **juga ada di berkas lain**. Menebak = kesalahan yang justru dicegah registry
   file-qualified.
3. **Ekstraktor tipe membuang komentar `//` di ujung deklarasi.** Tanpa itu
   `components: Component[]; // array of 7 items` resolve ke nol ⇒ satu referensi tak terikut,
   diam-diam.

`NESTED_INLINE_UNCHECKED` sekarang **kosong**, di-assert terhadap **kedua** sisi, dan berlaku
seperti `KNOWN_GAPS`: **hanya boleh menyusut**. Menambah satu baris = membuka kembali blind spot
yang sudah tertutup ⇒ butuh baris `DECISIONS.md`.

### 1.3 Divalidasi dengan 5 mutasi — kelimanya merah

Mengikuti pelajaran termahal SESI17 (§2.2): **gate yang belum pernah dibuktikan gagal belum
diketahui bekerja.**

| Mutasi disuntik ke `wire.ts` | Hasil |
|---|---|
| hapus kunci **di dalam** blok bersarang (`LeadAttemptWire.owner_nama`) | 🔴 *"never emits"* |
| kunci camelCase menyeberang **di dalam** blok bersarang (`ProposalLineWire.paymentTerms`) | 🔴 camelCase + kunci di luar kontrak |
| hapus `description` dari `DemoTaskWire` (**lubang yang dulu tak terlihat**) | 🔴 *"never emits"* — gate lama hijau |
| kembalikan satu blok jadi objek inline (`ProposalWire.lines`) | 🔴 blind-spot + `unfollowed` |
| referensi bersarang salah sasaran (`AttemptDetailWire.lead` → `…AttemptWire`) | 🔴 kunci hilang + kunci ekstra |

Sesudahnya `git status` bersih — keempat mutasi wire dipulihkan, diverifikasi.

### 1.4 T2b + lint di CI (SESI17 §3.2 butir 2 & 3)

- **T2b:** import `msl` yang tak terpakai dibuang dari `apps/api/scripts/mslseed.ts` ⇒ lint
  `@cdps/api` **0 error 0 warning**.
- **CI:** job `api` kini memanggil `npm run lint -w @cdps/api -- --max-warnings 0`. Warning dibuat
  **fatal** justru karena T2b beres — gate mulai dari nol jadi tak bisa mengumpulkan warning
  diam-diam. (Tanpa flag itu eslint keluar **exit 0** pada warning ⇒ langkah CI-nya hampa. Sama
  kelasnya dengan regex `[a-z_0-9]` di SESI17.)

---

## 2. Yang TIDAK dikerjakan & kenapa

- **Nol edit badan converter `wire.ts`.** Enam interface baru adalah ekstraksi tipe; tak ada
  converter yang mengirim kunci berbeda sesudah PR ini. Itu penting: paritas yang dibuktikan
  Paket A & B tetap berlaku apa adanya.
- **Nol entri baru di `ALLOWED_EXTRA` / `APPROVED_DIVERGENCE`.** Keduanya tidak bergerak (masing-
  masing **8** dan **1** entri; registry `WIRE_TO_FE` tumbuh 84 → **89**). `description` **tetap** di `ALLOWED_EXTRA` dan itu benar: relatif tipe
  daftar `DemoTask` ia memang kunci ekstra — yang berubah, sekarang ia juga dibandingkan terhadap
  `DemoTaskDetailTask` yang mewajibkannya.
- **`route-parity` `KNOWN_GAPS` tetap KOSONG.**
- **`backend/**` tidak disentuh** (read-only, oracle paritas sampai C-05).
- **Live `CDPS SG` tidak ditulis.**
- **T3 & Fase 5** — terkunci O47 / gate GO (SESI17 §3.3 masih berlaku).

---

## 3. Lanjut dari sini

1. **Merge #78 dulu, lalu PR ini** (stacked). Kalau `main` sudah maju, merge `main` ke dalamnya,
   jalankan `db:rebuild` + suite penuh **di atas hasil merge** — jangan diasumsikan.
   Konflik yang harus diduga: `docs/DECISIONS.md` (tabel append-only, sisipan di baris teratas).
   **Resolusi "ambil punyaku" akan menghapus keputusan orang lain secara senyap** — simpan kedua
   sisi, lalu verifikasi nol baris hilang & nol duplikat.
2. **Sesudah itu: nol butir engineering tersisa.** Jalur kritis 100% sisi pemilik — tujuh butir
   `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` §5, urutan tercepat: butir 1 (C-03) → butir 4
   (O34/O26/O35/O9) → gate GO → butir 6 & 7 → Fase 5. Plus dua butir kebersihan yang tidak
   memblokir apa pun: **tutup #73 & #74** tanpa merge.
3. Kalau sesi berikutnya *harus* mengerjakan sesuatu di kode: satu-satunya kandidat yang tidak
   terkunci adalah memperluas gate dari **bentuk** ke **nilai** (ia tidak akan menangkap
   `reason: domain.note` — batas yang dinyatakan #78 dan masih berlaku). Itu pekerjaan baru,
   bukan sisa; jangan mulai tanpa diminta.
