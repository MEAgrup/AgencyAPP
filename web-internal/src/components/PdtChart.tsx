/**
 * Grafik laporan PDT — SVG inline, nol dependensi (2026-09-21).
 *
 * Feedback pemilik 2026-09-21: laporan PDT "masih kurang detail" dibanding
 * mesin HTML lama, "lengkapi … termasuk grafik dan chart". Mesin lama memakai
 * Chart.js dari CDN; alasan CDPS memakai SVG sendiri ada di docblock
 * `lib/chart-geom.ts` (cetak, nol dependensi, geometrinya bisa diuji).
 *
 * Seluruh komponen di sini BODOH: ia menerima angka yang sudah final dari
 * payload laporan dan menggambarnya. Nol agregasi, nol pembulatan angka
 * bisnis, nol keputusan "kalau null anggap nol" — `null` digambar sebagai
 * JEDA/kosong, karena "tidak diketahui" dan "nol" adalah dua hal berbeda
 * (Rule 12, dan aturan rumah #7 untuk bagi-nol).
 *
 * `<title>` di tiap elemen adalah tooltip bawaan peramban — cukup untuk
 * laporan yang dibaca dan dicetak, tanpa satu baris pun JavaScript runtime.
 */
'use client';

import {
  angkaRingkas,
  jalurGaris,
  labelHari,
  potonganDonat,
  skalaLinear,
  tickSumbu,
  warnaSeri,
  type TitikSeri,
} from '@/lib/chart-geom';

const SUMBU = '#94a3b8';
const GARIS_BANTU = '#e2e8f0';
const TEKS = '#475569';

