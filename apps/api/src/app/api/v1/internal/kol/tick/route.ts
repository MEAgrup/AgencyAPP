/**
 * POST/GET /api/v1/internal/kol/tick — sapuan tenggat harian KOL (B-3):
 * pengingat H-1 & lewat tenggat per Booking, plus campaign yang mendekati
 * `tanggal_akhir`.
 *
 * Di Supabase sapuan ini berjalan dari pg_cron (`kol_reminder_tick`, 07:00 WIB
 * = 00:00 UTC — pengingat tenggat berguna di AWAL hari kerja), jadi job ini
 * SENGAJA tidak didaftarkan di `vercel.json`: pg_cron sudah memilikinya dan
 * memasang keduanya akan memanggilnya dua kali (tidak berbahaya — idempoten —
 * tapi membingungkan). Rute ini adalah fungsi yang SAMA, dijangkau dari cron
 * EKSTERNAL untuk deployment tanpa pg_cron, dan untuk backfill manual. Ia
 * melayani GET + `Authorization: Bearer` persis seperti saudara-saudaranya.
 *
 * Bukan pengguna yang login, jadi nol JWT: gerbangnya rahasia bersama lewat
 * `x-plan-tick-secret` atau `Authorization: Bearer` (`@/lib/tick-auth`) — gerbang
 * yang SAMA dengan tick M6B, dipakai ulang alih-alih menciptakan kredensial
 * sistem kedua yang harus dirotasi. Rahasia yang tidak diset berarti endpoint
 * TERTUTUP, bukan terbuka: env var yang hilang tidak boleh mengubah hook
 * privileged menjadi anonim.
 *
 * `waktu` di body POST (RFC3339) menggantikan "sekarang" untuk backfill/tes;
 * default jam dinding (GET, yang dipakai cron, tidak mengirim body).
 *
 * Nol pemanggil `web-internal` by design (route-parity itu FE→API): cron
 * satu-satunya klien.
 */
import { kol } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  waktu?: unknown;
}

/** Sapuannya sendiri, dipakai bersama GET (cron) dan POST (curl / GitHub Actions). */
async function runTick(when: Date | undefined): Promise<Response> {
  const res = await kol.runKolReminderTick(db(), when);
  return json({ h1: res.h1, jatuh_tempo: res.jatuhTempo, campaign_akhir: res.campaignAkhir });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const at = typeof body.waktu === 'string' ? new Date(body.waktu) : undefined;
    const when = at && !Number.isNaN(at.getTime()) ? at : undefined;
    return runTick(when);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick(undefined);
  });
}
