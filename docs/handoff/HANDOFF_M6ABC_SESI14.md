# HANDOFF — M6A/M6B/M6C Sesi 14 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI13 → **SESI14 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | **`claude/handoff-m6abc-sesi13-x4s6p9`** (branch sesi ini) |
| **PR terbuka** | **#115** — https://github.com/MEAgrup/AgencyAPP/pull/115 (base `main`, BELUM merge) |
| **Isi PR #115** | 2 commit: `ff7c697` (X-16/X-17) + `864fee5` (A-11) |

**Dua kemungkinan saat Anda mulai:**

- **Kalau PR #115 SUDAH merge** → mulai bersih dari `main`:
  ```bash
  git fetch origin main && git checkout -B <cabang-baru> origin/main
  ```
- **Kalau PR #115 MASIH terbuka** → lanjutkan di branch yang sama:
  ```bash
  git fetch origin claude/handoff-m6abc-sesi13-x4s6p9
  git checkout claude/handoff-m6abc-sesi13-x4s6p9
  ```
  Jangan buka PR kedua untuk branch ini — dorong commit baru ke branch yang sama,
  PR #115 ikut ter-update.

### 0.1 DB lokal — WAJIB, dan angka test menyesatkan tanpanya

`packages/domain` melaporkan ratusan **skip** kalau `DATABASE_URL` tidak di-set —
itu berarti Anda tidak menguji apa pun yang menyentuh DB. PostgreSQL 16 ada di
sandbox tapi **tidak jalan otomatis** dan **mati sendiri** setelah idle (container
mereklamasinya; ulangi langkah 1 kapan pun `pg_isready` bilang "no response").

```bash
# 1. nyalakan
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"

# 2. HANYA PERTAMA KALI — role postgres tanpa password, koneksi TCP ditolak
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""

# 3. bangun DB dari nol (74 migrasi + seed Alpha Digital + gate + 4 invariant SQL)
npm ci && scripts/db-rebuild.sh --yes

# 4. jalankan
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
cd web-internal && npm ci && npm test && npx tsc --noEmit && npx eslint; echo $?; npm run build
```

`web-internal` **bukan** anggota workspace (root hanya `apps/*` + `packages/*`),
jadi butuh `npm ci` + perintah test sendiri. ⚠️ **Jangan pipe eslint** (`| tail`
membajak exit code — pernah melaporkan "LINT OK" di atas error). Pakai
`npx eslint; echo $?`.

### 0.2 Posisi persis

| | |
|---|---|
| Migrasi | **74** (terakhir `20260809010000_m6a_a11_share_link`) |
| Gerbang tabel | **84** (ci.yml + db-rebuild.sh + `rls_checks.sql` §9) |
| Tes | domain **949** (+11 A-11) · apps/api **340** · core **137** · db **15** · web-internal **191** |
| Live `CDPS SG` | **SINKRON** — A-11 sudah di-`apply_migration`, 84 base tables (lihat §2) |
| Menggantung | Kode: **NOL**. Sub-item M6A: J-4 diff · form Section J · poles HTML klien A-11 |

## 1. Apa yang berubah di sesi ini

Menuntaskan tiga hal yang SESI13 tinggalkan sebagai penghalang, semuanya di PR #115.

### 1.1 X-16 RESOLVED — 6 field §4.1 tak terklasifikasi diberi tier final
`packages/core/src/visibility.ts` + label FE. Ini yang **membuka blokir A-11**
(SESI13 §3.1: halaman klien tak boleh terbit sebelum keenam tier benar). **I-4
tetap hard-internal**, jadi CHECK delapan-ID di migrasi A-10 (SESI13 §1.1) **tidak
berubah** — tak ada `DROP/ADD CONSTRAINT`.

### 1.2 X-17 RESOLVED — `setAssumptionStatus` sekarang bergerbang
SESI13 §4.2: UI menyempit tapi domain tak punya gerbang status sama sekali.
Ditambahkan gerbang server-side + pesan BI.

### 1.3 A-11 SELESAI — tautan klien `/s/{token}` (§7 D20), dan X-06/RA-7 diputus
**X-06 diputus (pemilik, 2026-08-09): tautan = versi aktif saja, tanpa
riwayat/diff.** Yang mendarat:

- **Migrasi `20260809010000`** — `strategi_share_token` (SHA-256 ter-hash, diikat
  `contract_id` → resolusi selalu ke versi `Aktif`, satu Aktif/kontrak lewat
  partial unique index, revocable + expirable) + `strategi_share_access_log`
  (append-only `forbid_mutation`). Gerbang 82→84.
