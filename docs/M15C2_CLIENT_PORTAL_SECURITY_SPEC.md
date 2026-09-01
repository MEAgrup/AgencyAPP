# CDPS — M15-C2 Client Portal: Security Spec (RESOLVED)

**Status:** **RESOLVED — O4 dan O5 CLOSED 2026-08-31** (`docs/DECISIONS.md`, entri 2026-08-31 "M15-C2 O4+O5 resolved"). Sembilan dari sepuluh Open Question §7 draft asli sudah dijawab pemilik (dua putaran `AskUserQuestion`, pola identik LT-61) dan sudah dilipat ke dalam dokumen ini — satu sisanya (OQ-8, token pass-through embed) tetap terbuka sebagai detail teknis klaster embed, bukan blocker M15-C2 (lihat §6, §7). §3 (autentikasi) direvisi total dari pola `backend/internal/auth/local.go` (Go, sudah dipensiunkan) ke pola realm auth non-HRIS **LT-61 vendor** (`supabase/migrations/20260903010000_lt61_vendor_auth.sql`) — preseden CDPS pertama yang SUNGGUHAN dibangun di stack TS/Supabase saat ini. Dokumen ini sekarang adalah **spec final** untuk implementasi M15-C2 (Rules → Flow → Example → System Requirements → PR kecil per klaster, pola sama seperti M15-C1).

**Tanggal draft asli:** 2026-07-20. **Tanggal revisi/closing:** 2026-08-31.
**Penulis:** Orchestrator (Fable) + eksekutor Sonnet, sesi 2026-07-20 (draft); Sonnet, sesi 2026-08-31 (revisi + closing O4/O5).
**Disetujui oleh:** Pemilik produk, via `AskUserQuestion` sesi 2026-08-31 (dua putaran — lihat §7 untuk jawaban per OQ).
**Prasyarat untuk:** M15-C2 boleh mulai dikoding — closing O4+O5 di sini ADALAH keputusan manusia yang dimaksud entri 2026-07-18 (bukan langkah otomatis terpisah; jawaban pemilik atas §7 sesi ini yang menutupnya).

**Dibaca bersama:**
- `CLAUDE.md` — `web-client-portal` = **separate auth realm**, strict allow-list data layer, never a permission-trimmed internal view.
- `docs/prd/CDPS_Phase0_Foundation_v2.md` §11 — baseline keamanan minimum (dikutip penuh di §1 di bawah).
- `docs/prd/CDPS_Module15_Client_Team_Portal.md` §2, §6.1 — surface data Client Portal (C2).
- `docs/DECISIONS.md` — entri 2026-07-18 (penundaan M15-C2), entri 2026-08-31 (O4/O5 resolved, jawaban §7), dan entri 2026-08-30 (LT-61, preseden realm auth non-HRIS yang ditiru §3).
- `supabase/migrations/20260903010000_lt61_vendor_auth.sql` + `packages/core/src/permission.ts` (`isVendorActor`/`actorFromVendorClaims`) — pola realm auth non-HRIS TS/Supabase yang **ditiru langsung** untuk Client Portal (lihat §3), menggantikan rujukan `backend/internal/auth/local.go` yang sudah pensiun di draft asli.

---

## 1. Baseline wajib dari Phase 0 v2 §11 (dikutip penuh)

> Module 15's Client Portal is the only **external-facing** surface. Before it is built (Wave 3), a short security spec must cover, at minimum: a separate auth realm for client contacts (never mixed into the HRIS employee sync), per-Client data isolation enforced at the query layer (strict allow-list per Module 15 §6.1 — not permission-trimmed internal views), rate limiting on login and the complaint form, session expiry, and per-contact action audit. Internal Team Portal reuses the standard HRIS-backed auth (§8).

Lima butir wajib dari kutipan ini (checklist yang harus dipenuhi spec ini, §2–§5):

1. **Separate auth realm** untuk kontak klien — tidak pernah bercampur dengan sinkronisasi karyawan HRIS.
2. **Isolasi data per-Client di query layer** — allow-list ketat sesuai M15 §6.1, bukan view internal yang dipangkas hak aksesnya.
3. **Rate limiting** pada login dan form komplain.
4. **Session expiry.**
5. **Audit per-aksi-kontak.**

