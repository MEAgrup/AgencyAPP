# Handoff — M6D (Rekap Hasil Mingguan) SESI 2 — resolusi Open Assumptions

**Tanggal:** 2026-08-13 · **Branch:** `claude/handoff-m6d-sesi1-hgxcbi`
**Sifat sesi ini: SPEC-ONLY. Nol kode, nol migrasi, nol perubahan skema.**
Semua yang mendarat adalah dokumen: jawaban pemilik atas RM-1…RM-11 dari SESI1.

> Rantai: `HANDOFF_M6D_SESI1.md` (spec, branch `cm-cro-weekly-results-3ptcb5`) → **SESI2 (ini)**.
> Baca SESI1 dulu untuk konteks modul; SESI2 hanya menutup pertanyaan terbukanya.
> Spec SESI1 sudah di-**merge** ke branch ini (8 berkas), jadi branch ini superset:
> kerja Interview/Kelola-Klien (PR #151) **+** spec M6D **+** resolusi ini.

---

## 0. Posisi

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/handoff-m6d-sesi1-hgxcbi` (dari `main`@`3cf31b8` + PR#151 + merge spec M6D) |
| **Status implementasi** | **Belum mulai** — diurut akhir Wave 2, sesudah M7/M8/M9/M10 mengekspos metrik (blocker sama seperti M6B P-E). Cek kesiapan sumber persis seperti SESI1 §5 sebelum D-01 |
| **Deliverable sesi ini** | Dokumen saja (di bawah) |

Berkas yang berubah SESI2:
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` — §4 Rule 1 (kecuali hold), Rule 8 (catatan divisi wajib + Head buka-kembali), RM-D6 (wajib), **RM-C9 baru** (teks-only), §9 (mesin #18 + `pernah_ditutup_otomatis` + katalog v7=48), **§10 ditulis ulang** + **§10.1 baru** (force-close + buka-kembali, "dimodelkan" + teks-only, katalog)
- `docs/backlog/M6D_BACKLOG.md` — D-02 (edge buka-kembali Head), D-04 (RM-C9 teks), D-06/D-07 diperbarui, §3 status, **tiket baru D-14** (M14 disiplin)
- `docs/prd/CDPS_Module14_Team_Performance.md` — **§9 baru** (komponen disiplin rekap = flag `pernah_ditutup_otomatis`, butuh sign-off)
- `docs/STATE_MACHINES.md` §15 — force-close N=2 hari kerja + **edge `Ditutup Otomatis→Terbuka` (Head)** + flag permanen
- `docs/DECISIONS.md` — 1 entri 2026-08-13 (resolusi RM-1…RM-11)
- `docs/handoff/HANDOFF_M6D_SESI2.md` — ini

---

## 1. Ringkasan jawaban pemilik (RM-1…RM-11)

| RM | Status | Isi |
|---|---|---|
| RM-1 | ✅ decided | Minggu ISO Sen–Min WIB **benar**. Tak berubah |
| RM-2 | ✅ decided | Klien aktif = **≥1 Service non-terminal, KECUALI semua-hold/paused dikecualikan**. Filter di job Senin (D-03/D-06) |
| RM-3 | ✅ decided | **Tak ada ROAS blend — ROAS = kanal Ads saja**. RM-C2 tetap `GMV Ads ÷ Spend`. Tertutup permanen |
| RM-4 | ✅ decided | **Tidak dimodelkan**, tapi ada field **teks-only RM-C9** "Catatan Metrik Tambahan" (owner 2026-08-13: *"text only untuk pencatatan"*). Bukan metrik — tak masuk delta/rollup/skor. Arti "dimodelkan" → PRD §10.1-B |
| RM-5 | ✅ decided | Force-close **N = 2 hari kerja** + **Head boleh buka-kembali** rekap `Ditutup Otomatis` (`→ Terbuka`, alasan wajib). `pernah_ditutup_otomatis` **permanen** — nilai AM tetap tercatat walau datanya diselamatkan. Alur → PRD §10.1-A |
| RM-6 | ✅ **signed off 2026-08-13** | Pemilik: *"Iya ini benar."* Katalog **v7=48** disetujui (44 live v1–v6 + 4 M6D). **Gate M6B PA-8 LULUS** — D-07 tak lagi terblokir. Daftar penuh → **§Katalog di bawah** |
| RM-7 | ✅ **decided 2026-08-13** | Pemilik: *"tidak perlu bangun dulu, buat saja kolom dengan text only, saat ini belum dibutuhkan."* View organik **tidak dimodelkan** sekarang → `—` / teks RM-C9. Auto hanya kalau sumbernya dibangun di M7 |
| RM-8 | ✅ decided | Catatan divisi **WAJIB** (divisi berutang laporan mingguan). Reminder `catatan_divisi_belum_diisi`. **Tak memblok tutup AM** |
| RM-9 | ✅ decided | Disiplin **ditampilkan (H-2) DAN dinilai** — nilainya di **M14, bukan komponen ke-8 M13**. Re-weight profil AM ⇒ RM-9a (di bawah, **signed off**) / D-14 |
| RM-9a | ✅ **signed off 2026-08-13** | Pemilik: *"jalankan Rekomendasi… 45/22.5/22.5/10… + slice kepatuhan-catatan di profil tiap divisi."* Profil AM **45/22.5/22.5/10**; profil divisi Creative/Ads/KOL **+5% proporsional** Kepatuhan Catatan. **D-14 tak lagi terblokir.** Detail → M14 §9 |
| RM-10 | ✅ decided | **H-4 verdict Interview tetap** di halaman health (advisory) |
| RM-11 | ✅ **decided 2026-08-13** | Pemilik: *"tidak perlu bangun dulu, buat saja kolom dengan text only, saat ini belum dibutuhkan."* CPC/CPM + Upcoming Milestones **tidak dimodelkan** sekarang → teks RM-C9; auto hanya kalau sumbernya dibangun di M8 |

**✅ Pertanyaan yang tadinya terbuka — semuanya SUDAH DIJAWAB pemilik 2026-08-13 (lihat `DECISIONS.md` baris 2026-08-13 teratas):**
1. **RM-6 — tanda tangan katalog `v7 = 48`.** ✅ **Ditandatangani** (*"Iya ini benar."*). Gate M6B PA-8 kini LULUS; D-07 bebas berjalan.
2. **RM-9a — bobot komponen disiplin di M14.** ✅ **Ditandatangani:** profil AM **45 / 22.5 / 22.5 / 10** (carve 10% proporsional); profil divisi Creative/Ads/KOL di-carve **5% proporsional** untuk Kepatuhan Catatan (28.5/23.75/23.75/19/5, 23.75/28.5/23.75/19/5, 28.5/23.75/19/23.75/5). D-14 bebas berjalan. Bobot final → M14 §9.
3. **RM-7 / RM-11 — go/no-go pemodelan.** ✅ **Diputuskan: default (b)** — *tidak* dibangun sekarang. View organik / CPC / CPM / impressions / Upcoming Milestones tetap `—` + catatan teks RM-C9; auto hanya jika kelak sumbernya dibangun di M7/M8. TIDAK memblok D-01…D-13.

**Seluruh RM-1…RM-11 (+ RM-9a) kini decided/ditandatangani — tidak ada lagi pertanyaan pemilik yang menggantung untuk M6D.**

---

## 2. §Katalog — 44 event live (RM-6, ✅ **ditandatangani 2026-08-13** → v7=48)

Diambil verbatim dari `packages/core/src/notification.ts` (`EVENTS` + `CATALOG` + `CATALOG_VERSIONS`).
Invarian sekarang = `registeredEventCount()` (jumlah versi teregistrasi), **bukan** literal (O55).

### v1 — 17 (Fase 0 v2 §9: 15 beku + 2 lead-delete tercatat)
| # | Event | Penerima |
|---|---|---|
| 1 | `m0.negotiation.pending_approval` | Sales Head/SPV |
| 2 | `m0.negotiation.decision` | Salesperson |
| 3 | `m0m5.installment.due` | Sales PIC + Finance |
| 4 | `m5.contract.not_received` | Finance + SPV |
| 5 | `m6.complaint.logged` | AM + SPV Account |
| 6 | `m9.kol.qc_failed_or_escalated` | KOL Lead |
| 7 | `m10.session.discrepancy_flagged` | SPV Account |
| 8 | `m11.dependency.satisfied` | Target Brief PIC |
| 9 | `m12.block_request.submitted` | SPV/Lead |
| 10 | `m12.block_request.decided` | Requester |
| 11 | `m12.revision_count.flag` | Team Leader/SPV |
| 12 | `m13.client.band_drop` | SPV |
| 13 | `m14.performance.published` | Tiap staff |
| 14 | `m1.lead.co_pursuit` | Co-pursuit owners + registrant |
| 15 | `m7.hours_logged.reminder` | PIC Asset |
| 16 | `m1.lead.delete_requested` | Head divisi asal lead |
| 17 | `m1.lead.delete_decided` | Requester |

### v2 — 14 (M6A §7 D12: 4 Strategi · M6B §9: 6 Plan · M6C §10: 3 Gate · O53: 1 Account)
| # | Event | Penerima |
|---|---|---|
| 18 | `strategi_diajukan` | SPV / Head of Account |
| 19 | `strategi_disetujui` | AM + lead divisi eksekusi + Finance |
| 20 | `strategi_dikembalikan` | AM |
| 21 | `strategi_revisi_disarankan` | AM + SPV |
| 22 | `plan_periode_aktif` | AM + lead divisi yang punya baris |
| 23 | `plan_target_diturunkan` | SPV |
| 24 | `plan_baris_belum_dieksekusi` | AM + SPV |
| 25 | `plan_keberatan_kapasitas` | AM + SPV |
| 26 | `plan_realisasi_belum_lengkap` | AM + SPV |
| 27 | `plan_periode_ditutup` | AM + SPV + Finance |
| 28 | `gate_override_dicatat` | SPV |
| 29 | `plan_sekarang_disarankan` | AM + SPV |
| 30 | `gate_deeskalasi_diminta` | SPV |
| 31 | `m6.client.assigned` | AM bersangkutan |

### v3 — 2 (M5-OA-7: Finance ACC transaksi)
| # | Event | Penerima |
|---|---|---|
| 32 | `m5.transaction.change_requested` | Direktur |
| 33 | `m5.transaction.change_decided` | Requester |

### v4 — 1 (M6A §4 D-7: Sanggahan Target)
| # | Event | Penerima |
|---|---|---|
| 34 | `m6a.strategi.sanggahan_target` | SPV Account + Head of Sales |

### v5 — 9 (Interview / Kelola Klien tab 1; semua advisory)
| # | Event | Penerima |
|---|---|---|
| 35 | `interview_dijadwalkan` | AM + SPV |
| 36 | `interview_pengingat` | AM |
| 37 | `interview_terlewat` | AM, lalu eskalasi SPV |
| 38 | `interview_butuh_data_klien` | AM |
| 39 | `interview_diajukan_dengan_kekosongan` | SPV |
| 40 | `interview_selesai` | AM + SPV + Head of Account |
| 41 | `kualifikasi_tidak_siap` | SPV + Head of Account (info only) |
| 42 | `kualifikasi_turun` | SPV + Head of Account |
| 43 | `interview_versi_baru` | AM + SPV |

### v6 — 1 (Interview bagian 2: eskalasi prasyarat)
| # | Event | Penerima |
|---|---|---|
| 44 | `kualifikasi_prasyarat_menggantung` | SPV + Head of Account |

**→ Total live = 44.**

### v7 — 4 (M6D, BARU, ✅ **ditandatangani 2026-08-13** bersama v1–v6)
| # | Event | Memicu | Penerima |
|---|---|---|---|
| 45 | `rekap_mingguan_terbuka` | Rekap mingguan dibuka (job Senin) | AM/CRO pemilik klien |
| 46 | `rekap_mingguan_belum_dikonfirmasi` | Belum dikonfirmasi N=2 hari kerja setelah minggu tutup | AM/CRO + SPV |
| 47 | `rekap_sengketa_angka` | AM ajukan `Sengketa Angka` atas angka auto | SPV |
| 48 | `catatan_divisi_belum_diisi` | Divisi berutang catatan wajib (RM-8) belum isi saat tutup | Lead divisi + AM |

**→ Dengan M6D = v7 = 48.** Registrasi = satu baris `notif_catalog_versions` (`eventCount: 4`) di migrasi D-07 — **jangan** menyetel literal 31/48 di test; invarian menghitung dari registry.

---

## 3. Urutan tiket (tak berubah dari SESI1, + D-14 baru)

D-01…D-13 seperti `M6D_BACKLOG.md`. Ranjau repo tetap sama (SESI1 §5): migrasi lewat
`supabase/migrations/**` (jangan `psql -f`/O38), wire snake_case (O43), `KNOWN_GAPS` kosong,
degradasi per-blok O52, `pg_cron` butuh guard `IF EXISTS pg_available_extensions` di CI, backend/
read-only.

Tambahan:
- **D-02** kini: + edge **`Ditutup Otomatis→Terbuka` (Head, alasan wajib)**; terminal sejati hanya `Ditutup`; kolom `pernah_ditutup_otomatis` (set saat force-close, trigger jaga tak pernah dicabut).
- **D-04** kini: + field **teks-only RM-C9** "Catatan Metrik Tambahan" (bukan metrik).
- **D-06** kini: job (b) N=2 hari kerja, (c) event `catatan_divisi_belum_diisi`.
- **D-07** kini: **v7 = 48**, bukan v3=31 (4 event, termasuk `catatan_divisi_belum_diisi`).
- **D-14 (baru)** — M14: komponen **Disiplin Rekap** (peran AM, hitung `pernah_ditutup_otomatis`) + **Kepatuhan Catatan** (peran divisi). **Bobot ✅ ditandatangani 2026-08-13 (RM-9a):** AM 45/22.5/22.5/10; divisi Creative/Ads/KOL +5% proporsional. M6D suplai sinyal mentah; M14 hitung skor. Diurut bareng/sesudah M6D.

---

## 4. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-13 baris teratas (resolusi RM-1…RM-11) + 2 entri M6D 2026-08-12.
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` §10 + §10.1 (klarifikasi berikut contoh).
- `docs/prd/CDPS_Module14_Team_Performance.md` §9 (amandemen disiplin, butuh sign-off).
- `packages/core/src/notification.ts` (`CATALOG_VERSIONS` — sumber angka 44).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-14).
