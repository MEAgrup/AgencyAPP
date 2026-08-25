'use client';

/**
 * Panel "Tempel / unggah dari MEA AM Cockpit" — jembatan tool HTML lokal AM →
 * Section C/D/E.
 *
 * AM menjalankan analisa di MEA AM Cockpit (baca export "Salin/Unduh JSON" di
 * kartu atas halaman ini), menekan "Unduh JSON" di Cockpit, lalu menempel atau
 * mengunggah file itu di sini. Sama seperti VideoFactoryImportPanel: ini
 * SARAN, bukan pengganti CDPS — AM tetap meninjau lalu menyimpan lewat jalur
 * Section C/D biasa.
 *
 * Section E pilar (E-3…E-10) beda: form ini belum punya editor draft untuknya
 * (lihat SectionE.tsx), jadi tombolnya menyimpan langsung ke server lewat
 * `onApplyPillars` — bukan mengisi draft seperti bagian lain panel ini.
 */

import { useRef, useState } from 'react';
import type { DiagnosaDraftAll } from './SectionC';
import type { KpiDraft, TargetDraft } from './SectionD';
import type { NarasiDraft } from './SectionE';
import {
  applyCockpitToDiagnosa,
  applyCockpitToKpi,
  applyCockpitToNarasi,
  applyCockpitToTargets,
  buildCockpitPillars,
  parseCockpitPayload,
  type CockpitPayload,
  type CockpitPillarBody,
} from '@/lib/strategi-cockpit-import';

