/**
 * Baseline engine — temuan (findings) + arah strategi (RAB-02).
 * Ported VERBATIM from the tool `findings` + `arah` (lines 864-931).
 *
 * ⛔ Teks temuan = string pemilik apa adanya (house rule #5: jangan mengarang /
 * mengubah label BI). `level` = tantangan|perhatian|catatan|modal — label temuan
 * tool = TANTANGAN (keputusan 7), TERPISAH dari HAMBATAN MENDASAR Blok C.
 * Benchmark = parameter (`bench`), fix #4.
 */
import { dec, div, esc, median, num, pct, rp } from './angka';
import type { Metrics } from './metrik';
import type { HistStats } from './riwayat';
import type { Score } from './skor';
import type { Benchmark, Finding } from './types';

export function findings(M: Metrics, H: HistStats, _sc: Score, bench: Benchmark): Finding[] {
  const B = bench;
  const F: Finding[] = [];
  const add = (lv: Finding['lv'], t: string): void => {
    F.push({ lv, t });
  };
  if (H.cakupan === 'kurang')
    add('perhatian', `Riwayat GMV baru <b>${H.months} bulan</b>. Baseline belum kuat dipakai jadi angka target kontrak — pakai estimasi dan catat alasannya.`);
  if (H.spike)
    add('perhatian', `<b>${esc(H.peakRow ? H.peakRow.label : 'Satu bulan')}</b> ${dec(div(H.peak, H.med) as number, 1)}× median → bulan campaign. Target jangan pakai rata-rata mentah.`);
  if (H.trend != null && H.trend < -0.1)
    add('tantangan', `GMV turun <b>${pct(Math.abs(H.trend))}</b> (3 bulan terakhir vs 3 bulan sebelumnya). Toko masuk dalam kondisi menurun, bukan stagnan.`);
  if (H.trend != null && H.trend > 0.15)
    add('modal', `GMV naik <b>${pct(H.trend)}</b> antar kuartal — momentum ada, tinggal diarahkan.`);
  const T = M.toko;
  if (T) {
    if (T.cr * 100 < B.cr)
      add('perhatian', `Konversi toko <b>${pct(T.cr, 2)}</b>, di bawah benchmark ${B.cr}%. Traffic masuk tapi nggak closing — cek harga, foto utama, review, dan ongkir.`);
    if (T.refundRate != null && T.refundRate * 100 > B.refund)
      add('tantangan', `Refund <b>${pct(T.refundRate)}</b> dari GMV (${rp(T.refund)}), di atas batas ${B.refund}%. Ini gerus margin dan skor toko.`);
    if (T.hariTotal && T.hariAktif < T.hariTotal * 0.8)
      add('perhatian', `Cuma <b>${T.hariAktif}/${T.hariTotal} hari</b> ada transaksi. Penjualan nggak harian, masih nunggu momen.`);
    if (T.peakShare != null && T.peakShare > 0.25)
      add('perhatian', `Satu hari nyumbang <b>${pct(T.peakShare)}</b> GMV bulan itu. Toko ini hidup dari spike, bukan dari arus harian.`);
    const affTot = T.vidAff == null || T.liveAff == null ? null : div(T.vidAff + T.liveAff, T.gmv);
    if (affTot != null && affTot > 0.6)
      add('catatan', `<b>${pct(affTot)}</b> GMV datang dari kreator afiliasi. Nasib toko nempel di orang lain — tangan sendiri (video toko + LIVE toko) masih kecil.`);
    if (T.other != null && div(T.other, T.gmv) != null && (div(T.other, T.gmv) as number) > 0.45)
      add('catatan', `<b>${pct(div(T.other, T.gmv))}</b> GMV dari kartu produk / Shop tab / search — artinya demand pencarian sudah ada, konten cuma jadi pelengkap.`);
  }
  if (M.vT) {
    if (M.vT.rate != null && M.vT.rate * 100 < B.vidSalesToko)
      add('perhatian', `Video toko: <b>${M.vT.withSales} dari ${M.vT.total}</b> yang ada penjualan (${pct(M.vT.rate)}), target ${B.vidSalesToko}%. Produksi jalan, closing-nya nggak.`);
    if ((M.vT.posted || 0) < B.vidPostToko)
      add('perhatian', `Cuma <b>${M.vT.posted} video</b> diposting di bulan referensi (target ${B.vidPostToko}). Frekuensi konten toko di bawah standar.`);
    const actT = M.vT.rows.filter((v) => v.vv > 0), sT = actT.filter((v) => v.gmv > 0);
    const thrT = Math.round(sT.length >= 3 ? median(sT.map((v) => v.vv)) : median(actT.map((v) => v.vv)));
    const failT = actT.filter((v) => v.vv >= thrT && v.gmv <= 0).length;
    if (failT >= 5 && failT > sT.length)
      add('catatan', `<b>${failT} video toko</b> sudah dapat tayangan di level yang biasanya jual (≥${num(thrT)} VV) tapi GMV nol. Masalahnya bukan reach, tapi kontennya nggak ngarah ke produk.`);
  }
  if (M.lT) {
    if (M.lT.sesi === 0)
      add('tantangan', `<b>LIVE toko nol sesi</b> di bulan referensi. Satu kanal penjualan terbesar TikTok Shop nggak dipakai sama sekali.`);
    else if (M.lT.sesi < B.liveSesi)
      add('tantangan', `LIVE toko cuma <b>${M.lT.sesi} sesi / ${dec(M.lT.jam)} jam</b> (target ${B.liveSesi} sesi & ${B.liveJam} jam). Masih coba-coba, belum jadi kanal.`);
    if (M.lT.sesi > 0 && M.lT.gmv === 0)
      add('tantangan', `LIVE toko jalan ${dec(M.lT.jam)} jam dengan GMV <b>${rp(0)}</b> dan ${num(M.lT.penonton)} penonton. Bukan soal jam tayang — sesi ini nggak ada yang nonton.`);
    else if (M.lT.sesi > 0 && M.lT.gmvPerJam != null && M.lT.gmvPerJam < B.liveGmvJam)
      add('perhatian', `GMV per jam LIVE toko <b>${rp(M.lT.gmvPerJam)}</b>, target ${rp(B.liveGmvJam)}. Host/skrip/penawaran perlu dibongkar.`);
  }
  if (M.lA && M.lT && M.lA.gmv > M.lT.gmv * 3 && M.lA.gmv > 0)
    add('catatan', `LIVE kreator hasilkan <b>${rp(M.lA.gmv)}</b> dari ${M.lA.sesi} sesi, LIVE toko <b>${rp(M.lT.gmv)}</b>. Buktinya produk ini <i>bisa</i> laku di LIVE — yang belum ada mesin LIVE toko sendiri.`);
  if (M.aff) {
    if (M.aff.rateAktif != null && M.aff.rateAktif * 100 < B.krSales)
      add('perhatian', `Dari <b>${num(M.aff.posted)} kreator</b> yang posting di periode ini, cuma <b>${M.aff.postedSales}</b> yang menghasilkan GMV (${pct(M.aff.rateAktif)}, target ${B.krSales}%). Total kreator terdaftar ${num(M.aff.total)}, yang aktif posting cuma ${pct(div(M.aff.posted, M.aff.total))}.`);
    if (M.aff.nempel > 0)
      add('catatan', `<b>${M.aff.nempel} kreator</b> posting konten tapi GMV nol — kandidat pembinaan atau dilepas.`);
    if (M.aff.top5Share != null && M.aff.top5Share * 100 > B.krKonsen)
      add('tantangan', `Top-5 kreator pegang <b>${pct(M.aff.top5Share)}</b> GMV afiliasi. Kalau satu pindah, GMV toko langsung jeblok.`);
    if (M.aff.sampel > 0 && M.aff.sampelSukses === 0)
      add('perhatian', `<b>${num(M.aff.sampel)} sampel</b> terkirim, belum ada yang balik jadi GMV. Seleksi penerima sampel perlu dirapikan.`);
  }
  if (M.prod) {
    if (M.prod.rate != null && M.prod.rate * 100 < B.skuSales)
      add('perhatian', `Cuma <b>${M.prod.withSales}/${M.prod.total} SKU</b> yang jalan (${pct(M.prod.rate)}). Katalog gemuk, mesin cuma di sebagian kecil.`);
    if (M.prod.top3Share != null && M.prod.top3Share > 0.6)
      add('catatan', `Top-3 SKU = <b>${pct(M.prod.top3Share)}</b> GMV. Fokus jelas, tapi rapuh kalau salah satu stok habis atau kena hold.`);
    if (M.prod.quad.traffic > 0)
      add('catatan', `<b>${M.prod.quad.traffic} SKU</b> klik tinggi konversi rendah — perbaikan halaman produk bisa naikin GMV tanpa nambah traffic.`);
  }
  if (M.ads && M.ads.spend > 0 && M.toko) {
    const dep = div(M.ads.rev, M.toko.gmv);
    if (M.ads.roas != null && M.ads.roas < B.roas)
      add('perhatian', `ROAS iklan <b>${dec(M.ads.roas, 2)}×</b>, di bawah target ${B.roas}×. Belanja ${rp(M.ads.spend)} balik ${rp(M.ads.rev)}.`);
    else add('modal', `ROAS iklan <b>${dec(M.ads.roas, 2)}×</b> (belanja ${rp(M.ads.spend)}). Kanal ini sudah efisien, tinggal diskalakan hati-hati.`);
    if (dep != null && dep > B.adsDep / 100)
      add('perhatian', `Pendapatan teratribusi iklan setara <b>${pct(dep)}</b> GMV toko. Ketergantungan iklan tinggi — kalau budget stop, GMV ikut turun.`);
  }
  if (!M.ads || !M.ads.ada)
    add('catatan', `Tidak ada data Ads Manager. Baseline ini murni organik + GMV Max yang nggak kelihatan — konfirmasi ke klien apakah memang nggak beriklan.`);
  const order: Record<Finding['lv'], number> = { tantangan: 0, perhatian: 1, catatan: 2, modal: 3 };
  return F.sort((a, b) => order[a.lv] - order[b.lv]);
}

