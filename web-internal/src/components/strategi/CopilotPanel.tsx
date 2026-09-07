'use client';

/**
 * B4 — "Susun draft dari AM Co-Pilot".
 *
 * Section E kosong di hampir semua Strategi (`DECISIONS.md` 2026-09-02), dan
 * rantai akibatnya panjang: pilar kosong ⇒ tidak ada yang bisa diwarisi baris
 * Plan ⇒ baris Plan mati ⇒ brief Creative tidak pernah membawa angle video.
 * Penyebabnya bukan AM malas: satu-satunya jalan mengisinya adalah tiga
 * salin-tempel JSON lewat `/tools/am-copilot` (handoff §4.2).
 *
 * Panel ini memotong rantai itu. Satu tombol memanggil
 * `GET /strategi/{id}/copilot`, yang menjalankan aturan Co-Pilot yang SAMA di
 * server atas payload Riset Awal yang sudah ada — tanpa export, tanpa file,
 * tanpa tempel. Yang muncul adalah USULAN: AM mencentang, lalu `savePillars`
 * yang menulis. Tidak ada gerbang baru; gerbangnya tetap submit → approve.
 *
 * `CockpitImportPanel` dan tombol "Salin/Unduh JSON" tetap dirender di halaman
 * ini — tool HTML masih jalur mundur yang sah saat klien belum punya payload
 * analisa (mis. baseline manual).
 */

import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { getStrategiCopilot, type StrategiCopilotUsulan } from '@/lib/strategi';
import type { CockpitPillarBody } from '@/lib/strategi-cockpit-import';
import { buildCopilotPillars, kunciAksi, semuaKunci } from '@/lib/strategi-copilot';

export default function CopilotPanel({
  strategiId,
  onApplyPillars,
  disabled,
}: {
  strategiId: string;
  /** Sama dengan jalur CockpitImportPanel: saveStrategiPillars + mergeCockpitPillars. */
  onApplyPillars: (pillars: CockpitPillarBody[]) => Promise<void>;
  disabled: boolean;
}) {
  const [usulan, setUsulan] = useState<StrategiCopilotUsulan | null>(null);
  const [dipilih, setDipilih] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [kosong, setKosong] = useState(false);

  const susun = async () => {
    setBusy(true);
    setError(null);
    setPesan(null);
    setKosong(false);
    try {
      const u = await getStrategiCopilot(strategiId);
      if (u === null) {
        setUsulan(null);
        setKosong(true);
        return;
      }
      setUsulan(u);
      // Semua tercentang di awal: usulan yang menyala sudah lolos pemicunya,
      // jadi kerja AM adalah MENCABUT yang tidak relevan, bukan mencari ulang.
      setDipilih(new Set(semuaKunci(u)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (kunci: string) => {
    setDipilih((cur) => {
      const next = new Set(cur);
      if (next.has(kunci)) next.delete(kunci);
      else next.add(kunci);
      return next;
    });
  };

  const simpan = async () => {
    if (!usulan) return;
    const rows = buildCopilotPillars(usulan, dipilih);
    if (rows.length === 0) {
      setError('Belum ada aksi yang dicentang.');
      return;
    }
    setBusy(true);
    setError(null);
    setPesan(null);
    try {
      await onApplyPillars(rows);
      setPesan(`${rows.length} pilar tersimpan ke Section E.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const totalAksi = usulan ? semuaKunci(usulan).length : 0;

  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>AM Co-Pilot</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          menyusun draft pilar E-3…E-10 dari Riset Awal — tanpa export, tanpa tempel JSON
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btnSecondary btnSm"
          onClick={susun}
          disabled={busy || disabled}
        >
          {busy ? 'Menyusun…' : 'Susun draft dari AM Co-Pilot'}
        </button>
      </div>

      {error && (
        <div className="alert alertError" style={{ marginTop: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {pesan && (
        <div className="alert alertInfo" style={{ marginTop: 8, fontSize: 13 }}>
          {pesan}
        </div>
      )}
      {kosong && (
        <div className="alert alertInfo" style={{ marginTop: 8, fontSize: 13 }}>
          Klien ini belum punya Riset Awal ber-skor, jadi belum ada yang bisa disusun otomatis.
          Isi Section E manual, atau jalankan Riset Awal dengan export platform lebih dulu.
        </div>
      )}

      {usulan && (
        <div style={{ marginTop: 10 }}>
          {usulan.channels.map((c) => (
            <div
              key={c.client_platform_id}
              style={{
                marginTop: 8,
                padding: 8,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
              }}
            >
              <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{c.channel === 'Lainnya' && c.channel_lain ? c.channel_lain : c.channel}</strong>
                {c.periode_referensi && (
                  <span className="badge badge-gray" style={{ fontWeight: 400 }}>
                    periode {c.periode_referensi}
                  </span>
                )}
                {c.benchmark_versi != null && (
                  <span className="badge badge-gray" style={{ fontWeight: 400 }}>
                    benchmark v{c.benchmark_versi}
                  </span>
                )}
              </div>

              {/* Yang TIDAK bisa diusulkan dikatakan, bukan didiamkan. */}
              {c.catatan.map((t) => (
                <p key={t} className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {t}
                </p>
              ))}

              {c.pilar.map((p) => (
                <div key={p.urutan} style={{ marginTop: 8 }}>
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{p.label}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {p.divisi} · jenis {p.jenis}
                      {p.skor_baseline != null ? ` · skor baseline ${p.skor_baseline}` : ''}
                    </span>
                  </div>
                  {p.aksi.map((a) => {
                    const k = kunciAksi(c, a);
                    return (
                      <label
                        key={k}
                        className="row"
                        style={{ alignItems: 'flex-start', gap: 8, marginTop: 6, fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={dipilih.has(k)}
                          disabled={disabled}
                          onChange={() => toggle(k)}
                        />
                        <span>
                          <b>
                            {a.kode} · {a.nama}
                          </b>
                          {a.quick_win && (
                            <span className="badge badge-gray" style={{ fontWeight: 400, marginLeft: 6 }}>
                              quick win
                            </span>
                          )}
                          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                            {a.target}
                          </span>
                          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                            Kenapa: {a.alasan}
                          </span>
                          {a.aturan_terkunci && (
                            <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                              {a.aturan_terkunci.label}
                              {a.aturan_terkunci.sudah_terlampaui ? ' — sudah terlampaui' : ''}
                            </span>
                          )}
                          {a.angle.length > 0 && (
                            <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                              Angle video yang sudah perform:
                              <ul style={{ margin: '2px 0 0 16px' }}>
                                {a.angle.map((g) => (
                                  <li key={g.judul}>{g.ringkas}</li>
                                ))}
                              </ul>
                            </span>
                          )}
                          {a.catatan && (
                            <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                              {a.catatan}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}

          {totalAksi > 0 && (
            <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {dipilih.size} dari {totalAksi} aksi dicentang
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btnPrimary btnSm"
                onClick={simpan}
                disabled={busy || disabled || dipilih.size === 0}
              >
                Simpan pilar terpilih ke Section E
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
