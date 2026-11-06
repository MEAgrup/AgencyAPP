/**
 * GET /api/v1/bridge/belum-lunas — BRIDGE-DP (opsi b, keputusan pemilik
 * 2026-11-04): klien MEAGO yang order-nya diterima saat pembayaran klien belum
 * lunas (snapshot MSDPS 0377), untuk follow-up Finance. Row scope = RLS
 * (`client_external_billing_select`: read-all | lead Account | Finance semua
 * level | AM pemilik klien) — tanpa gerbang TS tambahan, pola
 * `bridge/orders` GET.
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { klienBelumLunasToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => bridge.listBelumLunas(sql));
    return json({ data: rows.map(klienBelumLunasToWire) });
  });
}
