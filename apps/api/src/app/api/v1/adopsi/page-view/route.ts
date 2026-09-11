/**
 * POST /api/v1/adopsi/page-view — satu baris log adopsi (pemilik 2026-09-10,
 * Bagian 1).
 *
 * Dipanggil `web-internal` pada SETIAP perpindahan rute, jadi rute ini punya
 * kewajiban yang tidak biasa: **ia tidak boleh pernah merusak halaman yang
 * memanggilnya.** Pemanggilnya `void`-kan hasilnya dan menelan galatnya; di
 * sisi ini, `adopsi.recordPageView` sengaja memotong alih-alih menolak. Sebuah
 * 400 dari log pemakaian akan muncul sebagai galat pada halaman yang
 * sebenarnya baik-baik saja.
 *
 * **`employee_id` TIDAK PERNAH datang dari badan permintaan** — ia diambil dari
 * klaim JWT (`requireActor`). Jadi tidak ada bentuk permintaan yang bisa
 * menulis jejak atas nama orang lain, dan itu bukan detail implementasi
 * melainkan satu-satunya alasan angka laporan ini bisa dipercaya sama sekali.
 *
 * `nav_href`/`nav_total` DATANG dari klien, dan itu disengaja: gerbang
 * visibilitas menu adalah FUNGSI di `web-internal/src/lib/nav.ts`
 * (`visibleNav(role)`), bukan data. Menyalinnya ke server akan menciptakan
 * versi kedua dari aturan yang sama, dan versi kedua itu akan menyimpang.
 * Konsekuensinya dinyatakan, bukan disembunyikan: seorang pemanggil yang
 * membuat permintaannya sendiri bisa melaporkan `nav_total` palsu dan
 * menggeser persentase cakupan fitur DIRINYA SENDIRI. Itu bisa diterima
 * justru karena pemilik menyatakan angka ini bukan komponen reward — tidak ada
 * yang didapat dari memalsukannya. Kalau suatu hari ia jadi komponen
 * penilaian, kalimat inilah yang harus dibantah lebih dulu, dan penyebutnya
 * harus pindah ke server.
 *
 * Menulis lewat `db()` (service-role), bukan `readAsActor`: `page_views`
 * terkunci penuh dari `authenticated` (pola O51, migrasi `20261003010000`).
 */
import { adopsi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

interface Body {
  path?: unknown;
  nav_href?: unknown;
  nav_total?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!adopsi.canRecordPageView(actor)) {
      throw new adopsi.ForbiddenError();
    }
    const body = await readJson<Body>(request);
    await adopsi.recordPageView(db(), actor, {
      path: typeof body.path === 'string' ? body.path : '/',
      navHref: typeof body.nav_href === 'string' ? body.nav_href : null,
      navTotal: typeof body.nav_total === 'number' ? body.nav_total : 0,
    });
    return json({ data: { recorded: true } }, 201);
  });
}
