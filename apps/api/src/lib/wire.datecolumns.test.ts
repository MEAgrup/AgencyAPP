/**
 * O49 — paritas NILAI untuk field yang di-backing kolom Postgres bertipe `date`.
 *
 * Kelas cacatnya: domain mengembalikan `Date`, converter memanggil `.toISOString()`,
 * dan halaman FE — yang mendeklarasikan field itu `// YYYY-MM-DD` dan sering
 * merendernya MENTAH (`{row.due_date || '—'}`) — menampilkan
 * `"2026-07-30T00:00:00.000Z"` di tempat sebuah tanggal.
 *
 * Kenapa ini butuh berkas test sendiri, bukan satu baris di `wire.test.ts`:
 * `shape-parity.test.ts` membandingkan **kunci**, bukan **nilai** — batas yang #78
 * nyatakan eksplisit. Jadi seluruh kelas ini lolos setiap gate yang ada. Ia
 * ditemukan lewat audit branch (commit `46e2a6d` yang hilang tanpa PR), bukan
 * lewat CI, dan tanpa gate di bawah ia bisa tumbuh kembali dengan cara yang sama.
 *
 * Bukti empiris kenapa `toISOString()` salah di sini (postgres.js, kolom `date`,
 * diuji pada TZ proses UTC dan Asia/Jakarta): driver menormalkan ke tengah malam
 * UTC, jadi `toISOString()` ⇒ `"2026-07-30T00:00:00.000Z"` **konsisten apa pun TZ**.
 * Artinya ini BUKAN off-by-one hari — ia "timestamp mentah di kolom tanggal".
 * Dicatat supaya tidak ada yang memperbaikinya dengan alasan yang salah.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { finance } from '@cdps/domain';
import { installmentToWire, remindersToWire } from './wire';

/**
 * Field wire yang di-backing kolom `date` dan HARUS dikirim `YYYY-MM-DD`.
 * Diturunkan dari skema, bukan dari ingatan:
 *   select table_name||'.'||column_name from information_schema.columns
 *    where table_schema='public' and data_type='date';
 */
const DATE_BACKED_WIRE_KEYS = ['due_date', 'verified_date', 'period_start', 'period_end',
  'start_date', 'end_date', 'timeline_start', 'timeline_end', 'effective_from',
  'recurring_end_date', 'managed_since'] as const;

/**
 * Ledger pola `KNOWN_GAPS`: field date-backed yang MASIH dikirim RFC3339.
 * **Hanya boleh menyusut.** Menambah baris = mengakui satu halaman menampilkan
 * timestamp di kolom tanggal, dan itu butuh entri `DECISIONS.md`.
 *
 * `managed_since` ada di sini karena ia **belum diputuskan**, bukan karena ia
 * benar: Go tidak konsisten dengan dirinya sendiri — `module0_sales/closing.go:50`
 * memakai `string` ber-komentar `// optional YYYY-MM-DD`, sedangkan
 * `module4_client/client.go:53` memakai `*time.Time` (RFC3339). FE juga terbelah:
 * `sales.ts:208` beranotasi `"YYYY-MM-DD"`, `clients.ts:12` tanpa anotasi.
 * Menebak salah satu = mengarang kontrak (O49 butir b, menunggu head dev).
 */
const RFC3339_PENDING_DECISION: readonly string[] = ['managed_since'];

const WIRE_SRC = readFileSync(join(__dirname, 'wire.ts'), 'utf8');

