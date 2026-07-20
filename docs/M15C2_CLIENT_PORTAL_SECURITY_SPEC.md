# CDPS — M15-C2 Client Portal: Security Spec (DRAFT)

**Status:** DRAFT — menunggu keputusan **O5** (spec keamanan) dan **O4** (embeddability `mea-client-reporting`). Dokumen ini adalah **bahan keputusan, BUKAN izin memulai koding M15-C2.** Client Portal tetap **DITUNDA resmi** (`docs/DECISIONS.md`, entri 2026-07-18) sampai O4 dan O5 sama-sama diputuskan manusia.

**Tanggal:** 2026-07-20
**Penulis:** Orchestrator (Fable) + eksekutor Sonnet, sesi 2026-07-20
**Reviewer yang diharapkan:** Nerissa, Yohan, dan head dev (belum ditandatangani siapa pun — lihat §7 Open Questions)
**Prasyarat untuk:** O5 (`docs/DECISIONS.md` Open #O5); menutup O5 TIDAK otomatis membuka M15-C2 — pembukaan tetap butuh keputusan manusia terpisah sesuai entri 2026-07-18.

**Dibaca bersama:**
- `CLAUDE.md` — `web-client-portal` = **separate auth realm**, strict allow-list data layer, never a permission-trimmed internal view.
- `docs/prd/CDPS_Phase0_Foundation_v2.md` §11 — baseline keamanan minimum (dikutip penuh di §1 di bawah).
- `docs/prd/CDPS_Module15_Client_Team_Portal.md` §2, §6.1 — surface data Client Portal (C2).
- `docs/DECISIONS.md` — entri 2026-07-18 (penundaan M15-C2), O4/O5 (Open), dan entri 2026-07-19 (`AUTH DIREDESAIN`) yang menjelaskan pola auth lokal internal yang jadi rujukan/kontras di sini.
- `backend/internal/auth/local.go`, `backend/internal/auth/session.go`, `docs/handoff/AUTH_UAT_RUNBOOK.md` — implementasi auth lokal internal yang sudah live (realm karyawan), dipakai sebagai pola yang **sebagian dicontoh, sebagian sengaja dibedakan** untuk realm eksternal (lihat §3).

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

### 3.1 Provisioning (model, bukan keputusan final — lihat OQ-4)
Tidak ada self-registrasi. Model yang selaras dengan realm eksternal + house convention "tidak ada jalur mutasi tanpa pemilik yang jelas":
- AM (atau admin) **mengundang** kontak klien dengan nama + email; sistem membuat baris kontak berstatus belum aktif + password temporer (mirror pola `SetPassword` internal, `must_change_password=1`), ATAU mengirim link set-password sekali-pakai bertenggat (butuh keputusan email — lihat OQ-2).
- Kontak WAJIB ganti password sebelum mengakses surface lain (gate identik pola internal: `must_change_password` blocking, `local.go` §`MustChangePassword`).
- Kontak dapat **dinonaktifkan** oleh AM/admin (bukan dihapus — riwayat komplain yang sudah mereka submit tetap immutable & atributed ke ID kontak, konsisten house convention #3).

### 3.2 Kebijakan password & lockout
Diselaraskan dengan baseline internal (`backend/internal/auth/local.go`), dengan penyesuaian untuk permukaan publik:

| Parameter | Pola internal (karyawan) | Usulan realm Portal |
|---|---|---|
| Panjang password | Min 8 karakter, max 72 byte (batas bcrypt) | **Sama** — tidak ada alasan melonggarkan untuk publik; justru kandidat diperketat (lihat OQ-5) |
| Hash | bcrypt DefaultCost | **Sama** |
| Lockout | 5 percobaan gagal berturut-turut → kunci 15 menit; sukses reset counter | **Sama sebagai default**, tapi permukaan publik lebih rawan credential-stuffing terdistribusi (banyak IP) — pertimbangkan tambahan rate limit **per-IP** di depan lockout per-akun (§5.2), bukan pengganti |
| Reset lupa password | Tanpa self-service/email — admin set password temporer (keputusan 2026-07-19, khusus karyawan) | **OPEN QUESTION (OQ-2)** — klien eksternal biasanya mengharapkan jalur email self-service; keputusan "no email" internal punya alasan spesifik (HRIS terpisah, admin selalu ada). Untuk klien, "hubungi AM by WhatsApp" adalah opsi konsisten dengan pola M15 Rule 6 (semua follow-up lewat AM), tapi ini keputusan produk, bukan keputusan teknis — jangan diasumsikan |
| Enumerasi akun | `[email atau password salah]` generik, employee tidak aktif dianggap sama dengan email tidak ditemukan | **Sama pola**, wajib direplikasi persis (§5.3) |

### 3.3 Sesi
- **Cookie terpisah** dari `cdps_session` internal — nama berbeda (mis. `cdps_portal_session`), tabel sesi terpisah (`client_contact_sessions` atau setara), tidak pernah dibaca oleh middleware auth internal dan sebaliknya.
- **Atribut cookie wajib** (di atas baseline internal yang saat ini HANYA `HttpOnly` + `SameSite=Lax`, TANPA `Secure` eksplisit — lihat `backend/internal/httpapi/auth_handlers.go`): untuk realm publik, **`Secure` wajib eksplisit** (portal hanya boleh dilayani via HTTPS — tidak ada asumsi jaringan kantor terpercaya seperti internal), `HttpOnly` wajib, `SameSite=Strict` diusulkan sebagai default lebih ketat dari `Lax` internal (Portal tidak butuh navigasi cross-site apa pun kecuali skenario embed §6 — jika embed dipilih dan butuh `SameSite=None`, itu trade-off eksplisit yang harus dicatat, bukan default diam-diam).
- **TTL lebih pendek** dari 12 jam internal — usulan draft: 2–4 jam idle/absolute (OPEN QUESTION OQ-3, angka final butuh keputusan produk, bukan dikarang di sini).
- Ganti password → revoke semua sesi LAIN milik kontak yang sama (pola identik `RevokeOtherSessions`); admin menonaktifkan kontak → revoke SEMUA sesi kontak itu (pola identik `RevokeAllSessions`).

### 3.4 Force-change & reset admin
- Force-change pada login pertama: pola identik internal (`must_change_password` gate blocking semua surface lain sebelum ganti password).
- Reset oleh AM/admin: konsisten dengan tanpa-email internal ATAU jalur email — **lihat OQ-2, tidak diputuskan di sini.**

---

## 4. Otorisasi & Isolasi Data

### 4.1 Model akun ↔ Client
M15 §6.1 mengonfirmasi: **multi-contact per Client** — beberapa kontak bernama per Client, masing-masing login sendiri, semua melihat scoped view yang **identik** (tidak ada tiering internal antar-kontak di v1; lihat M15 Rule 1 & contoh Alpha Digital §5 — dua kontak sama-sama melihat Service Progress & Health Summary yang sama, bukan subset personal).

PRD **tidak menyebutkan** apakah satu kontak bisa terhubung ke **lebih dari satu Client** (mis. agensi/vendor pihak ketiga yang menangani beberapa akun klien MEA sekaligus, atau grup perusahaan dengan beberapa Client ID). Seluruh narasi M15 §2/§4/§6.1 ditulis dari sudut pandang "satu Client, banyak kontak" — tidak pernah dari sudut "satu kontak, banyak Client". **Ini ditulis sebagai OPEN QUESTION (OQ-1)**, bukan diasumsikan N:1 atau N:M secara sepihak — konsekuensi desainnya besar (apakah `client_contacts` punya satu `client_id` tetap, atau butuh tabel junction + selector "ganti Client aktif" di UI).

### 4.2 Allow-list field per surface (dari M15 §2, §6.1 — bukan tabel baru, transkripsi eksplisit dari PRD)

| Entitas/Surface (internal) | Field yang BOLEH keluar ke Portal | Field yang TIDAK BOLEH keluar |
|---|---|---|
| **Service Progress** (dari Module 11 Universal Column, per SVC aktif) | Nama/label Service (client-friendly); status **hasil relabeling tetap** — Queued / In Production / Finalizing / In Review / Completed (M15 §2 Rule 2, tabel lookup tetap) | Nama status internal asli (To Do/In Progress/Awaiting Review/Blocked-Revision/Done); `BRF-`/`AST-`/`BKG-`/task ID apa pun; siapa PIC-nya; SLA/timestamp internal |
| **Embedded Report** | Output `mea-client-reporting` yang memang ditujukan untuk Client (template existing) | — (surface ini didefinisikan oleh sistem laporan yang sudah ada, bukan field baru; lihat §6 untuk mekanisme render) |
| **Health Summary** | HANYA label band: "On Track" / "Needs Attention" / "Action Needed" (M15 §2 Rule 4) | Skor numerik 0–100 mentah maupun capped; breakdown per komponen (Revision Burden, Complaints, dll.); formula/bobot apa pun |
| **Complaint form (submit)** | Field TULIS: deskripsi, attachment opsional, severity tag pilihan-klien opsional (M15 §6.1) → membuat `CPL-` `source=Client Portal` + `submitting_contact_id` | Tidak ada field BACA di surface ini — M15 Rule 6 confirmed: **submit-only**, tidak ada log komplain personal yang ditampilkan ke klien |
| **Larangan lintas-surface eksplisit** (M15 §2 Rule 7, "Explicit exclusion list") | — | Detail Transaction/payment admin **di luar** status invoice/pembayaran milik Client sendiri (lihat **OQ-6** — surface invoice/payment ITU SENDIRI tidak pernah didefinisikan Rule/Flow mana pun, hanya disebut di klausa pengecualian); nama staf/workload staf; data Team Performance (M14); `BRF-`/`AST-`/`BKG-`/task ID internal; data Client LAIN mana pun |

**Larangan mutlak (ulang, eksplisit dari M15 §2 Rule 7 + prinsip §2.2 di atas):** komisi, skor performa tim (individu maupun rollup), audit log internal (Module log operasional, bukan audit-per-kontak milik Portal sendiri — lihat §5.1), dan data Client lain dalam bentuk apa pun (termasuk agregat lintas-klien apa pun — Management Dashboard M15 §6.3 adalah surface **internal-only**, Director/OD, dan TIDAK PERNAH punya padanan di Client Portal).

### 4.3 Isolasi teknis
- Setiap query read-model Portal WAJIB `WHERE client_id = :session_client_id` (atau setara) — tidak ada endpoint yang menerima `client_id` sebagai parameter permintaan yang dipercaya mentah-mentah dari client-side; ID di request (kalau ada) harus divalidasi SAMA DENGAN `client_id` yang terikat sesi, bukan dipakai sebagai sumber kebenaran.
- Read-model Portal idealnya berupa **package/paket kode terpisah** (mis. `internal/module15_client_portal` sebagai gambaran struktur, mirror pola `module15_portal` yang sudah ada untuk Team Portal internal) yang TIDAK mengimpor query internal Module 11 secara langsung — hanya lewat fungsi proyeksi allow-list yang eksplisit mengembalikan DTO terbatas (bukan struct internal penuh yang lalu di-serialize sebagian).

---

## 5. Audit & Rate Limiting

### 5.1 Audit per-aksi-kontak
- Setiap login (sukses/gagal), setiap akses Service Progress/Report/Health Summary (view-level, bukan hanya submit), dan setiap submit komplain **WAJIB tercatat append-only**, actor = ID kontak spesifik (bukan Client ID saja) — M15 §2 Rule 1 eksplisit: "each contact's own actions... are still individually logged for audit" (contoh: siapa dari Alpha Digital yang submit komplain).
- Pola immutability sama dengan seluruh sistem (CLAUDE.md #3): tidak ada UPDATE/DELETE pada baris audit Portal; entity_type baru diusulkan mis. `client_contact` / `client_contact_session`, mirror pola `employee_credential` di audit log internal.
- Log akses (bukan hanya aksi tulis) bernilai forensik tinggi di realm publik — kalau terjadi kebocoran, tim harus bisa menjawab "kontak mana yang mengakses apa, kapan" tanpa harus merekonstruksi dari log server mentah.

### 5.2 Rate limiting
Wajib pada MINIMAL dua titik (Phase 0 §11 eksplisit):
- **Login** — lockout per-akun (pola §3.2) + rate limit per-IP/per-endpoint di depan (nilai konkret = OPEN QUESTION OQ-5; realm publik butuh pertahanan berlapis yang tidak dibutuhkan realm karyawan di jaringan tertutup).
- **Form komplain** — endpoint tulis satu-satunya di realm ini, rawan spam/flood; rate limit per-kontak DAN per-IP, plus validasi ukuran/tipe attachment (detail teknis attachment belum di-scope PRD — dicatat, bukan diasumsikan).

### 5.3 Non-disclosure keberadaan akun
- Pesan login gagal **generik**, tidak membedakan "email tidak terdaftar" vs "password salah" vs "kontak dinonaktifkan" — pola identik `[email atau password salah]` internal. String BI final untuk realm Portal (termasuk apakah reuse string yang sama persis atau string baru khusus Portal) **diotorisasi via DECISIONS saat implementasi** — tidak dikarang di draft ini.
- Endpoint provisioning/invite tidak boleh membocorkan keberadaan email yang sudah terdaftar sebagai kontak Client lain (mencegah enumerasi lintas-tenant).

---

## 6. Embed (O4) — dua opsi, tanpa keputusan

M15 §6.1 sudah confirmed secara PRODUK bahwa laporan **native embedded**, bukan link-out (M15 §7 item 3, "Reports: link-out vs embed → Confirmed: Natively embedded"). Namun O4 (`docs/DECISIONS.md`) mencatat pengecekan **teknis** embeddability `mea-client-reporting` belum pernah dilakukan — keputusan produk "embed" sudah ada, tapi kelayakan tekniknya belum diverifikasi. Build Plan §R2 (dirujuk tugas ini) meminta opsi fallback anggun kalau embed ternyata tidak layak secara teknis. Dua opsi berikut disiapkan sebagai bahan, **tanpa memutuskan salah satu**:

### Opsi A — Embed native (arah yang sudah confirmed produk, M15 §6.1)
- Mekanisme: `<iframe>` (atau setara) yang me-render output `mea-client-reporting` di dalam frame Portal.
- **Prasyarat teknis (O4):** `mea-client-reporting` harus mengizinkan embedding — server laporan itu wajib TIDAK mengirim `X-Frame-Options: DENY`/`SAMEORIGIN` yang memblokir origin Portal, dan/atau CSP `frame-ancestors` di sisi laporan wajib mengizinkan origin `web-client-portal` secara eksplisit (allow-list origin, bukan wildcard).
- **Implikasi keamanan:**
  - CSP Portal sendiri butuh `frame-src` yang di-allow-list KETAT ke origin `mea-client-reporting` saja — tidak generik.
  - Kalau laporan butuh sesi/token untuk diakses, **token pass-through** dari sesi Portal ke iframe laporan adalah titik paling sensitif: token itu tidak boleh sama dengan cookie sesi Portal itu sendiri (kebocoran satu = kebocoran keduanya), idealnya token scoped-terbatas (mis. token sekali-pakai per render, TTL pendek, hanya bisa baca laporan Client itu — bukan token sesi penuh).
  - Origin laporan HARUS HTTPS (mixed-content di dalam frame Portal HTTPS adalah kebocoran otomatis oleh browser).
  - Risiko clickjacking terbalik (Portal yang di-embed oleh situs pihak ketiga) juga harus ditutup di sisi Portal sendiri — `frame-ancestors 'none'` di CSP Portal, KECUALI ada kebutuhan eksplisit sebaliknya (tidak ada di PRD).

### Opsi B — Link-out dengan degradasi anggun (fallback bila O4 = tidak layak)
- Mekanisme: Portal menampilkan ringkasan/tautan "Buka Laporan" yang membuka `mea-client-reporting` di tab/window baru, BUKAN di dalam frame Portal.
- **Implikasi keamanan:**
  - Lebih sederhana secara CSP (tidak ada `frame-src` lintas-origin untuk diamankan) tapi menyimpang dari keputusan produk M15 §7 item 3 ("Confirmed: Natively embedded") — kalau opsi ini dipilih, itu **override** keputusan produk yang sudah confirmed, bukan sekadar detail teknis, dan wajib dicatat sebagai entri baru di `docs/DECISIONS.md` (bukan diam-diam dipilih eksekutor) — konsisten aturan CLAUDE.md.
  - Handoff sesi (SSO-lite) dari Portal ke laporan tetap perlu diamankan: kalau link-out membawa token akses (query param atau redirect ber-token), token itu harus tervalidasi scoped ke Client yang sama dengan sesi Portal — tidak boleh jadi URL yang bisa di-share/di-tebak untuk mengakses laporan Client lain.

**Kesimpulan §6:** pilihan A vs B TIDAK diputuskan di dokumen ini — keduanya butuh cek teknis O4 dan/atau keputusan produk eksplisit sebelum salah satu diimplementasikan.

---

## 7. OPEN QUESTIONS — wajib diputuskan manusia sebelum koding M15-C2

| # | Pertanyaan | Kenapa tidak bisa diasumsikan | Butuh dari |
|---|---|---|---|
| OQ-1 | Satu kontak klien ↔ satu Client, atau bisakah satu kontak terhubung ke banyak Client? | M15 §2/§6.1 hanya menulis dari sudut "satu Client, banyak kontak" — arah sebaliknya tidak pernah disebut. Menentukan skema `client_contacts` (kolom `client_id` tetap vs tabel junction + Client selector di UI). | Yohan / product |
| OQ-2 | Reset password klien: jalur email self-service, atau admin/AM-only seperti realm karyawan (keputusan 2026-07-19)? | Keputusan "tanpa email" internal punya alasan spesifik ke karyawan (HRIS terpisah); klien eksternal biasanya berharap self-service. Keputusan produk, bukan teknis. | Nerissa / Yohan |
| OQ-3 | Angka final session TTL Portal (usulan draft 2–4 jam) dan idle-timeout vs absolute-timeout. | Draft ini hanya mengusulkan "lebih pendek dari 12 jam internal" — angka pasti perlu keputusan produk/keamanan, bukan dikarang eksekutor. | Head dev + Nerissa |
| OQ-4 | Siapa yang berwenang mengundang/provisioning kontak klien baru — AM saja, AM+Account Lead, atau termasuk admin non-AM? | PRD M15 tidak merinci mekanisme provisioning kontak sama sekali (hanya menyebut hasilnya: "multi-contact confirmed"). | Yohan / product |
| OQ-5 | Nilai konkret rate limiting per-IP (login & form komplain) — ambang percobaan, jendela waktu, mekanisme block (captcha? IP throttle? WAF?). | Phase 0 §11 mewajibkan rate limiting tapi tidak memberi angka; realm publik butuh pertahanan berlapis di luar lockout per-akun yang sudah ada di pola internal. | Head dev (kemungkinan butuh infra/WAF di luar kode aplikasi) |
| OQ-6 | Apakah Client Portal benar-benar menampilkan status invoice/pembayaran milik Client sendiri (tersirat oleh klausa pengecualian M15 §2 Rule 7: "beyond the Client's own invoice/payment status"), padahal TIDAK ADA Rule/Flow di M15 §2–§6 yang mendefinisikan surface ini? | Ambiguitas PRD langsung — klausa pengecualian menyiratkan sebuah fitur yang tidak pernah dirancang di modul yang sama. Sesuai CLAUDE.md: PRD ambigu/dua bagian modul bertentangan → STOP, jangan pilih sendiri. Kalau fitur ini memang dimaksud ada, field allow-list-nya (status Lunas/Belum Lunas/Bayar Sebagian? nominal? tanggal jatuh tempo?) harus dirinci dulu sebelum masuk §4.2. | Yohan (klarifikasi PRD M15 vs M5) |
| OQ-7 | O4 — apakah `mea-client-reporting` benar-benar embeddable (header `X-Frame-Options`/CSP `frame-ancestors` di sisi laporan)? | Belum pernah dicek secara teknis (dicatat di `docs/DECISIONS.md` sebagai Open, "cek teknis 1 hari"). Menentukan Opsi A vs B di §6. | Head dev (cek teknis, ±1 hari) |
| OQ-8 | Mekanisme token pass-through/handoff sesi ke `mea-client-reporting` (kalau Opsi A dipilih) — token sesi khusus-scoped seperti apa, siapa yang menerbitkan (Portal atau sistem laporan)? | Bergantung pada arsitektur `mea-client-reporting` yang berada di luar scope backend CDPS saat ini — tidak bisa dirancang tanpa tahu API/kontrak sistem tersebut. | Head dev + pemilik `mea-client-reporting` |
| OQ-9 | Apakah spec ini (dokumen ini sendiri) sudah dianggap "O5 RESOLVED", atau masih butuh satu putaran review eksplisit oleh head dev sebelum dicatat closed di `docs/DECISIONS.md`? | Dokumen ini ditulis sebagai draf oleh eksekutor — bukan otoritas untuk menutup Open Item sendiri. Perlu keputusan manusia eksplisit (siapa mereview, kapan, dan apakah ada revisi sebelum sign-off). | Nerissa / Yohan / head dev |
| OQ-10 | Ambang lockout & panjang password Portal: reuse persis 5x/15menit & 8–72 karakter internal, atau diperketat khusus realm publik? | §3.2 mengusulkan "sama sebagai default" tapi mencatat rawan credential-stuffing terdistribusi sebagai alasan potensial memperketat — bukan keputusan final. | Head dev |

---

**Catatan penutup:** Dokumen ini TIDAK menambah kode, migrasi, endpoint, string BI, atau entitas apa pun. Tidak ada file lain yang disentuh. Begitu O4 dan O5 (dokumen ini setelah direview — lihat OQ-9) diputuskan manusia, M15-C2 dapat dijadwalkan ulang sebagai klaster kerja normal (Rules → Flow → Example → System Requirements → PR kecil per klaster, pola yang sama seperti M15-C1).
