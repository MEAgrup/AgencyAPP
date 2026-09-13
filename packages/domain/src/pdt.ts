/**
 * PDT (Pusat Data Toko) — predikat izin domain (G1-01, PRD §6.6).
 *
 * K-3: `requirePermission` TIDAK ADA di repo ini (nol hasil grep; PX-M2a
 * 2026-09-12 menolak sistem permission-key). Pola rumah = predikat bernama,
 * ditegakkan RLS di DB. Lingkupnya disalin dari
 * `showcase.canKelolaIzinPitch` (PDT_BACKLOG.md §0 pagar #7): AM pemilik
 * klien yang berbicara langsung dengan kliennya boleh menulis data PDT
 * kliennya sendiri; Director membawa lead di mana pun.
 *
 * Predikat-predikat ini BERDIRI SENDIRI — tidak menumpang predikat modul
 * lain — konsisten dengan ketokan PX-M2a (`docs/DECISIONS.md` 2026-09-12).
 */
import { permission } from '@cdps/core';
import { ACCOUNT_DIVISION, type Actor } from './account';

/**
 * canUploadBatch — siapa yang boleh mengunggah batch PDT untuk sebuah toko
 * klien (Flow A langkah 1-2). AM pemilik klien, atau lead/Director Account.
 */
export function canUploadBatch(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true; // Director membawa lead di mana pun
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/**
 * canKelolaBenchmark — Director SAJA (bukan OD murni). Preseden
 * `adsscanner_benchmark`/`px_eligibility_policy`: kalibrasi ini langsung
 * menggerakkan skor performa klien yang dikirim ke klien, bukan sekadar
 * bidang admin biasa (mayoritas bidang admin CDPS = OD baca, Director tulis).
 */
export function canKelolaBenchmark(actor: Actor): boolean {
  return actor.role.director;
}

/**
 * canKirimLaporan — siapa yang boleh menekan "Kirim ke klien" (Flow B
 * langkah 4, membekukan snapshot ke `pdt_laporan_kiriman`). Lingkup sama
 * seperti `canUploadBatch`: orang yang boleh mengunggah data toko itu adalah
 * orang yang sama yang boleh memutuskan angkanya boleh dikirim ke klien.
 */
export function canKirimLaporan(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}
