# HANDOFF — Feedback Lapangan 2026-09-14 · SESI 1 → SESI 2

> **Dibuat 2026-09-14.** Baca berkas ini utuh sebelum menulis kode. Rantainya
> pendek: berkas ini **sesi pertama**, jadi tidak ada handoff sebelumnya untuk
> rumpun kerja ini. Yang ada sebelumnya hanya rencana (tidak di-commit) dan
> Google Doc sumbernya.
>
> **Status: PR #375 (F-1) TERBUKA, draft.** Kode sesi ini seluruhnya ada di
> branch `claude/tender-bardeen-pxneyu`, yang sudah **di-merge dengan `main`**
> (32 commit, 2026-09-14) — jadi ia membawa perbaikan `seedLaporan` dan
> gerbang suite-senyap yang baru. Tugas berikutnya **F-2 → F-3 →
> Gelombang 3** (lihat §2), tidak perlu menunggu #375 merge kecuali disebut
> sebaliknya.

---

## 0. Ringkasan 60 detik

**Sumbernya.** Google Doc **"Feedback"**
(`1OG13HxY89_2XqtRh-F-A6pOGknwaAIG4RTxypvQnMcA`, milik pemilik, diubah
2026-09-14). Keluhan lapangan **tiga divisi** — Sales, Account, Finance — atas
CDPS yang sudah dipakai produksi. Bukan gap PRD; laporan orang yang kerjanya
terhambat hari ini. Dokumen itu memuat screenshot yang **tidak terbaca lewat
Drive API** — dua butir tersendat karena itu (§4).

**Temuan besarnya: 16 butir itu bukan 16 pekerjaan.**

| Kelompok | Jumlah | Status |
|---|---|---|
| Satu akar (sesi mati) | 4 butir | ✅ **SELESAI** — PR #375 |
| Pesan validasi menyesatkan | 1 butir | ⬜ F-3, belum |
| Fitur baru ber-DB | 3 butir | ⬜ F-4/F-5/F-6, belum |
| Rate-limit login | 1 butir | ⬜ F-2, belum |
| **Sudah dibangun**, tinggal dijawab | 4 butir | ⬜ dokumen, belum |
| **Milik PDT G3** — jangan dibangun | 1 butir | ⛔ jangan sentuh |
| **Ditolak pemilik** | 1 butir | ⛔ sudah dicatat DECISIONS |
| Menunggu screenshot | 2 butir | ⏸ diblokir |

---

## 1. Yang SUDAH selesai sesi ini — F-1 (PR #375)

**Empat butir feedback tertutup sekaligus** oleh satu perbaikan, karena
memang satu lubang: CDPS menerima `refresh_token` dari GoTrue sejak auth BFF
lahir dan **membuangnya**.

Rinciannya ada di `docs/DECISIONS.md` baris teratas dan di badan PR #375.
Yang perlu diketahui sesi berikutnya hanya ini:

- Route **BARU** `POST /api/v1/auth/refresh`. Kalau Anda menambah route auth
  lain, jangan letakkan rate limiter di depannya tanpa membaca alasan di doc
  comment-nya.
- `web-internal/src/lib/api.ts` sekarang **mencoba ulang** request yang 401
  satu kali. Kalau Anda menulis kode yang mengandalkan 401 langsung terlihat
  di layar, itu tidak lagi benar.
- `web-internal/src/lib/auth-context.tsx` punya effect refresh proaktif
  (timer 10 menit + `visibilitychange`).
- Cookie baru: `cdps_refresh_token`, `cdps_client_refresh_token`, keduanya
  `Path=/api/v1/auth`.

### ⚠️ Yang MASIH harus diuji manusia di peramban (belum dilakukan)

Unit test tidak menangkap ini dan **pemilik menjadikannya syarat terima
keras** ("perhatikan supaya tidak logout otomatis"):

1. Login → `/account/strategi/{id}` → isi Section A → hapus cookie
   `cdps_access_token` di DevTools → tunggu autosave 20 detik atau tekan
   Simpan ⇒ **tersimpan**, AM tidak melihat apa pun.
