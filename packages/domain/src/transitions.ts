/**
 * Batched reader for the immutable transition log (P-1 optimasi kecepatan).
 *
 * KENAPA ADA. Modul agregasi (M12 task metrics, M13 health, M14 performance)
 * merekonstruksi metrik turunan DARI audit_log (house rule 4: derived fields
 * selalu recomputable dari log). Implementasi awalnya membaca log SATU entity per
 * query di dalam loop — pola N+1. Datanya kecil, tapi tiap baris = satu round-trip
 * ke pooler Supabase, jadi satu halaman bisa menembak ratusan round-trip dan
 * halamannya lambat walau tabelnya nyaris kosong (handoff P-1: latency-bound,
 * bukan volume-bound).
 *
 * `loadTransitions` menarik log SEMUA entity sekaligus dalam SATU query
 * (`entity_id = any(...)`) lalu mengelompokkannya di memori. Hasil per entity
 * identik byte-per-byte dengan pembacaan satu-satu — urutan baris dipertahankan
 * lewat parameter `order` karena dua pemanggil memakai urutan berbeda:
 *
 *   - 'id'         → `order by id asc` (M14 performance).
 *   - 'created_at' → `order by created_at asc, id asc` (M13 health, M12 task).
 *
 * Keduanya dipertahankan apa adanya; menyeragamkannya akan mengubah hasil hitung
 * pada baris yang created_at-nya di-backdate, dan P-1 wajib nol perubahan perilaku.
 *
 * CATATAN SCOPE. Batching TIDAK melebarkan visibilitas: `ids` selalu berasal dari
 * query yang sudah melewati gerbang scope pemanggil (RLS saat lewat readAsActor,
 * atau filter TS yang sama saat lewat db()). Fungsi ini hanya membaca log milik id
 * yang sudah boleh dilihat pemanggil.
 */

import type { Queryable } from '@cdps/db';
import type { Transition } from './task';

/** Row shape of the batched audit read. */
interface TransitionRow {
  entity_id: string;
  action: string;
  created_at: Date;
}

/** Ordering of the transition list, per calling module (see file header). */
export type TransitionOrder = 'id' | 'created_at';

/**
 * transitionTarget extracts B from a "transition:A->B" audit action, or null when
 * the action is not a transition at all.
 */
export function transitionTarget(action: string): string | null {
  const prefix = 'transition:';
  if (!action.startsWith(prefix)) {
    return null;
  }
  const idx = action.indexOf('->', prefix.length);
  return idx < 0 ? null : action.slice(idx + 2);
}

/**
 * loadTransitions reads the transition log for MANY entities of one type in a
 * single round trip and returns entityId → ascending transition list.
 *
 * Entities with no transition row are absent from the map; callers must treat a
 * miss as an empty list (helper `transitionsOf`). An empty `ids` issues no query.
 */
export async function loadTransitions(
  q: Queryable,
  entityType: string,
  ids: readonly string[],
  order: TransitionOrder = 'id',
): Promise<Map<string, Transition[]>> {
  const out = new Map<string, Transition[]>();
  if (ids.length === 0) {
    return out;
  }
  // Dedupe so a repeated id does not inflate the array parameter.
  const unique = [...new Set(ids)];
  const rows =
    order === 'id'
      ? await q<TransitionRow[]>`
          select entity_id, action, created_at from audit_log
           where entity_type = ${entityType} and entity_id = any(${unique})
             and action like 'transition:%'
           order by id asc`
      : await q<TransitionRow[]>`
          select entity_id, action, created_at from audit_log
           where entity_type = ${entityType} and entity_id = any(${unique})
             and action like 'transition:%'
           order by created_at asc, id asc`;
  for (const r of rows) {
    const to = transitionTarget(r.action);
    if (to === null) {
      continue;
    }
    const list = out.get(r.entity_id);
    if (list === undefined) {
      out.set(r.entity_id, [{ to, at: r.created_at }]);
    } else {
      list.push({ to, at: r.created_at });
    }
  }
  return out;
}

/** transitionsOf reads one entity's list out of a batch, treating a miss as empty. */
export function transitionsOf(batch: Map<string, Transition[]>, id: string): Transition[] {
  return batch.get(id) ?? [];
}
