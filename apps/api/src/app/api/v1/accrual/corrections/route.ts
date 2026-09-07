/**
 * POST /api/v1/accrual/corrections — mencatat satu jurnal koreksi (Gelombang D,
 * D-3). Finance segala level atau Director.
 *
 * Satu-satunya jalan memperbaiki bulan yang sudah tertutup: barisnya mendarat di
 * bulan BERJALAN, menunjuk bulan tertutup yang diperbaiki, `nilai` BERTANDA
 * (negatif = koreksi turun), `alasan` wajib. Barisnya immutable — membatalkan
 * sebuah koreksi berarti mencatat koreksi kedua yang berlawanan, jadi tidak ada
 * PUT/DELETE di sini dan itu disengaja.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { barisKoreksiToWire } from '@/lib/wire';

interface Body {
  bulan?: string;
  bulan_dikoreksi?: string;
  nilai?: string;
  alasan?: string;
  client_id?: string | null;
  service_id?: string | null;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Body>(request);
    const k = await tutupbuku.catatKoreksi(db(), actor, {
      bulan: b.bulan ?? '',
      bulanDikoreksi: b.bulan_dikoreksi ?? '',
      nilai: b.nilai ?? '',
      alasan: b.alasan ?? '',
      clientId: b.client_id,
      serviceId: b.service_id,
    });
    return json({ koreksi: barisKoreksiToWire(k) }, 201);
  });
}