function Kosong({ tinggi, pesan }: { tinggi: number; pesan: string }) {
  return (
    <div
      className="muted"
      style={{ height: tinggi, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
    >
      {pesan}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Garis — tren harian (§2 kedua laporan lama)
// ---------------------------------------------------------------------------

export interface GrafikGarisProps {
  titik: { label: string; nilai: number | null }[];
  /** Judul aksesibilitas (`<title>` SVG) — dibaca pembaca layar, bukan tampil. */
  judul: string;
  tinggi?: number;
  /** Garis putus-putus horizontal, mis. rata-rata harian. */
  acuan?: { nilai: number; label: string } | null;
}

/**
 * Garis satu seri dengan JEDA di setiap nilai `null`. Sumbu X berjarak sama
 * per titik (bukan skala waktu sungguhan): titik yang ada di payload adalah
 * hari yang ADA datanya, dan menyebarnya di kalender penuh akan menggambar
 * lubang sebagai jarak — padahal lubangnya sudah ditandai jeda garis.
 */
export function GrafikGaris({ titik, judul, tinggi = 220, acuan = null }: GrafikGarisProps) {
  const lebar = 720;
  const padKiri = 56;
  const padKanan = 12;
  const padAtas = 12;
  const padBawah = 28;

  const terisi = titik.filter((t) => t.nilai != null);
  if (terisi.length === 0) return <Kosong tinggi={tinggi} pesan="Belum ada data harian untuk periode ini." />;

  const maks = Math.max(...terisi.map((t) => t.nilai as number), acuan?.nilai ?? 0);
  const ticks = tickSumbu(maks, 4);
  const atas = ticks[ticks.length - 1];

  const sx = skalaLinear(0, Math.max(titik.length - 1, 1), padKiri, lebar - padKanan);
  const sy = skalaLinear(0, atas, tinggi - padBawah, padAtas);

  const seri: TitikSeri[] = titik.map((t, i) => ({ x: i, y: t.nilai }));
  const d = jalurGaris(seri, sx, sy);

  // Label sumbu X dijarangkan supaya tidak saling tumpuk di bulan 31 hari.
  const setiap = Math.max(1, Math.ceil(titik.length / 12));

  return (
    <svg viewBox={`0 0 ${lebar} ${tinggi}`} width="100%" height={tinggi} role="img" style={{ display: 'block' }}>
      <title>{judul}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padKiri} y1={sy(t)} x2={lebar - padKanan} y2={sy(t)} stroke={GARIS_BANTU} strokeWidth={1} />
          <text x={padKiri - 8} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={TEKS}>
            {angkaRingkas(t)}
          </text>
        </g>
      ))}

      {acuan && (
        <>
          <line
            x1={padKiri} y1={sy(acuan.nilai)} x2={lebar - padKanan} y2={sy(acuan.nilai)}
            stroke={warnaSeri(1)} strokeWidth={1} strokeDasharray="4 3"
          />
          <text x={lebar - padKanan} y={sy(acuan.nilai) - 4} textAnchor="end" fontSize={10} fill={warnaSeri(1)}>
            {acuan.label}
          </text>
        </>
      )}

      <path d={d} fill="none" stroke={warnaSeri(0)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {titik.map((t, i) =>
        t.nilai == null ? null : (
          <circle key={t.label} cx={sx(i)} cy={sy(t.nilai)} r={2.5} fill={warnaSeri(0)}>
            <title>{`${t.label}: ${angkaRingkas(t.nilai)}`}</title>
          </circle>
        ),
      )}

      {titik.map((t, i) =>
        i % setiap === 0 ? (
          <text key={`x-${t.label}`} x={sx(i)} y={tinggi - 8} textAnchor="middle" fontSize={10} fill={TEKS}>
            {labelHari(t.label)}
          </text>
        ) : null,
      )}

      <line x1={padKiri} y1={tinggi - padBawah} x2={lebar - padKanan} y2={tinggi - padBawah} stroke={SUMBU} strokeWidth={1} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Donat — kontribusi kanal (§3 kedua laporan lama)
// ---------------------------------------------------------------------------

export interface GrafikDonatProps {
  bagian: { label: string; nilai: number | null }[];
  judul: string;
  tinggi?: number;
  /** Teks di tengah cincin (mis. total GMV). */
  tengah?: string | null;
}

export function GrafikDonat({ bagian, judul, tinggi = 220, tengah = null }: GrafikDonatProps) {
  const cx = tinggi / 2;
  const cy = tinggi / 2;
  const rLuar = tinggi / 2 - 8;
  const rDalam = rLuar * 0.62;

  const nilai = bagian.map((b) => b.nilai ?? 0);
  const potongan = potonganDonat(nilai, cx, cy, rLuar, rDalam);
  if (potongan.length === 0) return <Kosong tinggi={tinggi} pesan="Belum ada kontribusi kanal untuk periode ini." />;

  // `potonganDonat` melewati nilai ≤ 0, jadi indeks potongan ≠ indeks bagian —
  // dipetakan ulang supaya warna & label tetap menempel ke kanal yang benar.
  const terpakai = bagian.map((b, i) => ({ b, i })).filter(({ b }) => (b.nilai ?? 0) > 0);

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 ${tinggi} ${tinggi}`} width={tinggi} height={tinggi} role="img" style={{ flexShrink: 0 }}>
        <title>{judul}</title>
        {potongan.map((p, i) => (
          <path key={terpakai[i].b.label} d={p.d} fill={warnaSeri(terpakai[i].i)}>
            <title>{`${terpakai[i].b.label}: ${angkaRingkas(terpakai[i].b.nilai ?? 0)} (${(p.fraksi * 100).toFixed(1).replace('.', ',')}%)`}</title>
          </path>
        ))}
        {tengah && (
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight="bold" fill={TEKS}>
            {tengah}
          </text>
        )}
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12, display: 'grid', gap: 6 }}>
        {terpakai.map(({ b, i }, k) => (
          <li key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: warnaSeri(i), flexShrink: 0 }} />
            <span>
              {b.label} — <strong>{angkaRingkas(b.nilai ?? 0)}</strong>{' '}
              <span className="muted">({(potongan[k].fraksi * 100).toFixed(1).replace('.', ',')}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batang berkelompok — omzet vs biaya per sumber iklan (§4 kedua laporan lama)
// ---------------------------------------------------------------------------

export interface GrafikBatangProps {
  kelompok: { label: string; nilai: (number | null)[] }[];
  /** Nama tiap batang dalam satu kelompok, mis. ['Omzet', 'Biaya']. */
  seri: string[];
  judul: string;
  tinggi?: number;
}

export function GrafikBatang({ kelompok, seri, judul, tinggi = 240 }: GrafikBatangProps) {
  const lebar = 720;
  const padKiri = 56;
  const padKanan = 12;
  const padAtas = 12;
  const padBawah = 40;

  const semua = kelompok.flatMap((k) => k.nilai).filter((v): v is number => v != null);
  if (semua.length === 0) return <Kosong tinggi={tinggi} pesan="Belum ada data iklan untuk periode ini." />;

  const ticks = tickSumbu(Math.max(...semua), 4);
  const atas = ticks[ticks.length - 1];
  const sy = skalaLinear(0, atas, tinggi - padBawah, padAtas);

  const lebarArea = lebar - padKiri - padKanan;
  const lebarKelompok = lebarArea / Math.max(kelompok.length, 1);
  const lebarBatang = Math.min(28, (lebarKelompok * 0.7) / Math.max(seri.length, 1));

  return (
    <div>
      <svg viewBox={`0 0 ${lebar} ${tinggi}`} width="100%" height={tinggi} role="img" style={{ display: 'block' }}>
        <title>{judul}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padKiri} y1={sy(t)} x2={lebar - padKanan} y2={sy(t)} stroke={GARIS_BANTU} strokeWidth={1} />
            <text x={padKiri - 8} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={TEKS}>
              {angkaRingkas(t)}
            </text>
          </g>
        ))}

        {kelompok.map((k, ki) => {
          const tengah = padKiri + lebarKelompok * (ki + 0.5);
          const mulai = tengah - (lebarBatang * seri.length) / 2;
          return (
            <g key={k.label}>
              {k.nilai.map((v, si) =>
                v == null ? null : (
                  <rect
                    key={seri[si]}
                    x={mulai + lebarBatang * si}
                    y={sy(v)}
                    width={lebarBatang - 2}
                    height={Math.max(tinggi - padBawah - sy(v), 0)}
                    fill={warnaSeri(si)}
                  >
                    <title>{`${k.label} · ${seri[si]}: ${angkaRingkas(v)}`}</title>
                  </rect>
                ),
              )}
              <text x={tengah} y={tinggi - 22} textAnchor="middle" fontSize={10} fill={TEKS}>
                {k.label.length > 18 ? `${k.label.slice(0, 17)}…` : k.label}
              </text>
            </g>
          );
        })}

        <line x1={padKiri} y1={tinggi - padBawah} x2={lebar - padKanan} y2={tinggi - padBawah} stroke={SUMBU} strokeWidth={1} />
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, marginTop: 4, flexWrap: 'wrap' }}>
        {seri.map((s, i) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: warnaSeri(i) }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batang horizontal — skor per dimensi
// ---------------------------------------------------------------------------

export interface GrafikSkorProps {
  dimensi: { label: string; nilai: number | null; disertakan: boolean }[];
  judul: string;
}

/**
 * Skor 0–100 per dimensi. Dimensi yang TIDAK disertakan (nol data periode ini)
 * tetap ditampilkan sebagai baris kosong ber-keterangan — menghilangkannya
 * akan membuat pembaca menyangka dimensi itu tidak ada, padahal yang tidak ada
 * adalah datanya.
 */
export function GrafikSkor({ dimensi, judul }: GrafikSkorProps) {
  if (dimensi.length === 0) return <Kosong tinggi={80} pesan="Belum ada dimensi skor untuk periode ini." />;
  const warnaAmbang = (v: number): string => (v >= 80 ? '#15803d' : v >= 60 ? '#b45309' : '#be123c');

  return (
    <div role="img" aria-label={judul} style={{ display: 'grid', gap: 8 }}>
      {dimensi.map((d) => (
        <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 52px', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>{d.label}</span>
          <div style={{ background: GARIS_BANTU, borderRadius: 3, height: 10, overflow: 'hidden' }}>
            {d.disertakan && d.nilai != null && (
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, d.nilai))}%`,
                  height: '100%',
                  background: warnaAmbang(d.nilai),
                }}
              />
            )}
          </div>
          <span style={{ fontSize: 12, textAlign: 'right' }} className={d.disertakan ? undefined : 'muted'}>
            {d.disertakan && d.nilai != null ? d.nilai.toFixed(0) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batang horizontal berperingkat — Top 10 kreator / Top 10 sesi LIVE /
// kampanye (2026-09-21, paritas mesin HTML lama)
// ---------------------------------------------------------------------------

export interface GrafikPeringkatProps {
  baris: { label: string; nilai: number | null; catatan?: string | null }[];
  judul: string;
  /** Pemformat nilai untuk label kanan, mis. `formatIDR`. */
  format: (v: number | null) => string;
  /** Warna batang — satu warna untuk seluruh baris (peringkat, bukan kategori). */
  warna?: string;
}

/**
 * Daftar berperingkat: panjang batang SEBANDING nilai terbesar di daftar
 * (bukan skala absolut), karena yang dibaca di daftar Top-N adalah jarak
 * antar peringkat, bukan besaran mutlaknya — besaran mutlak sudah tercetak
 * di label kanan.
 *
 * Baris ber-`nilai` `null` TETAP tampil tanpa batang: kreator yang GMV-nya
 * tidak diketahui bukan kreator yang GMV-nya nol, dan menghapusnya dari
 * daftar akan membuat "Top 10" berisi sembilan tanpa penjelasan.
 */
export function GrafikPeringkat({ baris, judul, format, warna = warnaSeri(0) }: GrafikPeringkatProps) {
  if (baris.length === 0) return <Kosong tinggi={80} pesan="Belum ada baris untuk periode ini." />;
  const maks = baris.reduce((a, b) => Math.max(a, b.nilai ?? 0), 0);

  return (
    <div role="img" aria-label={judul} style={{ display: 'grid', gap: 6 }}>
      {baris.map((b, i) => (
        <div key={`${b.label}-${i}`} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 116px', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.label}>
            {b.label}
            {b.catatan ? <span className="muted"> · {b.catatan}</span> : null}
          </span>
          <div style={{ background: GARIS_BANTU, borderRadius: 3, height: 10, overflow: 'hidden' }}>
            {b.nilai != null && maks > 0 && (
              <div style={{ width: `${Math.max(0, Math.min(100, (b.nilai / maks) * 100))}%`, height: '100%', background: warna }} />
            )}
          </div>
          <span style={{ fontSize: 12, textAlign: 'right' }} className={b.nilai == null ? 'muted' : undefined}>
            {format(b.nilai)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gelembung — matriks produk 4 kuadran (§5/§7 laporan lama)
// ---------------------------------------------------------------------------

export interface GrafikGelembungProps {
  produk: { label: string; x: number | null; y: number | null; ukuran: number | null; kuadran: string }[];
  judul: string;
  labelX: string;
  labelY: string;
  tinggi?: number;
}

const WARNA_KUADRAN: Record<string, string> = {
  bintang: '#15803d',
  bocor_traffic: '#b45309',
  hidden_gem: '#1d4ed8',
  kurang_potensial: '#94a3b8',
};

/**
 * Sebaran produk: X = trafik (klik), Y = konversi (CVR), luas gelembung =
 * GMV. Produk yang salah satu sumbunya `null` DILEWATI — menempatkannya di
 * 0 akan menaruhnya di pojok "kurang potensial" padahal yang tidak diketahui
 * adalah koordinatnya, bukan performanya.
 */
export function GrafikGelembung({ produk, judul, labelX, labelY, tinggi = 280 }: GrafikGelembungProps) {
  const lebar = 720;
  const padKiri = 56;
  const padKanan = 16;
  const padAtas = 12;
  const padBawah = 36;

  const dapatDigambar = produk.filter((p) => p.x != null && p.y != null);
  if (dapatDigambar.length === 0) return <Kosong tinggi={tinggi} pesan="Belum ada produk dengan trafik & konversi untuk periode ini." />;

  const maksX = Math.max(...dapatDigambar.map((p) => p.x as number));
  const maksY = Math.max(...dapatDigambar.map((p) => p.y as number));
  const maksUkuran = Math.max(...dapatDigambar.map((p) => p.ukuran ?? 0), 1);

  const tickX = tickSumbu(maksX, 4);
  const tickY = tickSumbu(maksY, 4);
  const sx = skalaLinear(0, tickX[tickX.length - 1], padKiri, lebar - padKanan);
  const sy = skalaLinear(0, tickY[tickY.length - 1], tinggi - padBawah, padAtas);
  // Luas ∝ nilai (bukan jari-jari ∝ nilai): mata membaca LUAS, dan memetakan
  // nilai ke jari-jari melebih-lebihkan yang besar secara kuadratik.
  const r = (v: number | null): number => 4 + 14 * Math.sqrt(Math.max(v ?? 0, 0) / maksUkuran);

  return (
    <div>
      <svg viewBox={`0 0 ${lebar} ${tinggi}`} width="100%" height={tinggi} role="img" style={{ display: 'block' }}>
        <title>{judul}</title>
        {tickY.map((t) => (
          <g key={`y${t}`}>
            <line x1={padKiri} y1={sy(t)} x2={lebar - padKanan} y2={sy(t)} stroke={GARIS_BANTU} strokeWidth={1} />
            <text x={padKiri - 8} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={TEKS}>
              {`${(t * 100).toFixed(t < 0.01 ? 2 : 1).replace('.', ',')}%`}
            </text>
          </g>
        ))}
        {tickX.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={tinggi - 20} textAnchor="middle" fontSize={10} fill={TEKS}>
            {angkaRingkas(t)}
          </text>
        ))}

        {dapatDigambar.map((p) => (
          <circle
            key={p.label}
            cx={sx(p.x as number)}
            cy={sy(p.y as number)}
            r={r(p.ukuran)}
            fill={WARNA_KUADRAN[p.kuadran] ?? SUMBU}
            fillOpacity={0.55}
            stroke={WARNA_KUADRAN[p.kuadran] ?? SUMBU}
          >
            <title>{`${p.label} — ${labelX} ${angkaRingkas(p.x as number)}, ${labelY} ${((p.y as number) * 100).toFixed(2).replace('.', ',')}%, GMV ${angkaRingkas(p.ukuran ?? 0)}`}</title>
          </circle>
        ))}

        <line x1={padKiri} y1={tinggi - padBawah} x2={lebar - padKanan} y2={tinggi - padBawah} stroke={SUMBU} strokeWidth={1} />
        <text x={lebar - padKanan} y={tinggi - 4} textAnchor="end" fontSize={10} fill={TEKS}>{labelX} →</text>
        <text x={padKiri - 8} y={padAtas + 2} textAnchor="end" fontSize={10} fill={TEKS}>{labelY}</text>
      </svg>
      {dapatDigambar.length < produk.length && (
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {produk.length - dapatDigambar.length} produk tidak digambar — trafik atau konversinya tidak diketahui
          periode ini (tidak sama dengan nol).
        </p>
      )}
    </div>
  );
}
