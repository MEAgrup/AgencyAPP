# RUNBOOK — Menutup 3 SKIP C-03 dari deployment Vercel

> **Untuk siapa:** pemilik / siapa pun di mesin **ber-akses internet + secret produksi**.
> Claude tidak bisa menjalankan ini (gateway sandbox menolak CONNECT ke `*.vercel.app`;
> nol kredensial live di env) — lihat `HANDOFF_CUTOVER_SESI9.md` §0.2.
>
> **Status per 2026-07-29:** skrip **sudah siap dijalankan terhadap deployment**. Yang tersisa
> murni eksekusi + satu QA UI manual. Sebelum sesi ini skrip **belum** siap — lihat §5.

## 1. Yang ditutup runbook ini

| SKIP (`CUTOVER_UAT_REPORT_20260728.md`) | Isi | Ditutup oleh |
|---|---|---|
| **SKIP-1** | walk house-rules belum dijalankan terhadap Vercel `agency-app-api` | §3 langkah 1 |
| **SKIP-2** | badge notifikasi di FE **ter-deploy** belum pernah dilihat | §4 (QA manual) |
| **SKIP-3** | `auth-smoke`: `/me` cookie valid → 401 | **sudah tertutup di kode** (§5) — tinggal dibuktikan ulang di deployment |

## 2. Yang perlu disiapkan lebih dulu

| Variabel | Dari mana | Wajib? |
|---|---|---|
| `BASE` | URL deployment `agency-app-api` (**bukan** `localhost`) | **ya** |
| `SUPABASE_JWT_SECRET` | env project Vercel — **jangan ditebak**, salin | **ya** |
| `BYPASS` | Vercel → Project → Settings → Deployment Protection → *Protection Bypass for Automation* | hanya bila deployment ter-proteksi |
| `SMOKE_ACTOR_*` | opsional — lihat §3.2 | tidak |

> ⚠️ Bila deployment ber-proteksi dan `BYPASS` **tidak** diisi, Vercel menjawab setiap path
> dengan halaman challenge. Itu terbaca seperti **routing-404** dan akan dilaporkan sebagai
> *path drift* — FAIL palsu di seluruh baris. Isi `BYPASS`, atau matikan proteksi sementara.

## 3. Eksekusi

```bash
git checkout main && git pull origin main
npm ci                                   # ⚠️ WAJIB dari ROOT repo (aturan rumah #6)

export BASE=https://<url-agency-app-api>
export SUPABASE_JWT_SECRET='<secret produksi>'
export BYPASS='<token bypass>'           # kosongkan bila deployment tidak ter-proteksi

node apps/api/scripts/cutover-houserules-walk.mjs   # target 22/22  (lihat §5 — dulu 21)
node apps/api/scripts/wave3-contract-smoke.mjs      # target 34/34
node apps/api/scripts/auth-smoke.mjs                # target 13/13  (SKIP-3 hilang di sini)
```

### 3.1 Baca blok `aktor terpakai` — ini bagian bukti, bukan hiasan

Setiap skrip mencetak dari mana identitas aktornya berasal **sebelum** cek pertama:

```
BASE=https://…
  note: discovery: 69 karyawan aktif, 39 role_mapping
aktor terpakai:
  sales_staff    EMP-202607-0007    Sales/staff          [role-match]  …
  director       EMP-202607-0001    Management/lead  +director  [layered:director]  …
  od             EMP-202607-00xx    …               +od  [synthetic, klaim sintetis]  …
```

| Tanda | Arti | Tindakan |
|---|---|---|
| `discovery: N karyawan aktif` | roster terbaca dari deployment | **yang diharapkan** — N harus ≈ 69 |
| `role-match` / `layered:director` | aktor punya role itu **sebenarnya** | ideal, salin ke report |
| `klaim sintetis` | karyawan ADA, tapi role-nya dipasang oleh skrip | sah untuk menguji gate, **tapi tulis apa adanya di report** — jangan menyiratkan Director resmi yang menjalankannya |
| `discovery gagal … fallback` | roster **tidak** terbaca ⇒ skrip memakai roster seed | 🔴 **STOP.** Hasil tidak sah untuk gate. Cek `SUPABASE_JWT_SECRET`, `BYPASS`, dan bahwa `/admin/employees` hidup |

`od` diperkirakan **`klaim sintetis`** sampai **O26/O34** diputus (belum ada baris OD di
`employee_layered_roles` produksi). Itu bukan kegagalan runbook ini — itu C-04.

### 3.2 Menyematkan aktor tertentu (opsional)

Bila ingin walk memakai orang tertentu (mis. agar cek scope divisi memakai Sales Head sungguhan):

