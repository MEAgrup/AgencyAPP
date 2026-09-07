/**
 * GET /api/v1/briefs/{id}/rollup — kenapa Brief ini BELUM bergerak (B-1a).
 *
 * `task.recomputeBriefRollup` punya empat jalan keluar yang tidak meninggalkan
 * jejak apa pun, dan dari halaman ketiganya terlihat identik: status tidak
 * berubah, tanpa galat, tanpa penjelasan. Yang paling sering menggigit adalah
 * `created < quantity_target` — Brief "12 video" dengan 3 Aset yang SEMUANYA
 * selesai tetap [In Progress] selamanya (keluhan Account #3 & #4). Rute ini
 * membuat sebabnya bisa dibaca.
 *
 * SEMUANYA TURUNAN, nol yang disimpan (aturan rumah #4) dan nol efek samping —
 * tidak ada transisi, audit, atau notifikasi di jalur ini.
 *
 * Gerbangnya `account.getBrief` lebih dulu, bukan predikat baru: siapa yang
 * boleh membaca diagnosis sebuah Brief adalah persis siapa yang boleh membaca
 * Brief-nya (M6 §9.1). Menuliskan aturan kedua di sini akan membuat dua sumber
 * kebenaran yang bisa berbeda. `readAsActor` untuk gerbangnya, lalu `db()`
 * untuk hitungannya: `assets`/`creator_bookings` punya gerbang baris sendiri
 * yang akan MENGURANGI hitungan "n dari N" tergantung siapa yang membaca —
 * dan angka progres yang berubah menurut pembacanya lebih buruk daripada tidak
 * ada angka sama sekali.
 */
import { account, task } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { briefRollupDiagnosisToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    await readAsActor(actor, (sql) => account.getBrief(sql, actor, id)); // gerbang baca (403/404)
    return json(briefRollupDiagnosisToWire(await task.diagnoseBriefRollup(db(), id)));
  });
}
