# Handoff — M6D (Rekap Hasil Mingguan) SESI 8 — D-09b (API + wire + FE) + D-10 (UI) mendarat

**Tanggal:** 2026-08-14 · **Branch kerja:** `claude/task-9b-10-handoff-6h5u5h`

> Rantai M6D: SESI1 (spec) → … → SESI6 (D-04/D-05) → SESI7 (D-06/D-07/D-08 + D-09 domain)
> → **SESI8 (ini) = D-09b (route API + wire + FE) + D-10 (UI internal)**. Baca SESI7 dulu
> untuk konteks domain D-09. **D-01…D-10 ✅ DONE.** Sisa M6D = **D-11/D-12/D-13** (integrasi
> Health) + **D-14** (M14 disiplin rekap).

---

## 0. Ringkasan sesi ini

1. **D-09b** — 11 route handler + 6 wire konverter + FE data-layer `recap.ts`. Semua gerbang
   parity hijau (`route`/`shape`/`body`), `KNOWN_GAPS` tetap kosong, `recap.ts` masuk `FE_FILES`.
2. **D-10** — halaman detail rekap (`/account/rekap/[id]`) + index per-klien (`/account/rekap`)
   + nav "Rekap Mingguan".
3. **Verifikasi hijau lokal:** `npm run typecheck` bersih; lint bersih (file baru);
   apps/api **338 pass / 7 skip** (18 berkas); web-internal **238 pass** (14 berkas).
4. **Nol migrasi baru, nol event baru** → gate **112/33/21/48 TETAP**. Domain/SQL D-09 tak
   disentuh (murni menambah lapisan HTTP + FE di atasnya).
5. **Keputusan dicatat:** `docs/DECISIONS.md` 2026-08-14 (baris teratas) + backlog D-09b/D-10.

---

## 1. Yang MENDARAT

### D-09b — route API (`apps/api/src/app/api/v1/`)
Pola shell tiap route: `handle(async () => { const actor = requireActor(request); … recap.<fn>(db(), actor, …); return json(<x>ToWire(…)); })`.
- **Reads:** `GET rekap/[id]` (`getRecapDetail`→`recapDetailToWire`), `GET clients/[id]/rekap`
  (`listRecapsForClient`→`{ data: RecapWire[] }`), `GET plan/[id]/rekap-rollup`
  (`getPlanRekapRollup` — passthrough jsonb, **bukan** objek domain camelCase, jadi bukan O43).
- **Writes:** `PUT rekap/[id]/pembuka` (RM-A6), `PUT rekap/[id]/narasi` (RM-D+RM-C9 full-replace),
  `PUT rekap/[id]/metrik/[metrik]` (RM-C manual/`—`), `POST rekap/[id]/metrik/[metrik]/sengketa`,
  `POST rekap/[id]/divisi/[divisi]/sengketa`, `POST rekap/[id]/catatan-divisi` (RM-D6),
  `POST rekap/[id]/close`, `POST rekap/[id]/reopen`.
- Route sengketa balikkan **detail segar** (`getRecapDetail`) karena domain balik `void` → FE render ulang.
- Error taxonomy: recap melempar kelas `account.*` (ValidationError/NotFound/Forbidden/Conflict)
  yang **sudah** dipetakan `http.ts` `mapError` → **tak perlu ubah `http.ts`**.

### D-09b — wire (`apps/api/src/lib/wire.ts`)
6 antarmuka `*Wire` + konverter + 2 `*FromWire` (semua **null eksplisit, bukan omitempty** — O43):
`RecapWire`/`RecapDivisiWire`/`RecapMetrikWire`/`RecapCatatanWire`/`RecapCatatanDivisiWire`/`RecapDetailWire`
(+ `recapNarasiFromWire`, `recapMetrikManualFromWire`). `recap` ditambah ke `import type { … } from '@cdps/domain'`.
Keenam didaftar di `shape-parity.test.ts` `WIRE_TO_FE` (→ `recap.ts::*`), `recap.ts` masuk `FE_FILES`.

### D-09b — FE (`web-internal/src/lib/recap.ts`)
Antarmuka cermin snake_case (kunci **identik** wire↔FE — syarat shape-parity), fungsi `api.*`,
konstanta mesin #18, dan **gerbang UX** (cermin domain): `canManageRecap`/`canWriteDivisiNote`/
`canReopenRecap`/`isReadOnlyRecap`. `PlanRekapRollup` FE-only (tak di-`WIRE_TO_FE` — SQL bangun
jsonb langsung, tak ada konverter, jadi shape-parity tak menuntutnya).

### D-10 — UI (`web-internal/src/app/(shell)/account/rekap/`)
- `[id]/page.tsx` — detail: header (status + `pernah_ditutup_otomatis` badge), **Tutup Rekap**
  (Terbuka+manage), **Buka Kembali** (Ditutup Otomatis+`canReopenRecap`, alasan via prompt),
  Catatan Pembuka, tabel Produksi Divisi (+sengketa), tabel Metrik (+sengketa auto, +form manual
  `total_view`/`ctr`/`cvr` isi-atau-`—`), Narasi (5 field), Catatan Divisi (append-only + form
  per divisi yang boleh), Rollup RM-E read-only bila `plan_id` (degradasi diam bila gagal — O52).
- `page.tsx` — index per-klien via `?clientId=` (Suspense utk `useSearchParams`).
- Nav item "Rekap Mingguan" (`ownedBy(ACCOUNT)`) di `DELIVERY_LINKS`.

---

## 2. Titik mulai sesi berikutnya — **D-11 → D-13** (integrasi Health), lalu **D-14**