2. Hapus **kedua** cookie ⇒ baru diarahkan ke `/login` dengan pesan BI.
3. Pindah section lalu kembali ⇒ isian Section A **masih ada**.
4. **Uji menganggur.** Setel `jwt_expiry` pendek di Dashboard Supabase,
   biarkan tab terbuka melewati **dua kali** umur token tanpa disentuh sama
   sekali ⇒ klik pertama sesudahnya **langsung berhasil**, nol layar login,
   nol request gagal. Kembalikan `jwt_expiry` sesudahnya.

Kalau butir 4 gagal, kemungkinan besar peramban mencekik timer lebih agresif
dari dugaan — perbaikannya di `visibilitychange`, bukan memperpendek interval.

---

## 2. Tugas berikutnya, berurutan

### F-2 · Ember rate-limit login dipakai bersama sekantor

**Butir feedback (Account):** *"Saat terjadi kendala jaringan ketika login,
sistem menampilkan 'percobaan masuk terlalu banyak', sehingga informasinya
kurang sesuai dengan kendala yang sebenarnya terjadi."*

**JANGAN perbaiki pemetaan pesannya — pemetaannya sudah benar.**
`web-internal/src/lib/api.ts` memberi `[Terjadi kesalahan, silahkan coba
lagi.]` untuk kegagalan jaringan, dan hanya 429 asli yang memunculkan pesan
rate-limit. Pesannya jujur; **embernya** yang bocor ke pengguna sah.

**Sebab sebenarnya**, di
`supabase/migrations/20260906010000_login_rate_limit.sql`:

1. `check_login_rate_limit` **menyisipkan baris untuk setiap percobaan yang
   lolos, termasuk yang BERHASIL** — ia dipanggil di
   `auth/login/route.ts` **sebelum** `passwordGrant`, jadi ia tidak pernah
   tahu hasilnya.
2. Kuncinya `clientIp()` (`apps/api/src/lib/http.ts:36-40`) = entri kiri
   `x-forwarded-for`. **Satu kantor MEA di balik satu NAT = satu ember
   10-per-15-menit untuk seluruh karyawan.**

Komentar migrasinya sendiri mengklaim limit ini *"never restricts a
legitimate human logging in ten times in fifteen minutes"* — benar
per-orang, **runtuh** kalau IP egress dipakai bersama.

**Yang dikerjakan:**
- Login **berhasil** tidak boleh mengonsumsi budget. Artinya pemanggilan
  pindah ke **sesudah** `passwordGrant` (hanya catat yang gagal), ditambah
  satu pemeriksaan murni-baca **sebelum**-nya supaya penyerang tetap
  terbendung sebelum bcrypt dijalankan. Dua fungsi, bukan satu.
- Ember dikunci **per email + IP**, bukan IP saja.
- Pesan 429 menyebut jalan keluarnya.

**Catatan:** sesudah F-1 tekanan ke endpoint ini sudah turun drastis dengan
sendirinya (tim tidak lagi login berkali-kali sehari), jadi F-2 sekarang
soal kebenaran, bukan kegentingan.

**Butuh migrasi** ⇒ masuk ke migrasi tunggal (§3).

---

### F-3 · `[data tidak lengkap]` yang berbohong

**Butir feedback (Sales):** *"setiap input data selalu seperti ini, padahal
semua data sudah di isi."*

**Bukti.** `packages/domain/src/sales.ts` melempar `IncompleteError` — pesan
identik `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` —
di **51 tempat**. Banyak di antaranya **bukan** soal field kosong:

| Baris | Penyebab sebenarnya |
|---|---|
| `sales.ts:1398` | platform layanan di luar checklist Qualified Form |
| `sales.ts:1402` | jasa yang sama dipilih dua kali untuk platform yang sama |
| `sales.ts:1579` | satu sales muncul dua kali di alokasi (komentar kodenya menyebut ini terang-terangan) |
| `sales.ts:1378` | jumlah jasa melebihi `MAX_SERVICES` |

Semua itu: data **lengkap**, tapi ada yang salah. Pesannya menyuruh orang
mengisi ulang yang sudah terisi.

