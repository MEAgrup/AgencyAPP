'use client';

/**
 * QA — perbandingan jalur Plan: `STR-` (M6 §4) vs `STRG-` (M6A/6B/6C).
 *
 * ## Kenapa halaman ini ada
 *
 * Service hub hari ini menampilkan DUA kartu strategi dan SATU form buat, dan
 * ketiganya berasal dari dua entitas yang berbeda:
 *
 * - `strategy_plans` / **`STR-`** — M6 §4, dibangun Juli. Form 5 field, dan satu-
 *   satunya yang punya tombol "buat" di UI.
 * - `strategi` / **`STRG-`** — M6A Section A→J + M6B Plan + M6C gate, dibangun
 *   Agustus. Lengkap sampai share-link klien dan revisi berversi, tapi
 *   `createStrategi()` di `lib/strategi.ts` **tidak punya satu pun pemanggil di
 *   halaman mana pun** — jadi jalur itu mustahil dibuka, dan karenanya mustahil
 *   di-QA.
 *
 * M6C §8 langkah 2 menunjuk jalur 6A untuk tier `Plan Wajib`, tapi keputusan
 * mencabut `STR-` belum diambil pemilik. Halaman ini adalah alat untuk mengambil
 * keputusan itu: ia menaruh kedua jalur berdampingan atas SATU layanan nyata,
 * dan menyediakan pintu M6A yang hilang supaya keduanya benar-benar bisa
 * dijalankan, bukan cuma dibaca.
 *
 * ## Yang SENGAJA tidak dilakukan
 *
 * Form `STR-` **tidak disalin ke sini**. Ia sudah hidup di Service hub, dan
 * salinan kedua dari form yang sama adalah persis kelas cacat yang sedang
 * diselidiki halaman ini. Yang dibangun di sini hanya form header `STRG-` —
 * bukan duplikat, melainkan pintu yang memang belum pernah ada.
 *
 * ## Ini menulis ke data sungguhan
 *
 * `POST /services/{id}/strategi` bukan simulasi: ia mencetak `STRG-`, dan kalau
 * Service belum punya kontrak ia **ikut mencetak `CTR-`** lewat
 * `ensureContractForService`. Halaman menyatakan itu di layar sebelum tombolnya
 * bisa ditekan — QA yang tidak tahu ia menulis bukan QA, itu kecelakaan.
 */

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  SERVICE_AWAITING_ONBOARDING,
  TIER_LABELS,
  getService,
  isAccountLead,
  isAccountStaff,
  isReadOnlyOD,
  listStrategies,
  type ServiceQueueRow,
  type Strategy,
} from '@/lib/account';
import { createStrategi, listStrategi, type Strategi } from '@/lib/strategi';

/** Satu baris perbandingan antara kedua jalur. */
interface CompareRow {
  aspek: string;
  str: string;
  strg: string;
  /** Mana yang lebih lengkap untuk aspek ini — dipakai hanya untuk penanda visual. */
  unggul: 'str' | 'strg' | 'imbang';
}

/**
 * Perbandingan yang bisa dinyatakan tanpa memanggil server — semuanya terbaca
 * dari PRD dan dari kode, jadi ia tetap benar pada layanan mana pun. Fakta yang
 * BERGANTUNG pada layanan (sudah ada STR-? sudah ada STRG-?) dirender terpisah
 * di bawah, dari respons server, supaya keduanya tidak tercampur.
 */
