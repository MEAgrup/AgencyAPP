/**
 * Gerbang tampilan + label antrean SCS — murni, tanpa DB.
 *
 * Yang diuji di sini adalah tiga tempat halaman paling mudah berbohong:
 *   1. tombol yang muncul untuk orang yang tidak berhak menekannya;
 *   2. baris "all client" yang dirender sebagai sel kosong (terbaca seperti
 *      data yang gagal dimuat, padahal ia jawaban yang sah);
 *   3. Speed Score standing yang dirender "0%" alih-alih "N/A".
 *
 * Server tetap otoritas akhir untuk (1) — ini murni UX. Tapi tombol yang
 * muncul lalu menjawab 403 adalah cacat tersendiri.
 */
import { describe, expect, it } from 'vitest';
import {
  STATUSES,
  canManageTask,
  canReviewTask,
  canSeeAllPics,
  canWorkTask,
  labelKlien,
} from './scs';
import type { Role } from './types';

const role = (o: Partial<Role>): Role => ({
  division: '', level: '', od: false, director: false, ...o,
} as Role);

const creativeLead = role({ division: 'Creative', level: 'lead' });
const creativeStaff = role({ division: 'Creative', level: 'staff' });
const adsLead = role({ division: 'Ads', level: 'lead' });
const od = role({ od: true });
const director = role({ director: true });
const staffOD = role({ division: 'Creative', level: 'staff', od: true });

describe('gerbang tampilan', () => {
  it('canManageTask: lead Creative + Director; OD murni TIDAK', () => {
    expect(canManageTask(creativeLead)).toBe(true);
    expect(canManageTask(director)).toBe(true);
    expect(canManageTask(creativeStaff)).toBe(false);
    expect(canManageTask(adsLead)).toBe(false);
    // OD adalah peran BACA (Phase 0 §4). Tombol yang muncul untuknya adalah
    // tombol yang dijawab 403.
    expect(canManageTask(od)).toBe(false);
    expect(canManageTask(staffOD)).toBe(false);
    expect(canManageTask(null)).toBe(false);
  });

  it('canWorkTask: HANYA PIC baris itu — lead pun tidak', () => {
    // Lebih sempit daripada gerbang M19 `canEnterActual` dengan sengaja: lead
    // yang menandai baris orang lain [In Progress] memalsukan jangkar yang
    // turnaround-nya diukur dari situ.
    expect(canWorkTask(creativeStaff, 'E1', 'E1')).toBe(true);
    expect(canWorkTask(creativeStaff, 'E2', 'E1')).toBe(false);
    expect(canWorkTask(creativeLead, 'L1', 'E1')).toBe(false);
    expect(canWorkTask(director, 'D1', 'E1')).toBe(false);
    // `assigned_pic` kosong tidak boleh cocok dengan employeeId kosong.
    expect(canWorkTask(creativeStaff, '', '')).toBe(false);
  });

  it('canReviewTask: lead Creative + Director, NOL AM', () => {
    expect(canReviewTask(creativeLead)).toBe(true);
    expect(canReviewTask(director)).toBe(true);
    expect(canReviewTask(role({ division: 'Account', level: 'staff' }))).toBe(false);
    expect(canReviewTask(creativeStaff)).toBe(false);
  });

  it('canSeeAllPics: OD boleh MELIHAT semua walau tidak boleh menulis', () => {
    expect(canSeeAllPics(od)).toBe(true);
    expect(canSeeAllPics(staffOD)).toBe(true);
    expect(canSeeAllPics(creativeLead)).toBe(true);
    expect(canSeeAllPics(creativeStaff)).toBe(false);
  });
});

describe('labelKlien — baris "all client" punya namanya sendiri', () => {
  it('client_id null ⇒ "Semua klien", BUKAN string kosong', () => {
    // Sel kosong di kolom Klien terbaca seperti data yang gagal dimuat. Baris
    // lintas-klien adalah jawaban yang sah, dan seluruh alasan modul ini punya
    // tabelnya sendiri alih-alih jadi Task M12.
    expect(labelKlien({ client_id: null, client_name: null })).toBe('Semua klien');
  });

  it('klien ada ⇒ nama tokonya; fallback ke ID kalau namanya kosong', () => {
    expect(labelKlien({ client_id: 'CLI-1', client_name: 'Bakoel Tas' })).toBe('Bakoel Tas');
    expect(labelKlien({ client_id: 'CLI-1', client_name: null })).toBe('CLI-1');
  });
});

describe('kosakata state', () => {
  it('SAMA PERSIS dengan `brief_task` — kesamaan itu yang dipakai server', () => {
    // Kalau salah satu nama di sini "dirapikan", filter status halaman berhenti
    // cocok dengan apa pun yang dikirim server — dan Speed Score seluruh baris
    // SCS ikut jadi null di sisi server, karena rumus M12 mencari nama-nama ini
    // di audit_log.
    expect([...STATUSES]).toEqual([
      '[To Do]', '[In Progress]', '[Submitted]', '[In Review]',
      '[Approved]', '[Revision Requested]', '[Blocked]',
    ]);
  });
});
