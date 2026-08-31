'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { createSession, listVendorBriefs, PLATFORM_OPTIONS, type VendorBrief } from '@/lib/livestream';

export default function VendorNewSessionPage() {
  const router = useRouter();

  const [briefs, setBriefs] = useState<VendorBrief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [briefId, setBriefId] = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORM_OPTIONS[0]);
  const [requestedDatetime, setRequestedDatetime] = useState('');
  const [targetDurationHours, setTargetDurationHours] = useState('');
  const [productsTalent, setProductsTalent] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listVendorBriefs();
      setBriefs(res.data);
      if (res.data.length > 0) {
        setBriefId(res.data[0].id);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const session = await createSession(briefId, {
        platform,
        requested_datetime: requestedDatetime,
        target_duration_hours: targetDurationHours,
        products_talent: productsTalent || undefined,
        special_instructions: specialInstructions || undefined,
      });
      router.replace(`/vendor/sessions/${session.id}`);
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <Link href="/vendor" className="muted">&larr; Kembali</Link>
      </div>
      <h1>Buat Jadwal Live Stream Baru</h1>

      {loading && <p className="muted">Memuat...</p>}
      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      {!loading && !loadError && briefs && briefs.length === 0 && (
        <div className="emptyState">
          Belum ada Brief yang terbuka untuk jadwal baru. Hubungi Account Manager Anda di MEA Agency.
        </div>
      )}

      {!loading && !loadError && briefs && briefs.length > 0 && (
        <section className="card">
          <form className="form" onSubmit={handleSubmit}>
            {submitError && <div className="alert alertError" role="alert">{submitError}</div>}
            <div className="field">
              <label htmlFor="new-session-brief">Klien</label>
              <select id="new-session-brief" required value={briefId} onChange={(e) => setBriefId(e.target.value)}>
                {briefs.map((b) => (
                  <option key={b.id} value={b.id}>{b.client_toko}</option>
                ))}
              </select>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="new-session-platform">Platform</label>
                <select id="new-session-platform" required value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="new-session-datetime">Tanggal/Jam Jadwal</label>
                <input
                  id="new-session-datetime"
                  type="datetime-local"
                  required
                  value={requestedDatetime}
                  onChange={(e) => setRequestedDatetime(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="new-session-duration">Target Durasi (jam)</label>
              <input
                id="new-session-duration"
                type="number"
                min="0.1"
                step="0.1"
                required
                value={targetDurationHours}
                onChange={(e) => setTargetDurationHours(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-session-products">Produk/Talent yang Ditampilkan (opsional)</label>
              <input
                id="new-session-products"
                value={productsTalent}
                onChange={(e) => setProductsTalent(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-session-instructions">Instruksi Khusus (opsional)</label>
              <textarea
                id="new-session-instructions"
                rows={3}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={submitting}>
                {submitting ? 'Menyimpan...' : 'Buat Jadwal'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
