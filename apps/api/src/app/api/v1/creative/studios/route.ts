/**
 * /api/v1/creative/studios — registry ruang produksi (M19 §5.1).
 *
 * Dilayani dari konstanta `packages/core/src/dailyops.ts`, BUKAN dari query —
 * ia dual-home dengan tabel `studios` dan `packages/db/src/dailyops.registry.test.ts`
 * yang memaksa keduanya set-equal. Membacanya dari DB di sini hanya menambah
 * round-trip untuk empat baris yang tidak pernah berubah tanpa migrasi.
 *
 * `cek_konflik` ikut dikirim supaya halaman tahu studio mana yang TIDAK
 * memperingatkan tumpang-tindih (`Luar Kantor`) dan tidak menjanjikan
 * peringatan yang tidak akan datang.
 */
import { dailyops } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { studioToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    return json({ data: dailyops.listStudios().map(studioToWire) });
  });
}
