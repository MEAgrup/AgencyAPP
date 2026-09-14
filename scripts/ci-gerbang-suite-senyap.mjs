#!/usr/bin/env node
/**
 * Gerbang CI: sebuah berkas tes TIDAK BOLEH lolos tanpa menjalankan satu tes pun.
 *
 * KENAPA ADA. 2026-09-12 migrasi `20261009010000_px_m2a_client_platforms_unique_active`
 * memasang UNIQUE baru; `seedLaporan` di `gelombang-c-showcase.e2e.test.ts`
 * melanggarnya pada panggilan kedua. Kegagalannya jatuh di `beforeAll`, jadi yang
 * runtuh adalah SUITE-nya, bukan satu tes — dan Vitest melaporkan kedua belas
 * tesnya sebagai "skipped", bukan merah. Ringkasan CI terbaca
 * "555 passed | 14 skipped": rapi, wajar, dan salah. `db-and-migrations` merah
 * DUA HARI sementara dua belas tes pagar Showcase (siapa boleh melihat klien
 * siapa, ledger izin immutable) tidak pernah dijalankan sama sekali.
 *
 * Merahnya CI bukan yang gagal — pesan CI-nya yang gagal. Skrip ini menutup
 * selisih itu: ia menyebut BERKASNYA dan menyebut berapa tes yang hilang.
 *
 * DUA BENTUK YANG DITANGKAP, dan yang kedua justru lebih berbahaya:
 *   1. Berkas ber-status `failed` yang NOL tesnya dijalankan — gagal di
 *      setup/impor. Inilah kasus 2026-09-12.
 *   2. Berkas yang NOL tesnya dijalankan tapi CI-nya HIJAU — mis. seluruh
 *      `describe.skipIf(!DATABASE_URL)` mati karena env tidak terpasang di job
 *      yang seharusnya punya DB. Bentuk ini tidak pernah memerahkan apa pun,
 *      jadi tanpa gerbang ini ia bisa hidup selamanya.
 *
 * Tes yang dilewati SATUAN (mis. dua tes Storage yang menunggu jaringan) bukan
 * urusan skrip ini: selama berkasnya masih menjalankan tes lain, ia terlihat.
 *
 * Pemakaian:  node scripts/ci-gerbang-suite-senyap.mjs <hasil.json> [...]
 * Berkas JSON dihasilkan `vitest run --reporter=json --outputFile=...`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

/**
 * Berkas yang memang SENGAJA tidak menjalankan tes tanpa flag tambahan.
 * Setiap baris WAJIB membawa alasannya — daftar tanpa alasan akan pelan-pelan
 * menampung justru hal yang gerbang ini cari.
 */
const DIIZINKAN = new Map([
  [
    'packages/domain/src/wave1_uat.e2e.test.ts',
    'UAT Gelombang 1 — opt-in lewat `UAT=1` (lihat `const RUN` di berkasnya), bukan bagian lari CI biasa',
  ],
]);

const AKAR = process.cwd();
const berkas = process.argv.slice(2);
if (berkas.length === 0) {
  console.error('pemakaian: node scripts/ci-gerbang-suite-senyap.mjs <hasil.json> [...]');
  process.exit(2);
}

const temuan = [];
let diperiksa = 0;

for (const jalur of berkas) {
  if (!existsSync(jalur)) {
    // Langkah tes yang tidak pernah jalan (job dihentikan lebih dulu) bukan
    // temuan gerbang ini — tapi juga tidak boleh lewat tanpa terlihat.
    console.log(`~ lewati ${jalur}: berkas hasil tidak ada`);
    continue;
  }
  const data = JSON.parse(readFileSync(jalur, 'utf8'));
  for (const berkasTes of data.testResults ?? []) {
    diperiksa++;
    const semua = berkasTes.assertionResults ?? [];
    const dijalankan = semua.filter((t) => t.status === 'passed' || t.status === 'failed').length;
    if (dijalankan > 0) continue;

    const nama = relative(AKAR, berkasTes.name);
    if (DIIZINKAN.has(nama)) continue;

    temuan.push({
      nama,
      status: berkasTes.status,
      hilang: semua.length,
      pesan: (berkasTes.message ?? '').split('\n').find((b) => b.trim() !== '') ?? '',
    });
  }
}

if (temuan.length === 0) {
  console.log(`✓ ${diperiksa} berkas tes diperiksa — tidak ada yang lolos tanpa menjalankan tes.`);
  process.exit(0);
}

console.error('');
console.error('✗ GERBANG SUITE SENYAP — berkas berikut TIDAK menjalankan satu tes pun:');
console.error('');
for (const t of temuan) {
  console.error(`  ${t.nama}`);
  console.error(`      status berkas : ${t.status}`);
  console.error(`      tes yang tidak pernah jalan : ${t.hilang}`);
  if (t.pesan) console.error(`      sebab : ${t.pesan}`);
  console.error('');
}
console.error('Kalau ini gagal di setup (beforeAll/impor), perbaiki sebabnya — JANGAN');
console.error('dibaca sebagai "skipped". Kalau memang sengaja dilewati, tambahkan ke');
console.error('DIIZINKAN di skrip ini BESERTA alasannya.');
process.exit(1);