**Presedennya sudah diputuskan pemilik dan tinggal diikuti.**
`docs/DECISIONS.md` **O73** (2026-09-04), kata demi kata: *"**String baru,
bukan default rumah** — `[data tidak lengkap…]` justru menyesatkan di sini,
karena sales SUDAH mengisi semua yang wajib."*
`packages/domain/src/internaltask.ts:55` memakai pola yang sama dan
menjelaskannya: *"'[data tidak lengkap]' on a five-field form tells the user
nothing."* Lihat `MSG_ASSIGNEE_INVALID` / `MSG_LINK_HASIL_WAJIB` /
`MSG_BUKAN_PIC` / `MSG_ALASAN_WAJIB` di sana sebagai contoh bentuk.

**Yang dikerjakan:**
1. Telusuri 51 lokasi, pisahkan "field kosong" (biarkan pakai pesan rumah)
   dari "isi salah".
2. Untuk kelompok kedua: konstanta BI baru bergaya `internaltask.ts` yang
   menyebut **field mana** dan **kenapa**.
3. Daftarkan tiap `Error.name` baru di tabel
   `apps/api/src/lib/http.ts:73-232`. **Jangan** impor domain ke `http.ts` —
   tabel `Error.name` itu ada justru supaya `http.ts` punya nol impor domain
   (perbaikan cold-start P1); menambah satu impor membatalkannya.
4. Tes domain yang menyatakan tiap kelas kegagalan memberi pesan **berbeda**
   — jaring pengaman supaya default rumah tidak merayap kembali.

**Utamakan empat baris di tabel atas.** Sisanya boleh menyusul; ini tidak
harus selesai sekali jalan.

⚠️ **JANGAN sentuh `packages/domain/src/pdt.ts`** — PR #368 sedang
mengubahnya (+356 baris).

**Nol migrasi.**

---

### Gelombang 3 · Empat butir yang SUDAH ADA — tulis dokumen, jangan bangun

Pemilik memilih **"jawab dulu, jangan dibangun"**. Semua sudah diverifikasi
di kode sesi ini:

