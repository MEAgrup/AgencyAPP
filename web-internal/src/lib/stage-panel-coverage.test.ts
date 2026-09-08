/**
 * M16 Rule 10 — gerbang intake "Cek Brief AM" harus punya TOMBOL di setiap
 * halaman tempat sebuah Brief dikerjakan.
 *
 * KENAPA TES INI ADA, dan kenapa bentuknya pemindaian sumber.
 *
 * `StageTimelinePanel` adalah satu-satunya UI untuk *Terima & proses* /
 * *Brief Dikembalikan ke AM*. PRD menyebut gerbang itu "wajib di semua divisi",
 * tapi selama berbulan-bulan panelnya hanya terpasang di empat halaman detail
 * Brief milik divisi yang punya board sendiri. Divisi yang masuk lewat antrean
 * generik `/tasks` karena itu **secara harfiah tidak punya cara menerima brief**
 * — dan tidak ada satu pun tes yang merah, karena setiap halaman lulus
 * tesnya sendiri dan yang hilang adalah PASANGAN halaman↔panel.
 *
 * Bentuknya sama dengan `route-parity.test.ts`: yang di-assert adalah pasangan,
 * bukan salah satu sisinya. Ditemukan lewat Feedback OD (Store Operation,
 * keluhan ke-10), diperbaiki lintas divisi — bukan dengan halaman khusus.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const APP = join(ROOT, 'src', 'app', '(shell)');

/**
 * Setiap halaman tempat seseorang membuka SATU Brief dan mengerjakannya.
 * `/tasks/[id]` adalah yang penting: ia melayani SETIAP divisi eksekusi yang
 * tidak punya halaman sendiri, jadi ia satu-satunya baris di sini yang menutup
 * lebih dari satu divisi sekaligus.
 */
const HALAMAN_BRIEF = [
  'account/briefs/[id]/page.tsx',
  'creative/briefs/[id]/page.tsx',
  'kol/briefs/[id]/page.tsx',
  'livestream/briefs/[id]/page.tsx',
  'store-ops/briefs/[id]/page.tsx',
  'tasks/[id]/page.tsx',
];

function sumber(rel: string): string {
  return readFileSync(join(APP, rel), 'utf8');
}

describe('M16 Rule 10 — cakupan StageTimelinePanel', () => {
  it.each(HALAMAN_BRIEF)('%s memasang StageTimelinePanel', (rel) => {
    const src = sumber(rel);
    expect(src, `${rel} tidak meng-import StageTimelinePanel`).toContain(
      "from '@/components/StageTimelinePanel'",
    );
    expect(src, `${rel} meng-import panelnya tapi tidak merendernya`).toContain('<StageTimelinePanel');
  });

  it('/tasks/[id] merender panelnya hanya untuk Brief, bukan untuk Aset', () => {
    // Tahapan menempel pada BRIEF, bukan pada Aset (M16 Rule 1). Merendernya
    // untuk sebuah Aset akan memanggil `/briefs/{AST-…}/stage` dan menampilkan
    // galat pada halaman yang sebetulnya sehat.
    const src = sumber('tasks/[id]/page.tsx');
    const i = src.indexOf('<StageTimelinePanel');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, i - 400), i)).toContain("source === 'brief'");
  });

  it('gerbang intake tidak mati untuk divisi TANPA pipeline (M16 Rule 12)', () => {
    // Ini setengah kedua dari cacat yang sama. Memasang panelnya di `/tasks`
    // belum cukup: kondisi yang memunculkan tombol "Terima & Proses" dulu hanya
    // `production_stage === 'Cek Brief AM'`, dan kolom itu NULL untuk divisi
    // yang belum punya pipeline (Rule 12 — hari ini Store Operation, LT-2).
    // Jadi panelnya muncul, tombolnya tidak, dan gerbang yang PRD sebut "wajib
    // di semua divisi" tetap mati justru di divisi yang paling butuh.
    //
    // Sisi server sudah benar lebih dulu: `stage.reviewBrief` mencatat baris
    // `brief_review` lalu melewati transisi tahapan saat pipeline-nya null (ada
    // tesnya di `stage.test.ts`). Yang diuji di sini bahwa sisi FE ikut.
    const src = readFileSync(
      join(ROOT, 'src', 'components', 'StageTimelinePanel.tsx'), 'utf8',
    );
    const i = src.indexOf('const pendingReview');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).toContain('stage_pipeline_code === null');
  });

  it('setiap halaman meneruskan assigned_division, bukan label divisi yang dihardcode', () => {
    // `assignedDivision` memilih daftar kode alasan pengembalian. Sebuah literal
    // di sini akan menawarkan alasan divisi lain — dan pada `/tasks` ia akan
    // salah untuk hampir semua pembacanya.
    for (const rel of HALAMAN_BRIEF) {
      const src = sumber(rel);
      const blok = src.slice(src.indexOf('<StageTimelinePanel'));
      expect(blok.slice(0, 600), `${rel}: assignedDivision di-hardcode?`).toMatch(
        /assignedDivision=\{[^}]*(assigned_division|taskDivision)/,
      );
    }
  });
});