Catatan: kalimat terakhir kutipan ("Internal Team Portal reuses the standard HRIS-backed auth §8") sudah **usang** — keputusan 2026-07-19 (`AUTH DIREDESAIN`) memindahkan auth internal sepenuhnya lokal (bukan lagi HRIS-backed; HRIS kini murni sumber data karyawan). Ini tidak mengubah §11 secara substansi (Client Portal tetap wajib realm terpisah dari realm karyawan manapun — lokal atau HRIS-backed), tapi memengaruhi seberapa jauh pola auth internal bisa dicontoh mentah-mentah untuk realm eksternal — lihat §3.

---

## 2. Ancaman & Prinsip

### 2.1 Model ancaman
Client Portal adalah **satu-satunya permukaan yang menghadap publik** di seluruh CDPS. Konsekuensinya berbeda kelas dari seluruh 15 module lain yang hidup di belakang login karyawan:

- **Akun kontak klien bukan akun terverifikasi HR** — tidak ada proses onboarding karyawan, tidak ada NIK, tidak ada deaktivasi otomatis via sync HRIS. Provisioning dan pencabutan akses sepenuhnya tanggung jawab CDPS/AM.
- **Enumerasi akun & credential stuffing** dari internet terbuka — bukan hanya dari jaringan kantor.
- **Cross-tenant data leakage** — satu klien tidak boleh, dengan cara apa pun (IDOR, query yang salah scope, cache, race condition), melihat data klien lain.
- **Over-exposure lewat "kemudahan reuse"** — risiko terbesar secara arsitektur: membangun Portal sebagai versi "read-only" dari Module 11 Client Board (internal) lalu memangkas field di frontend. CLAUDE.md dan M15 §6.1 sama-sama melarang ini secara eksplisit.
- **Form komplain publik sebagai vektor spam/DoS** — satu-satunya endpoint tulis di realm ini, satu-satunya jalur upload attachment.
- **Embed report** (`mea-client-reporting`) sebagai vektor clickjacking/XSS lintas-origin bila salah konfigurasi (lihat §6).

### 2.2 Prinsip desain (non-negotiable, dari CLAUDE.md + Phase 0 §11 + M15 §6.1)

1. **Strict allow-list, bukan permission-trimmed view.** Endpoint Portal HANYA membaca dari **read-model khusus Portal** (proyeksi eksplisit dari data internal, dibangun untuk Portal) — bukan endpoint internal Module 11 dengan role klien yang "dikecilkan" hak aksesnya. Kode-nya secara arsitektur harus terlihat: Portal handler tidak boleh punya jalur reuse langsung ke query internal yang mengembalikan field mentah, hanya lewat proyeksi allow-list (§4.2).
2. **Separate auth realm.** Tabel kredensial/sesi klien **terpisah total** dari `employee_credentials`/`sessions` milik karyawan (pola yang sama seperti `employee_credentials` dipisah dari `employees` — lihat DECISIONS 2026-07-19 — tapi ini adalah dua realm berbeda, bukan satu tabel yang di-share). Klien BUKAN employee; tidak boleh ada baris klien yang bisa "menembus" ke sesi/role karyawan lewat jalur mana pun.
3. **Tenant isolation per Client.** Setiap query Portal WAJIB terikat `client_id` dari sesi yang sedang login — tidak ada endpoint Portal yang menerima `client_id` sebagai parameter yang dipercaya dari request tanpa diverifikasi ulang terhadap sesi.
4. **Least surface.** Kalau PRD tidak eksplisit mengizinkan sebuah field/entitas keluar ke Portal, defaultnya TIDAK keluar — ambigu berarti STOP dan tulis sebagai open question (§7), bukan pilih sendiri.

---

## 3. Autentikasi Klien

**Pola dasar: realm Supabase Auth kedua, meniru LT-61 vendor (bukan `local.go` Go yang sudah pensiun).** LT-61 membuktikan bentuknya: satu tabel link "internal murni" (RLS on, nol policy, nol grant selain lewat fungsi SECURITY DEFINER) menghubungkan satu Supabase Auth user ke satu baris domain; `*_claims(uuid)` resolver + cabang baru di `custom_access_token_hook` yang mengembalikan NULL diam-diam untuk user tak-cocok (tidak mengganggu cabang employee/vendor yang sudah ada); `jwt_*_id()` helper RLS. Client Portal adalah realm non-HRIS **ketiga** dengan bentuk yang sama, skala lebih besar (banyak kontak per Client, bukan satu vendor per akun).

