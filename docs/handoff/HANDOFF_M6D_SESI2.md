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
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` — §4 Rule 1 (kecuali hold), Rule 8 + RM-D6 (catatan divisi wajib), §9 (katalog v7=48), **§10 ditulis ulang** (status resolusi) + **§10.1 baru** (klarifikasi force-close, "dimodelkan", katalog)
- `docs/backlog/M6D_BACKLOG.md` — D-06/D-07 diperbarui, §3 jadi status resolusi, **tiket baru D-14** (M14 disiplin)
- `docs/prd/CDPS_Module14_Team_Performance.md` — **§9 baru** (komponen disiplin rekap, butuh sign-off)
- `docs/STATE_MACHINES.md` §15 — force-close N=2 hari kerja
- `docs/DECISIONS.md` — 1 entri 2026-08-13 (resolusi RM-1…RM-11)
- `docs/handoff/HANDOFF_M6D_SESI2.md` — ini

---

## 1. Ringkasan jawaban pemilik (RM-1…RM-11)

| RM | Status | Isi |
|---|---|---|
| RM-1 | ✅ decided | Minggu ISO Sen–Min WIB **benar**. Tak berubah |
| RM-2 | ✅ decided | Klien aktif = **≥1 Service non-terminal, KECUALI semua-hold/paused dikecualikan**. Filter di job Senin (D-03/D-06) |
| RM-3 | ✅ decided | **Tak ada ROAS blend — ROAS = kanal Ads saja**. RM-C2 tetap `GMV Ads ÷ Spend`. Tertutup permanen |
| RM-4 | ⏳ clarified | CPL/impressions **tidak dimodelkan** di M6D (default R3, tampil `—`). Bangun di M8 dulu kalau mau. Arti "dimodelkan" → PRD §10.1-B |
| RM-5 | ✅ default set | Jendela force-close **N = 2 hari kerja** (owner-tunable). Contoh kerja → PRD §10.1-A |
| RM-6 | ⏳ sign-off | Premis "v3=31" **basi**. Katalog live **v6=44**; M6D → **v7=48**. Daftar penuh utk tanda tangan → **§Katalog di bawah** |
| RM-7 | ⏳ clarified | View organik = manual/`—` (sama kelas RM-4). Naik auto hanya kalau ada export platform rutin di M7 |
| RM-8 | ✅ decided | Catatan divisi **WAJIB** (divisi berutang laporan mingguan). Reminder `catatan_divisi_belum_diisi`. **Tak memblok tutup AM** |
| RM-9 | ✅ decided | Disiplin **ditampilkan (H-2) DAN dinilai** — nilainya di **M14, bukan komponen ke-8 M13**. Butuh re-weight profil AM ⇒ **sign-off** (RM-9a / D-14) |
| RM-10 | ✅ decided | **H-4 verdict Interview tetap** di halaman health (advisory) |
| RM-11 | ⏳ clarified | CPC/CPM + Upcoming Milestones **di luar cakupan** sampai sumbernya ada (sama kelas RM-4) |

**Tiga hal yang MASIH butuh pemilik sebelum/saat implementasi:**
1. **RM-4/7/11** — go/no-go: mau kami bangun sumber CPL/impressions/CPC/CPM/view-organik di M8/M7, atau biarkan `—`? (Default: biarkan `—`.)
2. **RM-6** — tanda tangan katalog v7=48 (§Katalog). Gate M6B PA-8 masih berlaku: nol modul kirim notifikasi sebelum ini ditandatangani.
3. **RM-9a** — bobot komponen disiplin di M14 (rekomendasi 45/22.5/22.5/10 utk profil AM). Mengubah profil terkonfirmasi butuh sign-off.

---

## 2. §Katalog — 44 event live untuk sign-off (RM-6)

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

### v7 — 4 (M6D, BARU, butuh sign-off bersama v1–v6)
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
- **D-06** kini: job (b) N=2 hari kerja, (c) event `catatan_divisi_belum_diisi`.
- **D-07** kini: **v7 = 48**, bukan v3=31 (4 event, termasuk `catatan_divisi_belum_diisi`).
- **D-14 (baru)** — M14: komponen **Disiplin Rekap** (peran AM) + **Kepatuhan Catatan** (peran divisi). **Butuh sign-off bobot** (RM-9a). M6D suplai sinyal mentah; M14 hitung skor. Diurut bareng/sesudah M6D.

---

## 4. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-13 baris teratas (resolusi RM-1…RM-11) + 2 entri M6D 2026-08-12.
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` §10 + §10.1 (klarifikasi berikut contoh).
- `docs/prd/CDPS_Module14_Team_Performance.md` §9 (amandemen disiplin, butuh sign-off).
- `packages/core/src/notification.ts` (`CATALOG_VERSIONS` — sumber angka 44).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-14).