| Butir feedback | Kenyataannya | Bukti |
|---|---|---|
| *"Lead Not Qualified, kalau datang lagi bisa di-input ulang?"* | **Ya, sudah bisa.** Daftarkan ulang dengan nomor yang sama; dedup mengenalinya dan **membuka kembali** lead itu + attempt baru. Nol pekerjaan. | `packages/domain/src/leads.ts:320-322` (`STATUS_NOT_QUALIFIED` → `outcome: 'reopen'`); jalur reopen `leads.ts:490-500` |
| *"Butuh fitur menandakan status iklan (hold, running, dll)"* | **Sudah ada.** Hold dua langkah: AM mengajukan `[In Execution] → [Hold Requested]`, Head Account menyetujui → `[On Hold]`, Resume kembali ke `[In Execution]`. | `packages/domain/src/client.ts:545-563` |
| *"Penambahan jasa iklan secara durasi"* | **Sudah ada.** Perpanjangan/cross-sell dengan jendela kontrak; `contracts.durasi_bulan` (1–36). | `packages/domain/src/renewal.ts:94,578`; `20260807120000_o57_contract_entity.sql:66,82` |
| *"Data testing bisa dihapus?"* | **Tidak, dan itu disengaja** (house rule #3: nol jalur UPDATE/DELETE untuk riwayat). Untuk lead ada jalur resmi `lead_delete_requests`: Head menyetujui, `[Deleted]` terminal, nomor telepon bebas lagi untuk lead baru. | `20260729162101_lead_delete_request.sql`; `leads.ts:285-287` |

**Keluaran:** satu dokumen `docs/FITUR_SUDAH_ADA_TAPI_TIDAK_TERLIHAT.md`,
bergaya `docs/FITUR_UPCOMING_MILESTONE.md` — **untuk AM/Sales/Head, bukan
developer**: di mana letaknya, siapa boleh apa, aturan yang mengejutkan orang
dan alasannya. Dokumen itu lahir karena persoalan yang sama persis
(*"fiturnya sudah jalan tapi belum pernah dijelaskan, jadi orang menganggapnya
belum ada"*), jadi tirulah nadanya.

**Kalau ternyata Hold memang tidak terlihat** di layar yang di-screenshot,
itu tiket UI tersendiri (tampilkan status layanan di halaman klien) — kecil,
nol migrasi.

---

### F-4 · Catatan wajib saat Nego + terlihat oleh Head

**Butir feedback (Sales):** setiap klik "Nego" harus ada kolom catatan wajib —
harga awal, harga setelah nego, alasan nego, alasan khusus customer. *"Semua
keterangan harus muncul ke akses Head, untuk semua detailnya, karena di sini
belum muncul."*

**Yang sudah ada, dan yang belum:**

- `negotiation_proposals.decision_note varchar(500)` **ADA**
  (`20260722053923_wave1_money_path.sql:72`) — tapi itu catatan **keputusan
  atasan**, ditulis di `sales.ts:1194` dengan `where decision_note is null`.
  **Bukan** catatan pengaju. Jangan pakai ulang kolom ini.
- `negotiation_proposal_lines.proposed_price` **ADA** = harga setelah nego.
- **Harga awal TIDAK disimpan.** `standardLines()` menghargai dari Master
  Service List **saat itu**, dan harga MSL berubah antar versi — jadi harga
  awal **tidak bisa direkonstruksi belakangan**. Inilah yang membuat kolom
  baru wajib, bukan sekadar enak.
- `submitNegotiation` (`sales.ts:1024`) sama sekali tidak menerima catatan.

**Yang dikerjakan:**
- Migrasi: `negotiation_proposals.alasan_nego varchar(500)` (wajib untuk
  versi ber-custom-terms) + `negotiation_proposal_lines.harga_standar
  numeric(15,2)`. Isi `harga_standar` di `writeProposal` (`sales.ts:1364`) —
  ia **sudah** menghitungnya di sana. Baris lama di-backfill dari MSL pada
  `master_version_no` yang tercatat, **bukan ditebak**.
- `submitNegotiation` / `resubmitNegotiation` / `reviseServices` menerima
  `alasanNego`; kosong ⇒ pesan BI **spesifik** (gaya F-3), bukan
  `[data tidak lengkap]`.
- Layar Head: alasan + harga standar → harga nego + selisih.
  `negotiationHistory` (`sales.ts:2483-2578`) sudah membaca `decision_note`;
  dua kolom baru ikut di sana, lalu lewat `*ToWire` di
  `apps/api/src/lib/wire.ts`.

⚠️ **`wire.ts` sedang diubah PR #368 (+59 baris).** Kerjakan F-4 **sesudah**
#368 merge, atau siapkan merge base yang bersih. Ini satu-satunya tiket di
rencana ini yang benar-benar bergesekan dengan PDT.

**Deviasi PRD** (M0 §5 tidak menyebut catatan wajib) ⇒ **butuh entri
`docs/DECISIONS.md`**.

---

### F-5 · Finance: nominal uang masuk berbeda dari rencana

**Butir feedback (layar Finance, dikonfirmasi pemilik 2026-09-14):**
*"Nominal uang masuk beda, sedangkan tidak ada fitur untuk edit nominal."*

**Bukti.** `installments`
(`20260722053923_wave1_money_path.sql:180-195`) punya `amount` (rencana) dan
bukti verifikasi (`verified_date`, `verified_by`, `proof_of_payment`) — tapi
**tidak ada kolom "jumlah yang benar-benar diterima"**. Dan
`installments.amount` **tidak pernah di-UPDATE oleh jalur kode mana pun**:
`finance.ts:472` hanya menyetel tanggal/bukti.

`transaction_change_requests` (TCR, `20260807130000`) memang ada, tapi ia
mengubah **skema cicilan** (`from_scheme` / `to_scheme` / `schedule_json`)
lewat persetujuan SPV — jawaban untuk "rencananya berubah", **bukan** untuk
"yang masuk ternyata Rp 4.900.000, bukan Rp 5.000.000". Jangan paksakan TCR
untuk ini.

**Yang dikerjakan** — append-only, menghormati house rule #3:
- Tabel baru `installment_receipts`, prefix **`RCP`**: `installment_id`,
  `amount_received`, `received_date`, `proof`, `catatan` (wajib),
  `created_by`, `created_at`. Trigger blok UPDATE+DELETE — **tiru pola
  `client_external_billing`** dari bridge, yang sudah benar memasang
  `SET search_path = public` (preseden `client_pitch_consents_frozen` LUPA
  memasangnya; jangan tiru yang itu).
- `installments.amount` **tetap** angka rencana. Yang benar-benar diterima =
  Σ tanda terima; selisih jadi field **turunan** yang bisa dihitung ulang
  dari log (house rule #4), bukan kolom yang diketik.
- Transisi `[Terverifikasi]` membaca Σ tanda terima, bukan `amount`.
- **Satu event notifikasi baru** (74 → 75) saat nominal diterima ≠ rencana:
  Sales PIC dan Head Finance perlu tahu **sebelum** rekap bulanan.

**Deviasi PRD** (M5 tidak mengenal pembayaran sebagian bernominal beda) ⇒
**butuh entri `docs/DECISIONS.md`**.

---

### F-6 · Riwayat Daily Activity karyawan — ⏸ TANYA PEMILIK DULU

**Permintaan (Account):** riwayat aktivitas harian — kegiatan (meeting klien /
internal / training / webinar / input data), waktu (tanggal & jam), bukti
pelaksanaan.

**Belum ada sama sekali:** grep
`daily_activity|dailyActivity|aktivitas harian|activity_log` di
`packages/domain/src`, `apps/api/src`, `web-internal/src` ⇒ **nol hasil**.

**Rancangan:** tabel `daily_activities` (prefix **`ACT`**) + domain
`packages/domain/src/dailyactivity.ts` + route + layar. RLS mengikuti Matriks
Peran Phase 0 §4: staff hanya miliknya, Lead/SPV se-divisi, OD baca-semua,
Director penuh — cermin `20261001010000_rls_kinerja_sales_lead_finance.sql`.

⛔ **JANGAN mulai sebelum pemilik menjawab:** CLAUDE.md menegaskan **CDPS
bukan HRIS**. Kalau yang dimaksud adalah catatan **keluaran kerja** (menyambung
ke M14 Team Performance), ini milik CDPS. Kalau yang dimaksud **absensi**, ia
milik HRIS dan tiket ini **dibatalkan**.

---

## 3. Aturan migrasi — BACA SEBELUM MENULIS SQL

**Keputusan pemilik 2026-09-14: SATU migrasi untuk SELURUH rencana ini.**
F-2, F-4, F-5, F-6 semuanya menumpang **satu berkas** dan **satu kali**
kenaikan gerbang CI, supaya bentrok dengan PDT terjadi sekali dan mudah
diselesaikan.

**Nama berkas:** `supabase/migrations/20261020010000_feedback_lapangan_20260914.sql`

⚠️ **Periksa ulang nomor ini sebelum memakainya.** Migrasi terakhir bergerak
cepat: `20261013010000_g1_04_pdt_raw_bucket.sql` saat handoff ini mulai
ditulis, sudah `20261017010000_ops_nonaktif_pilar_operasional_ke_store_operation.sql`
beberapa jam kemudian. `20261020010000` masih di atas keduanya, tapi ruang
kosongnya tinggal dua slot — `ls supabase/migrations/ | tail -3` dulu, dan
naikkan nomornya kalau PDT sudah memakan ruang itu.

**Angka gerbang di bawah sudah diverifikasi ulang sesudah merge `main`
2026-09-14 (32 commit masuk): 175/44/35/74 TIDAK berubah.**

**Gerbang CI harus naik di DUA tempat pada commit yang SAMA** —
`scripts/db-rebuild.sh:178` **dan** `.github/workflows/ci.yml:259-264`:

| Gerbang | Sekarang | Sesudah rencana penuh |
|---|---|---|
| tabel `public` | **175** | 177 (+`installment_receipts`, +`daily_activities`) |
| `entity_prefix` | **44** | 46 (+`RCP`, +`ACT`) |
| `sm_machines` | **35** | 35 (tetap) |
| `notif_events` | **74** | 75 (+1, F-5) |

Kalau Anda hanya mengerjakan sebagian, naikkan hanya sebanyak yang benar-benar
Anda tambahkan — dan perbarui tabel di atas untuk sesi sesudah Anda.

**Wajib:** `packages/core/src/ident.ts` `PREFIXES` + baris `entity_prefix`,
plus `supabase/tests/immutability_checks.sql` dan `rls_checks.sql`.
Terapkan ke `CDPS SG` **hanya** lewat `apply_migration` per berkas —
**JANGAN `psql -f`** (itu yang melahirkan drift O38) dan **jangan
`supabase db push`** (O65).

---

## 4. Yang DIBLOKIR — butuh screenshot dari pemilik

Dokumen Feedback penuh screenshot yang **tidak terbaca lewat Drive API**.
Dua butir tersendat karenanya. **Jangan tebak.**

| Butir | Kenapa berhenti |
|---|---|
| *"Kuota Deliverable dirasa tidak perlu ditampilkan dalam bentuk pilihan, karena data yang dimasukkan berupa angka"* | Di **Penentuan Kebutuhan Plan**, kolom itu **sudah** `<input type="number" min="0">` — `web-internal/src/components/PlanGatePanel.tsx:407`. Entah yang dimaksud layar lain, entah yang dikeluhkan panah spinner angka. Menebak = memperbaiki yang tidak rusak. |
| *"Langkah 1 – Reset Awal: upload gagal, harus input manual pakai Baseline AM"* | Sistem menyebutnya **"Riset Awal"** (langkah 1), bukan "Reset Awal". Bunyi galatnya belum diketahui. **Periksa dulu apakah ini cacat yang SAMA dengan temuan PDT:** Vercel membatasi badan request **4,5 MB keras** (`DECISIONS.md` 2026-09-13). Kalau ya, obatnya sudah jadi dan tinggal ditiru — `buatPdtRawSignedUploadUrl` di `apps/api/src/lib/pdt-storage.ts`. |

**Minta ke pemilik:** dua screenshot itu + bunyi galat upload Riset Awal.

---

## 5. Dua butir yang TIDAK boleh dikerjakan

### ⛔ "Pesanan batal Section B.1 dihitung otomatis" — MILIK PDT G3

`docs/backlog/PDT_BACKLOG.md` §3 (G3 — Prefill, PDT-18) menyebutnya persis:
*"% batal, belanja iklan, ROAS, ACOS per bulan, dan seluruh B-2…B-9 masih
manual. Itulah ruang ekspansi terbesar PDT."* Kode Strategi sendiri sudah
mencatat keterbatasannya di
`web-internal/src/components/strategi/SectionB.tsx:755` (*"Riset Awal has no
source for persen batal, ad spend, ROAS, ACOS"*).

Membangunnya di sini = **dua sumber kebenaran untuk angka yang sama**, dan
PDT punya pagar yang sudah diputuskan (Rule 33 read-only + tautan ke batch
sumber, Rule 36 jalur koreksi) yang tambalan cepat tidak akan punya.
**Jawab ke tim Account: sudah dijadwalkan, di PDT G3.**

### ⛔ "Brand Strategy tidak perlu untuk klien CRO" — DITOLAK PEMILIK

Pemilik 2026-09-14: **klien CRO tetap mengikuti semua langkah.** Sekaligus
mengoreksi premisnya: **klien mana yang butuh dokumen strategi ditentukan
dari PAKET JASA, bukan dari siapa yang memegang (AM atau CRO)** — dan kode
memang sudah bekerja begitu (`master_service_versions.plan_tier` →
`services.plan_tier`, `20260806061000_m6c_plan_gate.sql`; tidak satu pun
jalur membaca jabatan pemegangnya).

Sudah dicatat sebagai baris **Decided** di `docs/DECISIONS.md` supaya
permintaan yang sama tidak lahir lagi. **Nol kode.**

---

## 6. Pagar terhadap PDT & bridge — jangan dilanggar

**PDT PR #367 & #368 masih terbuka saat handoff ini ditulis.** Berkas yang
mereka ubah, dan karena itu rawan bentrok:

- `apps/api/src/lib/wire.ts` (+59 baris di #368) ← **F-4 menyentuh ini**
- `apps/api/src/lib/shape-parity.test.ts`
- `packages/domain/src/pdt.ts` (+356), `packages/core/src/pdt/**`
- `docs/DECISIONS.md` (semua orang menambah di **puncak** — konflik
  baris-tabel, sepele)
- `docs/backlog/PDT_BACKLOG.md`

**#368 tidak membawa migrasi dan tidak menaikkan gerbang CI**, jadi jalur
migrasi bebas — asal dipakai **sekali** (§3).

**Bridge MSDPS.** Bagian A sudah merge (#348, migrasi `20261007010000`).
**Jangan sentuh** `external_orders`, `client_external_ref`,
`client_external_billing`, `external_service_map`, `clients.sumber`,
`services.sumber`.

---

## 7. Definition of Done (tiap tiket)

Dari CLAUDE.md, tidak ada yang boleh dilewati:

- Validasi sisi server + pesan BI `[...]` **persis**.
- Tes izin per peran, termasuk OD/Director berlapis.
- Tes imutabilitas (`supabase/tests/immutability_checks.sql`) — tidak ada
  jalur mutasi pada riwayat.
- Field turunan punya tes hitung-ulang-dari-log.
- **Fixture Alpha Digital tetap lulus ujung-ke-ujung.**
- Event notifikasi terdaftar di katalog bila diminta.
- Sebelum menambah endpoint: `apps/api/src/lib/route-parity.test.ts` —
  `KNOWN_GAPS` wajib tetap **KOSONG**.

---

## 8. Perintah yang dipakai sesi ini

```bash
npm install                       # root; web-internal & web-client-portal punya sendiri
npm run typecheck                 # seluruh workspace
npm test                          # seluruh workspace
cd apps/api && npx vitest run     # apps/api saja (config-nya sendiri; `@/` TIDAK
                                  # ter-resolve dari vitest root — jalankan dari sini)
cd web-internal && npx tsc --noEmit && npx eslint src/...
```

Yang bikin tersandung sesi ini, supaya Anda tidak mengulanginya:

1. **`npx vitest run <path>` dari root gagal** me-resolve alias `@/lib/...`
   milik `apps/api`. Jalankan dari `apps/api`.
2. **Tarik `main` DULU sebelum membuka PR.** Branch sesi ini bercabang dari
   `37a8a73` dan langsung mewarisi `db-and-migrations` merah yang **bukan
   miliknya**: `seedLaporan` di `gelombang-c-showcase.e2e.test.ts`
   menyisipkan baris `client_platforms` baru tiap panggilan, dan sejak
   `20261009010000` memasang `uq_client_platforms_active_platform`,
   panggilan kedua gagal di `beforeAll`. PR #369 sudah memperbaikinya di
   `main` pagi itu juga. Satu `git merge origin/main` menghapus kegagalan
   itu.
3. **Kegagalan itu hanya muncul di job `db-and-migrations`.** Tes e2e
   ber-`skipIf(!DATABASE_URL)`, jadi lokal dan job `api` tetap hijau
   sementara CI merah. Kalau `api` hijau tapi `db-and-migrations` merah,
   curigai e2e lebih dulu, bukan kode Anda.
4. **Gerbang CI baru** `scripts/ci-gerbang-suite-senyap.mjs` (dari `main`,
   PR #371) menolak berkas tes yang lolos **tanpa menjalankan satu tes
   pun** — lahir persis dari cacat di butir 2, yang selama dua hari terbaca
   sebagai "skipped" alih-alih merah. Berkas tes baru Anda harus
   benar-benar menjalankan tesnya di job `db-and-migrations` juga.
5. **`docs/DECISIONS.md` pasti bentrok** kalau PDT juga sedang jalan —
   kedua sisi menambah baris di puncak tabel yang sama. Selesaikan dengan
   **mempertahankan keduanya**; jangan pernah membuang baris sisi lain.