describe('O49 — kolom `date` dikirim YYYY-MM-DD, bukan RFC3339', () => {
  const inst: finance.InstallmentRow = {
    id: 'INST-202607-0001',
    installmentNo: 1,
    amount: 'Rp. 9.000.000,00',
    dueDate: new Date('2026-07-30T00:00:00.000Z'),
    status: '[Belum Jatuh Tempo]',
    jatuhTempo: false,
    verifiedDate: new Date('2026-07-28T00:00:00.000Z'),
    verifiedBy: '2412090425',
    proofOfPayment: 'https://drive/bukti',
  } as finance.InstallmentRow;

  it('installmentToWire mengirim due_date & verified_date sebagai YYYY-MM-DD', () => {
    const wire = installmentToWire(inst);
    expect(wire.due_date).toBe('2026-07-30');
    expect(wire.verified_date).toBe('2026-07-28');
    // Assertion yang benar-benar menangkap regresi: nol 'T' dan nol 'Z'.
    // `toBe('2026-07-30')` saja sudah cukup, tapi ini yang gagal lebih jelas
    // kalau seseorang mengganti formatternya dengan varian ISO lain.
    expect(wire.due_date).not.toMatch(/[TZ]/);
    expect(wire.verified_date).not.toMatch(/[TZ]/);
  });

  it('installmentToWire mengirim null EKSPLISIT, bukan menghilangkan kuncinya', () => {
    // Kunci HILANG mengeblank halaman, `null` tidak (stance O43 house-wide).
    const wire = installmentToWire({ ...inst, dueDate: null, verifiedDate: null });
    expect(wire.due_date).toBeNull();
    expect(wire.verified_date).toBeNull();
    expect('due_date' in wire).toBe(true);
    expect('verified_date' in wire).toBe(true);
  });

  it('remindersToWire mengirim due_date sebagai YYYY-MM-DD', () => {
    const row: finance.ReminderRow = {
      installmentId: 'INST-202607-0001',
      transactionId: 'TRX-202607-0001',
      clientId: 'CLI-202607-0001',
      toko: 'Toko A',
      installmentNo: 1,
      amount: 'Rp. 9.000.000,00',
      dueDate: new Date('2026-07-30T00:00:00.000Z'),
      daysOverdue: 3,
      salesPicId: '2101180004',
      status: '[Jatuh Tempo]',
      label: '[jatuh tempo 3 hari, segera tindak lanjuti]',
    } as finance.ReminderRow;

    const wire = remindersToWire({ overdue: [row], upcoming: [], outstandingNoDueDate: [] } as finance.ReminderDashboard);
    expect(wire.reminders).toHaveLength(1);
    expect(wire.reminders[0].due_date).toBe('2026-07-30');
    expect(wire.reminders[0].due_date).not.toMatch(/[TZ]/);
  });

  it('due_date yang dikirim = tanggal kalender yang dipakai daysOverdue', () => {
    // Ini alasan sebenarnya kenapa formatnya penting, bukan estetika: halaman
    // menampilkan due_date DI SAMPING days_overdue. Kalau keduanya diturunkan
    // dari tanggal kalender yang berbeda, barisnya saling membantah di depan
    // orang yang harus menagih.
    const dueDate = new Date('2026-07-30T00:00:00.000Z');
    const row = { installmentId: 'I', transactionId: 'T', clientId: 'C', toko: 'X',
      installmentNo: 1, amount: 'Rp. 1,00', dueDate, daysOverdue: 0,
      salesPicId: 'S', status: '[Jatuh Tempo]', label: '' } as finance.ReminderRow;
    const wire = remindersToWire({ overdue: [row], upcoming: [], outstandingNoDueDate: [] } as finance.ReminderDashboard);
    // tz.dateString adalah fungsi yang sama yang dipakai jalur daysOverdue
    // (tz.daysBetween beroperasi pada tanggal kalender WIB).
    expect(wire.reminders[0].due_date).toBe('2026-07-30');
  });

  /**
   * GATE — mencegah kelasnya tumbuh kembali. Membaca sumber `wire.ts` dan
   * menandai setiap field date-backed yang masih memakai `.toISOString()`.
   *
   * Divalidasi dengan mutasi: mengembalikan `due_date: i.dueDate.toISOString()`
   * membuat test ini MERAH. Gate yang belum pernah dibuktikan gagal belum
   * diketahui bekerja.
   */
  it('nol field date-backed memakai toISOString() di wire.ts (kecuali ledger)', () => {
    const offenders: string[] = [];
    for (const line of WIRE_SRC.split('\n')) {
      const m = /^\s*([a-z_0-9]+)\s*:\s*(.+)$/.exec(line);
      if (!m) continue;
      const [, key, value] = m;
      if (!(DATE_BACKED_WIRE_KEYS as readonly string[]).includes(key)) continue;
      if (!value.includes('toISOString()')) continue;
      if (RFC3339_PENDING_DECISION.includes(key)) continue;
      offenders.push(`${key}: ${value.trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it('ledger RFC3339_PENDING_DECISION jujur — tiap entri masih benar-benar ada', () => {
    // Ledger yang menyebut field yang sudah diperbaiki adalah fiksi, dan fiksi
    // di ledger membuat gate di atas melewatkan pelanggaran nyata bernama sama.
    for (const key of RFC3339_PENDING_DECISION) {
      const stillThere = WIRE_SRC.split('\n').some((l) => {
        const m = /^\s*([a-z_0-9]+)\s*:\s*(.+)$/.exec(l);
        return m?.[1] === key && m[2].includes('toISOString()');
      });
      expect(stillThere, `${key} sudah tidak memakai toISOString() — hapus dari RFC3339_PENDING_DECISION`).toBe(true);
    }
  });
});
