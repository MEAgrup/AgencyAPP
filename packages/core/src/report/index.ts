/**
 * @cdps/core report — the weekly/monthly client performance report engine
 * (`cdps.report.tiktok.v1`).
 *
 * Pure and DOM-free, exactly like `../baseline`: it consumes already-parsed
 * sheets (AoA → `readSheet`), classifies them by COLUMN SIGNATURE (never by
 * filename), computes every section against a VERSIONED benchmark pro-rated to
 * the period, and emits the payload the API stores and the renderer draws.
 */
export * from './types';
export * from './bench';
export * from './detect';
export * from './metrik';
export * from './skor';
export * from './insight';
export * from './payload';
export * from './run';
export * from './render';
