/**
 * /api/v1/creative/scs/tasks/{id}/transition — SATU pintu untuk mesin #34.
 *
 * Satu rute dengan `aksi` di body, bukan tujuh rute: gerbang PERAN tiap langkah
 * berbeda (PIC vs lead) dan hidup di domain, jadi tujuh handler hanya akan jadi
 * tujuh salinan `requireActor → domain → json` yang berbeda satu kata. Yang
 * TIDAK diterima di sini adalah nama STATE mentah — sebuah body `{to: '[Approved]'}`
 * akan melewati gerbang peran yang menempel pada aksinya.
 */
import { scs } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { scsTaskToWire } from '@/lib/wire';

const AKSI = {
  mulai: 'mulai',
  submit: 'submit',
  buka_review: 'buka_review',
  setujui: 'setujui',
  minta_revisi: 'minta_revisi',
  lanjut: 'lanjut',
  blokir: 'blokir',
  buka_blokir: 'buka_blokir',
} as const;

type Aksi = keyof typeof AKSI;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<{ aksi?: string; link_hasil?: string }>(request);
    const aksi = (b?.aksi ?? '') as Aksi;
    const sql = db();
    switch (aksi) {
      case 'mulai':
        return json(scsTaskToWire(await scs.startScsTask(sql, actor, id)));
      case 'submit':
        return json(scsTaskToWire(await scs.submitScsTask(sql, actor, id, b?.link_hasil ?? '')));
      case 'buka_review':
        return json(scsTaskToWire(await scs.openReviewScsTask(sql, actor, id)));
      case 'setujui':
        return json(scsTaskToWire(await scs.approveScsTask(sql, actor, id)));
      case 'minta_revisi':
        return json(scsTaskToWire(await scs.requestRevisionScsTask(sql, actor, id)));
      case 'lanjut':
        return json(scsTaskToWire(await scs.resumeScsTask(sql, actor, id)));
      case 'blokir':
        return json(scsTaskToWire(await scs.blockScsTask(sql, actor, id)));
      case 'buka_blokir':
        return json(scsTaskToWire(await scs.unblockScsTask(sql, actor, id)));
      default:
        // Aksi tak dikenal adalah 400 dengan pesan BI rumah, BUKAN 500 dan
        // bukan diam-diam no-op yang membuat layar terlihat "tidak merespons".
        throw new scs.ValidationError();
    }
  });
}