/** Arah strategi (bukan eksekusi): 4 gap terbesar → kalimat arahan. */
export function arah(M: Metrics, sc: Score): string[] {
  void M;
  const gaps: { k: string; l: string; def: number }[] = [];
  sc.P.filter((p) => p.ada).forEach((p) => gaps.push({ k: p.k, l: p.l, def: (100 - (p.score as number)) * p.w }));
  gaps.sort((a, b) => b.def - a.def);
  const map: Record<string, string> = {
    live: 'Bangun kanal LIVE toko sendiri sebagai prioritas pertama — ini gap terbesar dan satu-satunya kanal yang bisa MEA kendalikan penuh tanpa nunggu kreator.',
    video: 'Geser fokus konten dari jumlah ke daya jual: tiru pola video yang terbukti closing di bagian B, hentikan format yang cuma nyari views.',
    aff: 'Rapikan mesin afiliasi: kurangi ketergantungan pada segelintir kreator, dan ubah kreator "posting doang" jadi produktif lewat brief + sampel yang terarah.',
    gmv: 'Perbaiki fondasi konversi toko dulu (halaman produk, harga, review, refund) sebelum nambah traffic — nambah trafik di atas konversi bocor cuma bakar biaya.',
    prod: 'Fokuskan katalog dan belanja iklan ke SKU yang sudah terbukti, dan angkat SKU klik-tinggi-konversi-rendah lewat perbaikan halaman produk.',
  };
  return gaps
    .slice(0, 4)
    .map((g) => map[g.k])
    .filter(Boolean);
}
