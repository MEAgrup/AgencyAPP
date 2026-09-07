/**
 * GET /api/v1/strategi/{id}/copilot — usulan pilar Section E dari AM Co-Pilot,
 * dihitung di server (B4).
 *
 * Sebelum ini satu-satunya jalan mengisi E-3…E-10 adalah rantai tiga salin-tempel
 * JSON lewat `/tools/am-copilot` (handoff Gelombang B §4.2), dan hasilnya Section
 * E kosong di hampir semua Strategi (`DECISIONS.md` 2026-09-02). Karena Co-Pilot
 * adalah mesin aturan deterministik — bukan AI — logikanya dijalankan di
 * `@cdps/core` dan endpoint ini menyajikannya langsung dari
 * `riset_awal_analisa.payload`, tanpa export, tanpa file, tanpa tempel.
 *
 * Pola bacanya SENGAJA identik dengan `baseline-prefill/route.ts` di direktori
 * sebelah: `db()` + gerbang domain (`canReadStrategi`), bukan `readAsActor`. Dua
 * endpoint bersaudara di halaman yang sama dengan dua jalur baca berbeda adalah
 * drift yang baru terasa saat salah satunya diubah.
 *
 * Usulan saja — route ini tidak menulis apa pun. Baris pilar baru ada setelah AM
 * mencentang dan `PUT /strategi/{id}/pillars` menyimpannya; gerbangnya tetap
 * submit → approve (mesin #15), tidak ada gerbang kedua. `null` saat klien belum
 * punya interview ber-skor atau riset awalnya belum menghasilkan baris analisa.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { strategiCopilotUsulanToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const usulan = await strategi.susunPilarUsulan(db(), actor, id);
    return json(usulan === null ? null : strategiCopilotUsulanToWire(usulan));
  });
}