- **Domain** (`packages/domain/src/strategi.ts`): `createShareToken` (rotate mencabut
  yang lama satu-transaksi), `revokeShareToken`, `getShareLinkStatus`,
  `resolveShareLink`. Filter §7 lewat **pintu tunggal `shareableFieldIds()` SEBELUM
  serialisasi**; `clientView()` **aman by-construction** (tiap blok digerbangi
  field-ID-nya ∈ shareable). Draft tak terjangkau; unknown/revoked/expired →
  satu halaman netral.
- **Route**: internal `POST/GET/DELETE /api/v1/strategi/{id}/share-link`; publik
  `apps/api/src/app/s/[token]/route.ts` (service-role, `no-store` + `noindex`).
- **FE**: `web-internal/src/components/strategi/ShareLinkPanel.tsx` — muncul saat
  `Aktif`, token ditampilkan **sekali**.
- **Tes**: 11 test domain A-11; shape-parity + route-parity diperbarui.

Detail keputusan: `docs/DECISIONS.md` 2026-08-09.

## 2. ✅ Live `CDPS SG` (`egddxfcnrtecheiykhlf`) SINKRON

A-11 sudah diterapkan ke live via `apply_migration` (nama
`20260809010000_m6a_a11_share_link`). Diverifikasi: **84 base tables**, keduanya
`strategi_share_token` + `strategi_share_access_log` hadir. Live `strategi` masih
0 baris, jadi tak ada data yang perlu backfill.

## 3. 🔴 TUGAS BERIKUTNYA (urut prioritas)

### 3.1 M6B — mesin eksekusi Plan (chunk TERBESAR yang tersisa)
**M6A tiket tuntas; M6B baru B-00.** Sisa B-01…B-11 adalah bagian terberat M6:
entitas `PLAN` + child tables, periode, distribusi mingguan, realisasi hybrid,
carry-over. Baca `docs/prd/` M6B + `docs/backlog/M6ABC_BACKLOG.md` (baris B-*)
penuh sebelum mulai. Ini kandidat utama sesi berikutnya.

### 3.2 Poles HTML klien A-11 (ditunda sadar)
`clientView()` sekarang merender **subset** aman (Channel B, Tesis E-1, Target D-2,
Asumsi D-8) — kontrak keamanan lengkap & teruji, tapi bukan dokumen 10-seksi
penuh. Kalau perlu render field-demi-field penuh: **tambah blok di `clientView()`,
tiap blok WAJIB digerbangi `shareable.has('<field-id>')`** — itu invarian yang
membuatnya aman. Jangan pernah render dari `detail` tanpa gerbang. Test
`packages/domain/src/strategi.test.ts` blok "A-11" menegakkan: setiap field-ID
yang dirender ∈ shareable, nol hard-internal.

### 3.3 J-4 diff — TIDAK diblokir lagi (tier X-16 sudah final), TAPI baca ini
X-16 memutuskan **J-4 tetap internal**. J-4 auto-diff atas **seluruh** rekaman,
jadi J-4 yang (hipotetis) shareable akan merender perubahan pada field
hard-internal — kebocoran di mana yang dirender adalah J-4, bukan sumbernya.
**Filter §3.2 wajib diterapkan ke isi diff apa pun tier J-4-nya.** Ini tidak
tersirat dari tabel tier; jangan bangun J-4 tanpa filter itu.

### 3.4 Form Section J belum ada
`WIRED` di `page.tsx` berisi A…I. Navigasi mematikan J, jadi J-1 dan J-4 tak punya
pintu. Perbaikannya adalah **form Section J**, bukan jalur navigasi kedua.

## 4. 🟡 Keputusan menunggu pemilik (carry-over)
Kode NOL yang menggantung. Keputusan yang masih terbuka dari rantai sebelumnya:
O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-12. (X-06, X-16, X-17 sudah
ditutup sesi ini — lihat `docs/DECISIONS.md`.)

## 5. Perintah pertama di chat baru
1. Nyalakan DB (§0.1) + `scripts/db-rebuild.sh --yes` → pastikan 84 tabel & 4
   invariant lolos.
2. Cek status PR #115 (merge atau belum) → pilih jalur branch di §0.
3. Baca PRD M6B sebelum menyentuh kode kalau mengambil §3.1.
