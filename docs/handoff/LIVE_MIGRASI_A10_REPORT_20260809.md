# Laporan penyusulan migrasi ke live `CDPS SG` — A-10 bagian 2

**Tanggal:** 2026-08-09 · **Migrasi:** `20260809000000_m6a_a10_visibilitas_field.sql`
**Proyek:** `CDPS SG` (`egddxfcnrtecheiykhlf`, ap-southeast-1) · **Dijalankan lewat:** Supabase MCP `apply_migration`
**Disetujui:** pemilik, 2026-08-09 (rute "saya jalankan lewat Supabase MCP")

## 0. Urutan yang dijalankan

Urutan rumah, tidak diubah: **merge PR dulu → `apply_migration` → verifikasi live ≡ repo lewat ISI.**

1. PR #111 (yang membawa migrasinya) di-merge → `af8813e`
2. PR #112 (A-13d, nol migrasi) di-merge → `66f5710`
3. Baca keadaan live **sebelum** menyentuhnya (§1)
4. Verifikasi prasyarat fungsi ada (§2)
5. `apply_migration` (§3)
6. Sidik jari 12 fakta, live vs lokal (§4)
7. Advisor keamanan (§5)

## 1. Keadaan live SEBELUM

| Fakta | Nilai | Catatan |
|---|---|---|
| `tabel_public` | **81** | repo 82 — selisih tepat satu, yaitu migrasi ini |
| `entity_prefix` | 31 | cocok |
| `sm_machines` | 16 | cocok |
| `notif_events` | 34 | cocok |
| `strategi` (baris) | **0** | ⇒ nol data terdampak, dan nol baris yang bisa ditolak CHECK baru |
| `strategi_field_visibility` ada? | **tidak** | belum pernah dijalankan; `apply_migration` bukan re-run |
| `role_mappings` | 39 | **bukan drift** — gerbang repo (12) mengukur SEED fixture, ini data roster produksi |

## 2. Prasyarat

Migrasi memakai dua objek yang harus sudah ada. Diperiksa lebih dulu supaya tidak ada kegagalan separuh jalan:

| Objek | Ada? |
|---|---|
| `public.set_updated_at()` | ✅ |
| `private.jwt_can_read_strategi(text)` | ✅ |
| `public.strategi` | ✅ |

`jwt_can_read_strategi` ada dalam varian `text` (bukan `varchar`); `strategi_id` bertipe `varchar(32)` dan Postgres meng-cast implisit — sama persis dengan lokal, dan hasilnya terlihat di §4 (`private.jwt_can_read_strategi((strategi_id)::text)`).

## 3. Eksekusi

`apply_migration`, nama `20260809000000_m6a_a10_visibilitas_field` (mengikuti konvensi nama live sejak `20260808020000`: stem berkas repo). Hasil: `success`.

## 4. Sidik jari — live vs lokal, **12 dari 12 identik**

Query yang sama dijalankan di live dan di DB lokal hasil `scripts/db-rebuild.sh`. Dibandingkan lewat **isi**, bukan lewat hitungan — hitungan bisa cocok sementara definisinya berbeda, dan justru definisi CHECK-nya yang jadi separuh invariant beku §7.

| # | Fakta | Live | Lokal | Sama? |
|---|---|---|---|---|
| 1 | `tabel_public` | 82 | 82 | ✅ |
| 2 | Kolom + tipe + nullability (8 kolom) | `strategi_id:character varying:NO, field_id:…:NO, visibilitas:…:NO, diubah_oleh:…:YES, diubah_pada:timestamp with time zone:YES, created_at:…:NO, updated_at:…:NO, created_by:…:NO` | idem | ✅ |
| 3 | `ck_strfv_hard_internal` | `CHECK (((visibilitas)::text = 'Internal Saja') OR ((field_id)::text <> ALL (ARRAY['A-10','D-7','F-5','F-7','H-4','I-4','J-2','J-3'])))` | idem | ✅ |
| 4 | `ck_strfv_visibilitas` | `CHECK ((visibilitas)::text = ANY (ARRAY['Bagikan ke Klien','Internal Saja']))` | idem | ✅ |
| 5 | `ck_strfv_diubah_utuh` | `CHECK ((diubah_oleh IS NULL) = (diubah_pada IS NULL))` | idem | ✅ |
| 6 | `pk_strfv` | `PRIMARY KEY (strategi_id, field_id)` | idem | ✅ |
| 7 | `fk_strfv_strategi` | `FOREIGN KEY (strategi_id) REFERENCES strategi(id) ON DELETE CASCADE` | idem | ✅ |
| 8 | RLS aktif | `true` | `true` | ✅ |
| 9 | Predikat policy | `private.jwt_can_read_strategi((strategi_id)::text)` | idem | ✅ |
| 10 | Trigger non-internal | 1 (`updated_at`) | 1 | ✅ |
| 11 | `anon` boleh SELECT | **false** | false | ✅ |
| 12 | `authenticated` boleh SELECT | true | true | ✅ |

**Fakta #3 adalah yang paling penting untuk diperiksa lewat isi.** Ia separuh DB dari invariant beku §7, dan isinya **delapan** field ID — ketujuh anggota §4.1 plus I-4 (hard-internal sementara, X-16). Sebuah CHECK yang "ada" tapi berisi tujuh akan lolos setiap pemeriksaan berbasis hitungan dan tetap membiarkan I-4 diterbitkan ke klien lewat tulis langsung.

**Fakta #11 juga bukan formalitas.** Tautan klien A-11 (`/s/{token}`) akan dirender server-side dengan filter visibilitas diterapkan SEBELUM serialisasi (§7). `anon` yang bisa membaca tabel ini akan jadi pintu belakang yang membuat seluruh filter itu tidak relevan.

## 5. Advisor keamanan Supabase

Dijalankan sesudah migrasi. **Nol temuan baru.** `strategi_field_visibility` tidak muncul di `rls_enabled_no_policy` karena ia punya RLS **dan** policy.

Sisa daftar seluruhnya pra-ada dan tidak disentuh migrasi ini: 11 tabel registry/konfigurasi ber-RLS tanpa policy (`entity_prefix`, `sm_machines`, `sessions`, …), 3 fungsi `search_path` mutable (`normalize_plan_tier`, `guard_siklus_terkunci`, `guard_floor_disetujui`), dan `auth_leaked_password_protection` yang masih nonaktif.

## 6. Kesimpulan

Live `CDPS SG` **≡ repo** untuk lingkup migrasi ini, diverifikasi lewat isi. Tabel 82. Nol rollback diperlukan, nol data tersentuh.

**Yang perlu diketahui sesi berikutnya:** Strategi yang dibuat sebelum migrasi ini tidak punya baris overlay. Nol Strategi live hari ini, jadi nol yang terdampak — dan seandainya ada, jalur bacanya `overlay[id] ?? defaultVisibility(id)` sudah menanganinya: field tanpa baris jatuh ke default §4.1-nya, bukan ke lubang.