```bash
export SMOKE_ACTOR_SALES_STAFF=EMP-202607-00xx
export SMOKE_ACTOR_SALES_LEAD=EMP-202607-00xx
export SMOKE_ACTOR_ACCOUNT_STAFF=EMP-202607-00xx
export SMOKE_ACTOR_FINANCE_STAFF=EMP-202607-00xx
export SMOKE_ACTOR_DIRECTOR=EMP-202607-00xx
export SMOKE_ACTOR_OD=EMP-202607-00xx
export SMOKE_EMPLOYEE_ID=EMP-202607-00xx   # khusus auth-smoke (satu aktor)
```

Override selalu menang atas discovery. Id yang tidak ada di roster tetap dipakai **tetapi
ditandai** di `note:` — jadi salah tulis tidak lolos diam-diam.

### 3.3 Jejak yang ditinggalkan walk

Walk **menulis**: ia meregistrasi 2 lead throwaway bernama `ZZC03 …` (+ prospect attempt +
baris audit) per run, dan tidak menyentuh baris uang yang bukan miliknya. Baris `audit_log`
**append-only** — tak ada jalur hapus, dan itu memang desainnya (aturan rumah #3). Sepakati
dulu apakah lead `ZZC03` boleh mendarat di produksi; kalau tidak, jalankan walk terhadap
**staging/preview** yang menunjuk DB produksi-mirip, bukan `CDPS SG` live.

## 4. QA manual (SKIP-2 + dua QA UI C-04 yang menggantung)

Di `web-internal` **ter-deploy**, login sebagai role sungguhan:

- [ ] **Badge notifikasi** (SKIP-2) — jumlah unread muncul, klik → tandai terbaca, jumlah turun, refresh tetap konsisten.
- [ ] **`/master-services`** — 32 layanan ber-versi tampil (MSL live sejak 2026-07-28), harga ter-render `Rp. X.XXX.XXX,00`.
- [ ] **`/sales/kalkulator`** — pilih layanan → total & komisi ter-render, **tanpa 500** (C03-F2 dulu 500 di sini karena bigint mentah; regresi ini yang paling mahal kalau kembali).

## 5. Apa yang berubah 2026-07-29 (kenapa target walk 22, bukan 21)

Sebelum sesi ini **skrip belum bisa menutup SKIP-1**, dan itu tidak terlihat dari report:

- `cutover-houserules-walk` menyematkan id **seed** (`EMP-0001`…`EMP-0009`) di source. Tak
  satupun ada di live (69 karyawan). Registrasi lead-nya menulis `sales_pemegang` ⇒ terhadap
  deployment walk gagal di **foreign key**, bukan di house rule. "21/21 dari Vercel" tidak
  mungkin tercapai.
- `auth-smoke` menyematkan `EMP-202607-0001` — kebalikannya, dan itulah **SKIP-3**.

Keduanya satu kelas: **identitas aktor adalah konstanta source, bukan sesuatu yang
diresolusi dari environment yang diuji.** Kini identitas diresolusi (`apps/api/scripts/lib/actors.mjs`,
17 unit test) dan ketiga skrip menerima `BASE` + `BYPASS` dari env secara konsisten.

Sekalian ditemukan: slot `sales_lead` **dideklarasikan lalu tak pernah dipakai**, jadi tingkat
**`lead` (scope divisi)** belum pernah diuji walaupun C-03 mengklaim mencakup Role Matrix.
Ceknya ditambahkan ⇒ **21 → 22**. Keputusan lengkap ada di `docs/DECISIONS.md` (2026-07-29).

**Bukti lokal** (Postgres nyata, 39 migrasi, seed 10 karyawan):
`auth-smoke` **13/13** — SKIP-3 hilang **bahkan di sandbox**, `walk` **22/22**,
`wave3` **34/34**, `@cdps/api` **211** test, typecheck bersih.

## 6. DoD

- [ ] Ketiga skrip hijau **terhadap `BASE` deployment**: 22/22 · 34/34 · 13/13.
- [ ] Blok `aktor terpakai` tiap skrip **disalin ke report** (provenance = syarat reproducible).
- [ ] Tidak ada baris ber-`discovery gagal`.
- [ ] Ketiga checkbox QA §4 tercentang.
- [ ] Report baru `docs/handoff/CUTOVER_UAT_REPORT_<tanggal>.md` — **FAIL = 0 TANPA SKIP**.
      **Jangan menyunting report 2026-07-28**; ia bukti historis.
- [ ] `docs/backlog/CUTOVER_BACKLOG.md` §2 C-03 `[~]` → `[x]`.