### 3.1 Model data ↔ Client (OQ-1 RESOLVED)
**Keputusan pemilik (2026-08-31): satu kontak klien = tepat satu Client, selamanya.** Tidak ada kasus "satu kontak, banyak Client" yang perlu didukung v1. Konsekuensi skema: `client_contacts.client_id` adalah kolom FK tetap (bukan tabel junction, bukan selector "ganti Client aktif" di UI) — persis pola `vendor_accounts.vendor_id` LT-61 (satu FK tetap, bukan N:M).

```sql
CREATE TABLE client_contacts (
    auth_user_id uuid         NOT NULL PRIMARY KEY,
    client_id    varchar(32)  NOT NULL REFERENCES clients (id),
    nama         varchar(255) NOT NULL,
    email        varchar(255) NOT NULL,
    status_aktif boolean      NOT NULL DEFAULT true,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL
);
```
(Bentuk indikatif untuk implementasi — nama kolom final ditentukan saat migrasi ditulis, konsisten konvensi snake_case DB.)

### 3.2 Provisioning (OQ-4 RESOLVED)
**Keputusan pemilik (2026-08-31): AM (Client miliknya sendiri) + Account lead/Director (Client mana pun).** Gate meniru bentuk `canManageVendor` LT-61 persis, diselaraskan ke scope Account:
- Tidak ada self-registrasi. AM/Account lead/Director **mengundang** kontak klien dengan nama + email → baris `client_contacts` dibuat berstatus belum aktif.
- Provisioning menghasilkan **password sementara** (`must_change_password=1`, pola `import_employee_credentials`/`provision_vendor_account` — termasuk fix `email_change=''` yang sudah ditambal untuk kedua fungsi itu, WAJIB direplikasi di sini, bukan diulang lagi latennya) — jalur admin-set selalu ada terlepas dari email (§3.3).
- Kontak WAJIB ganti password sebelum mengakses surface lain (gate `must_change_password`, pola identik internal/vendor).
- Kontak dapat **dinonaktifkan** oleh AM (Client sendiri)/Account lead/Director (bukan dihapus — riwayat komplain yang sudah mereka submit tetap immutable & atributed ke ID kontak, house convention #3), pola `set_vendor_account_status`.

### 3.3 Reset password (OQ-2 RESOLVED — DUA jalur, bukan salah satu)
**Keputusan pemilik (2026-08-31): keduanya didukung**, bukan salah satu:
1. **Admin/AM-set** — pola identik provisioning (§3.2): AM (Client sendiri)/Account lead/Director men-set password sementara baru untuk kontak yang terkunci/lupa password, `must_change_password=1` lagi. Jalur ini SELALU tersedia (nol dependensi email), dan satu-satunya jalur untuk kontak yang emailnya sendiri tidak lagi bisa diakses.
2. **Self-service email** — kontak meminta link reset dikirim ke email terdaftar. Ini permukaan BARU untuk CDPS (belum ada jalur pengiriman email sebelumnya di codebase manapun) — pakai kapabilitas bawaan Supabase Auth (GoTrue `recover`/reset-password endpoint + SMTP terkonfigurasi di project Supabase `CDPS SG`), bukan sistem email custom. Implikasi implementasi (dicatat, bukan dikarang di sini — detail teknis SMTP/template masuk klaster kerja tersendiri): butuh SMTP provider dikonfigurasi di Supabase project settings, template email di-review sebelum go-live (Bahasa Indonesia, bukan default Inggris GoTrue), dan endpoint recover Supabase Auth sudah rate-limited bawaan olehnya (di luar §5.2 app-level).
- Non-disclosure tetap berlaku pada kedua jalur (§5.3) — permintaan reset untuk email yang tidak terdaftar sebagai kontak aktif TIDAK membocorkan keberadaannya (Supabase Auth `recover` sudah generik secara default; jalur admin-set tinggal AM tidak pernah diberi tahu "email tidak ditemukan" secara berbeda dari "berhasil dikirim").

### 3.4 Kebijakan password & lockout (OQ-10 RESOLVED — identik realm karyawan/vendor, DIKOREKSI saat implementasi)
**Keputusan pemilik (2026-08-31): reuse persis, tanpa pengetatan khusus.** Ditemukan saat implementasi (klaster auth, sesi yang sama): "reuse persis" untuk **lockout** ternyata berarti **TIDAK ADA lockout kustom sama sekali** — draft OQ-10 semula menulis "5x/15menit" berdasarkan pola pra-migrasi-Supabase yang sudah tidak berlaku. `packages/domain/src/auth.ts` (realm karyawan) mendokumentasikan eksplisit: sejak login pindah ke Supabase Auth (GoTrue), lockout **sengaja tidak di-port** — GoTrue sendiri yang memegang rate limiting login, dan lockout kustom kedua "hanya akan memberi rasa aman palsu". Kolom `employee_credentials.failed_attempts`/`locked_until` adalah sisa tabel transit pra-GoTrue, tidak lagi dibaca jalur login manapun. **Client Portal mengikuti arsitektur yang sungguhan berlaku sekarang**, bukan draft yang sudah usang — lihat `DECISIONS.md` 2026-08-31 (entri klaster auth) untuk detail temuan.

| Parameter | Nilai (sama seluruh realm — karyawan, vendor, Portal) |
|---|---|
| Panjang password | Min 8 karakter, max 72 byte (batas bcrypt) |
| Hash | bcrypt DefaultCost (via Supabase Auth GoTrue, bukan implementasi custom) |
| Lockout | **Tidak ada tabel/counter kustom** — GoTrue yang memegang rate limiting login, identik realm karyawan/vendor |
| Enumerasi akun | `[email atau password salah]` generik — kontak nonaktif dianggap sama dengan email tidak ditemukan (§5.3) |

Pertahanan tambahan untuk permukaan publik BUKAN lewat lockout kustom, melainkan lewat rate limit per-IP terpisah di depan login (§5.2, OQ-5) — **DIBANGUN** sebagai follow-up 2026-08-31 (lihat §5.2 untuk detail penerapan seragam lintas-realm), di atas baseline bawaan GoTrue.

### 3.5 Sesi (OQ-3 RESOLVED — 4 jam idle)
**Keputusan pemilik (2026-08-31): 4 jam idle timeout** (bukan default GoTrue sepanjang hari seperti realm karyawan/vendor — Portal adalah realm satu-satunya yang menghadap publik, jadi mendapat kebijakan TTL sendiri, bukan reuse).
- Realm terpisah total dari sesi karyawan/vendor by construction (Supabase Auth user berbeda, `client_contacts` bukan `employees`/`vendor_accounts`) — tidak ada cookie/token yang bisa "menembus" ke realm lain.
- Idle timeout 4 jam berarti sesi Portal butuh mekanisme refresh/expiry yang lebih pendek dari default project — diimplementasikan di lapisan `web-client-portal` (cek `last_activity` per request/refresh token TTL custom untuk realm ini), bukan mengubah TTL project Supabase secara global (yang akan ikut memendekkan sesi karyawan/vendor).
- Ganti password → revoke semua sesi LAIN milik kontak yang sama; admin menonaktifkan kontak → revoke SEMUA sesi kontak itu (pola `set_vendor_account_status` yang men-nonaktifkan; mekanisme revoke sesi Supabase Auth per-user).

### 3.6 Force-change
Force-change pada login pertama (password sementara dari §3.2/§3.3 jalur admin-set): pola identik internal/vendor — `must_change_password` gate blocking semua surface lain sebelum ganti password.

---

## 4. Otorisasi & Isolasi Data

### 4.1 Model akun ↔ Client (OQ-1 RESOLVED — lihat §3.1)
M15 §6.1 mengonfirmasi: **multi-contact per Client** — beberapa kontak bernama per Client, masing-masing login sendiri, semua melihat scoped view yang **identik** (tidak ada tiering internal antar-kontak di v1; lihat M15 Rule 1 & contoh Alpha Digital §5 — dua kontak sama-sama melihat Service Progress & Health Summary yang sama, bukan subset personal).

Arah sebaliknya (satu kontak, banyak Client) **diputuskan pemilik tidak berlaku** (§3.1): `client_contacts.client_id` adalah FK tetap satu-ke-satu, bukan N:M — skema paling sederhana yang konsisten dengan seluruh narasi M15 §2/§4/§6.1 ("satu Client, banyak kontak").

### 4.2 Allow-list field per surface (dari M15 §2, §6.1 — bukan tabel baru, transkripsi eksplisit dari PRD)

| Entitas/Surface (internal) | Field yang BOLEH keluar ke Portal | Field yang TIDAK BOLEH keluar |
|---|---|---|
| **Service Progress** (dari Module 11 Universal Column, per SVC aktif) | Nama/label Service (client-friendly); status **hasil relabeling tetap** — Queued / In Production / Finalizing / In Review / Completed (M15 §2 Rule 2, tabel lookup tetap) | Nama status internal asli (To Do/In Progress/Awaiting Review/Blocked-Revision/Done); `BRF-`/`AST-`/`BKG-`/task ID apa pun; siapa PIC-nya; SLA/timestamp internal |
| **Embedded Report** | Output `mea-client-reporting` yang memang ditujukan untuk Client (template existing) | — (surface ini didefinisikan oleh sistem laporan yang sudah ada, bukan field baru; lihat §6 untuk mekanisme render) |
| **Health Summary** | HANYA label band: "On Track" / "Needs Attention" / "Action Needed" (M15 §2 Rule 4) | Skor numerik 0–100 mentah maupun capped; breakdown per komponen (Revision Burden, Complaints, dll.); formula/bobot apa pun |
| **Complaint form (submit)** | Field TULIS: deskripsi, attachment opsional, severity tag pilihan-klien opsional (M15 §6.1) → membuat `CPL-` `source=Client Portal` + `submitting_contact_id` | Tidak ada field BACA di surface ini — M15 Rule 6 confirmed: **submit-only**, tidak ada log komplain personal yang ditampilkan ke klien |
| **Larangan lintas-surface eksplisit** (M15 §2 Rule 7, "Explicit exclusion list") | — | **Seluruh** detail Transaction/payment admin, termasuk status invoice/pembayaran milik Client sendiri (lihat **OQ-6, RESOLVED** — pemilik memutuskan 2026-08-31: klausa pengecualian M15 Rule 7 dibaca sebagai frasa sisa, BUKAN fitur nyata; Portal v1 TIDAK menampilkan surface invoice/payment sama sekali — tidak dirancang di Rule/Flow M15 manapun, sengaja tidak ditambahkan); nama staf/workload staf; data Team Performance (M14); `BRF-`/`AST-`/`BKG-`/task ID internal; data Client LAIN mana pun |

**Larangan mutlak (ulang, eksplisit dari M15 §2 Rule 7 + prinsip §2.2 di atas):** komisi, skor performa tim (individu maupun rollup), audit log internal (Module log operasional, bukan audit-per-kontak milik Portal sendiri — lihat §5.1), dan data Client lain dalam bentuk apa pun (termasuk agregat lintas-klien apa pun — Management Dashboard M15 §6.3 adalah surface **internal-only**, Director/OD, dan TIDAK PERNAH punya padanan di Client Portal).

### 4.3 Isolasi teknis
- Setiap query read-model Portal WAJIB `WHERE client_id = :session_client_id` (atau setara) — tidak ada endpoint yang menerima `client_id` sebagai parameter permintaan yang dipercaya mentah-mentah dari client-side; ID di request (kalau ada) harus divalidasi SAMA DENGAN `client_id` yang terikat sesi, bukan dipakai sebagai sumber kebenaran.
- Read-model Portal idealnya berupa **modul domain terpisah** (mis. `packages/domain/src/client-portal.ts`, mirror pola `packages/domain/src/portal.ts` yang sudah ada untuk Team Portal internal) yang TIDAK mengimpor query internal Module 11 secara langsung — hanya lewat fungsi proyeksi allow-list yang eksplisit mengembalikan DTO terbatas (bukan objek domain penuh yang lalu di-serialize sebagian), dijaga `apps/api/src/lib/wire.ts` untuk terjemahan camelCase↔snake_case (CLAUDE.md).

---

## 5. Audit & Rate Limiting

### 5.1 Audit per-aksi-kontak
- Setiap login (sukses/gagal), setiap akses Service Progress/Report/Health Summary (view-level, bukan hanya submit), dan setiap submit komplain **WAJIB tercatat append-only**, actor = ID kontak spesifik (bukan Client ID saja) — M15 §2 Rule 1 eksplisit: "each contact's own actions... are still individually logged for audit" (contoh: siapa dari Alpha Digital yang submit komplain).
- Pola immutability sama dengan seluruh sistem (CLAUDE.md #3): tidak ada UPDATE/DELETE pada baris audit Portal; entity_type baru diusulkan mis. `client_contact` / `client_contact_session`, mirror pola `employee_credential` di audit log internal.
- Log akses (bukan hanya aksi tulis) bernilai forensik tinggi di realm publik — kalau terjadi kebocoran, tim harus bisa menjawab "kontak mana yang mengakses apa, kapan" tanpa harus merekonstruksi dari log server mentah.

### 5.2 Rate limiting (OQ-5 RESOLVED — login DIBANGUN 2026-08-31 follow-up; form komplain masih menunggu klasternya)
**Keputusan pemilik (2026-08-31): pakai angka default yang wajar sekarang**, ditegakkan di lapisan app/DB (proyek belum punya WAF/infra jaringan) — disesuaikan lagi nanti dari data trafik nyata, bukan dikunci permanen.
- **Login** — **DIBANGUN** (migrasi `20260906010000_login_rate_limit.sql`, DECISIONS.md O64 closed sama tanggal): **maksimal 10 percobaan per-IP per-15 menit**, ditegakkan `packages/domain/src/auth.ts` `enforceLoginRateLimit` + `apps/api` `POST /auth/login`. **Diterapkan SERAGAM ke ketiga realm** (employee/vendor/client-contact), bukan Portal-only — `/auth/login` satu endpoint bersama yang baru tahu realm mana SETELAH GoTrue autentikasi, jadi tidak bisa digerbang per-realm sebelum itu; owner memilih opsi ini lewat `AskUserQuestion` (dua pilihan: origin-header check yang lebih sempit tapi mudah dipalsukan, vs seragam yang lebih kokoh tapi lebih lebar dari cakupan literal OQ-5 — seragam dipilih). Tanpa lockout per-akun kustom sebagai lapisan lain (§3.4, dikoreksi — GoTrue yang memegang itu); baseline tambahan di ATAS proteksi bawaan GoTrue, bukan pengganti.
- **Form komplain** — endpoint tulis satu-satunya di realm ini: **maksimal 5 submit per-kontak per-jam** DAN **maksimal 20 submit per-IP per-jam**, plus validasi ukuran/tipe attachment (detail teknis attachment belum di-scope PRD — dicatat, bukan diasumsikan). Diimplementasikan bersamaan klaster complaint form (belum dibangun).
- Kedua ambang di atas adalah **starting point**, bukan angka final selamanya — revisi berikutnya (naik/turun) cukup lewat entri `DECISIONS.md` baru begitu ada data trafik nyata, tidak perlu putaran Open Question lagi.

### 5.3 Non-disclosure keberadaan akun
- Pesan login gagal **generik**, tidak membedakan "email tidak terdaftar" vs "password salah" vs "kontak dinonaktifkan" — pola identik `[email atau password salah]` internal. String BI final untuk realm Portal (termasuk apakah reuse string yang sama persis atau string baru khusus Portal) **diotorisasi via DECISIONS saat implementasi** — tidak dikarang di draft ini.
- Endpoint provisioning/invite tidak boleh membocorkan keberadaan email yang sudah terdaftar sebagai kontak Client lain (mencegah enumerasi lintas-tenant).

---

## 6. Embed (O4 RESOLVED — Opsi A dikonfirmasi)

M15 §6.1 sudah confirmed secara PRODUK bahwa laporan **native embedded**, bukan link-out (M15 §7 item 3, "Reports: link-out vs embed → Confirmed: Natively embedded"). **O4 (cek teknis embeddability) RESOLVED 2026-08-31** — pemilik mengonfirmasi `mea-client-reporting` embeddable (dijawab langsung, tanpa perlu sesi ini melakukan probe header `X-Frame-Options`/CSP sendiri — sesi ini tidak punya URL/akses ke sistem tersebut). **Opsi A di bawah adalah arah final** untuk implementasi; Opsi B tetap didokumentasikan sebagai fallback tercatat (Build Plan §R2) bila implementasi nyata nanti menemukan kendala teknis yang tidak terlihat dari jawaban ini — bukan opsi yang masih terbuka untuk dipilih sepihak.

**Catatan sisa: OQ-8 (mekanisme token pass-through) BELUM terjawab** — bergantung pada arsitektur/API `mea-client-reporting` yang berada di luar scope repo ini; ini detail implementasi klaster embed itu sendiri (butuh koordinasi dengan pemilik sistem tersebut saat klaster itu dikerjakan), bukan blocker untuk klaster lain (auth, read-model Service Progress/Health, complaint form) mulai dikerjakan lebih dulu.

### Opsi A — Embed native (dikonfirmasi, M15 §6.1 + O4 2026-08-31)
- Mekanisme: `<iframe>` (atau setara) yang me-render output `mea-client-reporting` di dalam frame Portal.
- **Prasyarat teknis (O4):** `mea-client-reporting` harus mengizinkan embedding — server laporan itu wajib TIDAK mengirim `X-Frame-Options: DENY`/`SAMEORIGIN` yang memblokir origin Portal, dan/atau CSP `frame-ancestors` di sisi laporan wajib mengizinkan origin `web-client-portal` secara eksplisit (allow-list origin, bukan wildcard).
- **Implikasi keamanan:**
  - CSP Portal sendiri butuh `frame-src` yang di-allow-list KETAT ke origin `mea-client-reporting` saja — tidak generik.
  - Kalau laporan butuh sesi/token untuk diakses, **token pass-through** dari sesi Portal ke iframe laporan adalah titik paling sensitif: token itu tidak boleh sama dengan cookie sesi Portal itu sendiri (kebocoran satu = kebocoran keduanya), idealnya token scoped-terbatas (mis. token sekali-pakai per render, TTL pendek, hanya bisa baca laporan Client itu — bukan token sesi penuh).
  - Origin laporan HARUS HTTPS (mixed-content di dalam frame Portal HTTPS adalah kebocoran otomatis oleh browser).
  - Risiko clickjacking terbalik (Portal yang di-embed oleh situs pihak ketiga) juga harus ditutup di sisi Portal sendiri — `frame-ancestors 'none'` di CSP Portal, KECUALI ada kebutuhan eksplisit sebaliknya (tidak ada di PRD).

### Opsi B — Link-out dengan degradasi anggun (fallback tercatat, TIDAK dipakai v1 — lihat catatan §6 di atas)
- Mekanisme: Portal menampilkan ringkasan/tautan "Buka Laporan" yang membuka `mea-client-reporting` di tab/window baru, BUKAN di dalam frame Portal.
- **Implikasi keamanan:**
  - Lebih sederhana secara CSP (tidak ada `frame-src` lintas-origin untuk diamankan) tapi menyimpang dari keputusan produk M15 §7 item 3 ("Confirmed: Natively embedded") — kalau opsi ini dipilih, itu **override** keputusan produk yang sudah confirmed, bukan sekadar detail teknis, dan wajib dicatat sebagai entri baru di `docs/DECISIONS.md` (bukan diam-diam dipilih eksekutor) — konsisten aturan CLAUDE.md.
  - Handoff sesi (SSO-lite) dari Portal ke laporan tetap perlu diamankan: kalau link-out membawa token akses (query param atau redirect ber-token), token itu harus tervalidasi scoped ke Client yang sama dengan sesi Portal — tidak boleh jadi URL yang bisa di-share/di-tebak untuk mengakses laporan Client lain.

**Kesimpulan §6:** Opsi A (embed native) adalah arah final, dikonfirmasi pemilik 2026-08-31 (O4 RESOLVED). Opsi B tetap didokumentasikan sebagai fallback Build Plan §R2 kalau implementasi nyata menemukan kendala teknis baru — bukan pilihan terbuka.

---

## 7. OPEN QUESTIONS — status akhir (RESOLVED 2026-08-31)

Sembilan dari sepuluh OQ draft asli dijawab langsung oleh pemilik (dua putaran `AskUserQuestion`, sesi 2026-08-31); satu (OQ-8) tetap terbuka sebagai detail teknis klaster embed, bukan blocker M15-C2 secara keseluruhan (§6).

| # | Pertanyaan | Keputusan | Lihat |
|---|---|---|---|
| OQ-1 | Satu kontak klien ↔ satu Client, atau banyak Client? | ✅ **Selalu satu Client per kontak.** `client_contacts.client_id` FK tetap, bukan junction table. | §3.1, §4.1 |
| OQ-2 | Reset password: email self-service, atau admin/AM-only? | ✅ **Keduanya.** Admin/AM-set (selalu tersedia, nol dependensi) DAN self-service email via Supabase Auth GoTrue (permukaan baru, butuh SMTP+template — detail teknis masuk klaster implementasi). | §3.3 |
| OQ-3 | Angka final session TTL Portal. | ✅ **4 jam, idle timeout.** Realm satu-satunya dengan TTL custom (bukan reuse default GoTrue sepanjang hari seperti karyawan/vendor). | §3.5 |
| OQ-4 | Siapa berwenang provisioning kontak klien baru? | ✅ **AM (Client miliknya sendiri) + Account lead/Director (Client mana pun).** Gate meniru bentuk `canManageVendor` LT-61. | §3.2 |
| OQ-5 | Nilai konkret rate limiting per-IP. | ✅ **Login: 10/IP/15menit — DIBANGUN 2026-08-31 (O64), seragam lintas realm.** Form komplain: 5/kontak/jam + 20/IP/jam, **masih menunggu klaster complaint form itu sendiri** (belum ada endpoint untuk digerbang). | §5.2 |
| OQ-6 | Apakah Portal menampilkan status invoice/pembayaran? | ✅ **Tidak — dikeluarkan sepenuhnya dari v1.** Klausa pengecualian M15 Rule 7 dibaca sebagai frasa sisa, bukan fitur nyata. | §4.2 |
| OQ-7 (=O4) | Apakah `mea-client-reporting` embeddable? | ✅ **Ya, dikonfirmasi pemilik.** Opsi A (embed native) adalah arah final. | §6 |
| OQ-8 | Mekanisme token pass-through ke `mea-client-reporting`. | ⏳ **TETAP TERBUKA** — bergantung arsitektur sistem eksternal itu, diselesaikan saat klaster embed benar-benar dikerjakan (butuh koordinasi dengan pemilik `mea-client-reporting`). Tidak memblokir klaster lain. | §6 |
| OQ-9 | Apakah revisi draft ini cukup untuk menutup O5, atau butuh review terpisah? | ✅ **Draft yang direvisi ini cukup** — O5 ditutup dalam sesi yang sama, dicatat `DECISIONS.md` 2026-08-31. | — |
| OQ-10 | Lockout & panjang password: reuse persis, atau diperketat? | ✅ **Reuse persis realm karyawan/vendor** — 8–72 karakter, hash bcrypt. **Dikoreksi saat implementasi**: "reuse persis" untuk lockout berarti **nol lockout kustom** — realm karyawan sudah tidak punya itu sejak migrasi GoTrue (GoTrue sendiri memegang rate limiting login), draft awal "5x/15menit" sudah usang. Lihat `DECISIONS.md` 2026-08-31. | §3.4 |

---

**Catatan penutup:** Dokumen ini sekarang **RESOLVED** — O4 dan O5 CLOSED (`docs/DECISIONS.md`, entri 2026-08-31). M15-C2 boleh dijadwalkan sebagai klaster kerja normal (Rules → Flow → Example → System Requirements → PR kecil per klaster, pola yang sama seperti M15-C1) mulai dari sesi berikutnya, dengan OQ-8 (token pass-through embed) diselesaikan saat klaster embed itu sendiri dikerjakan — bukan sebelum klaster lain (auth realm, read-model Service Progress/Health, complaint form) dimulai.