export default function CockpitImportPanel({
  diagnosa,
  onDiagnosa,
  kpi,
  onKpi,
  targets,
  onTargets,
  narasi,
  onNarasi,
  onApplyPillars,
  disabled,
}: {
  diagnosa: DiagnosaDraftAll;
  onDiagnosa: (draft: DiagnosaDraftAll) => void;
  kpi: KpiDraft;
  onKpi: (draft: KpiDraft) => void;
  targets: TargetDraft;
  onTargets: (draft: TargetDraft) => void;
  narasi: NarasiDraft;
  onNarasi: (draft: NarasiDraft) => void;
  /** Pilar tidak punya draft — panel ini memanggil save langsung (lihat modul note). */
  onApplyPillars: (pillars: CockpitPillarBody[]) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CockpitPayload | null>(null);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [pillarBusy, setPillarBusy] = useState(false);
  const [pillarError, setPillarError] = useState<string | null>(null);
  const [pillarMsg, setPillarMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const readPayload = (raw: string) => {
    setError(null);
    setDraftMsg(null);
    setPillarError(null);
    setPillarMsg(null);
    const parsed = parseCockpitPayload(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      setPayload(null);
      return;
    }
    setPayload(parsed.payload);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      setText(raw);
      readPayload(raw);
    };
    reader.onerror = () => setError('[gagal membaca file — coba tempel isinya langsung]');
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const applyDraft = () => {
    if (!payload) return;
    const d = applyCockpitToDiagnosa(diagnosa, payload);
    const t = applyCockpitToTargets(targets, payload);
    const k = applyCockpitToKpi(kpi, payload);
    const n = applyCockpitToNarasi(narasi, payload);
    onDiagnosa(d.draft);
    onTargets(t.draft);
    onKpi(k.draft);
    onNarasi(n.draft);
    const total = d.filled + t.filled + k.filled + n.filled;
    setDraftMsg(
      total > 0
        ? `${total} field terisi di Section C/D/E. Tinjau nilainya lalu simpan.`
        : 'Tidak ada field kosong yang cocok diisi — semua sudah terisi atau channel tidak cocok.',
    );
  };

  const pillars = payload ? buildCockpitPillars(payload) : [];

  const savePillars = async () => {
    if (!pillars.length) return;
    setPillarBusy(true);
    setPillarError(null);
    setPillarMsg(null);
    try {
      await onApplyPillars(pillars);
      setPillarMsg(`${pillars.length} pilar disimpan ke Section E.`);
    } catch (err) {
      setPillarError(err instanceof Error ? err.message : '[gagal menyimpan pilar]');
    } finally {
      setPillarBusy(false);
    }
  };

  return (
    <section
      className="card"
      style={{
        marginBottom: 16,
        padding: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface-muted, transparent)',
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Tempel / unggah dari MEA AM Cockpit</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>Section C · D · E</span>
        <span style={{ flex: 1 }} />
        {!disabled && (
          <button type="button" className="btn btnSecondary btnSm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Tutup' : 'Tempel / unggah hasil Cockpit'}
          </button>
        )}
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Di MEA AM Cockpit, jalankan analisa dari baseline lalu tekan <b>“Unduh JSON”</b> — bukan
        “Copy Draft STRG” (itu teks untuk dibaca manusia, bukan file yang bisa dibaca panel ini).
        Tempel isinya atau unggah file-nya di sini. Hanya field yang <b>masih kosong</b> yang
        diisi. Ini <b>saran</b>: tinjau lalu simpan seperti biasa.
      </p>

      {open && !disabled && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPayload(null);
            }}
            placeholder='Tempel isi file "Unduh JSON" dari MEA AM Cockpit di sini…'
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 100,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              padding: 8,
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              resize: 'vertical',
            }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btnGhost btnSm"
              onClick={() => readPayload(text)}
              disabled={!text.trim()}
            >
              Baca payload
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={onFile}
              style={{ fontSize: 12 }}
            />
            <button
              type="button"
              className="btn btnGhost btnSm"
              onClick={() => {
                setText('');
                setPayload(null);
                setError(null);
                setDraftMsg(null);
                setPillarError(null);
                setPillarMsg(null);
              }}
            >
              Bersihkan
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alertError" style={{ fontSize: 12, marginTop: 8 }}>
          {error}
        </div>
      )}

      {payload && !disabled && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <div className="alert alertInfo" style={{ fontSize: 12 }}>
            Terbaca: channel <b>{payload.channel || '(tidak ada)'}</b>. Menerapkan hanya mengisi
            field kosong pada channel ini di Section C dan D, plus E-1/E-13 kalau masih kosong.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btnPrimary btnSm" onClick={applyDraft}>
              Terapkan ke draft Section C/D/E
            </button>
          </div>
          {draftMsg && (
            <div className="alert alertInfo" style={{ fontSize: 12 }}>
              {draftMsg}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
            <strong style={{ fontSize: 13 }}>Pilar (Section E)</strong>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
              Section E belum punya editor pilar di form ini, jadi tombol ini{' '}
              <b>langsung menyimpan ke server</b> — tidak seperti bagian di atas. Pilar dari
              Cockpit yang sama (jenis + channel + aksi) akan MENGGANTI yang tersimpan sebelumnya;
              pilar lain (termasuk E-11 out-of-scope) tidak tersentuh.
            </p>
            {pillars.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>
                Tidak ada aksi yang sudah dikelompokkan ke pilar pada payload ini.
              </p>
            ) : (
              <>
                <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12 }}>
                  {pillars.map((p, i) => (
                    <li key={i}>
                      {typeof p.detail.pilar === 'string' ? p.detail.pilar : 'Pilar'} — {p.aksi} ({p.jenis})
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  disabled={pillarBusy}
                  onClick={() => void savePillars()}
                >
                  {pillarBusy ? 'Menyimpan…' : `Simpan ${pillars.length} pilar ke server`}
                </button>
              </>
            )}
            {pillarError && (
              <div className="alert alertError" style={{ fontSize: 12, marginTop: 8 }}>
                {pillarError}
              </div>
            )}
            {pillarMsg && (
              <div className="alert alertInfo" style={{ fontSize: 12, marginTop: 8 }}>
                {pillarMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