- **D-11** — 4 blok read-only ke `web-internal/src/app/(shell)/health/[clientId]`: **H-1** hasil &
  progress mingguan (pakai `getRecapDetail` + `getPlanRekapRollup` yang **sudah** ada dari D-09b),
  **H-2** status laporan (freshness, AM-closed vs `Ditutup Otomatis`, `Sengketa Angka` terbuka),
  **H-3** komplain aktif (`listClientComplaints`, sudah ada `account.ts:2247`), **H-4** verdict
  Interview (advisory). **Skor M13 TIDAK disentuh** (nol perubahan `health.ts` scoring). **Dua GMV
  wajib label beda:** `GMV Growth` (M4) vs `GMV Eksekusi (interim)` (M6D). Idem ROAS.
- **D-12** — portfolio landing `health/page.tsx`: tabel per klien aktif + freshness rekap. Butuh
  endpoint list (belum ada — `health.ts` hanya per-klien + scan). **Jangan lebarkan RLS tanpa entri O48.**
- **D-13** — degradasi per-blok (O52): tiap blok absen (bukan error) bila aktor tak berhak (H-4 lebih sempit).
- **D-14** — M14 komponen Disiplin Rekap (bobot AM 45/22.5/22.5/10; divisi +5%). M6D menyuplai
  sinyal mentah: status tutup + `pernah_ditutup_otomatis` + ada/tidak catatan divisi.

**Guardrail utama:** GMV single-source (rekap **tak pernah** tulis M6B PE-1 — D-08 patuh).

---

## 3. Ranjau repo (tetap + BARU dari D-09b/D-10)

- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration` (O38). DB rebuild HANYA
  `scripts/db-rebuild.sh`. **Sesi ini nol migrasi** → gate 112/33/21/48 tak berubah.
- **BARU (D-09b) reads pakai `db()` + gerbang TS, BUKAN `readAsActor`.** Fungsi `recap` reads
  menggerbang di TS (`canReadRecap`) & baca sub-tabel (`clients`, `wrr_divisi`); di bawah RLS
  (`readAsActor`) sub-baca itu bisa mem-blank spurious → gate gagal palsu. Preseden = route `strategi`
  GET yang juga `db()`. RLS = dinding kedua utk jalur `withClaims`/tes domain, bukan route.
- **BARU (D-09b) sengketa route balikkan detail segar** (domain balik `void`). Jangan asumsikan
  route write selalu balik entitas tunggal.
- **BARU (D-09b) base API = `/rekap`**, tapi **deep-link FE = `/account/rekap/{id}`** (path halaman,
  bukan API). Notif domain pakai `deepLink: '/account/rekap/{id}'` (SESI7) — cocok ke halaman D-10.
- **BARU (shape-parity) kunci wire↔FE wajib IDENTIK.** Tiap `*Wire` di `wire.ts` **wajib** ada di
  `WIRE_TO_FE` + antarmuka FE dgn kunci sama persis (tes "covers every wire interface" + "emits every
  key"/"no key outside"). `rincian: Record<string, unknown>` & skalar tak diikuti (aman). Nested wajib
  antarmuka bernama di dua sisi (RecapDetail→Recap/Divisi/Metrik/Catatan/CatatanDivisi sudah).
- **BARU (route-parity) tiap `api.*` di FE wajib dilayani.** `recap.ts` FE bikin 13 panggilan — semua
  punya route. `KNOWN_GAPS` tetap **kosong**.
- Wire snake_case: route kirim objek domain camelCase mentah = O43. `null` eksplisit, bukan omitempty.
- **(D-09 masih) tulis lewat `db()` = RLS bypass (O37)** — larangan clobber otomatis ditegakkan di TS
  (`recordRecapMetrikManual`), bukan belt.
- `backend/**` read-only (Go+MySQL pensiun).

---

## 4. Lingkungan dev lokal
- Install: **`npm ci`** (npm workspaces, BUKAN pnpm) — **wajib dulu**, node_modules tak ter-commit.
- Typecheck: `npm run -s typecheck` (root, mencakup semua workspace).
- Tes cepat (tanpa DB): `cd apps/api && npx vitest run` (338/7skip) ·
  `cd web-internal && npx vitest run` (238).
- Lint: `cd web-internal && npx eslint <path>` / `cd apps/api && npx eslint <path>`.
- Tes DB (opsional, domain tak berubah sesi ini): lihat SESI7 §4 (Postgres 16 + `db-rebuild.sh`).
  Suite `recap.*.test.ts` skip tanpa `DATABASE_URL`.
- **⚠️ Flake pra-ada (BUKAN M6D):** `interview.test.ts` "counts WORKING days … national holiday" &
  `admin.test.ts` "hari libur" — bergantung tanggal/DB persisten; hijau di DB segar. Di luar rekap.

---

## 5. Sumber kebenaran
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` (§4 Rule 6/7/8, §5 RM-E, §6 flow, §9 katalog).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-10 ✅ DONE; sisa D-11/D-12/D-13/D-14).
- `docs/DECISIONS.md` 2026-08-14 (D-09b+D-10) & 2026-08-13 (D-06…D-09).
- Kode: `apps/api/src/app/api/v1/rekap/**` + `clients/[id]/rekap` + `plan/[id]/rekap-rollup`;
  `apps/api/src/lib/wire.ts` (`recap*`); `apps/api/src/lib/shape-parity.test.ts` (`WIRE_TO_FE`/`FE_FILES`);
  `web-internal/src/lib/recap.ts`; `web-internal/src/app/(shell)/account/rekap/**`; `web-internal/src/lib/nav.ts`.
