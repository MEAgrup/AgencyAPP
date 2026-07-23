# Runbook UAT — Gate Exit Wave 1 (money-path M0/M1/M4/M5)

> **Tujuan:** membuktikan **satu deal riil end-to-end** melewati seluruh money-path yang kini
> ter-merge di `main` (PR #37 M1 claim + read model · #38 M5 Admin & Finance · #39 M4 Client Record).
> Ini **gerbang manusia** (Build Plan §4 / R5): pilot **Sales + Finance** (didampingi Dev + OD).
> Agent tak boleh menandai gate lolos — keputusan go/no-go Wave 2 ada di pemilik.
>
> **Prasyarat lolos = TIDAK boleh mulai tiket Wave 2** (M6/M12/M7–M10) sebelum runbook ini
> tuntas tanpa temuan blocking. Kegagalan langkah mana pun = **no-go**; catat di `docs/DECISIONS.md`.
>
> Runbook ini menggantikan `W1-20_UAT_RUNBOOK.md` (versi lama, abstrak/pra-implementasi TS).
> Setiap langkah dipetakan ke **endpoint API nyata** (`apps/api/src/app/api/v1/...`), **status persis**
> (`docs/STATE_MACHINES.md`), dan **string BI verbatim** dari kode (`packages/domain/src/*.ts`).

---

## 0. Cara mengeksekusi

Money-path ini adalah route handler Next (`/api/v1/...`) di atas `@cdps/domain`. UAT dapat dijalankan:

- **Via UI** internal (`web-internal`) di layar yang sudah tersedia, **atau**
- **Via API langsung** — satu bearer token per peran (login lokal CDPS), lalu `curl`/Postman ke
  endpoint yang tercantum tiap langkah. Route = shell tipis; kebenaran ada di domain + DB.

Kolom **"Verifikasi"** tiap langkah = kondisi yang HARUS benar (status DB, string BI persis, baris audit).
Setiap string dalam `[...]` di kolom itu adalah **teks BI verbatim** yang harus muncul apa adanya.

**Format uang** di semua tampilan Amount Verified / Outstanding: `Rp. X.XXX.XXX,00`. Pembagian-nol → `—`.

---

## A. Persiapan lingkungan (Dev)

| # | Aktor | Aksi | Verifikasi |
|---|---|---|---|
| A1 | Dev | Staging Postgres: seluruh `supabase/migrations/*.sql` ter-apply berurut. | **53 tabel**; `sm_machines`=14, `notif_events`=15 (katalog FROZEN). |
| A2 | Dev | Sync HRIS riil + `role_mappings` terisi dari divisi/jabatan riil; MSL riil ter-input (versioned) via Master Service admin. | Login tiap peran berhasil (Sales Staff/Head, Finance Staff/Head, Account Staff/Lead, OD, Director). **OD terbukti read-only**; **OD/Director layered** pada satu akun employee. |
| A3 | Dev | (opsional) Muat fixture Alpha Digital `supabase/seed.sql` sebagai sanity end-to-end sebelum deal riil. | Seed idempoten (apply dua kali aman); jumlah baris tetap. |

---

## B. Akuisisi → Closing (M1 §6 + M0)

| # | Aktor | Aksi (endpoint) | Verifikasi (status / BI / audit) |
|---|---|---|---|
| B1 | Sales Staff | Registrasi lead deal UAT — `POST /api/v1/leads`. | `LEAD-YYYYMM-NNNN` **hanya terbit setelah field wajib lengkap**; kontak invalid → `[Kontak salah/tidak valid]`; field wajib kosong → `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`. Registrasi ulang nomor sama → ditolak (collision), audit `register_blocked`. |
| B2 | Sales Staff | (Jika lead dari Marketing pool) klaim — `POST /api/v1/leads/{id}/claim`. | Lead `[Pool]` → attempt `PRSP-` terbit (`New Lead`), audit `claim`. Lead `[Closed-Success]` → `[lead sudah menjadi klien]`. Aktor sudah pegang attempt terbuka → `[anda sudah memiliki prospek aktif untuk lead ini]`. Lead di-scout sales lain → `[lead sedang diproses oleh sales lain (nama)]` + audit `claim_blocked`. Reclaim lead `[Rejected]`/`[Not Qualified]` → reopen `→[Pool]` lalu attach. |
| B3 | Sales Staff | Attempt `New Lead → Contacted` — `POST /api/v1/attempts/{id}/contacted`. | Transisi sah tercatat via `sm_transition`. Transisi di luar tabel diblokir `[transisi status tidak diizinkan]`. Aktor tanpa hak → `[anda tidak memiliki akses untuk melakukan transisi ini]`. |
| B4 | Sales Staff | Submit Qualified Form (identitas, platform, GMV baseline, target, budget, layanan ≤5) — `POST /api/v1/attempts/{id}/qualify`. | Attempt `→ Qualified`. **Estimasi Nilai + Komisi terhitung OTOMATIS** dari versi MSL pada tanggal itu (bandingkan langkah B5). Field wajib kurang → `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`. |
| B5 | Sales Head | **Spot-check komisi** — bandingkan Estimasi Komisi dari B4 vs `GET /api/v1/sales/quote-preview` (kalkulasi MSL) dan MSL manual. | Angka komisi UI **sama persis** dengan preview MSL. Selisih apa pun = temuan blocking. |
| B6 | Sales Staff + Sales Head | Negosiasi bila deal riil punya custom term — `POST /api/v1/attempts/{id}/negotiation` (submit), `.../negotiation/decision` (approve/reject SPV), `.../negotiation/resubmit`, `.../negotiation/accept`. | Proposal **versioned & immutable** (versi naik, tak menimpa); approval SPV wajib untuk custom; notifikasi approval masuk (in-app). |
| B7 | Sales Staff | Closing Form: salespeople ≤5, **alokasi Σ=100%**, Commission PIC + Payment PIC — `POST /api/v1/attempts/{id}/close`. | `CLI-`/`TRX-`/`SVC-`/`INST-` terbit **atomik** (satu transaksi). Σ alokasi ≠ 100% → diblokir `[total alokasi sales harus 100%]`, tanpa ID terbit. TRX lahir status `[Menunggu Verifikasi]` (antrean Finance). Pemenang pool di-resolve; kompetitor lain → `[Closed - Kalah Kompetisi]`. |

---

## C. Client Record → Uang (M4 + M5)

| # | Aktor | Aksi (endpoint) | Verifikasi (status / BI / audit) |
|---|---|---|---|
| C1 | Semua peran | Buka roster — `GET /api/v1/clients`; detail — `GET /api/v1/clients/{id}`. | Client Record mewarisi provenance (identitas Qualified, Sales PIC, Commission & Payment PIC, **Sales Allocation Σ100% read-only**). **Account BELUM melihat klien** (pra-verifikasi). Sales lain tak melihat; anggota alokasi + Sales Lead/OD/Director melihat (visibility §6, RLS-scoped). |
| C2 | Account Lead / OD / Director | Edit profil klien (lock matrix §4) — `PATCH /api/v1/clients/{id}`. | Field per matriks: profil (nama_pic/toko/kota/link/kategori) → Account Lead/OD/Director; `gmv_baseline` → **OD/Director saja**; `target_gmv`/`marketing_budget` → Account/Director; PIC → Sales Lead/Director. Peran tak berhak → `[anda tidak memiliki akses untuk mengubah field ini]`. Field sistem/immutable → `[field ini terkunci dan tidak dapat diubah]`. Tiap edit → audit `client_field_edited` before→after. |
| C3 | Account Lead / OD / Director | Platform List — `POST /api/v1/clients/{id}/platforms`, koreksi/deactivate — `PATCH /api/v1/clients/{id}/platforms/{pid}`. | Add + koreksi store_link/managed_since + **deactivate** (`active:false`, **bukan DELETE**), audited. Baris platform lama tetap ada. |
| C4 | Finance Staff | (Bila skema pra-verifikasi perlu diubah) — `POST /api/v1/transactions/{id}/scheme`. | Ganti scheme + jadwal (INST- baru), alasan wajib, **pra-verifikasi saja**. Setelah ada pembayaran terverifikasi → diblokir (`SchemeLockedError`). Jadwal Σ ≠ total transaksi → `[total termin tidak sama dengan nilai transaksi]`. |
| C5 | Finance Staff | **Verifikasi pembayaran pertama** (nominal, tanggal, link bukti) — `POST /api/v1/transactions/{id}/verify`. | INST → `[Terverifikasi]`; TRX → `[Terverifikasi - Sebagian]`. Amount Verified/Outstanding terformat `Rp. X.XXX.XXX,00` (`GET /api/v1/transactions/{id}/payment`). **Klien rilis ke Account saat itu juga** — audit `released_to_account` mereferensikan verifikasi pemicu (fire-once). **Account kini melihat klien** (ulangi C1 sebagai Account → tampak). |
| C6 | Finance Staff | Verifikasi kedua (parsial berikutnya). | Timestamp `released_to_account` **tidak berubah** (rilis hanya sekali). TRX tetap `[Terverifikasi - Sebagian]` sampai lunas. |
| C7 | Finance Staff | Coba verifikasi **melebihi sisa** transaksi. | Diblokir `[jumlah melebihi total transaksi, periksa kembali]` — **tanpa jejak tertulis** (tak menambah verifikasi). |
| C8 | Finance / Sales | Upload kontrak — `POST /api/v1/transactions/{id}/contract`; lalu verifikasi termin **terakhir** — `POST .../verify`. | Tanpa kontrak, verifikasi penutup diblokir `[kontrak belum diupload, lengkapi sebelum verifikasi penuh]`. Setelah kontrak ada → TRX `[Lunas]` **hanya saat SEMUA INST `[Terverifikasi]`** (§4 Rule 3 / §5). |
| C9 | Finance | Reminder — `GET /api/v1/reminders`; jalankan scan — `POST /api/v1/reminders/scan` (satu termin dibiarkan lewat due date / due date di-set dekat untuk simulasi). | INST overdue → `[Jatuh Tempo]`; label persis `[jatuh tempo X hari, segera tindak lanjuti]` (X = hari nyata). Notifikasi `installment.due` diterima **Commission & Payment PIC + lead Finance** (dual audiens). H-3 upcoming terkirim **sekali** (fire-once, idempoten — scan ulang tak menggandakan). |
| C10 | Finance + kedua SPV | (Opsional, jalur sengketa) flag `[Bermasalah]` — `POST /api/v1/transactions/{id}/bermasalah`; resolusi — `POST .../bermasalah/resolve`. | Flag tak mengubah Payment Status, **klien tak ditarik dari Account**. Resolusi butuh **suara SPV Finance DAN SPV Account** (append-only per-siklus), ATAU **Director** approve. |

---

## D. Komisi, Void, immutability, penutup

| # | Aktor | Aksi (endpoint) | Verifikasi |
|---|---|---|---|
| D1 | Sales Head / Finance | **Cross-check komisi vs MSL** — `GET /api/v1/transactions/{id}/commission`. | Commission achievement = **pro-rata ke Amount Verified** (M0 §5), dipecah per alokasi sales. Cocokkan tiap potongan komisi dengan versi MSL + Σ alokasi = angka commission endpoint. Selisih = temuan. |
| D2 | Account Lead / SPV / Director | (Opsional) Void satu Service — `POST /api/v1/services/{id}/void` (alasan wajib). | Service → `[Cancelled — Service Voided]`; child Briefs bukan-`[Approved]` **cascade** ke voided. **Efek komisi:** total transaksi tetap **immutable**, tapi `commission` (D1) **mengecualikan** service voided — ulang D1 dan pastikan komisi turun sesuai (keputusan pemilik, `docs/DECISIONS.md` 2026-07-23). |
| D3 | OD | Telusuri audit log seluruh perjalanan (lead → claim → qualify → negosiasi → closing → verifikasi → rilis → edit). | Rantai **immutable lengkap** (actor, action, before→after, timestamp). **Tidak ada** jalur UPDATE/DELETE pada history. |
| D4 | Dev | **Recompute dari log:** hitung ulang Amount Verified/Outstanding dari `payment_verifications` dan commission dari log alokasi. | Hasil recompute = nilai yang tampil di UI/endpoint (house rule #4 — derived, recomputable). |
| D5 | Pemilik (Nerissa/Yohan) + Head Dev | **Keputusan go/no-go Wave 2.** | Hasil + seluruh temuan dicatat di `docs/DECISIONS.md` (tanggal, keputusan, alasan, disetujui oleh). Lolos → Wave 2 boleh mulai (M6 Account & Service, M12 early, M7–M10). |

---

## Ringkasan gerbang

- **Lolos** = B1–B7, C1–C9, D1, D3, D4 hijau (C10 & D2 opsional bila deal riil tak menyentuh sengketa/void).
- **No-go** = kegagalan langkah mana pun → catat di `docs/DECISIONS.md`, jangan mulai Wave 2.
- Template hasil: `docs/handoff/WAVE1_EXIT_UAT_REPORT_TEMPLATE.md`.

## Referensi

- State: `docs/STATE_MACHINES.md` §1 (prospect_attempt), §4 (transaction_payment), §5 (installment), §6 (service).
- Keputusan money-path: `docs/DECISIONS.md` (5 entri 2026-07-23).
- Kode: `packages/domain/src/{leads,sales,finance,client}.ts`; route `apps/api/src/app/api/v1/`.
- Konsolidasi kerja: `docs/handoff/HANDOFF_FASE1_SESI12_WAVE1_MONEYPATH.md`.
