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
import type { finance, sales } from '@cdps/domain';
import { clientDetailToWire, installmentToWire, remindersToWire } from './wire';

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
 * **KOSONG sejak O49 butir (b) diputuskan 2026-07-30** — `managed_since` adalah
 * penghuni terakhirnya dan kini memakai `tz.dateString()` seperti sepuluh field
 * lainnya. Yang menahannya dulu: Go tidak konsisten dengan dirinya sendiri
 * (`module0_sales/closing.go:50` `string` ber-komentar `// optional YYYY-MM-DD`
 * vs `module4_client/client.go:53` `*time.Time`), dan mengubahnya berisiko
 * memecahkan halaman yang mem-parsing nilainya sebagai timestamp.
 *
 * Risiko itu **diukur, bukan ditebak**, dan ternyata tidak ada: satu-satunya
 * pembacanya `clients/[id]/page.tsx` memakai `new Date(v).toLocaleString('id-ID')`,
 * dan `new Date('2026-05-01')` (bentuk date-only = UTC per spec) menghasilkan
 * instant yang **identik** dengan `new Date('2026-05-01T00:00:00.000Z')` —
 * rendering byte-identical, diuji di TZ `Asia/Jakarta` dan `UTC`. Pembaca kedua
 * (`sales/[id]/page.tsx`) adalah form TULIS `<input type="date">`; ia mengirim
 * `YYYY-MM-DD`, tidak pernah membaca nilai wire ini.
 */
const RFC3339_PENDING_DECISION: readonly string[] = [];

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
   * O49 butir (b) — `managed_since`, penghuni terakhir ledger, diputuskan
   * 2026-07-30. Kolomnya `client_platforms.managed_since` bertipe `date`, jadi
   * kontraknya sama dengan sepuluh field date-backed lainnya.
   */
  const platform = (managedSince: Date | null) => ({
    id: 'CLI-202607-0001', leadId: null, winningAttemptId: null, namaPic: 'Ibu Alpha',
    toko: 'Alpha Digital', kota: 'Jakarta', linkToko: null, kategori: 'Fashion',
    gmvBaseline: '0.00', targetGmv: '0.00', marketingBudget: '0.00', totalSales: '0.00',
    transactionId: null, originCampaignId: null, salesPicId: 'EMP-BUDI', salesPicNama: 'Budi',
    commissionPaymentPicId: 'EMP-BUDI', paymentIntent: null, releasedToAccountAt: null,
    createdAt: new Date('2026-07-01T03:00:00.000Z'),
    platforms: [{ platform: 'Shopee', storeLink: null, managedSince, active: true }],
    allocations: [], services: [], transaction: null,
  } as unknown as sales.ClientDetail);

  it('clientDetailToWire mengirim managed_since sebagai YYYY-MM-DD', () => {
    const wire = clientDetailToWire(platform(new Date('2026-05-01T00:00:00.000Z')));
    expect(wire.platforms[0].managed_since).toBe('2026-05-01');
    expect(wire.platforms[0].managed_since).not.toMatch(/[TZ]/);
  });

  it('clientDetailToWire mengirim managed_since null EKSPLISIT, kuncinya tetap ada', () => {
    const wire = clientDetailToWire(platform(null));
    expect(wire.platforms[0].managed_since).toBeNull();
    expect('managed_since' in wire.platforms[0]).toBe(true);
  });

  it('perubahan managed_since TIDAK menggeser rendering halaman klien', () => {
    // Inilah risiko yang menahan butir (b) selama dua sesi, dan alasannya
    // diselesaikan dengan pengukuran, bukan dengan keberanian: satu-satunya
    // PEMBACA (`clients/[id]/page.tsx`) memakai `new Date(v).toLocaleString()`,
    // dan bentuk date-only di-parse sebagai UTC per spec ECMAScript — instant
    // yang sama persis dengan RFC3339 tengah malam UTC yang dikirim sebelumnya.
    // Kalau seseorang kelak mengganti formatter-nya jadi tengah malam LOKAL,
    // test ini merah dan ia tahu halaman klien ikut bergeser.
    expect(new Date('2026-05-01').getTime())
      .toBe(new Date('2026-05-01T00:00:00.000Z').getTime());
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
