/**
 * GET /api/v1/adopsi — Adopsi Sistem (pemilik 2026-09-10, Bagian 1): satu baris
 * per (bulan, anggota) dengan jam · sesi · page view · cakupan fitur perannya.
 *
 * `?from=&to=` ("YYYY-MM", inklusif) mempersempit; keduanya boleh diabaikan
 * untuk seluruh riwayat.
 *
 * PERMISSION — `adopsi.canViewAdopsi`: OD/Director (seluruh agensi) atau lead
 * divisi (divisinya sendiri saja, disaring di `adopsiReport` lewat
 * `adopsiScopeFor`). Ketokan pemilik 2026-09-11, `PR4-SIAPA-BOLEH-LIHAT`.
 *
 * Gerbang di rute ini sengaja hanya menjawab BOLEH/TIDAK; CAKUPANNYA diputuskan
 * satu kali di domain. Menyalinnya ke sini berarti dua tempat yang bisa
 * berselisih, dan yang kalah adalah yang tidak diuji. Lihat kepala `adopsi.ts`.
 *
 * ── Kenapa `db()` dan BUKAN `readAsActor` ────────────────────────────────
 *
 * `page_views` terkunci PENUH dari `authenticated` (pola O51, migrasi
 * `20261003010000`): nol grant, nol policy, dan `rls_checks.sql` §9
 * meng-assert bahwa bahkan klaim Director ditolak di tabelnya. `readAsActor`
 * berpindah ke peran `authenticated`, jadi ia akan menabrak 42501 dan halaman
 * ini menjawab 500 — persis yang terjadi saat tes rute ini pertama
 * dijalankan, dan itulah kenapa tesnya ada.
 *
 * Konsekuensinya harus dinyatakan, bukan dianggap detail: **di rute ini RLS
 * BUKAN penegaknya.** `canViewAdopsi` di atas adalah satu-satunya gerbang,
 * dan ia diperiksa SEBELUM `db()` disentuh. Pola yang sama dengan
 * `strategi_share_*` (M6A §7): tabel yang tidak punya pembaca `authenticated`
 * sama sekali dijaga di lapisan domain, bukan di policy yang tidak akan
 * pernah dievaluasi siapa pun.
 */
import { adopsi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adopsiReportToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!adopsi.canViewAdopsi(actor)) {
      throw new adopsi.ForbiddenError();
    }
    const q = new URL(request.url).searchParams;
    const report = await adopsi.adopsiReport(db(), actor, {
      from: q.get('from'),
      to: q.get('to'),
    });
    return json({ data: adopsiReportToWire(report) });
  });
}
