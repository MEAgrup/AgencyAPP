/**
 * GET /api/v1/strategi/katalog-pilar — daftar pilihan aksi untuk editor pilar
 * Section E (E-3…E-10).
 *
 * Penerus `GET /strategi/{id}/copilot`, yang pensiun bersama AM Co-Pilot
 * (`docs/DECISIONS.md` 2026-09-21). Perbedaan yang menjadi seluruh alasan
 * endpoint ini ada: **ia tidak membaca `riset_awal_analisa` sama sekali**.
 * Katalognya statis dan sama untuk setiap klien, jadi klien tanpa Riset Awal
 * — yang dulu terkunci total dari Section E — kini tetap bisa mengisinya.
 *
 * Karena itu pula pathnya TIDAK ber-`{id}`: tidak ada satu pun data Strategi
 * yang masuk ke jawabannya. Segmen statis `katalog-pilar` menaungi `[id]` di
 * router, dan itu aman — nol id Strategi berbentuk `PREFIX-YYYYMM-NNNN` yang
 * bisa bertabrakan dengannya.
 *
 * Usulan saja: nol baris `strategi_pillar` ditulis di sini. AM memilih di
 * editor dan `PUT /strategi/{id}/pillars` yang menyimpan — gerbangnya tetap
 * submit → approve (mesin #15), tidak ada gerbang kedua.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { katalogPilarAksiToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await strategi.listKatalogPilar(db(), actor);
    return json({ data: rows.map(katalogPilarAksiToWire) });
  });
}