const COMPARE: CompareRow[] = [
  {
    aspek: 'Spesifikasi',
    str: 'M6 §4 + §9.3',
    strg: 'M6A (Section A→J) + M6B (Plan) + M6C (gate)',
    unggul: 'strg',
  },
  {
    aspek: 'Prefix & tabel',
    str: 'STR- · strategy_plans (1 tabel)',
    strg: 'STRG- · strategi + ~20 tabel anak',
    unggul: 'strg',
  },
  {
    aspek: 'Induk',
    str: 'Service (1:1)',
    strg: 'Contract (CTR-) — satu Strategi bisa memayungi beberapa Service',
    unggul: 'strg',
  },
  {
    aspek: 'Isi form',
    str: 'Objective, Target KPI (GMV/ROAS/CTR/CVR), divisi terlibat, outline, timeline, task satuan',
    strg: 'Sepuluh seksi: A konteks · B baseline per channel · C diagnosa · D target+asumsi · E pilar · F sumber daya · G kalender · H risiko · I handoff · J versi',
    unggul: 'strg',
  },
  {
    aspek: 'Baseline numerik klien',
    str: 'Tidak ada',
    strg: 'Wajib per channel, dengan periode + sumber (M6A Rule 5)',
    unggul: 'strg',
  },
  {
    aspek: 'Gerbang kelengkapan',
    str: 'Validasi field wajib saat simpan',
    strg: 'checkCompleteness server-side + hitungan kekurangan hidup per seksi',
    unggul: 'strg',
  },
  {
    aspek: 'Revisi',
    str: 'Catatan revisi (kolom display terakhir)',
    strg: 'Versi = BARIS (Rule 13): n tetap Aktif sampai n+1 disetujui, wajib trigger + alasan + asumsi yang gugur',
    unggul: 'strg',
  },
  {
    aspek: 'Visibilitas klien',
    str: 'Tidak ada',
    strg: 'Dua tier per field (§4.1), hard-internal tak bisa dibuka, share link /s/{token} revocable',
    unggul: 'strg',
  },
  {
    aspek: 'Menghasilkan Plan periodik',
    str: 'Tidak',
    strg: 'Ya — persetujuan generate n periode anniversary-month (M6B Rule 1)',
    unggul: 'strg',
  },
  {
    aspek: 'Gate ±20% GMV vs target klien',
    str: 'Ada (QA pemilik 2026-08-12) — blokir submit sampai ACC Head/SPV',
    strg: 'Tidak ada gate ±20%; yang ada floor kontrak + stretch (Rule 7) dan Sanggahan Target advisory (D-7)',
    unggul: 'imbang',
  },
  {
    aspek: '⛔ Membuka gerbang Brief',
    str: 'YA — approveStrategy menggerakkan Service → [Strategy Approved] dalam transaksi yang sama',
    strg: 'TIDAK — approveStrategi tidak menyentuh tabel services sama sekali',
    unggul: 'str',
  },
  {
    aspek: '⛔ Pintu "buat" di UI',
    str: 'Ada di Service hub',
    strg: 'TIDAK ADA di mana pun — createStrategi() nol pemanggil (halaman ini pintu pertamanya)',
    unggul: 'str',
  },
];

