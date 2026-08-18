/**
 * @cdps/core baseline — Skor Kondisi Toko engine (RAB-02).
 *
 * A pure, DOM-free port of the owner's TikTok-Shop baseline tool
 * (`docs/design/BASELINE_TOOL_TIKTOK_v1.html`). Reads already-parsed sheets
 * (AoA), classifies them (12 signatures), computes the 5-pillar store-condition
 * score against a VERSIONED benchmark, and emits the `cdps.baseline.tiktok.v1`
 * payload. The xlsx binary parse and all identity/time inputs live at the caller
 * boundary (RAB-04); this engine is deterministic and unit-testable.
 *
 * Vocabulary firewall (handoff §2.3): the score's `kondisi_toko` values are
 * DELIBERATELY disjoint from the Blok C verdict enum — a bad store is the REASON
 * a client hires MEA, not a mark against the client.
 */
export * from './angka';
export * from './types';
export * from './benchmark';
export * from './errors';
export * from './sheet';
export * from './detect';
export * from './metrik';
export * from './riwayat';
export * from './skor';
export * from './meter';
export * from './temuan';
export * from './payload';
export * from './run';
