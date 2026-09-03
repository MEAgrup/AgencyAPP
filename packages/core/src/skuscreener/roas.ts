/**
 * Target ROAS — a plain manual number input, default 4.
 *
 * `docs/DECISIONS.md` O66 (2026-09-03, RESOLVED): the owner chose to mirror
 * the shipped tool exactly rather than the PRD — Target ROAS stays a MANUAL
 * NUMBER FIELD the advertiser types in (sourced from their own EKONOMI_KLIEN
 * tab calculation done outside this tool), default `4` (`<input id="target"
 * value="4">` in `docs/design/MEA_SKU_SCREENER_v2.html`), NOT the PRD's
 * default `3.57`. PRD §2.2 R07 (target ROAS auto-selected by client phase
 * 1/2/3) and R08 (biaya platform / service-fee-per-order derivation feeding
 * that auto-selection) are OWNER-CONFIRMED DEVIATIONS from the PRD — the
 * shipped tool never computes a target ROAS from client economics, and the
 * port keeps that behaviour verbatim: "nol risiko kejutan buat tim, perilaku
 * port persis sama dengan yang sudah dipakai sehari-hari."
 *
 * ⛔ DO NOT wire `roasFloorKontribusi`/`roasBreakEvenPenuh`/`roasTargetProfit`
 * below into `DEFAULT_TARGET_ROAS` or into any auto-population of the target
 * field. That exact idea was raised and explicitly rejected in O66. If CDPS
 * later stores client margin/platform-fee/service-fee data cleanly and the
 * team wants auto-calculation, that is a NEW decision (a new DECISIONS.md
 * entry), not a bug fix on this file.
 *
 * The three functions below exist ONLY because:
 *   (a) R07/R08's formulas are well-defined, auditable pure math that the
 *       PRD's own worked example (§4.3, Sperantia) gives exact numbers for,
 *       and the porting brief asks for that example as a fixture test; and
 *   (b) having the formula available, tested, and clearly quarantined from
 *       the manual-input path is safer than leaving it undocumented — a
 *       future AM-facing "your target looks low vs. floor kontribusi"
 *       advisory display could read them WITHOUT changing the manual input's
 *       behaviour, the same way a lint warning doesn't change the code it
 *       warns about.
 * This split (formula implemented + tested, but NOT wired to any default or
 * auto-fill) is a judgment call beyond what the porting brief specifies
 * verbatim — flagged prominently in the handoff report for confirmation.
 */

/** The shipped tool's default (`<input id="target" value="4">`), NOT the PRD's 3.57 (O66). */
export const DEFAULT_TARGET_ROAS = 4;

/** Flow A3 error path: "ROAS ≤ 0 → validasi error." PRD gives no rule-specific bracket text, so the house default applies (CLAUDE.md rule #5). */
export const MSG_TARGET_ROAS_INVALID = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

export type TargetRoasValidation = { ok: true; value: number } | { ok: false; message: string };

/** Flow A3: Target ROAS must be > 0. */
export function validateTargetRoas(v: number): TargetRoasValidation {
  if (!isFinite(v) || !(v > 0)) return { ok: false, message: MSG_TARGET_ROAS_INVALID };
  return { ok: true, value: v };
}

// ─────────────────────────────────────────────────────────────────────────
// R07/R08 reference calculators — NOT wired to any default. See file header.
// ─────────────────────────────────────────────────────────────────────────

/** R08 — biaya platform dihitung dari harga jual, bukan dari margin. */
export interface BiayaPlatformInput {
  hargaJual: number;
  adminPct: number;
  komisiPct: number;
  biayaProgramLainPct: number;
}

/** R08: biaya_platform_Rp = (admin% + komisi% + biaya_program_lain%) × harga_jual. */
export function biayaPlatform({ hargaJual, adminPct, komisiPct, biayaProgramLainPct }: BiayaPlatformInput): number {
  return ((adminPct + komisiPct + biayaProgramLainPct) / 100) * hargaJual;
}

/** R08: service_fee_per_pesanan = service_fee_bulanan_Rp ÷ pesanan_per_bulan. `—` (NaN) when pesanan_per_bulan ≤ 0 — never a fabricated Rp figure. */
export function serviceFeePerPesanan(serviceFeeBulananRp: number, pesananPerBulan: number): number {
  return pesananPerBulan > 0 ? serviceFeeBulananRp / pesananPerBulan : NaN;
}

/**
 * R07 Fase 1 (bulan 0-6) — ROAS Floor Kontribusi = harga_jual ÷ (margin_Rp −
 * biaya_platform_Rp). Verified against PRD §4.3 (Sperantia): AOV Rp80.000,
 * margin 40% (Rp32.000), platform 12% (Rp9.600) ⇒ floor = 80.000 ÷ 22.400 = 3.57.
 */
export function roasFloorKontribusi(hargaJual: number, marginRp: number, biayaPlatformRp: number): number {
  const kontribusi = marginRp - biayaPlatformRp;
  return kontribusi > 0 ? hargaJual / kontribusi : NaN;
}

/** R07 Fase 2 (bulan 6-12) — ROAS Break-Even Penuh = harga_jual ÷ (margin − platform − service_fee_per_pesanan). */
export function roasBreakEvenPenuh(hargaJual: number, marginRp: number, biayaPlatformRp: number, serviceFeePerPesananRp: number): number {
  const basis = marginRp - biayaPlatformRp - serviceFeePerPesananRp;
  return basis > 0 ? hargaJual / basis : NaN;
}

/** R07 Fase 3 (bulan 12+) — ROAS Target Profit = harga_jual ÷ (margin − platform − service_fee_per_pesanan − target_profit). */
export function roasTargetProfit(
  hargaJual: number,
  marginRp: number,
  biayaPlatformRp: number,
  serviceFeePerPesananRp: number,
  targetProfitRp: number,
): number {
  const basis = marginRp - biayaPlatformRp - serviceFeePerPesananRp - targetProfitRp;
  return basis > 0 ? hargaJual / basis : NaN;
}
