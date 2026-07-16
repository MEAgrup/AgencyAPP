'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { MasterService } from '@/lib/types';
import { formatIDR } from '@/lib/money';
import { previewQuote, type Quote, type ServiceSelection } from '@/lib/sales';

// Category display order mirrors the sales team's "Kalkulator Service Jasa"
// sheet (docs/handoff/MSL_KALKULATOR_VALIDASI.md §2). Categories not in this
// list (should not normally occur) are appended at the end so nothing the
// server returns is ever silently dropped from view.
const CATEGORY_ORDER = [
  'Store Management',
  'Ads Spending',
  'Asset Produk',
  'Konten Organik',
  'KOL & Influencer',
  'Affiliator',
  'Live & Content Service',
  'Social Proof',
] as const;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatQty(value: string | undefined): string {
  if (!value) return '—';
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return '—';
  return String(Math.trunc(n));
}

const DEBOUNCE_MS = 400;

export default function KalkulatorPenawaranPage() {
  const [services, setServices] = useState<MasterService[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Raw text entered per service row: quantity (non-passthrough) or nominal
  // rupiah (passthrough). Keyed by master_service_id.
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const requestSeq = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await api.get<{ data: MasterService[] }>(`/master-services?effective_at=${todayISO()}`);
        if (!cancelled) setServices(res.data.filter((s) => s.active));
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, MasterService>();
    (services ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, MasterService[]>();
    (services ?? []).forEach((s) => {
      const cat = s.category || '—';
      const list = byCategory.get(cat) ?? [];
      list.push(s);
      byCategory.set(cat, list);
    });
    const ordered: { category: string; services: MasterService[] }[] = [];
    CATEGORY_ORDER.forEach((cat) => {
      const list = byCategory.get(cat);
      if (list && list.length > 0) {
        ordered.push({ category: cat, services: list });
        byCategory.delete(cat);
      }
    });
    // Any leftover category the sheet ordering doesn't know about — keep it
    // visible rather than dropping it, sorted for stable ordering.
    Array.from(byCategory.keys())
      .sort()
      .forEach((cat) => ordered.push({ category: cat, services: byCategory.get(cat)! }));
    return ordered;
  }, [services]);

  function setInput(id: string, value: string) {
    setInputs((prev) => ({ ...prev, [id]: value }));
  }

  const selections = useMemo<ServiceSelection[]>(() => {
    const out: ServiceSelection[] = [];
    Object.entries(inputs).forEach(([id, raw]) => {
      const trimmed = raw.trim();
      if (trimmed === '') return;
      const svc = byId.get(id);
      if (!svc) return;
      if (svc.pricing_mode === 'passthrough') {
        const n = Number(trimmed);
        if (!Number.isNaN(n) && n > 0) {
          out.push({ master_service_id: id, amount: trimmed });
        }
      } else {
        const n = Number(trimmed);
        if (!Number.isNaN(n) && n > 0) {
          out.push({ master_service_id: id, quantity: Math.trunc(n) });
        }
      }
    });
    return out;
  }, [inputs, byId]);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (selections.length === 0) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      const seq = ++requestSeq.current;
      setQuoting(true);
      setQuoteError(null);
      try {
        const q = await previewQuote(selections);
        if (requestSeq.current === seq) {
          setQuote(q);
        }
      } catch (err) {
        if (requestSeq.current === seq) {
          setQuote(null);
          setQuoteError(errorMessage(err));
        }
      } finally {
        if (requestSeq.current === seq) setQuoting(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(selections)]);

  const subtotalByService = useMemo(() => {
    const m = new Map<string, string>();
    quote?.lines.forEach((l) => m.set(l.service_id, l.subtotal_idr));
    return m;
  }, [quote]);

  return (
    <div className="stack">
      <div>
        <h1>Kalkulator Penawaran</h1>
        <p className="muted">Pilih layanan &amp; isi kuantitas untuk menghitung Estimasi Nilai dan Perhitungan Komisi.</p>
      </div>

      {loading && <p className="muted">Memuat...</p>}
      {loadError && <div className="alert alertError">{loadError}</div>}

      {!loading && !loadError && services && services.length === 0 && (
        <div className="card emptyState">Belum ada layanan aktif.</div>
      )}

      {!loading && !loadError && groups.map(({ category, services: rows }) => (
        <section className="card" key={category}>
          <div className="cardHeader">
            <h2>{category}</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Satuan</th>
                  <th>Batas Minimal</th>
                  <th>Harga</th>
                  <th>Quantity / Nominal</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const isPassthrough = s.pricing_mode === 'passthrough';
                  const value = inputs[s.id] ?? '';
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.unit || '—'}</td>
                      <td>{formatQty(s.min_qty)}</td>
                      <td>{isPassthrough ? '—' : formatIDR(s.standard_price)}</td>
                      <td>
                        {isPassthrough ? (
                          <input
                            type="number"
                            min="0"
                            placeholder="Nominal (Rp)"
                            value={value}
                            onChange={(e) => setInput(s.id, e.target.value)}
                            style={{ width: 160 }}
                          />
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Quantity"
                            value={value}
                            onChange={(e) => setInput(s.id, e.target.value)}
                            style={{ width: 100 }}
                          />
                        )}
                      </td>
                      <td>{subtotalByService.get(s.id) ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="card">
        <div className="cardHeader">
          <h2>Ringkasan</h2>
        </div>
        {quoteError && <div className="alert alertError" role="alert">{quoteError}</div>}
        {!quoteError && selections.length === 0 && (
          <p className="muted">Pilih minimal 1 layanan untuk melihat estimasi.</p>
        )}
        {!quoteError && selections.length > 0 && (
          <div className="row" style={{ gap: 24 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Estimasi Nilai</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {quoting && !quote ? '…' : quote?.estimasi_nilai_idr ?? '—'}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Total Komisi</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {quoting && !quote ? '…' : quote?.total_komisi_idr ?? '—'}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