export default function QaJalurPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  // Pintu tulis yang sama dengan Service hub (createStrategi menegakkan
  // owner-AM sendiri di server — ini hanya menyembunyikan tombol yang pasti 403).
  const canWrite =
    !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);

  const [service, setService] = useState<ServiceQueueRow | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [strategiList, setStrategiList] = useState<Strategi[]>([]);
  const [strategiError, setStrategiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form header STRG- — pintu M6A yang selama ini tidak ada.
  const [durasi, setDurasi] = useState('');
  const [mulai, setMulai] = useState('');
  const [akhir, setAkhir] = useState('');
  const [siklus, setSiklus] = useState('');
  const [toleransi, setToleransi] = useState('20');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<Strategi | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setServiceError(null);
    setStrategyError(null);
    setStrategiError(null);
    // Ketiga baca dijalankan berdampingan dan gagal SENDIRI-SENDIRI: satu 403
    // (mis. pembaca yang boleh lihat Brief tapi tidak Service) tidak boleh
    // mengosongkan dua kolom lain yang sebenarnya terbaca.
    const [svc, str, strg] = await Promise.allSettled([
      getService(id),
      listStrategies(),
      listStrategi(id),
    ]);
    if (svc.status === 'fulfilled') setService(svc.value);
    else setServiceError(errorMessage(svc.reason));
    if (str.status === 'fulfilled') {
      setStrategy(str.value.data.find((s) => s.service_id === id) ?? null);
    } else setStrategyError(errorMessage(str.reason));
    if (strg.status === 'fulfilled') setStrategiList(strg.value);
    else setStrategiError(errorMessage(strg.reason));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Prefill jendela kontrak dari layanan bila ada. Hanya saat masih kosong —
  // angka yang sudah diketik QA tidak pernah ditimpa oleh refetch.
  useEffect(() => {
    if (siklus === '' && mulai !== '') setSiklus(mulai);
  }, [mulai, siklus]);

  async function handleCreateStrategi(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setSubmitting(true);
    try {
      const res = await createStrategi(id, {
        durasi_kontrak_bulan: Number(durasi),
        tanggal_mulai_kontrak: mulai,
        tanggal_akhir_kontrak: akhir,
        tanggal_mulai_siklus: siklus.trim() === '' ? null : siklus,
        toleransi_over_persen: toleransi.trim() === '' ? null : Number(toleransi),
      });
      setCreated(res);
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const awaitingOnboarding = service ? service.status === SERVICE_AWAITING_ONBOARDING : true;
  const planGated = service ? service.requires_strategy_plan : false;

  if (loading) return <div className="pageLoading">Memuat…</div>;

  return (
    <div className="stack">
      <div>
        <Link href={`/account/services/${encodeURIComponent(id)}`} className="muted">
          &larr; Kembali ke Layanan {id}
        </Link>
      </div>

      <div>
        <h1>QA · Perbandingan Jalur Plan</h1>
        <p className="muted">
          {service ? `${service.name} · ${id}` : id} &mdash; <code>STR-</code> (M6 §4) versus{' '}
          <code>STRG-</code> (M6A/6B/6C), atas layanan yang sama.
        </p>
      </div>

      <div className="alert alertInfo" role="status">
        <strong>Halaman QA, bukan halaman produk.</strong> Ia ada untuk satu keputusan: jalur mana
        yang dipertahankan untuk layanan tier <em>Plan Wajib</em>. Tidak ada di navigasi, dan
        dibuang begitu keputusannya diambil.
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Keadaan nyata — supaya perbandingan di bawah dibaca dengan konteks. */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="cardHeader">
          <h2>Keadaan Nyata Layanan Ini</h2>
          {service && <StatusBadge status={service.status} />}
        </div>
        {serviceError && <div className="alert alertError" role="alert">{serviceError}</div>}
        {service && (
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Tier katalog</div>
              <div>{TIER_LABELS[service.plan_tier]}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Gerbang efektif</div>
              <div>{planGated ? 'Plan-gated (wajib Strategy & Plan)' : 'Direct (tanpa Plan)'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Jumlah Brief</div>
              <div>{service.brief_count}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>AM pemilik</div>
              <div>{service.assigned_am_id || 'Belum ditugaskan'}</div>
            </div>
          </div>
        )}
        {service && service.plan_tier === 'plan_wajib' && (
          <p className="muted" style={{ fontSize: 13 }}>
            M6C §8 langkah 2: tier <strong>Plan Wajib</strong> menunjuk ke <strong>jalur Strategi
            6A</strong>. Yang bisa diklik di Service hub hari ini justru <code>STR-</code>.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Efek pada gerbang Brief — perbedaan yang menentukan.                */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="cardHeader">
          <h2>Efek pada Gerbang Brief</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          <code>guardBriefCreation</code> membaca <strong>status Service</strong>, bukan keberadaan
          dokumen strategi. Jadi pertanyaannya bukan &ldquo;dokumen mana yang lebih lengkap&rdquo;,
          melainkan <strong>persetujuan mana yang menggerakkan Service</strong>.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Aksi</th>
                <th>Yang terjadi pada Service</th>
                <th>Brief terbuka?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Setujui <code>STR-</code> (<code>account.approveStrategy</code>)</td>
                <td>[Awaiting Onboarding] &rarr; [Strategy Approved], satu transaksi</td>
                <td><span className="badge badge-green">Ya</span></td>
              </tr>
              <tr>
                <td>Setujui <code>STRG-</code> (<code>strategi.approveStrategi</code>)</td>
                <td>Tidak menyentuh tabel <code>services</code>; hanya generate periode PLAN</td>
                <td><span className="badge badge-red">Tidak</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Ini deviasi yang sudah tercatat: <code>DECISIONS.md</code> 2026-08-06 butir (4) &mdash;
          <em>&ldquo;Persetujuan STRG BELUM menggerakkan Service… Penyambungan ikut penggantian
          form&rdquo;</em>. Penggantian form itu belum pernah terjadi.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Perbandingan isi.                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="cardHeader">
          <h2>Perbandingan Isi &amp; Kemampuan</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Aspek</th>
                <th style={{ width: '38%' }}>Jalur A &mdash; <code>STR-</code> (M6 §4)</th>
                <th style={{ width: '44%' }}>Jalur B &mdash; <code>STRG-</code> (M6A/6B/6C)</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.aspek}>
                  <td><strong>{r.aspek}</strong></td>
                  <td style={{ fontWeight: r.unggul === 'str' ? 600 : 400 }}>{r.str}</td>
                  <td style={{ fontWeight: r.unggul === 'strg' ? 600 : 400 }}>{r.strg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Jalur A — pintunya sudah ada, jadi ini TAUTAN, bukan salinan form.  */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="cardHeader">
          <h2>Jalur A &mdash; Strategy &amp; Plan (<code>STR-</code>)</h2>
        </div>
        {strategyError && <div className="alert alertError" role="alert">{strategyError}</div>}
        {strategy ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <Link href={`/account/strategies/${strategy.id}`}>{strategy.id}</Link>
                <div className="muted" style={{ fontSize: 12 }}>{strategy.objective || '—'}</div>
              </div>
              <StatusBadge status={strategy.status} />
            </div>
          </div>
        ) : (
          <p className="muted">Belum ada <code>STR-</code> untuk layanan ini.</p>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          Formnya <strong>tidak disalin ke sini</strong> &mdash; ia sudah hidup di Service hub, dan
          salinan kedua dari satu form adalah persis cacat yang sedang diselidiki halaman ini.
        </p>
        <Link
          href={`/account/services/${encodeURIComponent(id)}`}
          className="btn btnSecondary btnSm"
        >
          Buka form &ldquo;Buat Strategy &amp; Plan&rdquo; di Service hub
        </Link>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Jalur B — pintu yang selama ini TIDAK ADA.                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="cardHeader">
          <h2>Jalur B &mdash; Strategi M6A (<code>STRG-</code>)</h2>
        </div>
        {strategiError && <div className="alert alertError" role="alert">{strategiError}</div>}
        {strategiList.length === 0 ? (
          <p className="muted">Belum ada <code>STRG-</code> untuk layanan ini.</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {strategiList.map((st) => (
              <div key={st.id} className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <Link href={`/account/strategi/${st.id}`}>{st.id}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>
                    versi {st.versi_no} &middot; kontrak {st.contract_id}
                  </div>
                </div>
                <StatusBadge status={st.status} />
              </div>
            ))}
          </div>
        )}

        <p className="muted" style={{ fontSize: 13 }}>
          Form sepuluh seksi (A→J) ada di <code>/account/strategi/{'{id}'}</code> dan sudah lengkap
          &mdash; yang tidak pernah ada adalah <strong>pintu membuatnya</strong>. Form header di
          bawah ini pintu pertamanya, dan hanya itu yang dibangun di halaman ini: sisanya sudah
          terpasang di halaman Strategi.
        </p>

        {created && (
          <div className="alert alertSuccess" role="status">
            <code>{created.id}</code> dibuat (kontrak <code>{created.contract_id}</code>).{' '}
            <Link href={`/account/strategi/${created.id}`}>Buka form Section A→J</Link> untuk
            melanjutkan QA jalur ini.
          </div>
        )}

        {!canWrite && (
          <p className="muted" style={{ fontSize: 13 }}>
            Peran Anda hanya membaca &mdash; form buat disembunyikan.
          </p>
        )}

        {canWrite && !planGated && (
          <div className="alert alertInfo" role="status">
            Layanan ini bukan plan-gated, jadi <code>createStrategi</code> akan menolak dengan
            <em> [layanan ini tidak memerlukan Strategy &amp; Plan]</em>. Formnya tetap ditampilkan
            supaya penolakan itu sendiri bisa di-QA.
          </div>
        )}

        {canWrite && !awaitingOnboarding && (
          <div className="alert alertInfo" role="status">
            Layanan sudah lewat [Awaiting Onboarding] &mdash; server kemungkinan menolak pembuatan
            Strategi baru. Ditampilkan supaya perilakunya terlihat, bukan ditebak.
          </div>
        )}

        {canWrite && (
          <form className="form" onSubmit={handleCreateStrategi}>
            {createError && <div className="alert alertError" role="alert">{createError}</div>}

            <div className="alert alertInfo" role="status">
              <strong>Ini menulis ke data sungguhan.</strong> Menekan tombol mencetak baris{' '}
              <code>STRG-</code>
              {service && ' dan — karena layanan ini belum punya kontrak — ikut mencetak satu '}
              {service && <code>CTR-</code>}
              {service && ' lewat '}
              {service && <code>ensureContractForService</code>}
              . Keduanya masuk audit log dan tidak ada jalur hapus.
            </div>

            <div className="formRow">
              <div className="field">
                <label htmlFor="q-durasi">Durasi kontrak (bulan)</label>
                <input
                  id="q-durasi"
                  type="number"
                  min="1"
                  required
                  value={durasi}
                  onChange={(e) => setDurasi(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  Menentukan berapa periode PLAN yang lahir saat Strategi disetujui (M6B Rule 1).
                </span>
              </div>
              <div className="field">
                <label htmlFor="q-toleransi">Toleransi over-komitmen (%)</label>
                <input
                  id="q-toleransi"
                  type="number"
                  min="0"
                  step="1"
                  value={toleransi}
                  onChange={(e) => setToleransi(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  M6A D16 &mdash; default 20.
                </span>
              </div>
            </div>

            <div className="formRow">
              <div className="field">
                <label htmlFor="q-mulai">Tanggal mulai kontrak</label>
                <input
                  id="q-mulai"
                  type="date"
                  required
                  value={mulai}
                  onChange={(e) => setMulai(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="q-akhir">Tanggal akhir kontrak</label>
                <input
                  id="q-akhir"
                  type="date"
                  required
                  value={akhir}
                  onChange={(e) => setAkhir(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="q-siklus">Tanggal mulai siklus (G-0)</label>
              <input
                id="q-siklus"
                type="date"
                value={siklus}
                onChange={(e) => setSiklus(e.target.value)}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                Kosongkan untuk memakai tanggal mulai kontrak (keputusan pemilik X-05). Beku setelah
                periode 1 tutup (Rule 17).
              </span>
            </div>

            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              Saya paham ini menulis <code>STRG-</code> (dan mungkin <code>CTR-</code>) ke data
              sungguhan
            </label>

            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={submitting || !acknowledged}
              >
                {submitting ? 'Membuat…' : 'Buat Strategi M6A (STRG-)'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Apa yang harus dilihat QA di tiap jalur.                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="card">
        <div className="cardHeader">
          <h2>Cara Menjalankan Perbandingannya</h2>
        </div>
        <ol style={{ fontSize: 13, paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Jalur A:</strong> buka Service hub, isi &ldquo;Buat Strategy &amp; Plan&rdquo;.
            Menyimpan otomatis mengajukan. Minta SPV menyetujui, lalu perhatikan Service pindah ke
            [Strategy Approved] dan form Brief terbuka.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Jalur B:</strong> isi form header di atas, lalu buka{' '}
            <code>/account/strategi/{'{id}'}</code> dan jalani Section A→J: panel kekurangan hidup,
            autosave 20 detik, toggle visibilitas klien, share link, Ajukan/Setujui/Kembalikan.
          </li>
          <li>
            <strong>Yang dibandingkan:</strong> berapa lama tiap jalur diisi, seberapa banyak yang
            benar-benar dipakai SPV untuk menilai, dan &mdash; paling menentukan &mdash; setelah
            jalur B disetujui, cek bahwa Service <em>tetap</em> di [Awaiting Onboarding] dan Brief{' '}
            <em>tetap</em> tertutup.
          </li>
        </ol>
      </section>
    </div>
  );
}
