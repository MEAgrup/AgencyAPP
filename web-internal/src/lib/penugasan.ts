'use client';

// Data layer for Penugasan Internal (`TSK-`) — atasan menugaskan anggota timnya.
//
// This is NOT M12. `lib/tasks.ts` executes work that already exists as a Brief
// or an Asset, and every one of those hangs off a paying client. This module is
// the other thing entirely: a task a Director/Head/SPV hands to a person, with a
// due date and a deliverable link, whose completion and lateness are recorded.
//
// The three lateness fields arrive PRE-COMPUTED from the server and are rendered
// as given. They are deliberately not re-derived in the browser: "am I late" is
// a WIB calendar comparison, and a second implementation here would eventually
// disagree with the one the discipline report counts.

import { api } from '@/lib/api';

/** Statuses of machine `internal_task`, in lifecycle order. */
export const PENUGASAN_STATUSES = [
  '[Ditugaskan]',
  '[Dikerjakan]',
  '[Selesai]',
  '[Dibatalkan]',
] as const;

/**
 * Divisions an assignment can target. Same list the rest of web-internal
 * duplicates locally per build convention (see `lib/tasks.ts` DIVISIONS), plus
 * the non-delivery divisions — a Director tasking Finance or Sales is exactly
 * the case M12 has no room for.
 */
export const PENUGASAN_DIVISIONS = [
  'Sales',
  'Marketing',
  'Finance',
  'Account',
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
] as const;

/** One TSK- row. Mirrors `InternalTaskWire` in apps/api/src/lib/wire.ts. */
export interface Penugasan {
  id: string;
  judul: string;
  deskripsi: string;
  assignee_id: string;
  assignee_division: string;
  due_date: string; // YYYY-MM-DD
  lampiran_link: string;
  link_hasil: string;
  status: string;
  dimulai_pada: string | null;
  selesai_pada: string | null;
  dibatalkan_pada: string | null;
  alasan_pembatalan: string;
  created_at: string;
  created_by: string;
  /** Belum selesai dan sudah lewat jatuh tempo. */
  terlambat_berjalan: boolean;
  /** Sudah selesai, tapi lewat jatuh tempo — catatan permanen. */
  selesai_terlambat: boolean;
  hari_terlambat: number;
}

/** One PIC's row in the discipline report. Mirrors `DisciplineRowWire`. */
export interface RekapDisiplin {
  assignee_id: string;
  assignee_division: string;
  total: number;
  selesai_tepat_waktu: number;
  selesai_terlambat: number;
  terlambat_berjalan: number;
  berjalan: number;
  dibatalkan: number;
  /** null when nothing has been closed yet — render `ketepatan_display`, not this. */
  ketepatan_pct: number | null;
  /** PRE-FORMATTED ("87.50%" | "—"). Render verbatim; never reformat (house rule #7). */
  ketepatan_display: string;
  total_hari_terlambat: number;
}

export interface PenugasanFilter {
  assignee?: string;
  division?: string;
  status?: string;
  /** Only late rows (running-late or finished-late). */
  terlambat?: boolean;
}

function qs(f: PenugasanFilter): string {
  const p = new URLSearchParams();
  if (f.assignee) p.set('assignee', f.assignee);
  if (f.division) p.set('division', f.division);
  if (f.status) p.set('status', f.status);
  if (f.terlambat) p.set('terlambat', '1');
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

export function listPenugasan(filter: PenugasanFilter = {}): Promise<{ data: Penugasan[] }> {
  return api.get<{ data: Penugasan[] }>(`/penugasan${qs(filter)}`);
}

export function getPenugasan(id: string): Promise<Penugasan> {
  return api.get<Penugasan>(`/penugasan/${id}`);
}

export function getRekapDisiplin(filter: PenugasanFilter = {}): Promise<{ data: RekapDisiplin[] }> {
  return api.get<{ data: RekapDisiplin[] }>(`/penugasan/rekap${qs(filter)}`);
}

export interface PenugasanInput {
  judul: string;
  deskripsi?: string;
  assignee_id: string;
  due_date: string; // YYYY-MM-DD
  lampiran_link?: string;
}

export function createPenugasan(input: PenugasanInput): Promise<Penugasan> {
  return api.post<Penugasan>('/penugasan', input);
}

export function mulaiPenugasan(id: string): Promise<Penugasan> {
  return api.post<Penugasan>(`/penugasan/${id}/mulai`);
}

/** `link_hasil` is mandatory server-side — the button is disabled until it is filled. */
export function selesaiPenugasan(id: string, linkHasil: string): Promise<Penugasan> {
  return api.post<Penugasan>(`/penugasan/${id}/selesai`, { link_hasil: linkHasil });
}

export function batalPenugasan(id: string, alasan: string): Promise<Penugasan> {
  return api.post<Penugasan>(`/penugasan/${id}/batal`, { alasan });
}

// --- Small pure helpers (duplicated per build convention; no shared-file edits) ---

/** A one-word lateness label for a row, or '' when it is not late. */
export function labelKeterlambatan(t: Penugasan): string {
  if (t.selesai_terlambat) return `Selesai terlambat ${t.hari_terlambat} hari`;
  if (t.terlambat_berjalan) return `Terlambat ${t.hari_terlambat} hari`;
  return '';
}

/** Can this actor still act on the task at all? Terminal rows are read-only. */
export function isTerminal(t: Penugasan): boolean {
  return t.status === '[Selesai]' || t.status === '[Dibatalkan]';
}
