# `archive/backend-go/` — Go + MySQL, ARSIP READ-ONLY

> **Diarsipkan 2026-09-04 oleh C-05** (`docs/backlog/CUTOVER_BACKLOG.md`), sesudah gate GO
> C-04 diketok. Sebelumnya berkas-berkas ini ada di `backend/` pada akar repo.
>
> **Jangan bangun apa pun di sini.** Ini bukan stack produksi, tidak di-deploy, dan MySQL
> sudah tidak dipakai. Stack CDPS adalah **TypeScript + Supabase/Postgres**
> (`docs/DECISIONS.md` 2026-07-29, "Pensiun Go").

## Kenapa masih disimpan, bukan dihapus

Satu alasan saja: **O47 memutuskan `cmd/import` DITINGGALKAN** — tidak pernah diport ke TS.
Direktori ini karena itu adalah satu-satunya tempat spesifikasi tiga alur klien itu masih
bisa dibaca utuh:

- `cmd/import` → `gen-form`
- `cmd/import` → `clients-dryrun` / `clients-apply`
- `cmd/import` → `dormant-dryrun` / `dormant-apply`

Menghapusnya membuat keputusan O47 tidak bisa dibatalkan. Selama importer mundur belum
pernah dibangun, spesifikasi itu satu-satunya titik awal kalau kelak dibutuhkan.

## Jangkar riwayat

Keadaan terakhir pohon ini **pada jalur aslinya `backend/`** ada di commit **`133f717`**.
Pakai itu kalau perlu membaca repo persis seperti sebelum relokasi:

```
git show 133f717:backend/cmd/import/main.go
git ls-tree -r 133f717 --name-only backend/
```

Tag lokal `backend-go-final` menunjuk commit yang sama. **Tag itu belum ada di remote** —
push-nya diblokir **proxy sesi Claude**, bukan remote — write ke path git-refs/tags tidak diizinkan lewat proxy (dikonfirmasi 2026-09-05; lihat `docs/DECISIONS.md` entri C-05). Commit SHA di
atas adalah jangkar yang sesungguhnya; tag hanya kenyamanan.

## Statusnya sebagai oracle paritas

Untuk **perilaku**, direktori ini masih boleh dibaca sebagai pembanding saat porting (O43).
Untuk **bentuk respons** ia sudah bukan satu-satunya: `apps/api/src/lib/shape-parity.test.ts`
ber-anchor pada tipe FE dan **selamat** dari pengarsipan ini (89 converter,
`NESTED_INLINE_UNCHECKED` kosong).

Job CI `backend` (Go + service MySQL) **sudah dihapus** dari `.github/workflows/ci.yml` oleh
C-05 — kode di sini beku, jadi menjalankannya hanya membuang waktu CI dan bisa merah palsu.

## Config yang sudah mati

`Dockerfile` dan `railway.json` di direktori ini menyasar deployment Railway yang
**dimatikan** sebagai bagian C-05. Keduanya ditandai deprecated, bukan dihapus, supaya
riwayat deployment tetap bisa dibaca.
